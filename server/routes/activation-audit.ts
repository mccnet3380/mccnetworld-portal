// server/routes/activation-audit.ts
//
// 작업명: MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1
//
// "개통현황 조회" 화면에 통합되는 자동검수 API. 기존 server/routes/sheet-viewer.ts(원본
// 시트 그대로 보기)는 무수정 — 이 라우터는 완전히 독립된 신규 엔드포인트만 추가한다.
// READ ONLY — 계산 결과를 DB에 저장하지 않는다(요청마다 계산, 캐시는 personal-performance.ts
// 의 공유 캐시 재사용).
//
// 권한(§6/§7/§8 확정):
// - /summary(전체 작업자 검수): admin 또는 (userType='user' AND !dealerId AND
//   !dealerRegistrationId AND role='middle_manager')만 허용. sales_manager는 이 신규
//   검수 권한 대상이 아니다(§7 — "MIDDLE_MANAGER를 sales_manager로 매핑하지 않는다").
//   Server-side에서 강제한다 — 사이드바 숨김만으로 끝내지 않는다(§8).
// - /me(본인 누락만): admin/sales_manager/dealer 제외, 내부 user만(WORKER·MIDDLE_MANAGER
//   공통 — 둘 다 "본인 개인실적"은 볼 수 있다, §6). 본인 performanceWorkerName 기준으로
//   서버에서 필터링한다(요청 파라미터로 다른 작업자를 지정할 수 없음).

import { Router } from "express";
import { getStorage } from "../storage";
import { createLedgerCache } from "../lib/personal-performance";
import { computeActivationAudit } from "../lib/activation-audit";
import { invalidateMemiCache } from "../lib/memi-client";

const router = Router();

function parseDateParam(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function requireActivationAuditAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType === "admin") {
    req.session = session;
    return next();
  }
  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (user && !user.dealerId && !user.dealerRegistrationId && user.role === "middle_manager") {
      req.session = session;
      return next();
    }
  }
  return res.status(403).json({ error: "접근 권한이 없습니다." });
}

async function requireOwnActivationAuditAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType !== "user") {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }
  const user = await getStorage().getUserById(session.userId);
  if (!user || user.dealerId || user.dealerRegistrationId) {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }
  req.session = session;
  next();
}

/** 전체 작업자 검수(관리자/중간관리자 전용) — admin/sales_manager/dealer/worker 접근 불가(worker=일반 user) */
router.get("/api/activation-audit/summary", requireActivationAuditAccess, async (req, res) => {
  const date = req.query.date === undefined ? new Date() : parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });

  try {
    const cache = createLedgerCache();
    const result = await computeActivationAudit(date, cache);
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (err: any) {
    console.error("[activation-audit] summary 계산 실패:", err?.message ?? err);
    res.status(500).json({ error: "개통현황 검수 데이터를 불러오지 못했습니다." });
  }
});

/** 본인 업무 누락 검수(WORKER/MIDDLE_MANAGER 공통, 본인 performanceWorkerName 기준만) */
router.get("/api/activation-audit/me", requireOwnActivationAuditAccess, async (req: any, res) => {
  const date = req.query.date === undefined ? new Date() : parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });

  try {
    const user = await getStorage().getUserById(req.session.userId);
    const performanceWorkerName = user?.performanceWorkerName || null;
    if (!performanceWorkerName) {
      return res.json({
        mapped: false,
        message: "실적 작업자가 아직 연결되지 않았습니다. 관리자에게 실적 작업자 연결을 요청해 주세요.",
      });
    }

    const cache = createLedgerCache();
    const result = await computeActivationAudit(date, cache);
    const myRows = result.rows.filter((r) => r.worker === performanceWorkerName);
    const byCode: Record<string, number> = {};
    let error = 0;
    let dataUnavailable = 0;
    for (const r of myRows) {
      if (r.status === "ERROR") error++;
      else if (r.status === "DATA_UNAVAILABLE") dataUnavailable++;
      for (const iss of r.issues) byCode[iss.code] = (byCode[iss.code] ?? 0) + 1;
    }

    res.set("Cache-Control", "no-store");
    res.json({
      mapped: true,
      date: result.date,
      sourceSheet: result.sourceSheet,
      total: myRows.length,
      summary: { error, dataUnavailable, pass: myRows.length - error - dataUnavailable },
      byCode,
      rows: myRows,
      memiSync: result.memiSync,
    });
  } catch (err: any) {
    console.error("[activation-audit] me 계산 실패:", err?.message ?? err);
    res.status(500).json({ error: "본인 업무 누락 검수 데이터를 불러오지 못했습니다." });
  }
});

/**
 * [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 관리자/중간관리자용 수동 [매미 새로고침] 보조
 * 기능(§14) — 기본 업무 흐름은 자동(요청 시 cache 없으면 자동 fetch)이며, 이 엔드포인트는
 * cache가 stale하다고 판단될 때 강제로 다시 받아오는 보조 수단일 뿐이다. /summary와 동일한
 * 권한(admin/내부 middle_manager)만 허용 — 일반 WORKER는 호출할 수 없다.
 */
router.post("/api/activation-audit/memi-refresh", requireActivationAuditAccess, async (req, res) => {
  const date = req.body?.date === undefined ? new Date() : parseDateParam(req.body.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
  const dateYmd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  invalidateMemiCache(dateYmd);
  try {
    const cache = createLedgerCache();
    const result = await computeActivationAudit(date, cache);
    res.json({ memiSync: result.memiSync });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;
