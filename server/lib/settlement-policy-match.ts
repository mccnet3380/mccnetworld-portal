// server/lib/settlement-policy-match.ts
//
// 작업명: MCC_SETTLEMENT_MONTHLY_ISOLATION_AND_STALE_POLICY_REMATCH_FIX_1
//
// server/routes.ts의 POST /api/admin/settlement/match, POST /api/admin/settlement/rematch가
// 각자 인라인으로 갖고 있던 findPvAt()/matchRow() 판정 로직을 그대로(1글자도 바꾸지 않고)
// 옮겨 담은 공용 모듈이다. 기존 두 라우트는 이번 작업에서 건드리지 않는다(회귀 위험 회피 —
// 이미 검증된 경로를 그대로 둔다). 이 파일은 신규 STALE REVALIDATION 기능(§5~§9)에서만
// import해서 쓴다 — "정책 계산 규칙을 두 군데로 복제하지 말 것"(§7) 요구를 지키기 위해
// 세 번째 복사본을 만드는 대신 여기 한 곳만 만들고 신규 코드가 이걸 가져다 쓴다.
//
// LOCK: matchRow()/findPvAt()의 판정 규칙 자체는 원본 라우트의 로직과 정확히 동일해야
// 한다 — 새 규칙을 발명하지 않는다.

import { normalizeCustomerType, normalizePlanNameForMatching } from "./activation-normalize";

export interface PolicyVersionLike {
  id: number;
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
}

/** /match, /rematch와 동일한 findPvAt() — 활성 정책 배열에서 날짜에 맞는 첫 번째 차수를 반환 */
export function buildFindPvAt(activePvs: PolicyVersionLike[]) {
  return (at: Date): PolicyVersionLike | null => {
    for (const p of activePvs) {
      const from = new Date(p.effectiveFrom);
      const to = p.effectiveTo ? new Date(p.effectiveTo) : null;
      if (from <= at && (!to || to > at)) return p;
    }
    return null;
  };
}

function normalize(v: any): string {
  return String(v ?? "").trim();
}

/** /match, /rematch와 동일한 matchRow() */
export function matchPolicyRow(activation: any, row: any, exclude: Set<string>): "exact" | "wildcard" | "none" {
  if (activation.channel !== row.channel) return "none";
  if (normalizePlanNameForMatching(activation.planName) !== normalizePlanNameForMatching(row.planName)) return "none";
  if (normalizeCustomerType(activation.customerType) !== normalizeCustomerType(row.customerType)) return "none";

  const actNat = normalize(activation.nationalityType || "내국인");
  const rowNat = normalize(row.nationalityType || "");
  let natResult: "exact" | "wildcard";
  if (rowNat === "") {
    natResult = "wildcard";
  } else if (actNat === rowNat) {
    natResult = "exact";
  } else {
    return "none";
  }

  const optionals: { actKey: string; rowKey: string }[] = [
    { actKey: "simCount", rowKey: "simCount" },
    { actKey: "bundleType", rowKey: "bundleType" },
    { actKey: "addService", rowKey: "addService" },
    { actKey: "regFeeType", rowKey: "regFeeType" },
  ];
  for (const { actKey, rowKey } of optionals) {
    if (exclude.has(rowKey)) continue;
    const rv = row[rowKey];
    if (rv === null || rv === undefined || rv === "") continue;
    if (normalize(activation[actKey]) !== normalize(rv)) return "none";
  }
  return natResult;
}

/** /match, /rematch와 동일한 MATCH_PASSES 폴백 시퀀스 */
export const SETTLEMENT_MATCH_PASSES: Array<{ exclude: Set<string>; isAuto: boolean }> = [
  { exclude: new Set([]), isAuto: true }, // 완전일치
  { exclude: new Set(["addService"]), isAuto: false }, // 부가서비스 제외
  { exclude: new Set(["bundleType"]), isAuto: false }, // 결합 제외
  { exclude: new Set(["regFeeType"]), isAuto: false }, // 가입비 제외
];

export interface ResolvedPolicyMatch {
  policyVersionId: number | null;
  policyRowId: number | null;
  matchStatus: "AUTO_MATCH" | "REVIEW_REQUIRED" | "POLICY_NOT_FOUND";
  matchedRow: any | null;
}

export interface NewActivationSettlementDeps {
  /** /match와 동일: 활성 정책 차수 전체(effectiveFrom 정렬은 호출측 getPolicyVersions()가 보장) */
  getActivePolicyVersions: () => Promise<PolicyVersionLike[]>;
  getPvRows: (policyVersionId: number) => Promise<any[]>;
  /** activation_id 기준 기존 settlement_item 존재 여부 — 있으면 SKIP(§7 LOCK) */
  hasExistingSettlementItem: (activationId: number) => Promise<boolean>;
  calculateSettlementAdjustments: (activation: any, policyVersionId: number) => Promise<{ addAmount: number; deductAmount: number }>;
  calculateHiddenAmount: (activation: any) => Promise<number>;
  createSettlementItem: (data: any) => Promise<any>;
}

export interface NewActivationSettlementResult {
  created: number;
  skipped: number;
  autoMatch: number;
  reviewRequired: number;
  policyNotFound: number;
  errors: string[];
}

/**
 * 작업명: MCC_SETTLEMENT_IMPORT_AUTO_CREATE_AND_POLICY_MATCH_PIPELINE_1
 *
 * "신규로 생성된 activation_records"만 대상으로 settlement_item을 생성한다.
 * /match 라우트(server/routes.ts)의 per-activation 루프 본문(정책 선택 → MATCH_PASSES →
 * dealerRegistrationId 없으면 강등 → addAmount/deductAmount/hiddenAmount 계산 →
 * createSettlementItem)과 동일한 순서/판정을 재사용한다 — /match 라우트 자체는 회귀 위험
 * 회피를 위해 건드리지 않고 그대로 둔다(§8 LOCK).
 *
 * 불변식: activation_id에 이미 settlement_item이 있으면 SKIP, 없을 때만 CREATE.
 * 기존 row는 절대 UPDATE하지 않는다.
 */
export async function createSettlementItemsForNewActivations(
  activations: any[],
  deps: NewActivationSettlementDeps,
): Promise<NewActivationSettlementResult> {
  const result: NewActivationSettlementResult = {
    created: 0, skipped: 0, autoMatch: 0, reviewRequired: 0, policyNotFound: 0, errors: [],
  };
  if (activations.length === 0) return result;

  const activePvs = await deps.getActivePolicyVersions();
  const findPvAt = buildFindPvAt(activePvs);
  const pvRowCache = new Map<number, any[]>();
  const getPvRowsCached = async (pvId: number): Promise<any[]> => {
    if (!pvRowCache.has(pvId)) pvRowCache.set(pvId, await deps.getPvRows(pvId));
    return pvRowCache.get(pvId)!;
  };

  for (const activation of activations) {
    try {
      const exists = await deps.hasExistingSettlementItem(activation.id);
      if (exists) {
        result.skipped++;
        continue;
      }

      const refDatetime = activation.receptionDatetime ?? activation.activationDatetime;
      const pv = refDatetime ? findPvAt(new Date(refDatetime)) : null;
      const activeRows = pv ? await getPvRowsCached(pv.id) : [];

      let matchedRow: any = null;
      let matchStatus: "AUTO_MATCH" | "REVIEW_REQUIRED" | "POLICY_NOT_FOUND" = "POLICY_NOT_FOUND";

      for (const { exclude, isAuto } of SETTLEMENT_MATCH_PASSES) {
        const exactFound = activeRows.find((r: any) => matchPolicyRow(activation, r, exclude) === "exact");
        if (exactFound) {
          matchedRow = exactFound;
          matchStatus = isAuto ? "AUTO_MATCH" : "REVIEW_REQUIRED";
          break;
        }
        const wildcardFound = activeRows.find((r: any) => matchPolicyRow(activation, r, exclude) === "wildcard");
        if (wildcardFound) {
          matchedRow = wildcardFound;
          matchStatus = "REVIEW_REQUIRED";
          break;
        }
      }

      if (matchStatus === "AUTO_MATCH" && !activation.dealerRegistrationId) {
        matchStatus = "REVIEW_REQUIRED";
      }

      let adjAddAmount: string | null = null;
      let adjDeductAmount: string | null = null;
      if (matchedRow && pv?.id) {
        try {
          const adj = await deps.calculateSettlementAdjustments(activation, pv.id);
          if (adj.addAmount > 0) adjAddAmount = String(adj.addAmount);
          if (adj.deductAmount > 0) adjDeductAmount = String(adj.deductAmount);
        } catch (_) {}
      }

      let adjHiddenAmount: string | null = null;
      try {
        const hidden = await deps.calculateHiddenAmount(activation);
        if (hidden !== 0) adjHiddenAmount = String(hidden);
      } catch (_) {}

      await deps.createSettlementItem({
        activationId: activation.id,
        policyVersionId: matchedRow ? (pv?.id ?? null) : null,
        policyRowId: matchedRow ? matchedRow.id : null,
        dealerRegistrationId: activation.dealerRegistrationId ?? null,
        dealerName: activation.dealerName ?? null,
        rebateAmount: matchedRow ? String(matchedRow.rebateAmount) : null,
        adjustedAmount: null,
        addAmount: adjAddAmount,
        deductAmount: adjDeductAmount,
        hiddenAmount: adjHiddenAmount,
        matchStatus,
        status: "미정산",
        policySnapshotJson: matchedRow ?? null,
      });

      result.created++;
      if (matchStatus === "AUTO_MATCH") result.autoMatch++;
      else if (matchStatus === "REVIEW_REQUIRED") result.reviewRequired++;
      else result.policyNotFound++;
    } catch (err: any) {
      result.errors.push(`activation_id ${activation.id}: ${String(err?.message ?? "").substring(0, 80)}`);
    }
  }

  return result;
}

/**
 * 한 건의 activation을 현재 활성 정책 기준으로 재평가한다. /match의 per-activation 루프
 * 본문(정책 선택 → MATCH_PASSES → dealerRegistrationId 없으면 강등)과 동일한 순서/판정을
 * 그대로 재사용한다. addAmount/deductAmount/hiddenAmount 계산은 포함하지 않는다 — 이
 * 함수는 STALE REVALIDATION 전용이며, 그 기능은 정책 참조/matchStatus/rebateAmount만
 * 재평가하고 수동 조정 금액은 건드리지 않아야 하기 때문이다(§8 LOCK).
 */
export async function resolvePolicyMatchForActivation(
  activation: {
    channel: string | null;
    planName: string | null;
    customerType: string | null;
    nationalityType: string | null;
    bundleType: string | null;
    addService: string | null;
    regFeeType: string | null;
    simCount: number | null;
    dealerRegistrationId: number | null;
    receptionDatetime: Date | string | null;
    activationDatetime: Date | string;
  },
  activePvs: PolicyVersionLike[],
  getPvRows: (policyVersionId: number) => Promise<any[]>,
): Promise<ResolvedPolicyMatch> {
  const findPvAt = buildFindPvAt(activePvs);
  const refDatetime = activation.receptionDatetime ?? activation.activationDatetime;
  const pv = refDatetime ? findPvAt(new Date(refDatetime)) : null;
  const activeRows = pv ? await getPvRows(pv.id) : [];

  let matchedRow: any = null;
  let matchStatus: ResolvedPolicyMatch["matchStatus"] = "POLICY_NOT_FOUND";

  for (const { exclude, isAuto } of SETTLEMENT_MATCH_PASSES) {
    const exactFound = activeRows.find((r: any) => matchPolicyRow(activation, r, exclude) === "exact");
    if (exactFound) {
      matchedRow = exactFound;
      matchStatus = isAuto ? "AUTO_MATCH" : "REVIEW_REQUIRED";
      break;
    }
    const wildcardFound = activeRows.find((r: any) => matchPolicyRow(activation, r, exclude) === "wildcard");
    if (wildcardFound) {
      matchedRow = wildcardFound;
      matchStatus = "REVIEW_REQUIRED";
      break;
    }
  }

  if (matchStatus === "AUTO_MATCH" && !activation.dealerRegistrationId) {
    matchStatus = "REVIEW_REQUIRED";
  }

  return {
    policyVersionId: matchedRow ? (pv?.id ?? null) : null,
    policyRowId: matchedRow ? matchedRow.id : null,
    matchStatus,
    matchedRow,
  };
}
