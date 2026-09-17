// server/routes/performance-admin.ts
//
// 작업명: MCC_INTERNET_RULE_AND_MONTHLY_SHEET_AUTO_ROUTING_1
//
// 관리자가 "현재 MCC가 어떤 개통현황 스프레드시트를 읽고 있는지" 확인할 수 있는
// 전용 라우터. server/routes.ts(기존 검증된 대형 라우터)는 건드리지 않고
// server/routes/remote-lab.ts와 같은 방식으로 독립 라우터로 분리해서 마운트한다.
//
// private key/서비스 계정 비밀정보는 절대 응답에 포함하지 않는다.

import { Router } from "express";
import { getStorage } from "../storage";
import { getResolverStatusSnapshot, resolveActiveSpreadsheet, invalidateSpreadsheetCache } from "../lib/spreadsheet-resolver";
import { computeWirePerformanceSnapshot, closeWireDay } from "../lib/internet-cumulative";

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

function toPublicShape(current: Awaited<ReturnType<typeof resolveActiveSpreadsheet>> | null) {
  if (!current) return null;
  return {
    spreadsheetId: current.id,
    fileName: current.name,
    targetYearMonth: current.targetYearMonth,
    resolvedVia: current.resolvedVia,
    resolvedAt: current.resolvedAt,
  };
}

/** 현재 연결된 스프레드시트 상태 조회 (없으면 지금 한 번 시도) */
router.get("/api/admin/performance/spreadsheet-status", requireAdminSession, async (_req, res) => {
  let current = null;
  let error: string | null = null;
  try {
    current = await resolveActiveSpreadsheet();
  } catch (err: any) {
    error = err.message;
  }
  const snapshot = getResolverStatusSnapshot();
  res.set("Cache-Control", "no-store");
  res.json({
    autoRouteEnabled: snapshot.autoRouteEnabled,
    current: toPublicShape(current),
    lastError: error ?? snapshot.lastError,
  });
});

/** 캐시를 무시하고 강제로 다시 탐색 */
router.post("/api/admin/performance/spreadsheet-status/refresh", requireAdminSession, async (_req, res) => {
  try {
    invalidateSpreadsheetCache();
    const current = await resolveActiveSpreadsheet(new Date(), { force: true });
    res.json(toPublicShape(current));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// 유선(인터넷) 실적/누적 — MCC_INTERNET_LIVE_STATE_CUMULATIVE_FINALIZE_1
// cumulative의 source of truth는 DB 체인이 아니라 4개 상태 시트 실시간 재조회다.
// [MCC_INTERNET_LEGACY_CUMULATIVE_CLEANUP_1] baseline 라우트와 과거 마감 수정(PATCH)
// 라우트는 구형 체인 모델 전용이라 완전히 제거했다 — 과거 마감을 다시 반영하려면
// 해당 날짜를 다시 /close 하면 된다(재마감은 그 시점 라이브 값으로 덮어쓸 뿐 중복 가산 없음).
// ─────────────────────────────────────────────────────────

function parseDateParam(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 실적 스냅샷 (읽기 전용, DB 미변경) — daily는 인터넷접수, cumulative는 4개 상태 시트 실시간 재조회 */
router.get("/api/admin/performance/internet/preview", requireAdminSession, async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
  try {
    const report = await computeWirePerformanceSnapshot(date);
    res.set("Cache-Control", "no-store");
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 마감 확정 — 그 순간 라이브 시트에서 읽은 값을 DB에 보존(snapshot). 재확정해도 매번 다시 읽어 덮어쓸 뿐 중복 가산 없음 */
router.post("/api/admin/performance/internet/close", requireAdminSession, async (req, res) => {
  const date = parseDateParam(req.body?.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
  try {
    const report = await closeWireDay(date);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
