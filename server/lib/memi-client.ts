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
import iconv from "iconv-lite";

// [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_RESUME_2] 실제 매미 서버 대상 실측(credential
// 적용 후 진행) 결과, 로그인/xlsDown 응답이 전부 charset=EUC-KR로 내려온다(서버의
// Content-Type 헤더로 명시 확인). Node fetch의 res.text()는 UTF-8로만 디코딩하므로 그대로
// 쓰면 한글이 깨지고, 하필 깨진 바이트가 실패 판정 정규식(`alert(`)과 우연히 일치해
// "로그인 되었습니다"(성공) 메시지를 실패로 오판하는 실제 버그가 있었다 — 이 파일 전체에서
// 응답 본문은 반드시 이 함수로 디코딩한다.
//
// [DEV_RESUME_2 실측 — 2차 버그] xlsDown 응답의 HTTP Content-Type 헤더에는 charset이
// 아예 없다(예: "application/vnd.ms-excel"만, 로그인 응답과 달리 charset 파라미터 없음).
// 이 상태에서 기본값을 utf-8로 두면 EUC-KR 바이트를 잘못 디코딩해서 "일련번호"/"모델명"
// 같은 헤더 문자열이 깨져 findHeaderIndex()가 못 찾는 실제 버그가 있었다 — 실서버 응답으로
// 확인. 이 사이트(imemi.co.kr) 전체가 EUC-KR을 쓰는 것을 로그인 응답(明시적 charset=EUC-KR)
// 으로 이미 확인했으므로, HTTP 헤더에 charset이 없을 때는 UTF-8이 아니라 EUC-KR을
// 기본값으로 쓴다(범용 유틸이 아니라 이 모듈 전용 함수라 안전하다).
function decodeBody(buf: Buffer, contentType: string | null): string {
  const m = /charset=([^;]+)/i.exec(contentType ?? "");
  const charset = (m?.[1] ?? "euc-kr").trim().toLowerCase();
  if (charset === "utf-8" || charset === "utf8") return buf.toString("utf-8");
  try {
    return iconv.decode(buf, charset);
  } catch {
    return buf.toString("utf-8");
  }
}

// HTTP(HTTPS 아님) 사용 — 인증서 이름 불일치가 실측 확인되어 임의로 HTTPS 전환하지 않는다.
const MEMI_BASE = "http://ad2.imemi.co.kr";
const MEMI_LOGIN_URL = `${MEMI_BASE}/Login/LoginDo?`;
const MEMI_XLSDOWN_PATH = `/Sell/Sell/xlsDown`;

// [DEV_RESUME_2] 실제 로그인 성공 응답 실측: alert("(주)엠씨씨코리아님 로그인 되었습니다").
// 실패 응답도 alert(...)를 쓰므로(§3/§5 실측 그대로) "alert() 존재 여부"가 아니라 "성공
// 문구 포함 여부"로 판정해야 한다 — 실패를 성공으로 오판하는 것보다 훨씬 안전한 방향이다
// (성공 문구가 없으면 무조건 실패 처리).
const LOGIN_SUCCESS_PATTERN = /로그인\s*되었습니다/;

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
 * 매미 로그인. 필드: MemberID/MemberPW/chk_id/mAddr.
 * [DEV_RESUME_2 실측 완료] chk_id/mAddr는 빈 문자열로 실제 로그인이 성공하는 것을 확인했다
 * (실측 응답: alert("(주)엠씨씨코리아님 로그인 되었습니다") + PHPSESSID/mm_sid_cookie/
 * mm_nid_cookie 쿠키 3종 발급 — 실제 브라우저 로그인 폼은 /aLogin으로 제출되고 이 값들을
 * 아예 보내지 않지만, /Login/LoginDo?로 직접 보내는 이 방식도 실측상 정상 동작한다).
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

  let text = "";
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    text = decodeBody(buf, res.headers.get("content-type"));
  } catch {
    // 바이너리/빈 응답 — 무시
  }

  // [DEV_RESUME_2 실측] 실제 alert 메시지 예: "존재하지 않는 회원입니다"(실패, 이전 라운드
  // 추정), "(주)엠씨씨코리아님 로그인 되었습니다"(성공, 이번에 실제 확인). 성공 문구가 없으면
  // 무조건 실패로 처리한다 — 메시지 내용은 로그에만 남기고 credential 값 자체는 포함하지 않는다.
  if (!LOGIN_SUCCESS_PATTERN.test(text)) {
    throw new MemiUnavailableError(`매미 로그인 실패(성공 문구 없음): ${text.slice(0, 200)}`);
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
  /** [DEV_RESUME_2 실측] 매미 xlsDown은 실제 바이너리 xls/xlsx가 아니라 "엑셀에서 열리도록
   * Content-Type만 application/vnd.ms-excel로 위장한 HTML table"을 내려준다(실제 브라우저의
   * [엑셀저장] 버튼 클릭을 캡처해 확인함, 흔한 레거시 PHP 방식). 그래서 바이너리 signature
   * (ZIP/OLE) 검사가 아니라 디코딩된 HTML 텍스트 자체를 파싱 단계로 넘긴다. */
  html: string;
}

/**
 * 금일 개통자료 xlsDown. [DEV_RESUME_2 실측 완료] 실제 브라우저의 [엑셀저장] 버튼 클릭을
 * Playwright로 캡처해서 확정한 요청이다 — 과거 캡처(§3, ListType/OpnSvcCheck/SearchDayChk/
 * SearchSDay/SearchEDay/Cpage 6개 필드)는 불완전해서 실제로는 0건이 반환됐었다(원인:
 * winUser 쿼리 파라미터 누락 — 이 값 없이는 매미가 "어느 계정의 판매 데이터"를 조회할지
 * 알 수 없다). 아래는 실제 요청을 그대로 재현한 것이다.
 */
// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] sDayYmd/eDayYmd로 분리했다(기존
// dateYmd 단일 인자 → 동일 값을 sDay/eDay 양쪽에 넣던 호출부만 xlsDownWithAuth(dateYmd,
// dateYmd)로 바뀌었을 뿐 단일 날짜 동작은 100% 동일). DEV 실측(스크립트로 직접 확인)
// 결과 매미가 SearchSDay≠SearchEDay 진짜 기간 조회를 정확히 지원한다: 9/24(5건)+9/28(20건)
// 개별 호출 합계(25건)와 9/24~9/28 범위 1회 호출 결과(25건)가 정확히 일치했다 — 추측이
// 아니라 실측으로 확정.
async function xlsDown(sDayYmd: string, eDayYmd: string, cookieHeader: string): Promise<XlsDownResult> {
  const creds = getCredentials();
  if (!creds) throw new MemiUnavailableError("MEMI_CREDENTIAL_REQUIRED");

  const query = new URLSearchParams({
    winUser: creds.id,
    OpnSvcCheck: "S",
    idxA: "4",
    idxB: "10",
    idxE: "0",
    urlC: "/Sell/Sell/list.html",
    uw: "",
    SearchOption: "1",
    SearchDayChk: "Y",
    SearchDayChk2: "",
    SearchSDay: sDayYmd,
    SearchEDay: eDayYmd,
    SearchMulti: "",
  });

  const form = new FormData();
  const formFields: Record<string, string> = {
    no: "",
    ListType: "SELL",
    ListMType: "",
    SearchPhnMaker: "",
    OpnSvcCheck: "S",
    OpnSvcAgcy: "",
    SearchModelType: "none",
    SearchAddrGroup: "none",
    SearchType1: "none",
    SearchDayChk: "on",
    SearchDayChk2: "",
    SearchSDay: sDayYmd,
    SearchEDay: eDayYmd,
    TelComValue: "--통신사--",
    TelCom: "",
    PhnMaker: "",
    PhnMakerValue: "",
    Gds1Value: "--공급자--",
    Gds1: "",
    Gds2Value: "--공급받는자--",
    Gds2: "",
    InGdsAgcyValue: "--개통처--",
    InGdsAgcy: "",
    SellAgcyValue: "--판매처--",
    SellAgcy: "",
    SellerValue: "--판매자--",
    Seller: "",
    ModelValue: "--단말기--",
    Model: "",
    MColorValue: "--색상--",
    MColor: "",
    MnumberValue: "--복수검색--",
    Mnumber: "",
    SellType2: "",
    SearchStr: "",
    Cpage: "1",
  };
  for (const [k, v] of Object.entries(formFields)) form.set(k, v);

  let res: Response;
  try {
    res = await fetch(`${MEMI_BASE}${MEMI_XLSDOWN_PATH}?${query.toString()}`, {
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
  const contentDisposition = res.headers.get("content-disposition") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  const html = decodeBody(buf, contentType);

  // 세션 만료 시 매미는 로그인 폼 HTML을 돌려준다(§7/§8 판정 근거) — 로그인 입력창이
  // 있으면 세션 만료로 보고 호출부가 1회 재로그인+재시도하게 한다.
  if (/name=["']?MemberID["']?/i.test(html) || /alert\(\s*['"]/.test(html)) {
    throw new SessionExpiredError("매미 xlsDown이 로그인/오류 화면을 반환했습니다(세션 만료 추정).");
  }

  // 정상 응답은 실제 바이너리가 아니라 HTML table이지만(§7 주석 참고), Content-Type/
  // Content-Disposition은 여전히 유효성 판정 근거로 쓴다 — 진짜 Excel도, 진짜 오류 응답도
  // 아닌 애매한 응답(예: 완전히 빈 200)을 걸러낸다.
  const looksLikeValidResponse =
    contentType.includes("application/vnd.ms-excel") && contentDisposition.includes("attachment") && /<table/i.test(html);
  if (!looksLikeValidResponse) {
    throw new MemiUnavailableError(
      `매미 xlsDown 응답이 예상 형식과 다릅니다(content-type=${contentType}, content-disposition=${contentDisposition}).`,
    );
  }

  return { html };
}

class SessionExpiredError extends Error {}

/**
 * 로그인 → xlsDown, 세션 만료로 보이면 재로그인 후 1회만 재시도(§5/§8 CASE 8 — 무한 반복 금지).
 */
async function xlsDownWithAuth(sDayYmd: string, eDayYmd: string): Promise<XlsDownResult> {
  const cookieHeader = await getSession();
  try {
    return await xlsDown(sDayYmd, eDayYmd, cookieHeader);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      const freshCookie = await getSession(true);
      return await xlsDown(sDayYmd, eDayYmd, freshCookie); // 1회만 재시도 — 실패하면 그대로 throw
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

// §8: header 기반 parsing 우선, index 하드코딩 금지. [DEV_RESUME_2 실측 완료] 실제 매미
// Excel의 정확한 헤더명은 "일련번호"/"모델명"으로 확인됐다(전체 53개 헤더: No/통신사/타입/
// 개통일/약정/개월/유형/개월/MNP/보상등급/모델명/일련번호/색상/개통처/소속점/판매처/고객명/
// 이동번호/입고유형/입고가/출고가/적용단가정보/판매자/usim/usim일련번호/usim모델명/
// 음성요금제/데이타요금제/부가서비스/결합/서류번호/미비서류/완료/반납모델명/반납일련번호/
// 반납색상/완료/고객구분/관리번호/생년월일/고객연락번호/요금청구주소/이메일/양도인명/
// 양도인관리번호/양도인연락번호/TU가입-요금제/TU가입-cas번호/TU가입-가입비/번들일련번호/
// 번들모델명/번들색상/메모/처리자/입고일). 기존에 1순위 후보로 넣어둔 "일련번호"/"모델명"이
// 정확히 일치해서 별도 수정 없이 그대로 맞는다 — 나머지 후보는 다른 계정/화면 구성에서
// 헤더명이 달라질 가능성에 대비한 안전망으로 유지한다.
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

/**
 * [DEV_RESUME_2 실측] xlsDown 응답은 실제 바이너리 xls/xlsx가 아니라 HTML table이다(위
 * xlsDown() 주석 참고). SheetJS의 XLSX.read()는 문자열로 넘기면 HTML table도 자동
 * 인식해서 파싱한다(buffer/binary 모드가 아니라 반드시 type:"string" 사용 — 실측으로
 * 확인: buffer 모드는 실패하고 string 모드는 정상적으로 워크북을 만든다).
 */
function parseExcelHtml(html: string): MemiParsedSheet {
  let workbook: any;
  try {
    workbook = XLSX.read(html, { type: "string" });
  } catch (err: any) {
    throw new MemiUnavailableError(`매미 Excel(HTML table) 파싱 실패: ${err?.message ?? err}`);
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
    const { html } = await xlsDownWithAuth(dateYmd, dateYmd);
    const parsed = parseExcelHtml(html);
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

// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] §12/§13 — 기간 조회 전용. 날짜별로
// N번 로그인+xlsDown을 반복하지 않는다(§13 "불필요한 반복 로그인 금지"): DEV 실측으로
// 매미가 진짜 SearchSDay~SearchEDay 범위를 지원함을 확인했으므로 기간 전체를 xlsDown
// 1회로 조회한다. 캐시는 기존 syncCache Map을 그대로 재사용하되 키를 "start::end"로
// 구성해 단일 날짜 캐시(키가 순수 YYYY-MM-DD라 "::"를 포함하지 않음)와 절대 충돌하지
// 않는다. 성공 5분/실패 60초 TTL도 기존과 동일하게 적용한다(§13 "기존 구조를 임의
// 변경하지 말고" 그대로 재사용). start===end(사용자가 오늘 하루만 조회하는 기존 방식
// 그대로 쓰는 경우)는 완전히 동일한 결과를 내는 getMemiDailyReconciliation()에 그대로
// 위임한다 — 새 캐시 엔트리를 중복으로 만들지 않고 기존 단일 날짜 캐시를 재사용한다.
export async function getMemiRangeReconciliation(
  startYmd: string,
  endYmd: string,
  opts?: { force?: boolean },
): Promise<MemiSyncResult> {
  if (startYmd === endYmd) {
    return getMemiDailyReconciliation(startYmd, opts);
  }

  const cacheKey = `${startYmd}::${endYmd}`;
  const cached = syncCache.get(cacheKey);
  if (!opts?.force && cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  if (!isMemiConfigured()) {
    const result = emptyUnavailable(cacheKey, "MEMI_CREDENTIAL_REQUIRED");
    syncCache.set(cacheKey, { result, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    return result;
  }

  try {
    const { html } = await xlsDownWithAuth(startYmd, endYmd);
    const parsed = parseExcelHtml(html);
    const bySerial = new Map<string, MemiDeviceRow>();
    for (const d of parsed.devices) {
      if (d.normalizedSerial) bySerial.set(d.normalizedSerial, d);
    }
    const result: MemiSyncResult = {
      status: "ok",
      date: cacheKey,
      syncedAt: new Date().toISOString(),
      rowCount: parsed.rowCount,
      header: parsed.header,
      bySerial,
    };
    syncCache.set(cacheKey, { result, expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS });
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error("[MEMI] range reconciliation 실패:", message);
    const result = emptyUnavailable(cacheKey, message);
    syncCache.set(cacheKey, { result, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
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
