// server/routes/sheet-viewer.ts
//
// 작업명: MCC_MONTHLY_SPREADSHEET_SELECTIVE_SHEET_VIEWER_1
//
// 월별 ★개통현황 Spreadsheet에서 사용자가 선택한 시트만 조회하는 범용 READ ONLY 뷰어.
// 특정 시트 이름을 하드코딩하지 않는다 — 실제 존재하는 시트 목록은 항상 Google Sheets
// metadata(listSpreadsheetSheetsById)에서 그때그때 가져온다.
//
// 권한: admin / sales_manager / (dealerId·dealerRegistrationId가 없는) 내부 user만 허용
// — server/routes/lg-audit.ts의 requireLgAuditAccess, server/routes/training.ts의
// requireTrainingViewer와 완전히 동일한 패턴이다. 딜러도 DB상 userType='user'로 저장되므로
// session.userType만으로는 내부 워커를 판정할 수 없다 — getUserById로 재조회해서
// dealerId/dealerRegistrationId 부재를 직접 확인한다.
//
// resolveActiveSpreadsheet()/fetchSheetValuesById()(둘 다 LOCK, import만) 재사용 —
// 이 파일은 새 계산/매칭 로직을 만들지 않는다. 정산/실적 계산과 무관한 순수 조회 기능.
//
// 고객정보(고객명/전화번호 등) 원문은 로그에 남기지 않는다 — 행 개수/에러만 로그.

import { Router } from "express";
import { getStorage } from "../storage";
import { resolveActiveSpreadsheet } from "../lib/spreadsheet-resolver";
import { fetchSheetValuesById, listSpreadsheetSheetsById, type SpreadsheetSheetMeta } from "../lib/google-sheets-client";

const router = Router();

async function requireSheetViewerAccess(req: any, res: any, next: any) {
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

function parseYearMonth(q: any): { year: number; month: number } | null {
  const year = Number(q.year);
  const month = Number(q.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/** resolveActiveSpreadsheet() 에러 메시지를 사용자 친화적 코드로 분류(§14/§15) */
function classifyResolveError(err: any): { status: number; code: string; error: string } {
  const msg = String(err?.message ?? "");
  if (msg.includes("0개") || msg.includes("찾지 못했습니다")) {
    return { status: 404, code: "NOT_FOUND", error: "해당 월의 개통현황 Spreadsheet를 찾을 수 없습니다." };
  }
  if (msg.includes("403") || msg.includes("거부")) {
    return { status: 502, code: "PERMISSION", error: "Google Drive/Sheets 접근 권한 오류가 발생했습니다." };
  }
  if (msg.includes("개 발견")) {
    return { status: 409, code: "MULTIPLE_FOUND", error: "해당 월의 개통현황 Spreadsheet가 여러 개 발견되어 자동 선택할 수 없습니다." };
  }
  return { status: 502, code: "UNKNOWN", error: "Spreadsheet를 찾는 중 오류가 발생했습니다." };
}

function classifySheetsApiError(err: any): { status: number; code: string; error: string } {
  const status = err?.status;
  if (status === 429) return { status: 429, code: "QUOTA", error: "Google Sheets API 사용량 제한(429)에 도달했습니다. 잠시 후 다시 시도해주세요." };
  if (status === 403) return { status: 502, code: "PERMISSION", error: "Google Sheets 접근 권한 오류가 발생했습니다." };
  // Sheets API는 존재하지 않는 시트명을 범위 파싱 실패(400 INVALID_ARGUMENT)로 응답한다 —
  // 이 컨텍스트에서는 사실상 "시트를 찾을 수 없음"과 같은 의미다.
  if (status === 404 || status === 400) return { status: 404, code: "NOT_FOUND", error: "시트를 찾을 수 없습니다." };
  return { status: 502, code: "UNKNOWN", error: "Google Sheets 조회 중 오류가 발생했습니다." };
}

async function resolveForQuery(query: any) {
  const ym = parseYearMonth(query);
  if (!ym) {
    const err = new Error("year/month가 필요합니다(month는 1-12).") as any;
    err.badRequest = true;
    throw err;
  }
  const date = new Date(ym.year, ym.month - 1, 1);
  return { ym, resolved: await resolveActiveSpreadsheet(date) };
}

// GET /api/sheet-viewer/resolve?year=&month=
router.get("/api/sheet-viewer/resolve", requireSheetViewerAccess, async (req, res) => {
  try {
    const { resolved } = await resolveForQuery(req.query);
    res.set("Cache-Control", "no-store");
    res.json({ spreadsheetId: resolved.id, spreadsheetName: resolved.name });
  } catch (err: any) {
    if (err.badRequest) return res.status(400).json({ error: err.message });
    console.error("[sheet-viewer:resolve] error:", err.message);
    const c = classifyResolveError(err);
    res.status(c.status).json({ error: c.error, code: c.code });
  }
});

// ── sheet 목록 캐시: spreadsheetId -> {sheets, expiresAt} — TTL 5분(§17) ──────────
const SHEETS_CACHE_TTL_MS = 5 * 60 * 1000;
const sheetsListCache = new Map<string, { sheets: SpreadsheetSheetMeta[]; expiresAt: number }>();

// GET /api/sheet-viewer/sheets?year=&month=
router.get("/api/sheet-viewer/sheets", requireSheetViewerAccess, async (req, res) => {
  try {
    const { resolved } = await resolveForQuery(req.query);

    const cached = sheetsListCache.get(resolved.id);
    let sheets: SpreadsheetSheetMeta[];
    if (cached && Date.now() < cached.expiresAt) {
      sheets = cached.sheets;
    } else {
      sheets = await listSpreadsheetSheetsById(resolved.id);
      sheetsListCache.set(resolved.id, { sheets, expiresAt: Date.now() + SHEETS_CACHE_TTL_MS });
    }

    const visible = sheets.filter((s) => !s.hidden);
    res.set("Cache-Control", "no-store");
    res.json({
      spreadsheetName: resolved.name,
      sheets: visible.map((s) => ({ title: s.title, index: s.index, rowCount: s.rowCount })),
      totalSheetCount: sheets.length,
      visibleSheetCount: visible.length,
      hiddenSheetCount: sheets.length - visible.length,
    });
  } catch (err: any) {
    if (err.badRequest) return res.status(400).json({ error: err.message });
    console.error("[sheet-viewer:sheets] error:", err.message);
    const c = err.status ? classifySheetsApiError(err) : classifyResolveError(err);
    res.status(c.status).json({ error: c.error, code: c.code });
  }
});

// trailing 빈 컬럼/빈 행 정리(§11) — 값 자체는 변형하지 않음
function trimTrailingEmpty(header: string[], rows: string[][]): { header: string[]; rows: string[][] } {
  let lastCol = -1;
  for (let c = 0; c < header.length; c++) {
    if (String(header[c] ?? "").trim() !== "") lastCol = c;
    for (const r of rows) {
      if (String(r[c] ?? "").trim() !== "") { lastCol = c; break; }
    }
  }
  const width = lastCol + 1;
  const trimmedHeader = width > 0 ? header.slice(0, width) : header;
  const trimmedRows = rows
    .map((r) => (width > 0 ? r.slice(0, width) : r))
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return { header: trimmedHeader, rows: trimmedRows };
}

// GET /api/sheet-viewer/data?year=&month=&sheet=<title>
router.get("/api/sheet-viewer/data", requireSheetViewerAccess, async (req, res) => {
  const sheetTitle = typeof req.query.sheet === "string" ? req.query.sheet.trim() : "";
  if (!sheetTitle) return res.status(400).json({ error: "sheet 파라미터가 필요합니다." });

  try {
    const { resolved } = await resolveForQuery(req.query);

    let values: string[][];
    try {
      values = await fetchSheetValuesById(resolved.id, sheetTitle);
    } catch (fetchErr: any) {
      // fetchSheetValuesById는 status를 err에 안 붙이므로 메시지로 404/429 구분
      const msg = String(fetchErr?.message ?? "");
      const statusMatch = msg.match(/status=(\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : undefined;
      const err: any = new Error(msg);
      err.status = status;
      throw err;
    }

    if (values.length === 0) {
      return res.json({ sheetTitle, header: [], rows: [], totalRows: 0 });
    }

    const { header, rows } = trimTrailingEmpty(values[0] ?? [], values.slice(1));
    console.log(`[sheet-viewer:data] sheet="${sheetTitle}" rows=${rows.length}`);
    res.set("Cache-Control", "no-store");
    res.json({ sheetTitle, header, rows, totalRows: rows.length });
  } catch (err: any) {
    if (err.badRequest) return res.status(400).json({ error: err.message });
    console.error(`[sheet-viewer:data] sheet="${sheetTitle}" error:`, err.message);
    const c = err.status ? classifySheetsApiError(err) : classifyResolveError(err);
    res.status(c.status).json({ error: c.error, code: c.code, sheetTitle });
  }
});

export default router;
