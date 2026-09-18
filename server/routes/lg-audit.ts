// server/routes/lg-audit.ts
//
// 작업명: LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// LG 개통 검수 전용 API. server/routes.ts(기존 검증된 대형 라우터)는 건드리지 않고
// server/routes/performance.ts와 같은 방식으로 독립 라우터로 분리해서 마운트한다.
//
// 권한: admin / sales_manager / (dealerId·dealerRegistrationId가 없는) 내부 user만 허용.
// 딜러 계정도 DB상 userType='user'로 저장되므로 session.userType만으로는 내부 워커를
// 판정할 수 없다(감사에서 확인) — 반드시 getUserById로 재조회해서 dealerId/dealerRegistrationId
// 부재를 직접 확인한다. 기존 requireAdmin/requireWorker/requireDealerOrWorker/
// requireInternalSession은 이 작업에서 전혀 수정하지 않는다.
//
// 월별 스프레드시트: "오늘" 기준이 아니라 "검수 날짜(auditDate)" 기준으로
// resolveActiveSpreadsheet()를 호출한다(spreadsheet-resolver.ts 자체는 무수정, 재사용만).
//
// private key/서비스 계정 비밀정보는 절대 응답에 포함하지 않는다.

import { Router } from "express";
import { getStorage } from "../storage";
import { resolveActiveSpreadsheet } from "../lib/spreadsheet-resolver";
import { fetchSheetValuesById } from "../lib/google-sheets-client";
import { normalizeLedgerDate, isSameExactDate, type ExactDate } from "../lib/lg-audit-date";

const router = Router();

const LEDGER_SHEET = "개통처리부";

async function requireLgAuditAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }

  if (session.userType === "admin" || session.userType === "sales_manager") {
    req.session = session;
    return next();
  }

  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (user && !user.dealerId && !user.dealerRegistrationId) {
      req.session = session;
      return next();
    }
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }

  return res.status(403).json({ error: "접근 권한이 없습니다." });
}

function parseDateParam(v: unknown): ExactDate | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [year, month, day] = v.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * 로그인만 되어 있으면 통과(관리자/근무자/영업과장) — 판매점(dealer) 세션은 제외.
 * GET /api/lg-audit/sheet?date=YYYY-MM-DD
 * date에서 연/월을 추출해 해당 월 스프레드시트를 자동 탐색하고, "개통처리부"에서
 * 개통일이 date와 정확히 일치하는 행만 반환한다.
 */
router.get("/api/lg-audit/sheet", requireLgAuditAccess, async (req, res) => {
  const rawDate = req.query.date;
  const auditDate = parseDateParam(rawDate);
  if (!auditDate) {
    return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
  }

  try {
    const dateObj = new Date(auditDate.year, auditDate.month - 1, auditDate.day);
    const resolved = await resolveActiveSpreadsheet(dateObj);
    const values = await fetchSheetValuesById(resolved.id, LEDGER_SHEET);

    res.set("Cache-Control", "no-store");

    if (values.length === 0) {
      return res.json({ spreadsheet: resolved.name, sheet: LEDGER_SHEET, date: rawDate, rows: [] });
    }

    const header = values[0];
    const dateIdx = header.findIndex((h) => h.includes("개통일"));
    if (dateIdx < 0) {
      throw new Error(
        `[LgAudit] "${LEDGER_SHEET}" 시트에서 개통일 컬럼을 찾지 못했습니다. 헤더: ${header.join(", ")}`,
      );
    }

    const rows = values
      .slice(1)
      .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
      .filter((r) => isSameExactDate(normalizeLedgerDate(r[dateIdx], auditDate.year), auditDate))
      .map((r) => Object.fromEntries(header.map((h, i) => [h || `__${i}`, r[i] ?? ""])));

    res.json({ spreadsheet: resolved.name, sheet: LEDGER_SHEET, date: rawDate, rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
