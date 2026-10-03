// server/lib/activation-audit.ts
//
// 작업명: MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1
//
// "개통현황 조회" 화면에 통합되는 개통 후 자동검수 엔진. READ ONLY — Google Sheets/DB
// 어느 것도 수정하지 않는다.
//
// 데이터 원본은 정확히 2개 시트만 사용한다(감사 확정, §0 LOCK):
// - ■당일완료: 오늘 날짜 데이터만 보유(매일 초기화되는 라이브 스테이징 시트, 실측 확인)
// - 개통처리부: 오늘 이전 날짜만 보유하는 월 누적 처리 원장(실측 확인, 당일 데이터 없음)
// 두 시트는 날짜 기준으로 서로 배타적이다(실측: 조합키 교집합 0건) — 조회일이 오늘이면
// ■당일완료, 그 이전이면 개통처리부 하나만 선택해서 읽는다(합산하지 않는다).
// ■변경완료/00700결합은 이번 기능 범위에서 완전히 제외한다(사용 금지).
//
// 캐시는 새로 만들지 않고 server/lib/personal-performance.ts의 fetchLedgerCached()
// (spreadsheetId::sheetName 키, 60초 프로세스 공유 캐시)를 그대로 재사용한다.
//
// 컬럼은 헤더명으로 resolve한다(index 하드코딩 금지 — 개통처리부/■당일완료가 시트마다
// 컬럼 위치가 달라서 헤더 기반 resolver가 필수임을 실측으로 확인했다).
//
// 코드/접점코드 처리(실측 확정, §12): 화면에는 코드+접점코드 둘 다 표시하지만, 누락 검수는
// CONTACT_CODE_MISSING 하나만 사용한다(코드/접점코드 단독 결측 사례 0건 — 개통처리부/
// ■당일완료 재조사로 반례 없음 재확인 완료). CODE_MISSING은 만들지 않는다.
//
// [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 매미 실연동은 server/lib/memi-client.ts가
// 담당한다(로그인/xlsDown/Excel 파싱/일련번호 normalization, 이 파일에서 재구현하지 않음).
// 이 파일은 그 결과(MemiSyncResult)를 받아 단말 대상 행에만 적용한다:
// - memi 조회 자체가 실패/미설정(credential 없음 등)이면 MEMI_DATA_UNAVAILABLE(기존과 동일)
// - memi 조회는 성공했는데 이 시트의 일련번호가 매미 자료에 없으면 MEMI_DEVICE_NOT_FOUND(ERROR)
// - 매미에서 확인되면 이슈를 만들지 않고 memiStatus='MATCHED' + memiModel(정보용, 매칭 실패
//   판정에 쓰지 않음 — §10)만 채운다.
// MEMI_DATA_UNAVAILABLE을 MEMI_DEVICE_NOT_FOUND로 절대 계산하지 않는다(§11/§18 원칙 — memi
// 조회 성공 여부로 완전히 분기).
//
// 본사진행 예외(§14, 실측 확정): 작업자="본사"인 행은 ACTIVATION_NUMBER_MISSING 검수에서만
// 제외한다(가입번호 100% 빈값 상관관계 확인, 반례 없음). 다른 검수 항목까지 제외하지 않는다.
// 작업자="L)현아" 등 본사 외 가입번호 빈값 사례는 §14가 명시한 예외 대상이 아니므로 그대로
// ACTIVATION_NUMBER_MISSING으로 판정한다(HOLD로 보고 완료, 임의 확장 금지).

import { fetchLedgerCached, type LedgerCache } from "./personal-performance";
import { matchesDate } from "./performance-calc";
import { getMemiDailyReconciliation, getMemiRangeReconciliation, normalizeSerial, type MemiSyncResult } from "./memi-client";
import { resolveActiveSpreadsheet } from "./spreadsheet-resolver";
import { getSheetCacheStatus } from "./google-sheets-client";

/** [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §4 — stale
 * fallback이 쓰였을 수도 있는 상황을 화면에 구분해서 보여줄 수 있도록 하는 선택적 정보.
 * PHASE 1의 getSheetCacheStatus()를 그대로 조회만 한다(별도 캐시를 새로 만들지 않음). */
async function getSourceFreshness(date: Date, sheetName: string): Promise<{ stale: boolean; fetchedAt: string | null }> {
  try {
    const resolved = await resolveActiveSpreadsheet(date);
    const status = getSheetCacheStatus(resolved.id, sheetName);
    return { stale: status.stale, fetchedAt: status.fetchedAt ? new Date(status.fetchedAt).toISOString() : null };
  } catch {
    return { stale: false, fetchedAt: null };
  }
}

export const AUDIT_SOURCE_SHEETS = {
  today: "■당일완료",
  historical: "개통처리부",
} as const;

/** stable code — 확장 가능, 기존 프로젝트 naming과 충돌 없음(신규 파일 전용) */
export type AuditCode =
  | "ACTIVATION_PHONE_MISSING" // 개통번호(§11-A) — 업무 티켓/문서번호 성격, 실측상 예외 없이 항상 필수
  | "CONTACT_CODE_MISSING"
  | "PLAN_MISSING"
  | "ACTIVATION_NUMBER_MISSING" // 가입번호(§11-D/§13/§14) — 본사진행 예외 있음(§14)
  | "FOREIGNER_GRADE_MISSING"
  | "DEVICE_MODEL_MISSING"
  | "DEVICE_SERIAL_MISSING"
  | "MEMI_DEVICE_NOT_FOUND" // 매미 실연동 전까지 절대 사용하지 않음(정의만 선점)
  | "MEMI_DATA_UNAVAILABLE";

export type AuditSeverity = "ERROR" | "DATA_UNAVAILABLE";

export interface AuditIssue {
  code: AuditCode;
  severity: AuditSeverity;
  label: string;
}

export type RowAuditStatus = "PASS" | "ERROR" | "DATA_UNAVAILABLE";

export interface AuditedActivationRow {
  /** [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] 이 행이 속한 조회 날짜(YYYY-MM-DD,
   * 항상 명확한 형식 — activationDate 원본 셀은 "9/24"처럼 연도 없는 표기라 기간 조회/
   * 월 경계 상황에서 모호할 수 있다). computeActivationAudit()/computeActivationAuditRange()
   * 둘 다 채운다(단일 날짜 조회는 그 날짜 그대로, 기간 조회는 이 행이 속한 하루). 기존
   * 소비처(SheetViewer.tsx 단일 날짜 화면)는 이 필드를 참조하지 않아 무영향(additive). */
  auditDate: string;
  worker: string;
  activationDate: string;
  requestPoint: string;
  customerName: string;
  activationNumber: string;
  code: string;
  contactCode: string;
  planName: string;
  subscriptionNumber: string;
  customerType: string;
  foreignerGrade: string;
  model: string;
  serial: string;
  /** 단말 대상 행에만 채워짐. 단말이 아니면 undefined(§10 — 매미 정보를 억지로 끼워넣지 않음) */
  memiStatus?: "MATCHED" | "NOT_FOUND" | "DATA_UNAVAILABLE";
  /** 매미 쪽 모델명(정보용 — MCC_MODEL과 다르다는 이유만으로 ERROR 처리하지 않음, §10) */
  memiModel?: string;
  /** [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] 매미 쪽 원본 일련번호 문자열(정보용,
   * Excel §19 "매미 일련번호" 컬럼 전용). 매칭 안 되면 undefined. */
  memiSerial?: string;
  status: RowAuditStatus;
  issues: AuditIssue[];
}

export interface ActivationAuditResult {
  date: string; // YYYY-MM-DD
  sourceSheet: string;
  total: number;
  summary: { pass: number; error: number; dataUnavailable: number };
  byCode: Partial<Record<AuditCode, number>>;
  rows: AuditedActivationRow[];
  /** §13 UI 상태 표시용 — credential/세션 등 민감정보 없음 */
  memiSync: { status: "ok" | "unavailable"; syncedAt: string | null; rowCount: number; error?: string };
  /** [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §4 —
   * stale=true면 Google 429 등으로 최신 조회가 실패해 이전에 성공한 캐시 값을 대신
   * 보여주고 있다는 뜻(화면에서 "최신이 아님" 표시에 사용 가능). */
  dataFreshness: { stale: boolean; fetchedAt: string | null };
}

interface ColumnIndexes {
  worker: number;
  date: number;
  requestPoint: number;
  customerName: number;
  activationNumber: number;
  code: number;
  contactCode: number;
  planName: number;
  subscriptionNumber: number;
  customerType: number;
  foreignerGrade: number;
  model: number;
  serial: number;
}

/**
 * 헤더명 기준 컬럼 resolver. 작업자/개통일/요청점은 기존 loadClassifiedRows()와 동일하게
 * 필수(없으면 시트 구조가 깨진 것 — 예외를 던져서 조용히 0건이 되는 것을 막는다).
 * 나머지 검수 대상 컬럼은 실측상 두 시트 모두에 존재하지만, 혹시 없으면 -1로 두고
 * 해당 검수 항목만 건너뛴다(전체 요청을 실패시키지 않음).
 */
function resolveColumns(header: string[]): ColumnIndexes {
  const idx = (name: string) => header.indexOf(name);
  const worker = idx("작업자");
  const date = header.findIndex((h) => h.includes("개통일"));
  const requestPoint = idx("요청점");
  if (worker < 0 || date < 0 || requestPoint < 0) {
    throw new Error(
      `[ActivationAudit] 필수 컬럼(작업자/개통일/요청점)을 찾지 못했습니다. 헤더: ${header.join(", ")}`,
    );
  }
  return {
    worker,
    date,
    requestPoint,
    customerName: idx("고객명"),
    activationNumber: idx("개통번호"),
    code: idx("코드"),
    contactCode: idx("접점코드"),
    planName: idx("요금제"),
    subscriptionNumber: idx("가입번호"),
    customerType: idx("고객유형"),
    foreignerGrade: idx("외국인등급"),
    model: idx("모델명"),
    serial: idx("일련번호"),
  };
}

function cell(row: string[], i: number): string {
  if (i < 0 || i >= row.length) return "";
  return String(row[i] ?? "").trim();
}

const ISSUE_LABEL: Record<AuditCode, string> = {
  ACTIVATION_PHONE_MISSING: "개통번호 누락",
  CONTACT_CODE_MISSING: "접점코드 누락",
  PLAN_MISSING: "요금제 누락",
  ACTIVATION_NUMBER_MISSING: "가입번호 누락",
  FOREIGNER_GRADE_MISSING: "외국인등급 누락",
  DEVICE_MODEL_MISSING: "단말 모델명 누락",
  DEVICE_SERIAL_MISSING: "단말 일련번호 누락",
  MEMI_DEVICE_NOT_FOUND: "매미 금일 자료에서 확인되지 않음",
  MEMI_DATA_UNAVAILABLE: "매미 조회 불가",
};

function issue(code: AuditCode, severity: AuditSeverity): AuditIssue {
  return { code, severity, label: ISSUE_LABEL[code] };
}

/**
 * 한 행을 검수한다. §10 원칙: "빈칸이면 무조건 오류" 금지 — 조건부 필수값만 판정한다.
 *
 * [실측 확정 — 이전 라운드에서 개통번호/가입번호를 혼동했던 것을 바로잡음]
 * - 개통번호(§11-A, ACTIVATION_PHONE_MISSING): 업무 티켓/문서번호 성격의 필드. 개통처리부+
 *   ■당일완료 전체에서 예외 없이 100% 채워짐(반례 없음) — 조건 없이 필수로 취급.
 * - 가입번호(§11-D/§13/§14, ACTIVATION_NUMBER_MISSING): 실제 통신사 가입번호. 작업자="본사"
 *   행은 100% 빈값(반례 없음, §14 예외 대상)이므로 이 필드에서만 작업자="본사"를 제외한다.
 *   작업자="L)현아" 등 다른 예외 후보는 §14가 명시한 범위가 아니므로 그대로 ERROR 처리한다
 *   (HOLD 보고 완료 — 화면에 노출해서 실제로 확인하도록 함).
 * - 접점코드/요금제: 이 두 시트는 실측상 "완료된 신규개통"만 보유한다(변경/조회/취소 등은
 *   ■변경완료 쪽이며 이번 범위에서 제외됨) — 예외 없이 필수로 취급(실측: 100% 채워짐).
 * - 외국인등급: 고객유형에 "외국인"이 포함된 행에만 적용(기존 activation-row-mapper.ts의
 *   nationalityType 판정 규칙과 동일하게 .includes('외국인') 사용 — 새 판정 발명 아님).
 * - 단말 모델/일련번호: 요청점이 "단말)"로 시작하는 행에만 적용(§16 실측 패턴).
 * - 매미: 단말 대상 행만 memiSync 결과로 대사한다(memi-client.ts 참고, 이 함수는 순수하게
 *   조회된 결과만 반영 — 네트워크 호출은 computeActivationAudit()에서 미리 1회만 수행).
 * - 개통번호/가입번호 "형식" 오류는 검사하지 않는다(채널별 확정 규칙이 없음 — §11/§13).
 */
function auditRow(
  row: string[],
  cols: ColumnIndexes,
  memiSync: MemiSyncResult,
  auditDate: string,
): { fields: Omit<AuditedActivationRow, "status" | "issues">; issues: AuditIssue[] } {
  const worker = cell(row, cols.worker);
  const requestPoint = cell(row, cols.requestPoint);
  const contactCode = cell(row, cols.contactCode);
  const planName = cell(row, cols.planName);
  const activationNumber = cell(row, cols.activationNumber);
  const subscriptionNumber = cell(row, cols.subscriptionNumber);
  const customerType = cell(row, cols.customerType);
  const foreignerGrade = cell(row, cols.foreignerGrade);
  const model = cell(row, cols.model);
  const serial = cell(row, cols.serial);

  const issues: AuditIssue[] = [];

  if (cols.activationNumber >= 0 && !activationNumber) {
    issues.push(issue("ACTIVATION_PHONE_MISSING", "ERROR"));
  }
  if (cols.contactCode >= 0 && !contactCode) {
    issues.push(issue("CONTACT_CODE_MISSING", "ERROR"));
  }
  if (cols.planName >= 0 && !planName) {
    issues.push(issue("PLAN_MISSING", "ERROR"));
  }
  if (cols.subscriptionNumber >= 0 && !subscriptionNumber && worker !== "본사") {
    issues.push(issue("ACTIVATION_NUMBER_MISSING", "ERROR"));
  }

  const isForeigner = cols.customerType >= 0 && customerType.includes("외국인");
  if (isForeigner && cols.foreignerGrade >= 0 && !foreignerGrade) {
    issues.push(issue("FOREIGNER_GRADE_MISSING", "ERROR"));
  }

  const isDeviceTarget = requestPoint.startsWith("단말)");
  let memiStatus: AuditedActivationRow["memiStatus"];
  let memiModel: string | undefined;
  let memiSerial: string | undefined;
  if (isDeviceTarget) {
    if (cols.model >= 0 && !model) issues.push(issue("DEVICE_MODEL_MISSING", "ERROR"));
    if (cols.serial >= 0 && !serial) issues.push(issue("DEVICE_SERIAL_MISSING", "ERROR"));

    if (memiSync.status !== "ok") {
      memiStatus = "DATA_UNAVAILABLE";
      issues.push(issue("MEMI_DATA_UNAVAILABLE", "DATA_UNAVAILABLE"));
    } else if (!serial) {
      // MCC 쪽 일련번호 자체가 없으면 대사할 키가 없다 — 이미 DEVICE_SERIAL_MISSING으로
      // 잡혔으므로 매미 상태는 판정하지 않는다(정보 없음, 중복 issue 생성 안 함).
    } else {
      const matched = memiSync.bySerial.get(normalizeSerial(serial));
      if (matched) {
        memiStatus = "MATCHED";
        memiModel = matched.model;
        memiSerial = matched.rawSerial || undefined;
      } else {
        memiStatus = "NOT_FOUND";
        issues.push(issue("MEMI_DEVICE_NOT_FOUND", "ERROR"));
      }
    }
  }

  return {
    fields: {
      auditDate,
      worker,
      activationDate: cell(row, cols.date),
      requestPoint,
      customerName: cell(row, cols.customerName),
      activationNumber,
      code: cell(row, cols.code),
      contactCode,
      planName,
      subscriptionNumber,
      customerType,
      foreignerGrade,
      model,
      serial,
      memiStatus,
      memiModel,
      memiSerial,
    },
    issues,
  };
}

function rowStatus(issues: AuditIssue[]): RowAuditStatus {
  if (issues.some((i) => i.severity === "ERROR")) return "ERROR";
  if (issues.some((i) => i.severity === "DATA_UNAVAILABLE")) return "DATA_UNAVAILABLE";
  return "PASS";
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

// [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] PHASE 2 —
// 상단 "개통 후 자동검수"가 참조할 원본을 사용자가 명시적으로 고를 수 있게 하는 선택적
// override. 지정하지 않으면(undefined) 기존과 완전히 동일한 날짜 기준 자동 선택
// (오늘=■당일완료, 과거=개통처리부)으로 동작한다 — 기존 호출부(여기·§11 "me" 엔드포인트)
// 는 이 옵션을 넘기지 않으므로 결과가 전혀 달라지지 않는다.
export interface ActivationAuditOptions {
  /** 지정 시 날짜와 무관하게 이 시트 하나만 사용(§10 — 상단 원본 선택 UI 전용). */
  sourceOverride?: typeof AUDIT_SOURCE_SHEETS.today | typeof AUDIT_SOURCE_SHEETS.historical;
  /** true면 해당 시트의 Google Sheets 캐시(PHASE 1 공용 캐시 + 이 파일의 ledger 캐시)를
   * 모두 건너뛰고 강제로 다시 읍는다(§12 — "매미 새로고침"이 실제로 최신 데이터를
   * 반영하도록). 매미 자체의 재조회 여부와는 독립적이다. */
  forceRefresh?: boolean;
}

function resolveSourceSheet(date: Date, sourceOverride?: ActivationAuditOptions["sourceOverride"]): string {
  if (sourceOverride) return sourceOverride;
  return isToday(date) ? AUDIT_SOURCE_SHEETS.today : AUDIT_SOURCE_SHEETS.historical;
}

/**
 * 지정한 날짜의 개통 완료 데이터를 자동검수한다. 오늘이면 ■당일완료, 과거면 개통처리부
 * 하나만 선택해서 읽는다(두 시트를 합산하지 않음 — 실측상 날짜 기준으로 배타적).
 * opts.sourceOverride가 있으면 그 시트를 날짜와 무관하게 그대로 사용한다.
 */
export async function computeActivationAudit(date: Date, cache: LedgerCache, opts?: ActivationAuditOptions): Promise<ActivationAuditResult> {
  const dateYmd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sourceSheet = resolveSourceSheet(date, opts?.sourceOverride);

  // [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 매미 조회는 행마다가 아니라 이 요청당
  // 딱 1번만 수행한다(§12/§14 — 로그인/xlsDown 반복 방지, memi-client.ts 내부 cache 재사용).
  const [entry, memiSync] = await Promise.all([
    fetchLedgerCached(date, cache, sourceSheet, { forceRefresh: opts?.forceRefresh }),
    getMemiDailyReconciliation(dateYmd),
  ]);
  const cols = resolveColumns(entry.header);

  const rows: AuditedActivationRow[] = [];
  const byCode: Partial<Record<AuditCode, number>> = {};
  let pass = 0;
  let error = 0;
  let dataUnavailable = 0;

  for (const r of entry.rows) {
    if (!matchesDate(r[cols.date], date)) continue;
    const { fields, issues } = auditRow(r, cols, memiSync, dateYmd);
    const status = rowStatus(issues);
    if (status === "PASS") pass++;
    else if (status === "ERROR") error++;
    else dataUnavailable++;
    for (const iss of issues) {
      byCode[iss.code] = (byCode[iss.code] ?? 0) + 1;
    }
    rows.push({ ...fields, status, issues });
  }

  const dataFreshness = await getSourceFreshness(date, sourceSheet);

  return {
    date: dateYmd,
    sourceSheet,
    total: rows.length,
    summary: { pass, error, dataUnavailable },
    byCode,
    rows,
    memiSync: { status: memiSync.status, syncedAt: memiSync.syncedAt, rowCount: memiSync.rowCount, error: memiSync.error },
    dataFreshness,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] 기간 조회 확장
//
// §4/§5/§6 실측 결론: "■당일완료"는 항상 "오늘"의 행만 보유하고(자정이 지나면 그 행은
// 더 이상 여기 없음 — 기존 personal-performance.ts 주석/§0 LOCK 전제), "개통처리부"는
// 항상 "오늘 이전" 행만 보유한다(실측: DEV에서 조회 시점 기준 개통처리부의 오늘 날짜
// 행이 0건임을 직접 확인). 즉 두 시트는 "같은 날짜의 데이터를 중복 보유"하지 않고
// 날짜 자체로 이미 배타적으로 partition되어 있다 — 그래서 기간 조회도 "day-by-day로
// 그날에 맞는 소스 하나만 선택해서 합치는" 기존 computeActivationAudit()의 원칙을
// 날짜별로 반복 적용하기만 하면 되고, 행 단위 중복 제거(dedup)가 필요 없다.
//
// DEDUP_KEY=해당없음(불필요) — DEDUP_REASON: 두 시트가 날짜로 이미 배타적 partition되어
// 있음을 실측 확인(오늘 날짜의 개통처리부 행=0건, 이번 달 데이터가 옮겨진 과거 날짜
// (9/24·9/28)는 개통처리부에만 존재·■당일완료엔 전혀 없음 — 같은 업무건이 두 시트에
// 동시에 존재하는 사례 자체가 없다). DUPLICATE_COUNT=0(같은 이유로 발생하지 않음).
// 완료 보고서에 실측 근거를 그대로 남긴다.
//
// §5 "■당일완료 → 개통처리부 이동 안전성": 과거 날짜를 재조회할 때 그 날짜가 오늘이
// 아니면 무조건 개통처리부만 본다(당일완료는 애초에 그 날짜 데이터를 갖고 있지 않음) —
// 이동이 이미 끝났다고 가정하지 않고, "오늘 이후로는 항상 개통처리부에서 찾는다"는
// 날짜 기준 규칙 자체가 이동 완료 여부와 무관하게 항상 안전하다(개통처리부에 아직
// 반영되지 않았다면 그 날짜는 정말로 0건으로 나오는 것이 맞다 — 검수 결과를 조작해서
// 억지로 채우지 않는다).
function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function enumerateDates(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= last.getTime()) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export interface ActivationAuditRangeResult {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** §7 — 실제로 읽은 원본만, 읽은 순서 그대로(예: ["개통처리부"] | ["■당일완료"] | ["개통처리부","■당일완료"]) */
  sourceSheets: string[];
  total: number;
  summary: { pass: number; error: number; dataUnavailable: number };
  byCode: Partial<Record<AuditCode, number>>;
  rows: AuditedActivationRow[];
  memiSync: { status: "ok" | "unavailable"; syncedAt: string | null; rowCount: number; error?: string };
  /** [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §4 —
   * sourceSheets의 각 시트별 캐시 신선도. 기간 조회라 시트가 여러 개일 수 있어 맵으로 제공. */
  sourceFreshness: Record<string, { stale: boolean; fetchedAt: string | null }>;
}

/**
 * 지정한 [startDate, endDate] 기간(양끝 포함, §2)을 자동검수한다. 날짜별로 §0 LOCK된
 * 기존 원칙(오늘=■당일완료, 과거=개통처리부, 절대 합산하지 않음)을 그대로 적용해서
 * 모은다 — 판정 규칙(auditRow)도 단일 날짜 경로와 완전히 동일한 함수를 그대로 재사용한다.
 * 매미 조회는 기간 전체 1회만 수행한다(§13 — 날짜별 반복 로그인 금지, DEV 실측으로
 * 매미가 실제 기간 조회를 지원함을 확인했다).
 */
export async function computeActivationAuditRange(
  startDate: Date,
  endDate: Date,
  cache: LedgerCache,
  opts?: ActivationAuditOptions,
): Promise<ActivationAuditRangeResult> {
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("[ActivationAudit] 시작일이 종료일보다 늦습니다.");
  }

  const dates = enumerateDates(startDate, endDate);
  const startYmd = ymd(startDate);
  const endYmd = ymd(endDate);

  const memiSync = await getMemiRangeReconciliation(startYmd, endYmd);

  const rows: AuditedActivationRow[] = [];
  const byCode: Partial<Record<AuditCode, number>> = {};
  let pass = 0;
  let error = 0;
  let dataUnavailable = 0;
  const sourceSheetsUsed: string[] = [];
  const sourceSheetsSeen = new Set<string>();

  for (const date of dates) {
    const dateYmd = ymd(date);
    // [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
    // sourceOverride가 있으면 기간 내 모든 날짜에 그 시트 하나만 적용한다(사용자가
    // 상단에서 "개통처리부"를 명시적으로 선택했다면, 기간 안에 오늘이 섞여 있어도
    // 날짜별 자동 선택으로 되돌리지 않는다 — §10/§11 요구사항).
    const sourceSheet = resolveSourceSheet(date, opts?.sourceOverride);
    if (!sourceSheetsSeen.has(sourceSheet)) {
      sourceSheetsSeen.add(sourceSheet);
      sourceSheetsUsed.push(sourceSheet);
    }

    const entry = await fetchLedgerCached(date, cache, sourceSheet, { forceRefresh: opts?.forceRefresh });
    const cols = resolveColumns(entry.header);

    for (const r of entry.rows) {
      if (!matchesDate(r[cols.date], date)) continue;
      const { fields, issues } = auditRow(r, cols, memiSync, dateYmd);
      const status = rowStatus(issues);
      if (status === "PASS") pass++;
      else if (status === "ERROR") error++;
      else dataUnavailable++;
      for (const iss of issues) {
        byCode[iss.code] = (byCode[iss.code] ?? 0) + 1;
      }
      rows.push({ ...fields, status, issues });
    }
  }

  // §4 — sourceSheets에 등장한 시트별로 신선도를 조회한다(endDate 기준 spreadsheet로
  // 조회 — 기간이 월을 넘지 않는 일반적인 사용 범위에서는 전체 기간과 동일한 spreadsheet).
  const sourceFreshness: Record<string, { stale: boolean; fetchedAt: string | null }> = {};
  for (const sheet of sourceSheetsUsed) {
    sourceFreshness[sheet] = await getSourceFreshness(endDate, sheet);
  }

  return {
    startDate: startYmd,
    endDate: endYmd,
    sourceSheets: sourceSheetsUsed,
    total: rows.length,
    summary: { pass, error, dataUnavailable },
    byCode,
    rows,
    memiSync: { status: memiSync.status, syncedAt: memiSync.syncedAt, rowCount: memiSync.rowCount, error: memiSync.error },
    sourceFreshness,
  };
}
