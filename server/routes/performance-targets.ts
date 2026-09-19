// server/routes/performance-targets.ts
//
// 작업명: MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1
//
// 관리자 전용: 근무자 ↔ Spreadsheet worker 명시적 매핑 관리 + 월별 목표 기여도(%) 관리.
// 새 독립 관리자 시스템이 아니라 기존 AdminPanel 사용자 관리에 붙는 최소 API다.
//
// worker 목록은 별도 파서를 새로 만들지 않고 기존 computePerformanceDataset()이 이미
// 계산한 dataset.workers를 그대로 재사용한다.

import { Router } from "express";
import { getStorage } from "../storage";
import { workerHomeNetwork } from "../lib/performance-classify";
import { resolveRangeDates, discoverWorkerNamesForDates, createLedgerCache } from "../lib/personal-performance";

const router = Router();

async function requireAdminSession(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  req.session = session;
  next();
}

function parseYearMonth(q: any): { year: number; month: number } | null {
  const year = Number(q.year);
  const month = Number(q.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

// [MCC_PERSONAL_PERFORMANCE_REAL_DATA_QA_1] 원래 computePerformanceDataset(new Date())로
// "오늘" 하루만 조회했는데, 실제 dev 환경 QA에서 오늘자 "■당일완료"에 아직 등록된 처리
// 건수가 0건이면 dataset.workers가 완전히 빈 배열이 되어 관리자 매핑 dropdown에 선택지가
// 하나도 없는 실제 버그를 발견했다(그날 첫 처리가 올라오기 전까지, 또는 휴일에는 매핑 자체가
// 불가능해짐). "이번 달 1일~오늘"로 넓혔다.
//
// [MCC_PERFORMANCE_WORKER_MAPPING_DROPDOWN_FIX_1] 그런데도 Production에서 여전히
// workers=[]가 반환되는 문제가 다시 발견됐다 — 원인은 "이번 달 1일~오늘" 범위를 봐도
// "■당일완료" 단일 시트에 이번 달 데이터가 아직 하나도 없으면 여전히 빈 배열이라는 것.
// 기존 실적관리(performance-calc.ts의 buildSourceBlock)는 "확정 실적 source"로
// ■당일완료 하나만 보지 않는다 — "기타 완료" 집계에 ■변경완료/00700결합도 동일하게
// "작업자/개통일" 컬럼을 갖는 소스로 취급한다(LOCK 파일 그대로, 무수정 확인). 그래서
// worker 이름 discovery만 이 3개 시트를 전부 보도록 personal-performance.ts에
// discoverWorkerNamesForDates()를 추가해서 재사용한다(계산 공식은 전혀 건드리지 않음 —
// 이 함수는 이름 목록만 만들고 실적 숫자를 계산하지 않는다). 이름은 시트에서 발견된
// 문자열 그대로만 사용한다 — 추정/변환 없음.
router.get("/api/admin/performance/worker-options", requireAdminSession, async (_req, res) => {
  try {
    const today = new Date();
    const cache = createLedgerCache();
    const monthDates = resolveRangeDates("month", today);
    const names = await discoverWorkerNamesForDates(monthDates, cache);
    res.set("Cache-Control", "no-store");
    res.json({ workers: names });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 내부 worker 전체 + 현재 매핑 + 지정한 연월의 목표(있으면) */
router.get("/api/admin/performance/targets", requireAdminSession, async (req, res) => {
  const ym = parseYearMonth(req.query);
  if (!ym) return res.status(400).json({ error: "year/month가 필요합니다(month는 1-12)." });

  try {
    const [workers, targets] = await Promise.all([
      getStorage().listInternalWorkersWithMapping(),
      getStorage().listPerformanceTargetsForMonth(ym.year, ym.month),
    ]);
    const targetByUserId = new Map(targets.map((t: any) => [t.userId, t]));

    const rows = workers.map((w: any) => {
      const t = targetByUserId.get(w.id);
      return {
        userId: w.id,
        name: w.name,
        username: w.username,
        performanceWorkerName: w.performanceWorkerName || null,
        homeNetwork: w.performanceWorkerName ? workerHomeNetwork(w.performanceWorkerName) : null,
        targetContributionRate: t?.targetContributionRate != null ? Number(t.targetContributionRate) : null,
        changeTargetRate: t?.changeTargetRate != null ? Number(t.changeTargetRate) : null,
        // [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 월과 무관한 계정 단위 값이라
        // 매달 동일하게 포함한다 — 실적현황 roster 병합/근무자 관리 화면에서 사용.
        hireDate: w.hireDate || null,
        terminationDate: w.terminationDate || null,
      };
    });

    res.set("Cache-Control", "no-store");
    res.json({ year: ym.year, month: ym.month, workers: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4: 개통 목표(targetContributionRate)와
// 변경 목표(changeTargetRate)는 독립된 값이라 각각 선택적으로 보낼 수 있다 — 최소 하나는
// 있어야 하고, 보내지 않은 쪽은 storage 계층에서 기존 값을 그대로 둔다(덮어쓰지 않음).
function parseOptionalRate(v: unknown): number | undefined | null {
  if (v === undefined) return undefined; // 이 필드는 건드리지 않음
  if (v === null) return null; // 명시적으로 null이면? 현재는 지원 안 함(아래에서 걸러냄)
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** 월별 목표(개통/변경) upsert — userId+year+month 단위, 자동 복사 없음, 두 목표는 독립 저장 */
router.put("/api/admin/performance/targets", requireAdminSession, async (req, res) => {
  const { userId, year, month, targetContributionRate, changeTargetRate } = req.body || {};
  if (!Number.isInteger(userId) || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "userId/year/month가 필요합니다(month는 1-12)." });
  }

  const parsedTarget = parseOptionalRate(targetContributionRate);
  const parsedChange = parseOptionalRate(changeTargetRate);
  if (parsedTarget === null || parsedChange === null) {
    return res.status(400).json({ error: "targetContributionRate/changeTargetRate는 0 이상 숫자여야 합니다." });
  }
  if (parsedTarget === undefined && parsedChange === undefined) {
    return res.status(400).json({ error: "targetContributionRate 또는 changeTargetRate 중 최소 하나는 보내야 합니다." });
  }

  try {
    const fields: { targetContributionRate?: number; changeTargetRate?: number } = {};
    if (parsedTarget !== undefined) fields.targetContributionRate = parsedTarget;
    if (parsedChange !== undefined) fields.changeTargetRate = parsedChange;
    const saved = await getStorage().upsertPerformanceTarget(userId, year, month, fields);
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 근무자 ↔ Spreadsheet worker 매핑 — 이름 자동추측 없이 관리자가 명시적으로 지정 */
router.patch("/api/admin/users/:id/performance-mapping", requireAdminSession, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 사용자 ID입니다." });

  const raw = req.body?.performanceWorkerName;
  if (raw !== null && typeof raw !== "string") {
    return res.status(400).json({ error: "performanceWorkerName은 문자열 또는 null이어야 합니다." });
  }
  const value = typeof raw === "string" ? raw.trim() || null : null;

  try {
    // MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1: 같은 Spreadsheet worker를
    // 두 MCC 사용자에게 실수로 연결하는 것을 막는다. schema UNIQUE는 추가하지 않고
    // (기존 DB에 이미 중복이 있을 수 있어 migration을 깨뜨릴 위험) application 검증만 한다.
    if (value !== null) {
      const workers = await getStorage().listInternalWorkersWithMapping();
      const conflict = workers.find((w: any) => w.id !== id && w.performanceWorkerName === value);
      if (conflict) {
        return res.status(409).json({
          error: `이미 "${conflict.name}"(${conflict.username}) 사용자에게 연결된 작업자입니다. 같은 작업자를 두 사용자에게 연결할 수 없습니다.`,
        });
      }
    }

    const updated = await getStorage().updateUserPerformanceWorkerName(id, value);
    if (!updated) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ id: updated.id, name: updated.name, performanceWorkerName: updated.performanceWorkerName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 입사일 정정/퇴사 처리 — 계정/과거
// 실적/목표를 절대 삭제하지 않는다. 두 필드는 독립적으로 보낼 수 있고(목표와 동일 패턴),
// 보내지 않은 쪽은 storage 계층에서 건드리지 않는다. terminationDate: null을 보내면
// "퇴사 취소(재직으로 되돌림)"도 가능하게 한다(실수로 퇴사 처리한 경우 복구용).
function parseOptionalDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return "invalid";
}

router.patch("/api/admin/users/:id/employment", requireAdminSession, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 사용자 ID입니다." });

  const hireDate = parseOptionalDate(req.body?.hireDate);
  const terminationDate = parseOptionalDate(req.body?.terminationDate);
  if (hireDate === "invalid" || terminationDate === "invalid") {
    return res.status(400).json({ error: "hireDate/terminationDate는 YYYY-MM-DD 형식이거나 null이어야 합니다." });
  }
  if (hireDate === undefined && terminationDate === undefined) {
    return res.status(400).json({ error: "hireDate 또는 terminationDate 중 최소 하나는 보내야 합니다." });
  }

  try {
    const fields: { hireDate?: string | null; terminationDate?: string | null } = {};
    if (hireDate !== undefined) fields.hireDate = hireDate;
    if (terminationDate !== undefined) fields.terminationDate = terminationDate;
    const updated = await getStorage().updateUserEmployment(id, fields);
    if (!updated) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ id: updated.id, name: updated.name, hireDate: updated.hireDate ?? null, terminationDate: updated.terminationDate ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
