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
import { computePerformanceDataset } from "../lib/performance-dataset";
import { workerHomeNetwork } from "../lib/performance-classify";

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

/** 오늘 기준 라이브 dataset.workers에서 발견된 worker 문자열 목록 — 별도 파서 없이 재사용 */
router.get("/api/admin/performance/worker-options", requireAdminSession, async (_req, res) => {
  try {
    const dataset = await computePerformanceDataset(new Date());
    const names = Array.from(new Set(dataset.workers.map((w) => w.worker))).sort();
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
    const updated = await getStorage().updateUserPerformanceWorkerName(id, value);
    if (!updated) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ id: updated.id, name: updated.name, performanceWorkerName: updated.performanceWorkerName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
