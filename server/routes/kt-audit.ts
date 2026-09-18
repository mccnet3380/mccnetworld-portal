// server/routes/kt-audit.ts
//
// 작업명: KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// KT 개통 검수 전용 API. LG의 server/routes/lg-audit.ts와 완전히 독립적으로 유지한다 —
// KT 화면은 이 라우트만 호출하고 /api/lg-audit/sheet를 직접 호출하지 않는다.
// 공통 인프라(resolveActiveSpreadsheet, fetchSheetValuesById, normalizeLedgerDate,
// isSameExactDate)는 그대로 import해서 재사용한다 — LG 파일은 전혀 수정하지 않는다.
//
// 권한: server/lib/internal-access.ts의 requireInternalOrAdminAccess (KT 전용 helper,
// LG의 requireLgAuditAccess와 판정 로직은 동일하지만 별도 파일).
//
// private key/서비스 계정 비밀정보는 절대 응답에 포함하지 않는다.

import { Router } from "express";
import { resolveActiveSpreadsheet } from "../lib/spreadsheet-resolver";
import { fetchSheetValuesById } from "../lib/google-sheets-client";
import { normalizeLedgerDate, isSameExactDate, type ExactDate } from "../lib/lg-audit-date";
import { requireInternalOrAdminAccess } from "../lib/internal-access";

const router = Router();

const LEDGER_SHEET = "개통처리부";

function parseDateParam(v: unknown): ExactDate | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [year, month, day] = v.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * GET /api/kt-audit/sheet?date=YYYY-MM-DD
 * date에서 연/월을 추출해 해당 월 스프레드시트를 자동 탐색하고(LG와 동일한 resolver 재사용),
 * "개통처리부"에서 개통일이 date와 정확히 일치하는 행만 반환한다.
 */
router.get("/api/kt-audit/sheet", requireInternalOrAdminAccess, async (req, res) => {
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
        `[KtAudit] "${LEDGER_SHEET}" 시트에서 개통일 컬럼을 찾지 못했습니다. 헤더: ${header.join(", ")}`,
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
