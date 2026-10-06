// server/lib/data-scope.ts
//
// 작업명: MCC_RBAC_PHASE_2D_DATA_SCOPE_FOUNDATION_AND_SAFE_ENFORCEMENT_1
// (LEGACY_COMPAT 추가: MCC_RBAC_PHASE_2E_PRE_TRANSITION_SAFETY_AND_TYPING_PERMISSION_AUDIT_1)
//
// RBAC가 "이 기능을 쓸 수 있는가"(permission)를 답했다면, 이 모듈은 "그 기능에서
// 어느 범위의 데이터를 볼 수 있는가"(scope)를 답한다. 반드시 RESOURCE + PERMISSION +
// PRINCIPAL 조합으로 계산한다 — "이 사용자가 가진 역할 중 가장 넓은 역할 하나"를
// 전역으로 골라 쓰는 모델은 절대 금지(한 리소스에서 ALL인 역할을 가졌다고 다른
// 리소스까지 ALL이 되면 안 됨).
//
// ---------------------------------------------------------------------------
// 세 가지 결과 모드
// ---------------------------------------------------------------------------
// - LEGACY: 호출부가 기존 레거시 접근 로직을 "그대로" 타야 한다 — 이 모듈이 뭔가를
//   더 제한하거나 넓히면 안 된다. 두 가지 경로로 도달한다(reason 필드로 구분):
//     · NO_ROLE: principal에게 RBAC role이 전혀 없음(현재 모든 일반 worker/dealer).
//     · LEGACY_COMPAT: principal에게 RBAC role이 있지만, 그 역할이 이 resource+
//       permission에 대해 "아직 RBAC로 전환되지 않았고 기존 접근을 유지해도 안전함"이
//       명시적으로 등록되어 있음(LEGACY_COMPAT_POLICY). 이 등록이 없으면 절대 LEGACY로
//       떨어지지 않는다 — fail-closed 유지(아래 DENY 참고).
// - DENY: RBAC role이 있는 principal인데, 그 역할들 중 이 resource+permission에
//   대해 정의된 scope도 없고 LEGACY_COMPAT 등록도 없음(정책 공백 — 데이터 이상에
//   준하는 상황). 절대 ALL이나 LEGACY로 처리하지 않는다 — 호출부는 빈 결과 또는
//   403/503으로 처리해야 한다.
// - RBAC: 실제 scope 목록을 반환한다. 여러 역할의 scope는 OR(합집합)으로 합성하고,
//   그 중 하나라도 ALL이면 전체가 ALL로 수렴한다(ALL dominates).
//
// ---------------------------------------------------------------------------
// LEGACY_COMPAT가 필요한 이유 — "role 하나 배정하면 업무가 막히는" 사고 방지
// ---------------------------------------------------------------------------
// 2E 설계 중 발견된 문제: 지금은 OWNER/ADMIN 외 어떤 role도 DOCUMENT_READ scope
// 정책이 없다. 그 상태에서 어떤 worker(NO_ROLE_USER, 현재 LEGACY)에게 예를 들어
// MIDDLE_MANAGER role을 "시험 삼아" 하나 배정하면, roleCodes.length가 0에서 1로
// 바뀌어 더 이상 LEGACY 분기를 타지 않고 RBAC 분기로 들어간다. MIDDLE_MANAGER는
// DATA_SCOPE_POLICY에 DOCUMENT_READ 항목이 없으므로 scopes.size===0 → DENY →
// GET /api/documents가 403으로 막힌다. 즉 "role을 주는 것"이 "접근을 뺏는 것"이
// 되어버리는 역설이 생긴다.
//
// 이를 "정책이 없으면 LEGACY로 fallback"하는 암묵적 규칙으로 풀면 fail-closed가
// 깨진다(어떤 role이든 정의만 안 해두면 전부 LEGACY=느슨한 접근이 되어버림). 그래서
// 대신 LEGACY_COMPAT_POLICY라는 별도의 명시적 화이트리스트를 둔다 — "이 role은 이
// resource+permission에서 기존 코드 경로와 섞여도 안전하다"고 사람이 한 줄씩 적어넣은
// 경우에만 LEGACY로 떨어지고, 그 외 미등록 role+resource+permission 조합은 여전히
// DENY다. 현재 GET /api/documents/GET /api/documents/export/excel는 세션의
// userType==='user' 여부로만 분기하고 users.role(middle_manager 등 legacy 문자열)을
// 전혀 보지 않으므로, USER principal에 어떤 "내부 직원" 성격의 role(MIDDLE_MANAGER/
// ACTIVATION/AUDIT/SETTLEMENT/SALES)을 배정해도 기존 코드 동작은 그대로다 — 이 role들만
// 화이트리스트에 올린다. SALES_MANAGER는 로그인 자체가 구조적으로 막혀 있어(그리고
// 만약 뚫린다면 기존 필터 조건에 걸리지 않아 의도치 않게 전체가 노출되는 코드 공백이
// 있음) 화이트리스트에 넣지 않는다 — "추측 금지" 원칙에 따라 안전한 쪽(DENY)에 둔다.
// ---------------------------------------------------------------------------
// DEALER 식별은 RBAC role과 별개의 "구조적" 사실이다
// ---------------------------------------------------------------------------
// 현재 운영 user_roles에는 DEALER role이 전혀 배정되어 있지 않다(판매점 계정은
// RBAC 역할 없이 전부 LEGACY 상태). 그런데도 dealer 계정은 users.dealerId 또는
// users.dealerRegistrationId가 채워져 있다는 사실 자체로 이미 "판매점 계정"임이
// 구조적으로 결정되어 있고(server/routes.ts의 getDealerAccessContext()가 쓰는
// 바로 그 기준), 이 사실은 RBAC role 배정 여부와 무관하게 항상 OWN_DEALER로
// 수렴해야 한다 — 그래야 "RBAC role이 없으니 LEGACY인데, LEGACY 처리 중 우연히
// dealer 전용 필터가 빠지는" 사고(아래 참고)를 원천적으로 막을 수 있다.
//
// 참고: server/routes.ts의 GET /api/documents, GET /api/documents/export/excel는
// 클라이언트가 보내는 allWorkers=true 쿼리 파라미터 하나로 dealer 소유권 필터
// 자체를 건너뛸 수 있는 구조였다(storage.ts getDocuments()의 "!filters.allWorkers"
// 조건). 단건 조회/수정 경로(assertDocumentAccessForDealer)는 쿼리파라미터와
// 무관한 세션+문서 기준 가드라 안전했지만, 목록/엑스포트 경로는 그렇지 않았다.
// 이번 작업에서 그 두 endpoint에만 이 resolver 기반 enforcement를 적용해 dealer가
// 클라이언트 파라미터로 자기 범위를 벗어나지 못하게 한다 — 기존 ownership 로직을
// 대체하는 게 아니라, 같은 식별 기준(dealerId/dealerRegistrationId)을 "클라이언트가
// 끄고 켤 수 없게" 강제하는 것이다.

import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { users } from "../../shared/schema";
import { getPrincipalRoles, type PrincipalType } from "./rbac";

export type ScopeType = "ALL" | "TEAM" | "ASSIGNED" | "OWN" | "OWN_DEALER";

// 과도한 resource 분할 금지 — 이번 단계에서 실제로 enforcement하는 대상만 정의.
// 감사는 더 넓게 했지만(TEAM/ASSIGNED/OWN 다수가 NOT_READY), 정책 테이블에는
// "실제로 쓰는" 값만 넣는다. 나중에 TEAM/ASSIGNED 등이 준비되면 그때 추가한다.
export type ResourceCode = "DOCUMENT";

export interface DataScopeRequest {
  principalType: PrincipalType;
  principalId: number;
  permissionCode: string;
  resource: ResourceCode;
}

export type DataScopeResult =
  | { mode: "LEGACY"; reason: "NO_ROLE" | "LEGACY_COMPAT"; matchedRole?: string }
  | { mode: "DENY" }
  | { mode: "RBAC"; scopes: ScopeType[] };

// resource -> permissionCode -> roleCode -> scopes.
// OWNER/ADMIN은 현재 이 작업에서 enforcement하는 모든 resource에서 ALL —
// 기존 동작과 동일하게 유지한다는 원칙(섹션 13-A) 그대로.
const DATA_SCOPE_POLICY: Record<ResourceCode, Record<string, Record<string, ScopeType[]>>> = {
  DOCUMENT: {
    DOCUMENT_READ: {
      OWNER: ["ALL"],
      ADMIN: ["ALL"],
    },
  },
};

// resource -> permissionCode -> "이 role을 가진 USER principal에게 이 resource+
// permission은 아직 RBAC로 전환되지 않았으니 기존 코드 경로(LEGACY)를 그대로 써도
// 안전하다"고 명시적으로 등록한 화이트리스트. 정책 공백을 암묵적으로 LEGACY로
// 떨어뜨리는 것이 아니라, 사람이 코드를 직접 추적해 "안전함을 확인한" 조합만 적는다
// (파일 상단 설명 참고). 등록되지 않은 role+resource+permission 조합은 여전히 DENY다.
//
// 근거(MCC_RBAC_PHASE_2E_PRE_TRANSITION_SAFETY_AND_TYPING_PERMISSION_AUDIT_1에서 확인):
// GET /api/documents / GET /api/documents/export/excel는 세션의 userType==='user'
// 여부로만 분기하고 users.role(middle_manager 등) 문자열은 전혀 보지 않는다. 즉
// USER principal이 어떤 "내부 직원" 성격의 role을 가지고 있어도 documents 목록/
// export 동작은 role과 무관하게 동일하다(dealerId 유무 → dealerId/userId fallback
// → allWorkers 토글, 기존 그대로). 따라서 아래 5개 role은 안전하게 등록 가능.
// SALES_MANAGER는 제외했다 — principalType='SALES_MANAGER'는 이 route의 어떤
// userType==='user' 분기에도 걸리지 않아(로그인 자체도 구조적으로 막혀 있음) "기존
// 코드 경로"가 무엇을 의미하는지조차 불명확하다. 추측 금지 원칙에 따라 DENY로 둔다.
const LEGACY_COMPAT_POLICY: Record<ResourceCode, Record<string, Set<string>>> = {
  DOCUMENT: {
    DOCUMENT_READ: new Set(["MIDDLE_MANAGER", "ACTIVATION", "AUDIT", "SETTLEMENT", "SALES"]),
  },
};

async function getDealerIdentity(
  userId: number,
): Promise<{ dealerId: number | null; dealerRegistrationId: number | null } | null> {
  const db = await getDatabase();
  const rows = await db
    .select({ dealerId: users.dealerId, dealerRegistrationId: users.dealerRegistrationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.dealerId == null && row.dealerRegistrationId == null) return null;
  return row;
}

// USER principal이 dealer 계정인지 구조적으로 판정한다. username/role 문자열이
// 아니라 getDealerAccessContext()와 동일한 기준(dealerId/dealerRegistrationId
// 존재 여부)을 쓴다 — RBAC principal 자체를 dealerRegistrationId로 바꾸지 않는다
// (principalId는 여전히 users.id).
export async function getDealerIdentityForPrincipal(
  principalType: PrincipalType,
  principalId: number,
): Promise<{ dealerId: number | null; dealerRegistrationId: number | null } | null> {
  if (principalType !== "USER") return null;
  return getDealerIdentity(principalId);
}

export async function resolveDataScope(req: DataScopeRequest): Promise<DataScopeResult> {
  // 1. 구조적 DEALER 식별 — RBAC role 배정 여부와 무관하게 항상 우선한다.
  if (req.resource === "DOCUMENT" && req.principalType === "USER") {
    const dealerIdentity = await getDealerIdentity(req.principalId);
    if (dealerIdentity) {
      return { mode: "RBAC", scopes: ["OWN_DEALER"] };
    }
  }

  // 2. RBAC role 기반 정책.
  const roleCodes = await getPrincipalRoles(req.principalType, req.principalId);
  if (roleCodes.length === 0) {
    // NO_ROLE_USER — 절대 ALL이 아니라 LEGACY(기존 코드 경로 그대로).
    return { mode: "LEGACY", reason: "NO_ROLE" };
  }

  const scopes = new Set<ScopeType>();
  for (const roleCode of roleCodes) {
    const roleScopes = DATA_SCOPE_POLICY[req.resource]?.[req.permissionCode]?.[roleCode];
    if (roleScopes) {
      for (const s of roleScopes) scopes.add(s);
    }
  }

  if (scopes.size > 0) {
    if (scopes.has("ALL")) {
      return { mode: "RBAC", scopes: ["ALL"] };
    }
    return { mode: "RBAC", scopes: Array.from(scopes) };
  }

  // 3. 명시적 scope 정책이 없다 — 암묵적으로 LEGACY로 떨어뜨리지 않는다. 오직
  // LEGACY_COMPAT_POLICY에 "이 role은 안전하다"고 등록된 경우에만 LEGACY를 허용한다
  // (파일 상단 설명 참고 — role 하나 배정이 접근을 뺏어가는 사고 방지).
  const legacyCompatRoles = LEGACY_COMPAT_POLICY[req.resource]?.[req.permissionCode];
  if (legacyCompatRoles) {
    const matchedRole = roleCodes.find((rc) => legacyCompatRoles.has(rc));
    if (matchedRole) {
      return { mode: "LEGACY", reason: "LEGACY_COMPAT", matchedRole };
    }
  }

  // RBAC가 배정된 principal인데 이 resource+permission에 대한 scope 정책도
  // LEGACY_COMPAT 등록도 전혀 없음 — fail-closed. 절대 ALL이나 LEGACY로 넘기지 않는다.
  return { mode: "DENY" };
}
