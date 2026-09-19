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
import { resolveRangeDates, computeWorkerPerformanceForDates, createLedgerCache } from "../lib/personal-performance";

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
// 불가능해짐). "이번 달 1일~오늘"로 넓혀서 이번 달에 한 번이라도 등장한 worker는 항상
// dropdown에 뜨게 한다. 새 파서를 만들지 않는다 — personal-performance.ts가 이미 갖고 있는
// 저비용 경로(■당일완료 시트를 스프레드시트당 1회만 읽고 날짜별로 메모리에서 필터링)를
// 그대로 재사용한다. 오히려 computePerformanceDataset(모바일/유선/마감/딜러매트릭스 등 여러
// 시트를 매번 새로 읽음)보다 Google Sheets 쿼터 소모가 훨씬 적다.
router.get("/api/admin/performance/worker-options", requireAdminSession, async (_req, res) => {
  try {
    const today = new Date();
    const cache = createLedgerCache();
    const monthDates = resolveRangeDates("month", today);
    const perDay = await computeWorkerPerformanceForDates(monthDates, cache);
    const names = new Set<string>();
    for (const day of perDay) {
      for (const w of day.workers) names.add(w.worker);
    }
    res.set("Cache-Control", "no-store");
    res.json({ workers: Array.from(names).sort() });
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
        targetContributionRate: t ? Number(t.targetContributionRate) : null,
      };
    });

    res.set("Cache-Control", "no-store");
    res.json({ year: ym.year, month: ym.month, workers: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 월별 목표 기여도(%) upsert — userId+year+month 단위, 자동 복사 없음 */
router.put("/api/admin/performance/targets", requireAdminSession, async (req, res) => {
  const { userId, year, month, targetContributionRate } = req.body || {};
  if (
    !Number.isInteger(userId) ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    typeof targetContributionRate !== "number" ||
    !Number.isFinite(targetContributionRate) ||
    targetContributionRate < 0
  ) {
    return res.status(400).json({ error: "userId/year/month/targetContributionRate(0 이상 숫자)가 필요합니다." });
  }
  try {
    const saved = await getStorage().upsertPerformanceTarget(userId, year, month, targetContributionRate);
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

export default router;
