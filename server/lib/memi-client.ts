// server/lib/memi-client.ts
//
// 작업명: MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1
//
// 매미(imemi.co.kr) 실연동 클라이언트. MCC Backend가 서버 간(server-to-server)으로
// 매미에 자동 로그인 → 금일 개통자료 xlsDown → Excel 파싱까지 전부 처리한다. 작업자가
// 매미 사이트 접속/엑셀 다운로드/업로드/VLOOKUP을 할 필요가 없다(§1 목적).
//
// ─────────────────────────────────────────────────────────
// Credential 보안 원칙(§4):
// - MEMI_USER_ID / MEMI_USER_PASSWORD 환경변수만 사용한다.
// - 소스코드/frontend/HTML/Git/DB 평문/API 응답/console log 어디에도 값을 남기지 않는다.
// - 이 파일은 실제 자격증명 문자열을 하드코딩하지 않는다(env가 없으면 즉시
//   MemiUnavailableError로 실패 처리 — 호출부가 MEMI_DATA_UNAVAILABLE로 매핑한다).
// ─────────────────────────────────────────────────────────
//
import * as XLSX from "xlsx";

// HTTP(HTTPS 아님) 사용 — 인증서 이름 불일치가 실측 확인되어 임의로 HTTPS 전환하지 않는다.
const MEMI_BASE = "http://ad2.imemi.co.kr";
const MEMI_LOGIN_URL = `${MEMI_BASE}/Login/LoginDo?`;
const MEMI_XLSDOWN_URL = `${MEMI_BASE}/Sell/Sell/xlsDown`;

// 로그인 실패 시 HTTP 200이어도 alert(...)가 반환되는 것이 실측됐다(§3/§5) — 200만으로
// 성공 판정하지 않는다.
const LOGIN_FAILURE_PATTERN = /alert\(\s*['"]/;

// 세션 재사용 TTL(추정치) — 매미가 실제로 몇 분/시간 세션을 유지하는지 실측되지 않았으므로
// 보수적으로 짧게 잡는다. xlsDown이 로그인 페이지(HTML)를 반환하면 즉시 세션 만료로 보고
// 1회 재로그인+재시도한다(§5/§8 CASE 8) — 이 TTL은 "그 전에 불필요한 재로그인을 막는" 용도일
// 뿐, 정확한 만료 판정은 xlsDown 응답 자체로 한다.
const SESSION_ASSUME_VALID_MS = 10 * 60 * 1000;

// 매미 결과 cache TTL — 성공은 5분, 실패는 60초만(§12 "실패 응답을 정상 데이터처럼 장시간
// cache하지 않는다"). personal-performance.ts의 fetchLedgerCached(60초)와 같은 재사용
// 우선 원칙을 따르되, 매미 로그인은 Sheets API 조회보다 훨씬 무거운 작업이라 성공 시에는
// 조금 더 길게(5분) 유지한다.
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 1000;

export class MemiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemiUnavailableError";
  }
}

interface MemiCredentials {
  id: string;
  password: string;
}

function getCredentials(): MemiCredentials | null {
  const id = process.env.MEMI_USER_ID?.trim();
  const password = process.env.MEMI_USER_PASSWORD?.trim();
  if (!id || !password) return null;
  return { id, password };
}

export function isMemiConfigured(): boolean {
  return getCredentials() !== null;
}

interface MemiSession {
  cookieHeader: string;
  establishedAt: number;
}

let cachedSession: MemiSession | null = null;

function parseSetCookie(headers: Headers): string[] {
  // Node의 fetch Headers는 getSetCookie()를 지원한다(Node 18.17+/20+). 없으면 단일
  // set-cookie 헤더로 폴백한다(일부 서버는 콤마로 이어붙여 줄 수도 있어 완벽하지 않지만,
  // 이 프로젝트의 다른 fetch 호출(google-sheets-client.ts)과 동일하게 표준 fetch만 쓴다).
  const anyHeaders = headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookies(existing: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();
  for (const pair of existing.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k) jar.set(k, rest.join("="));
  }
  for (const raw of setCookieHeaders) {
    const firstPart = raw.split(";")[0];
    const eq = firstPart.indexOf("=");
    if (eq > 0) {
      jar.set(firstPart.slice(0, eq).trim(), firstPart.slice(eq + 1).trim());
    }
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * 매미 로그인. 실측 필드(§3): MemberID/MemberPW/chk_id/mAddr.
 * chk_id/mAddr의 정확한 기대값은 실제 로그인 폼 캡처로 재확인되지 않았다 — 아이디저장
 * 체크박스/접속기기 식별용 보조 필드로 추정되는 값을 안전한 기본값으로 보낸다(둘 다 로그인
 * 필수 여부가 확인되지 않았으므로, 실패 시 credential 문제와 구분해 로그로만 남긴다).
 */
async function login(): Promise<string> {
  const creds = getCredentials();
  if (!creds) {
    throw new MemiUnavailableError("MEMI_CREDENTIAL_REQUIRED: MEMI_USER_ID/MEMI_USER_PASSWORD 환경변수가 없습니다.");
  }

  const body = new URLSearchParams({
    MemberID: creds.id,
    MemberPW: creds.password,
    chk_id: "",
    mAddr: "",
  });

  let res: Response;
  try {
    res = await fetch(MEMI_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString(),
      redirect: "manual",
    });
  } catch (err: any) {
    throw new MemiUnavailableError(`매미 로그인 요청 실패(네트워크): ${err?.message ?? err}`);
  }

  const setCookies = parseSetCookie(res.headers);
  const cookieHeader = mergeCookies("", setCookies);

  // 3xx 리다이렉트 응답 body는 비어 있을 수 있으므로 body 검사보다 먼저 쿠키 유무를 본다.
  let text = "";
  try {
    text = await res.text();
  } catch {
    // 바이너리/빈 응답 — 무시
  }

  if (LOGIN_FAILURE_PATTERN.test(text)) {
    throw new MemiUnavailableError(`매미 로그인 실패(알림 응답 감지): ${text.slice(0, 200)}`);
  }
  if (!cookieHeader) {
    throw new MemiUnavailableError("매미 로그인 실패: 세션 쿠키가 발급되지 않았습니다.");
  }

  return cookieHeader;
}

async function getSession(forceRelogin = false): Promise<string> {
  if (!forceRelogin && cachedSession && Date.now() - cachedSession.establishedAt < SESSION_ASSUME_VALID_MS) {
    return cachedSession.cookieHeader;
  }
  const cookieHeader = await login();
  cachedSession = { cookieHeader, establishedAt: Date.now() };
  return cookieHeader;
}

interface XlsDownResult {
  buffer: Buffer;
}

const XLSX_ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // .xlsx (zip)
const XLS_OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xcd, 0xfe, 0xe1, 0xa0]); // legacy .xls

function looksLikeExcelBinary(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf.subarray(0, 4).equals(XLSX_ZIP_SIGNATURE)) return true;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(XLS_OLE_SIGNATURE)) return true;
  return false;
}

/**
 * 금일 개통자료 xlsDown. 실측 필드(§3, 과거 캡처 — 그대로 하드코딩하지 않고 최소 필요
 * 필드만 재현): ListType=SELL, OpnSvcCheck=S, SearchDayChk=on, SearchSDay, SearchEDay,
 * Cpage=1. Audit Engine이 조회하는 날짜와 동일한 날짜만 요청한다(§6 — 월 전체 다운로드 후
 * 클라이언트 필터링 금지).
 *
 * 응답 검증(§7): Content-Type/Content-Disposition만으로 성공 판정하지 않고, 실제 바이너리
 * signature(xlsx=ZIP PK.., 구형 xls=OLE) 확인 + XLSX.read() 실제 파싱 성공까지 확인한다.
 * 로그인 페이지/오류 HTML이 200으로 와도 이 검사에서 걸러진다.
 */
async function xlsDown(dateYmd: string, cookieHeader: string): Promise<XlsDownResult> {
  const form = new FormData();
  form.set("ListType", "SELL");
  form.set("OpnSvcCheck", "S");
  form.set("SearchDayChk", "on");
  form.set("SearchSDay", dateYmd);
  form.set("SearchEDay", dateYmd);
  form.set("Cpage", "1");

  let res: Response;
  try {
    res = await fetch(MEMI_XLSDOWN_URL, {
      method: "POST",
      headers: { Cookie: cookieHeader },
      body: form,
    });
  } catch (err: any) {
    throw new MemiUnavailableError(`매미 xlsDown 요청 실패(네트워크): ${err?.message ?? err}`);
  }

  if (!res.ok) {
    throw new MemiUnavailableError(`매미 xlsDown 실패(status=${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  // 로그인 페이지/오류 HTML이 200으로 오는 경우 감지(§7/§8 세션 만료 판정 근거) — 호출부가
  // 이 신호로 재로그인 1회 재시도를 판단한다.
  const looksHtml = contentType.includes("text/html") || (!looksLikeExcelBinary(buf) && buf.subarray(0, 200).toString("utf-8").trimStart().startsWith("<"));
  if (looksHtml) {
    throw new SessionExpiredError("매미 xlsDown이 Excel이 아닌 HTML을 반환했습니다(세션 만료 추정).");
  }

  if (!looksLikeExcelBinary(buf)) {
    throw new MemiUnavailableError(`매미 xlsDown 응답이 Excel 파일 signature와 일치하지 않습니다(content-type=${contentType}).`);
  }

  return { buffer: buf };
}

class SessionExpiredError extends Error {}

/**
 * 로그인 → xlsDown, 세션 만료로 보이면 재로그인 후 1회만 재시도(§5/§8 CASE 8 — 무한 반복 금지).
 */
async function xlsDownWithAuth(dateYmd: string): Promise<XlsDownResult> {
  const cookieHeader = await getSession();
  try {
    return await xlsDown(dateYmd, cookieHeader);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      const freshCookie = await getSession(true);
      return await xlsDown(dateYmd, freshCookie); // 1회만 재시도 — 실패하면 그대로 throw
    }
    throw err;
  }
}

export interface MemiDeviceRow {
  rawSerial: string;
  normalizedSerial: string;
  model: string;
}

export interface MemiParsedSheet {
  header: string[];
  rowCount: number;
  serialHeader: string;
  modelHeader: string;
  devices: MemiDeviceRow[];
}

// §8: header 기반 parsing 우선, index 하드코딩 금지. 실제 매미 header 명칭이 실측되지
// 않았으므로(credential 없어 실행 불가) 합리적인 후보군으로 resolve하고, 못 찾으면
// 파싱 실패(=MEMI_DATA_UNAVAILABLE)로 명확히 처리한다 — 추측으로 임의 index를 쓰지 않는다.
const SERIAL_HEADER_CANDIDATES = ["일련번호", "시리얼", "시리얼번호", "SERIAL", "S/N", "단말일련번호"];
const MODEL_HEADER_CANDIDATES = ["모델명", "모델", "단말모델", "MODEL"];

function findHeaderIndex(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.findIndex((h) => String(h ?? "").trim() === c);
    if (idx >= 0) return idx;
  }
  // 부분 일치(포함) fallback — 그래도 못 찾으면 -1
  for (const c of candidates) {
    const idx = header.findIndex((h) => String(h ?? "").trim().includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * 일련번호 normalization(§9): raw exact match를 1순위로 쓰고, 실패 시에만 이 정규화 결과로
 * 재시도한다. Excel scientific notation(예: "1.23457E+14"), 공백, 대소문자 차이만 안전하게
 * 보정한다 — 임의 substring/fuzzy 매칭은 하지 않는다(다른 단말을 같은 단말로 오인 금지).
 */
export function normalizeSerial(raw: unknown): string {
  let v = String(raw ?? "").trim();
  if (!v) return "";
  const sci = v.match(/^(\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
  if (sci) {
    const num = Number(v);
    if (Number.isFinite(num)) v = num.toFixed(0);
  }
  v = v.replace(/\s+/g, "");
  return v.toUpperCase();
}

function parseExcelBuffer(buf: Buffer): MemiParsedSheet {
  let workbook: any;
  try {
    workbook = XLSX.read(buf, { type: "buffer" });
  } catch (err: any) {
    throw new MemiUnavailableError(`매미 Excel 파싱 실패: ${err?.message ?? err}`);
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new MemiUnavailableError("매미 Excel에 시트가 없습니다.");
  const ws = workbook.Sheets[sheetName];
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (aoa.length === 0) throw new MemiUnavailableError("매미 Excel이 비어 있습니다.");

  const header = aoa[0].map((h) => String(h ?? "").trim());
  const serialIdx = findHeaderIndex(header, SERIAL_HEADER_CANDIDATES);
  const modelIdx = findHeaderIndex(header, MODEL_HEADER_CANDIDATES);
  if (serialIdx < 0) {
    throw new MemiUnavailableError(`매미 Excel에서 일련번호 컬럼을 찾지 못했습니다. 헤더: ${header.join(", ")}`);
  }

  const rows = aoa.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const devices: MemiDeviceRow[] = rows
    .map((r) => {
      const rawSerial = String(r[serialIdx] ?? "").trim();
      const model = modelIdx >= 0 ? String(r[modelIdx] ?? "").trim() : "";
      return { rawSerial, normalizedSerial: normalizeSerial(rawSerial), model };
    })
    .filter((d) => d.rawSerial !== "");

  return {
    header,
    rowCount: rows.length,
    serialHeader: header[serialIdx],
    modelHeader: modelIdx >= 0 ? header[modelIdx] : "",
    devices,
  };
}

export interface MemiSyncResult {
  status: "ok" | "unavailable";
  date: string;
  syncedAt: string | null;
  rowCount: number;
  header: string[];
  bySerial: Map<string, MemiDeviceRow>;
  error?: string;
}

interface CacheEntry {
  result: MemiSyncResult;
  expiresAt: number;
}
const syncCache = new Map<string, CacheEntry>();

function emptyUnavailable(date: string, error: string): MemiSyncResult {
  return { status: "unavailable", date, syncedAt: null, rowCount: 0, header: [], bySerial: new Map(), error };
}

/**
 * 지정한 날짜의 매미 자료를 확보한다(§14 자동 동기화 — 화면 진입/필터 클릭마다 재로그인하지
 * 않고, cache가 유효하면 재사용, 없거나 만료되면 fetch→cache→반환 순서로 처리한다).
 */
export async function getMemiDailyReconciliation(dateYmd: string, opts?: { force?: boolean }): Promise<MemiSyncResult> {
  const cached = syncCache.get(dateYmd);
  if (!opts?.force && cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  if (!isMemiConfigured()) {
    const result = emptyUnavailable(dateYmd, "MEMI_CREDENTIAL_REQUIRED");
    syncCache.set(dateYmd, { result, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    return result;
  }

  try {
    const { buffer } = await xlsDownWithAuth(dateYmd);
    const parsed = parseExcelBuffer(buffer);
    const bySerial = new Map<string, MemiDeviceRow>();
    for (const d of parsed.devices) {
      if (d.normalizedSerial) bySerial.set(d.normalizedSerial, d);
    }
    const result: MemiSyncResult = {
      status: "ok",
      date: dateYmd,
      syncedAt: new Date().toISOString(),
      rowCount: parsed.rowCount,
      header: parsed.header,
      bySerial,
    };
    syncCache.set(dateYmd, { result, expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS });
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[MEMI] daily reconciliation 실패:", message);
    const result = emptyUnavailable(dateYmd, message);
    syncCache.set(dateYmd, { result, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    return result;
  }
}

/** 관리자 수동 [매미 새로고침] 보조 기능(§14) — 기본 흐름은 자동, 이건 보조일 뿐 */
export function invalidateMemiCache(dateYmd?: string): void {
  if (dateYmd) syncCache.delete(dateYmd);
  else syncCache.clear();
}

/** 화면 상태 표시용(§13) — credential/세션 등 민감정보 절대 포함하지 않는다 */
export function getMemiStatusSnapshot(dateYmd: string): { configured: boolean; cached: Omit<MemiSyncResult, "bySerial"> | null } {
  const cached = syncCache.get(dateYmd)?.result ?? null;
  return {
    configured: isMemiConfigured(),
    cached: cached ? { status: cached.status, date: cached.date, syncedAt: cached.syncedAt, rowCount: cached.rowCount, header: cached.header, error: cached.error } : null,
  };
}
