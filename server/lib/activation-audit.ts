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
import { getMemiDailyReconciliation, normalizeSerial, type MemiSyncResult } from "./memi-client";

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
      } else {
        memiStatus = "NOT_FOUND";
        issues.push(issue("MEMI_DEVICE_NOT_FOUND", "ERROR"));
      }
    }
  }

  return {
    fields: {
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

/**
 * 지정한 날짜의 개통 완료 데이터를 자동검수한다. 오늘이면 ■당일완료, 과거면 개통처리부
 * 하나만 선택해서 읽는다(두 시트를 합산하지 않음 — 실측상 날짜 기준으로 배타적).
 */
export async function computeActivationAudit(date: Date, cache: LedgerCache): Promise<ActivationAuditResult> {
  const dateYmd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sourceSheet = isToday(date) ? AUDIT_SOURCE_SHEETS.today : AUDIT_SOURCE_SHEETS.historical;

  // [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 매미 조회는 행마다가 아니라 이 요청당
  // 딱 1번만 수행한다(§12/§14 — 로그인/xlsDown 반복 방지, memi-client.ts 내부 cache 재사용).
  const [entry, memiSync] = await Promise.all([
    fetchLedgerCached(date, cache, sourceSheet),
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
    const { fields, issues } = auditRow(r, cols, memiSync);
    const status = rowStatus(issues);
    if (status === "PASS") pass++;
    else if (status === "ERROR") error++;
    else dataUnavailable++;
    for (const iss of issues) {
      byCode[iss.code] = (byCode[iss.code] ?? 0) + 1;
    }
    rows.push({ ...fields, status, issues });
  }

  return {
    date: dateYmd,
    sourceSheet,
    total: rows.length,
    summary: { pass, error, dataUnavailable },
    byCode,
    rows,
    memiSync: { status: memiSync.status, syncedAt: memiSync.syncedAt, rowCount: memiSync.rowCount, error: memiSync.error },
  };
}
