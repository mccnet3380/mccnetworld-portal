// server/routes/settlement-sheets-import.ts
//
// 작업명: MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
//
// "정산 결과 관리" 화면의 "Google Sheets에서 가져오기" 기능. 월별 ★개통현황
// Spreadsheet의 "개통처리부" 시트를 activation_records로 안전하게 import한다(V1: 개통처리부만,
// 00700결합/데이터유심/인터넷 제외 — 감사 보고서 근거).
//
// 권한: ADMIN만(§32 — sheet-viewer/training과 달리 내부 worker/sales_manager 허용하지 않음,
// 정산 데이터 쓰기 기능이므로 기존 정산 결과 관리와 동일하게 admin 전용).
//
// resolveActiveSpreadsheet()/fetchSheetValuesById()(LOCK, import만) 재사용. 매핑/매칭
// 로직은 server/lib/activation-row-mapper.ts, activation-dealer-matcher.ts 재사용(기존
// Excel 업로드 라우트와 동일한 COL_MAP/매칭 우선순위를 그대로 복제한 모듈).
//
// Preview는 DB에 아무것도 쓰지 않는다. Import는 Preview를 처음부터 다시 계산한 뒤(클라이언트
// 캐시를 신뢰하지 않음) insert만 트랜잭션으로 묶는다 — 부분 저장 없음.
//
// Google Sheets 원본 행 전체나 고객 개인정보를 로그에 남기지 않는다(요약 카운트만).

import { Router } from "express";
import { eq, inArray, and, isNotNull } from "drizzle-orm";
import { getStorage } from "../storage";
import { getDatabase } from "../db";
import { activationRecords } from "../../shared/schema";
import { resolveActiveSpreadsheet } from "../lib/spreadsheet-resolver";
import { fetchSheetValuesById } from "../lib/google-sheets-client";
import { mapSheetRowToActivationInput, computeActivationDedupeKey } from "../lib/activation-row-mapper";
import { matchActivationDealer, createDealerMatchCache } from "../lib/activation-dealer-matcher";

const router = Router();

const SOURCE_SHEET_NAME = "개통처리부"; // V1: 이 상수 하나만 지원 — 00700결합 등은 이번 범위 아님(§ LOCK)
const SOURCE_TYPE = "google_sheets";

async function requireSettlementAdmin(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session || session.userType !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  req.session = session;
  next();
}

function parseYearMonth(body: any): { year: number; month: number } | null {
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

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

interface RowError {
  row: number;
  reason: string;
}

interface ClassifiedRow {
  rowNum: number;
  data: ReturnType<typeof mapSheetRowToActivationInput>["data"];
  mccCodeRaw: string | null;
  codeNameRaw: string | null;
  dedupeKey: string | null;
}

interface ClassifyResult {
  spreadsheetId: string;
  spreadsheetName: string;
  totalRows: number;
  toCreate: ClassifiedRow[]; // 신규 + 유효(배치 내 중복 아님)
  duplicateExisting: number; // 이미 DB에 있는 dedupeKey
  duplicateWithinBatch: number; // 같은 시트 안에서 중복
  missingRequired: number;
  dedupeUnknownCount: number; // toCreate 중 dedupeKey 계산 불가(중복검사 생략) 건수
  errors: RowError[];
}

async function resolveAndFetch(year: number, month: number) {
  const date = new Date(year, month - 1, 1);
  const resolved = await resolveActiveSpreadsheet(date);
  const values = await fetchSheetValuesById(resolved.id, SOURCE_SHEET_NAME);
  return { resolved, values };
}

async function classifySheet(year: number, month: number): Promise<ClassifyResult> {
  const { resolved, values } = await resolveAndFetch(year, month);

  if (values.length === 0) {
    return {
      spreadsheetId: resolved.id, spreadsheetName: resolved.name, totalRows: 0,
      toCreate: [], duplicateExisting: 0, duplicateWithinBatch: 0, missingRequired: 0,
      dedupeUnknownCount: 0, errors: [],
    };
  }

  const header = values[0];
  const rawRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  const toCreate: ClassifiedRow[] = [];
  let missingRequired = 0;
  let duplicateWithinBatch = 0;
  let dedupeUnknownCount = 0;
  const errors: RowError[] = [];
  const seenKeysInBatch = new Set<string>();
  const dedupeKeysToCheck: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // 헤더 포함 1-indexed
    try {
      const raw: Record<string, unknown> = {};
      header.forEach((h, idx) => { raw[h] = rawRows[i][idx]; });

      const mapped = mapSheetRowToActivationInput(raw);
      if (mapped.missing.length > 0) {
        missingRequired++;
        continue;
      }

      const dedupeKey = computeActivationDedupeKey({
        contactCode: mapped.data.contactCode,
        activationDatetime: mapped.data.activationDatetime,
        customerName: mapped.data.customerName,
        activationNumber: mapped.data.activationNumber,
        subscriptionNumber: mapped.data.subscriptionNumber,
      });

      if (dedupeKey) {
        if (seenKeysInBatch.has(dedupeKey)) {
          duplicateWithinBatch++;
          continue;
        }
        seenKeysInBatch.add(dedupeKey);
        dedupeKeysToCheck.push(dedupeKey);
      } else {
        dedupeUnknownCount++;
      }

      toCreate.push({ rowNum, data: mapped.data, mccCodeRaw: mapped.mccCodeRaw, codeNameRaw: mapped.codeNameRaw, dedupeKey });
    } catch (rowErr: any) {
      errors.push({ row: rowNum, reason: String(rowErr?.message ?? "행 처리 오류").slice(0, 120) });
    }
  }

  // 기존 DB에 이미 있는 dedupeKey 일괄 조회
  let existingKeys = new Set<string>();
  if (dedupeKeysToCheck.length > 0) {
    const db = await getDatabase();
    const rows = await db
      .select({ dedupeKey: activationRecords.dedupeKey })
      .from(activationRecords)
      .where(and(inArray(activationRecords.dedupeKey, dedupeKeysToCheck), isNotNull(activationRecords.dedupeKey)));
    existingKeys = new Set(rows.map((r) => r.dedupeKey as string));
  }

  let duplicateExisting = 0;
  const finalToCreate: ClassifiedRow[] = [];
  for (const row of toCreate) {
    if (row.dedupeKey && existingKeys.has(row.dedupeKey)) {
      duplicateExisting++;
      continue;
    }
    finalToCreate.push(row);
  }

  return {
    spreadsheetId: resolved.id,
    spreadsheetName: resolved.name,
    totalRows: rawRows.length,
    toCreate: finalToCreate,
    duplicateExisting,
    duplicateWithinBatch,
    missingRequired,
    dedupeUnknownCount,
    errors: errors.slice(0, 50),
  };
}

// POST /api/admin/settlement/google-sheets/preview  { year, month }
router.post("/api/admin/settlement/google-sheets/preview", requireSettlementAdmin, async (req: any, res) => {
  const ym = parseYearMonth(req.body);
  if (!ym) return res.status(400).json({ error: "year/month가 필요합니다(month는 1-12)." });

  try {
    const result = await classifySheet(ym.year, ym.month);
    console.log(`[settlement-sheets-import:preview] ${ym.year}-${ym.month} sheet="${SOURCE_SHEET_NAME}" total=${result.totalRows} willCreate=${result.toCreate.length} dupExisting=${result.duplicateExisting} dupBatch=${result.duplicateWithinBatch} missing=${result.missingRequired}`);
    res.set("Cache-Control", "no-store");
    res.json({
      spreadsheetName: result.spreadsheetName,
      sourceSheet: SOURCE_SHEET_NAME,
      totalRows: result.totalRows,
      willCreate: result.toCreate.length,
      duplicateExisting: result.duplicateExisting,
      duplicateWithinBatch: result.duplicateWithinBatch,
      missingRequired: result.missingRequired,
      dedupeUnknownCount: result.dedupeUnknownCount,
      errors: result.errors,
    });
  } catch (err: any) {
    console.error("[settlement-sheets-import:preview] error:", err.message);
    const c = classifyResolveError(err);
    res.status(c.status).json({ error: c.error, code: c.code });
  }
});

// POST /api/admin/settlement/google-sheets/import  { year, month }
router.post("/api/admin/settlement/google-sheets/import", requireSettlementAdmin, async (req: any, res) => {
  const ym = parseYearMonth(req.body);
  if (!ym) return res.status(400).json({ error: "year/month가 필요합니다(month는 1-12)." });

  try {
    // Preview를 신뢰하지 않고 import 시점에 다시 계산(§34 — Sheet가 그 사이 바뀌었을 수 있음)
    const result = await classifySheet(ym.year, ym.month);
    const sourceMonth = `${ym.year}-${String(ym.month).padStart(2, "0")}`;

    // 판매점 매칭(읽기 전용, 트랜잭션 밖에서 수행 — insert만 트랜잭션으로 묶는다)
    const matchCache = createDealerMatchCache();
    const insertRows: (typeof activationRecords.$inferInsert)[] = [];
    for (const row of result.toCreate) {
      const match = await matchActivationDealer(row.mccCodeRaw, row.data.contactCode, row.codeNameRaw, row.data.dealerName, matchCache);
      insertRows.push({
        activationDatetime: row.data.activationDatetime!,
        receptionDatetime: row.data.receptionDatetime,
        channel: row.data.channel!,
        customerName: row.data.customerName,
        customerPhone: row.data.customerPhone,
        customerEmail: row.data.customerEmail,
        subscriptionNumber: row.data.subscriptionNumber,
        activationNumber: row.data.activationNumber,
        contactCode: row.data.contactCode,
        mccCode: row.mccCodeRaw,
        dealerRegistrationId: match.dealerRegistrationId,
        dealerName: match.dealerName,
        contactCodeId: match.contactCodeId,
        codeName: match.codeName,
        realSalesPOS: match.realSalesPOS,
        subDealerName: match.subDealerName,
        matchingStatus: match.matchingStatus,
        matchingBasis: match.matchingBasis,
        planName: row.data.planName,
        customerType: row.data.customerType,
        nationalityType: row.data.nationalityType,
        previousCarrier: row.data.previousCarrier,
        bundleType: row.data.bundleType,
        addService: row.data.addService,
        regFeeType: row.data.regFeeType,
        receptionist: row.data.receptionist,
        memo: row.data.memo,
        source: SOURCE_TYPE,
        sourceSpreadsheetId: result.spreadsheetId,
        sourceSheetName: SOURCE_SHEET_NAME,
        sourceMonth,
        dedupeKey: row.dedupeKey,
        createdBy: req.session.userId,
      });
    }

    let created = 0;
    if (insertRows.length > 0) {
      const db = await getDatabase();
      await db.transaction(async (tx: any) => {
        for (const values of insertRows) {
          const inserted = await tx
            .insert(activationRecords)
            .values(values)
            .onConflictDoNothing({ target: activationRecords.dedupeKey })
            .returning({ id: activationRecords.id });
          if (inserted.length > 0) created++;
        }
      });
    }

    console.log(`[settlement-sheets-import:import] ${sourceMonth} sheet="${SOURCE_SHEET_NAME}" created=${created} dupExisting=${result.duplicateExisting} dupBatch=${result.duplicateWithinBatch} missing=${result.missingRequired}`);
    res.json({
      spreadsheetName: result.spreadsheetName,
      sourceSheet: SOURCE_SHEET_NAME,
      totalRows: result.totalRows,
      created,
      duplicateSkipped: result.duplicateExisting + result.duplicateWithinBatch + (insertRows.length - created),
      errorSkipped: result.missingRequired + result.errors.length,
      dedupeUnknownCount: result.dedupeUnknownCount,
      errors: result.errors,
    });
  } catch (err: any) {
    console.error("[settlement-sheets-import:import] error:", err.message);
    const c = classifyResolveError(err);
    res.status(c.status).json({ error: c.error, code: c.code });
  }
});

export default router;
