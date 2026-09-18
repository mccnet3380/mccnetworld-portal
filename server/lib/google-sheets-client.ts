// server/lib/google-sheets-client.ts
//
// MCC_PERFORMANCE_CLOSING_LIVE_INTEGRATION_1
// Google Sheets(실적 원본 스프레드시트)를 서버에서만 읽기 위한 클라이언트.
//
// 절대 원칙:
// - 이 파일이 다루는 인증정보(서비스 계정 이메일/개인키/스프레드시트 ID)는
//   서버 환경변수(.env 로컬 / Render 대시보드 운영)에서만 읽는다.
// - frontend(client/**)에는 어떤 값도 절대 전달하지 않는다.
// - 쓰기(write) 권한은 사용하지 않는다. spreadsheets.readonly 스코프만 사용.
//
// ─────────────────────────────────────────────────────────
// [필요 시 사용자가 직접 해야 하는 Google Cloud 설정 절차]
// 이미 서비스 계정이 있다면 아래 3~4단계만 확인하면 됩니다.
//
// 1) Google Cloud Console(console.cloud.google.com)에서 프로젝트 선택/생성
// 2) "APIs & Services > Library"에서 "Google Sheets API" 활성화(Enable)
// 3) "APIs & Services > Credentials"에서 서비스 계정(Service Account) 생성
//    - 역할(Role)은 별도로 줄 필요 없음 (프로젝트 내 권한이 아니라
//      "스프레드시트 공유"로 접근 권한을 주는 방식이기 때문)
//    - 생성 후 "Keys" 탭에서 JSON 키 생성 → JSON 파일 다운로드
// 4) 다운로드한 JSON 안의 두 값을 서버 환경변수로 등록
//    - client_email  → GOOGLE_SERVICE_ACCOUNT_EMAIL
//    - private_key   → GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//      (줄바꿈이 \n 으로 이스케이프된 상태로 저장해도 되며, 이 파일이 자동 변환함)
// 5) 대상 Google Spreadsheet를 3)에서 만든 서비스 계정 이메일과
//    "뷰어(Viewer)" 권한으로 공유 (스프레드시트 우측 상단 "공유" 버튼)
// 6) 스프레드시트 URL의 /d/ 뒤 ID 값을 GOOGLE_SHEETS_SPREADSHEET_ID 로 등록
//    (이번 작업 대상: 1AzWZZcDBFXfEOWnpoSik_HHVY4nJZfkT8JXToaKQ6LE)
//
// 등록 위치:
// - 로컬 개발: 이 프로젝트 루트 .env 파일
// - 운영(Render로 확인됨): Render 대시보드 > 해당 서비스 > Environment 탭
//   (기존 DATABASE_URL_PROD, JWT_ACCESS_SECRET 등과 동일한 방식)
// ─────────────────────────────────────────────────────────

import { JWT } from "google-auth-library";
import { resolveActiveSpreadsheet } from "./spreadsheet-resolver";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedClient: JWT | null = null;

function normalizePrivateKey(raw: string): string {
  // Render/Replit Secrets에 줄바꿈이 \n 문자열로 저장되는 경우가 많아 자동 변환
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

interface CredentialStatus {
  ok: boolean;
  missing: string[];
  email?: string;
  privateKey?: string;
  spreadsheetId?: string;
}

function getCredentialStatus(): CredentialStatus {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();

  const missing: string[] = [];
  if (!email) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!rawKey) missing.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!spreadsheetId) missing.push("GOOGLE_SHEETS_SPREADSHEET_ID");

  return {
    ok: missing.length === 0,
    missing,
    email,
    privateKey: rawKey ? normalizePrivateKey(rawKey) : undefined,
    spreadsheetId,
  };
}

/** 실적 화면/스크립트에서 사전 점검용으로 사용 */
export function getGoogleSheetsConfigStatus(): { configured: boolean; missing: string[] } {
  const status = getCredentialStatus();
  return { configured: status.ok, missing: status.missing };
}

export function isGoogleSheetsConfigured(): boolean {
  return getCredentialStatus().ok;
}

function getClient(): JWT {
  if (cachedClient) return cachedClient;

  const status = getCredentialStatus();
  if (!status.ok) {
    throw new Error(
      `[GoogleSheets] 환경변수 누락: ${status.missing.join(", ")}. ` +
        `설정 절차는 server/lib/google-sheets-client.ts 상단 주석을 참고하세요.`,
    );
  }

  cachedClient = new JWT({
    email: status.email,
    key: status.privateKey,
    scopes: [SHEETS_READONLY_SCOPE],
  });
  return cachedClient;
}

async function getAccessToken(): Promise<string> {
  const client = getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("[GoogleSheets] 액세스 토큰 발급에 실패했습니다.");
  }
  return token;
}

/**
 * MCC_INTERNET_RULE_AND_MONTHLY_SHEET_AUTO_ROUTING_1:
 * GOOGLE_SHEETS_AUTO_ROUTE가 꺼져 있으면(기본값) 기존과 완전히 동일하게
 * GOOGLE_SHEETS_SPREADSHEET_ID를 그대로 사용한다 (동작 변경 없음).
 * 켜져 있으면 spreadsheet-resolver가 매월 파일을 자동으로 찾아서 반환한다.
 */
async function getSpreadsheetId(): Promise<string> {
  const status = getCredentialStatus();
  if (!status.spreadsheetId) {
    throw new Error("[GoogleSheets] GOOGLE_SHEETS_SPREADSHEET_ID 환경변수가 없습니다.");
  }
  const resolved = await resolveActiveSpreadsheet();
  return resolved.id;
}

/**
 * 시트 이름으로 값을 읽는다. (읽기 전용)
 * 반환값: 2차원 배열, 첫 행이 헤더인지 여부는 호출부에서 판단.
 */
export async function fetchSheetValues(
  sheetName: string,
  range = "A1:ZZ20000",
): Promise<string[][]> {
  const token = await getAccessToken();
  const spreadsheetId = await getSpreadsheetId();
  const encodedRange = encodeURIComponent(`'${sheetName}'!${range}`);
  const url =
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[GoogleSheets] 시트 조회 실패 (status=${res.status}) sheet="${sheetName}": ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as { values?: unknown[][] };
  return (json.values || []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

/**
 * LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1: 검수 날짜 기준으로 이미 resolve된
 * spreadsheetId를 직접 받아 조회한다. 기존 fetchSheetValues()(항상 "오늘" 기준으로
 * getSpreadsheetId()를 호출)는 그대로 두고 별도 함수로 추가했다 — 검증된 경로 무변경.
 * LG 검수는 "검수 날짜"의 연/월로 resolve한 스프레드시트를 읽어야 하므로
 * resolveActiveSpreadsheet(auditDate)의 결과를 호출부에서 직접 넘겨 쓴다.
 */
export async function fetchSheetValuesById(
  spreadsheetId: string,
  sheetName: string,
  range = "A1:ZZ20000",
): Promise<string[][]> {
  const token = await getAccessToken();
  const encodedRange = encodeURIComponent(`'${sheetName}'!${range}`);
  const url =
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[GoogleSheets] 시트 조회 실패 (status=${res.status}) sheet="${sheetName}": ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as { values?: unknown[][] };
  return (json.values || []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

/**
 * MCC_INTERNET_EXISTING_EXCEL_RULE_TRACE_1: 진단 전용 — 셀의 "값"이 아니라 "수식 문자열"을 읽는다.
 * 기존 fetchSheetValues()는 그대로 두고 별도 함수로 추가했다 (검증된 경로 무변경).
 * 어떤 시트가 다른 시트를 SUMIF/COUNTIF 등으로 참조하는지 찾을 때 사용.
 */
export async function fetchSheetFormulas(
  sheetName: string,
  range = "A1:ZZ200",
): Promise<string[][]> {
  const token = await getAccessToken();
  const spreadsheetId = await getSpreadsheetId();
  const encodedRange = encodeURIComponent(`'${sheetName}'!${range}`);
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMULA`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[GoogleSheets] 수식 조회 실패 (status=${res.status}) sheet="${sheetName}": ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as { values?: unknown[][] };
  return (json.values || []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

/** 스프레드시트에 실제로 존재하는 시트(탭) 이름 목록을 조회 */
export async function listSpreadsheetSheetNames(): Promise<string[]> {
  const token = await getAccessToken();
  const spreadsheetId = await getSpreadsheetId();
  const url = `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties.title`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[GoogleSheets] 스프레드시트 메타 조회 실패 (status=${res.status}): ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (json.sheets || [])
    .map((s) => s.properties?.title)
    .filter((title): title is string => !!title);
}
