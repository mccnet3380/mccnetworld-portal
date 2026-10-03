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

// ============================================================
// [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
// 공용 read 캐시 — Google Sheets API 429(RATE_LIMIT_EXCEEDED, Read requests per
// minute per user) 구조적 문제 해결(PHASE 1). 모든 MCC 계정이 하나의 Service
// Account를 공유하므로, 같은 (spreadsheetId, sheetName, range)를 짧은 시간에
// 여러 번(여러 사용자/여러 화면) 읍어도 실제 Google 호출은 1번만 나가게 한다.
//
// 이 캐시는 fetchSheetValuesById()/fetchSheetValues() 내부에 있으므로, 이미
// 존재하는 모든 호출부(performance-dataset.ts 체인, sheet-viewer.ts,
// personal-performance.ts 등)가 코드 변경 없이 자동으로 혜택을 받는다.
// personal-performance.ts는 이미 자체 60초 캐시(sharedLedgerCache)를 갖고
// 있어 이 레이어와 중복되지만, 데이터 의미/회귀 위험 때문에 그 파일은
// 건드리지 않는다(§1 지시 — 기존 기능 캐시를 무리하게 공용화하지 않음). 중복
// 캐시는 결과를 바꾸지 않고 단지 한 번 더 확인하는 것뿐이라 안전하다.
//
// CACHE_KEY = spreadsheetId + "::" + sheetName + "::" + range — 다른 월/다른
// 시트/다른 range가 섞이는 사고를 막기 위해 3개 값을 전부 키에 포함한다.
// ============================================================
const SHEET_CACHE_TTL_MS = 60_000;
// stale fallback으로 재사용할 수 있는 최대 나이 — 이보다 오래된 캐시는 "쓸 수
// 있는 최근 데이터"로 보지 않고 평소처럼 에러를 그대로 던진다(§4 — 캐시가
// 전혀 없는 최초 요청에서 429가 나면 정상적으로 오류 처리한다는 원칙의 연장).
const STALE_FALLBACK_MAX_AGE_MS = 10 * 60_000;

interface SheetCacheEntry {
  data: string[][];
  fetchedAt: number;
  expiresAt: number;
}

const sheetValuesCache = new Map<string, SheetCacheEntry>();
const inFlightSheetRequests = new Map<string, Promise<string[][]>>();

function sheetCacheKey(spreadsheetId: string, sheetName: string, range: string): string {
  return `${spreadsheetId}::${sheetName}::${range}`;
}

/** 호출부가 "지금 보여주는 데이터가 최신인지 stale인지" 구분하고 싶을 때 쓰는 선택적 조회. */
export interface SheetCacheStatus {
  cached: boolean;
  stale: boolean;
  fetchedAt: number | null;
  ageMs: number | null;
}

export function getSheetCacheStatus(spreadsheetId: string, sheetName: string, range = "A1:ZZ20000"): SheetCacheStatus {
  const entry = sheetValuesCache.get(sheetCacheKey(spreadsheetId, sheetName, range));
  if (!entry) return { cached: false, stale: false, fetchedAt: null, ageMs: null };
  const ageMs = Date.now() - entry.fetchedAt;
  return { cached: true, stale: Date.now() > entry.expiresAt, fetchedAt: entry.fetchedAt, ageMs };
}

export interface FetchSheetValuesOpts {
  /** true면 TTL 캐시를 무시하고 강제로 Google을 다시 호출한다(§5 — 명시적 강제 새로고침용).
   * in-flight dedup은 강제 새로고침에도 그대로 적용된다(동시에 여러 번 눌러도 Google 호출은 1번). */
  forceRefresh?: boolean;
}

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
 * [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
 * "오늘" 기준 활성 spreadsheetId를 resolve한 뒤 fetchSheetValuesById()(캐시+
 * in-flight dedup 포함)에 그대로 위임한다 — 동작은 기존과 동일, 캐시만 추가.
 */
export async function fetchSheetValues(
  sheetName: string,
  range = "A1:ZZ20000",
  opts?: FetchSheetValuesOpts,
): Promise<string[][]> {
  const spreadsheetId = await getSpreadsheetId();
  return fetchSheetValuesById(spreadsheetId, sheetName, range, opts);
}

/** 실제 Google Sheets API 호출(캐시/dedup 없는 원본) — 내부 전용. */
async function fetchSheetValuesByIdRaw(
  spreadsheetId: string,
  sheetName: string,
  range: string,
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
    const err: any = new Error(
      `[GoogleSheets] 시트 조회 실패 (status=${res.status}) sheet="${sheetName}": ${body.slice(0, 500)}`,
    );
    err.status = res.status;
    throw err;
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
/**
 * [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
 * PHASE 1 핵심 함수 — 캐시(TTL 60초) + in-flight 중복요청 제거 + 429 stale
 * fallback을 전부 여기서 처리한다. 호출 시그니처(인자 3개까지)는 기존과 동일해서
 * 기존 모든 호출부(performance-dataset.ts 체인, sheet-viewer.ts 등)는 코드를
 * 한 줄도 바꾸지 않고 캐시 혜택을 받는다. 4번째 opts는 이번에 추가된 선택 인자.
 *
 * 동작 순서:
 * 1) forceRefresh가 아니고 캐시가 TTL 안이면 → 캐시 그대로 반환(Google 호출 0)
 * 2) 이미 같은 key로 진행 중인 요청이 있으면 → 그 Promise를 공유(Google 호출 0,
 *    TEST_C: 동시 10개 요청 → Google 실제 호출 1회)
 * 3) 그 외에는 Google을 실제로 호출하고, 성공하면 캐시에 저장
 * 4) Google 호출이 실패했는데(429든 다른 오류든) "쓸 수 있는" stale 캐시가
 *    있으면(10분 이내) 그 값을 반환한다 — 화면 전체 ERROR 대신 최근 데이터로
 *    대체(§4). 쓸 수 있는 캐시가 전혀 없으면 원래처럼 에러를 그대로 던진다.
 */
export async function fetchSheetValuesById(
  spreadsheetId: string,
  sheetName: string,
  range = "A1:ZZ20000",
  opts?: FetchSheetValuesOpts,
): Promise<string[][]> {
  const key = sheetCacheKey(spreadsheetId, sheetName, range);
  const now = Date.now();

  if (!opts?.forceRefresh) {
    const cached = sheetValuesCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  const inFlight = inFlightSheetRequests.get(key);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = (async (): Promise<string[][]> => {
    try {
      const data = await fetchSheetValuesByIdRaw(spreadsheetId, sheetName, range);
      sheetValuesCache.set(key, { data, fetchedAt: Date.now(), expiresAt: Date.now() + SHEET_CACHE_TTL_MS });
      return data;
    } catch (err: any) {
      const stale = sheetValuesCache.get(key);
      if (stale && Date.now() - stale.fetchedAt <= STALE_FALLBACK_MAX_AGE_MS) {
        console.warn(
          `[GoogleSheets] "${sheetName}" 조회 실패(${err?.status ?? "?"}) — ` +
            `${Math.round((Date.now() - stale.fetchedAt) / 1000)}초 전 캐시로 대체 응답(stale fallback).`,
        );
        return stale.data;
      }
      throw err;
    } finally {
      inFlightSheetRequests.delete(key);
    }
  })();

  inFlightSheetRequests.set(key, requestPromise);
  return requestPromise;
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

/**
 * 작업명: MCC_MONTHLY_SPREADSHEET_SELECTIVE_SHEET_VIEWER_1
 *
 * 지정한 spreadsheetId(이미 resolveActiveSpreadsheet()로 resolve된 값)에 실제로
 * 존재하는 시트(탭) 전체의 metadata(제목/숨김여부/행·열 개수)를 조회한다. 값(셀 데이터)은
 * 읽지 않는다 — fields를 properties로 제한해 quota 부담을 최소화한다. 시트 이름을
 * 하드코딩하지 않는 범용 조회 기능(개통현황 선택 조회)의 기반 함수다. 기존
 * listSpreadsheetSheetNames()(env 고정 spreadsheetId, title만 반환)는 무수정 — 이 함수는
 * fetchSheetValuesById()와 같은 방식으로 spreadsheetId를 인자로 받는 별도 함수로 추가한다.
 */
export interface SpreadsheetSheetMeta {
  title: string;
  sheetId: number;
  index: number;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
}

export async function listSpreadsheetSheetsById(spreadsheetId: string): Promise<SpreadsheetSheetMeta[]> {
  const token = await getAccessToken();
  const url =
    `${SHEETS_API_BASE}/${spreadsheetId}` +
    `?fields=${encodeURIComponent("sheets.properties(sheetId,title,index,hidden,gridProperties)")}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`[GoogleSheets] 시트 목록 조회 실패 (status=${res.status}): ${body.slice(0, 500)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const json = (await res.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
  };

  return (json.sheets || [])
    .map((s) => s.properties)
    .filter((p): p is NonNullable<typeof p> => !!p?.title)
    .map((p) => ({
      title: p.title!,
      sheetId: p.sheetId ?? 0,
      index: p.index ?? 0,
      hidden: p.hidden === true,
      rowCount: p.gridProperties?.rowCount ?? 0,
      columnCount: p.gridProperties?.columnCount ?? 0,
    }));
}
