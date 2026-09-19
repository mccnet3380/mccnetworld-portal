// server/lib/personal-performance.ts
//
// 작업명: MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1
//
// LOCK: 개인 인정 처리량/실적률 공식은 server/lib/worker-performance.ts의
// computeWorkerPerformance()를 그대로 재사용한다. 통신망 분류 의미는
// server/lib/performance-calc.ts의 summarizeNetworkTotals/summarizeWorkerNetworkMatrix를
// 그대로 재사용한다. 이 두 파일은 이번 작업에서 한 글자도 수정하지 않는다(import만).
//
// 다만 주/월처럼 여러 날짜를 집계할 때 performance-calc.ts의 loadClassifiedRows()를
// 날짜마다 그대로 호출하면 같은 스프레드시트를 매번 통째로 재조회하게 되어(Google Sheets
// API 쿼터를 불필요하게 소모 — 운영에서 429 rate limit이 이미 관측된 적 있다) 같은 달에
// 속한 날짜들도 시트를 여러 번 읽게 된다. 그래서 이 파일은 "■당일완료" 시트를
// (spreadsheetId 기준) 한 번만 fetch하고, 날짜별 필터링만 메모리에서 반복한다.
//
// [MCC_PERFORMANCE_EXACT_DATE_MATCHING_ROOT_FIX_1] 날짜-매칭 판정은 원래 performance-calc.ts의
// 비공개 matchesDate()를 그대로 복사해서 썼다(그 파일을 export 추가로도 건드리지 않기
// 위함) — 그런데 그 복사본에 있던 "접두어(startsWith) 일치" 버그(예: "9/1"이 "9/10"~
// "9/19"에도 매치되어 09-01 조회 시 해당 날짜들의 행이 전부 잘못 포함됨, 09-01 KT
// officialTotal이 실제 167건이어야 할 것이 1165건으로 계산됨)가 실측으로 확인됐다.
// 이번 라운드에서는 performance-calc.ts도 함께 수정이 허용되어, 그 파일이 이제 export하는
// matchesDate()(내부적으로 lg-audit-date.ts의 정확 매칭 파서 재사용, prefix 비교 없음)를
// 그대로 가져다 쓴다 — 복사본을 만들지 않고 동일한 함수를 공유해서 두 계산 경로의 날짜
// 판정이 항상 같은 결과를 내도록 한다.
import { fetchSheetValuesById } from "./google-sheets-client";
import { resolveActiveSpreadsheet } from "./spreadsheet-resolver";
import { classifyReq, workerHomeNetwork } from "./performance-classify";
import { summarizeNetworkTotals, summarizeWorkerNetworkMatrix, matchesDate, type ClassifiedRow, type WorkerNetworkRow, type NetworkTotals } from "./performance-calc";
import { computeWorkerPerformance, type WorkerPerformanceRow } from "./worker-performance";

const LEDGER_SHEET = "■당일완료";

// [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] 실제 시트 조사 결과(사용자
// 지시로 코드 수정 전에 직접 확인):
// - "■당일완료"는 그날그날의 "오늘" 라이브 원장이다(조사 시점: 이번 달 전체 행이 오늘자
//   1건뿐 — 다른 날짜 행이 전혀 없음). 하루가 지나면 그 행은 여기 남아있지 않다.
// - "개통처리부"는 헤더가 "■당일완료"와 완전히 동일(작업자/개통일/요청점 등 같은 위치)한
//   이번 달 전체 개통 마스터 로그다. 조사 시점 기준 9/1~9/18 데이터가 있고 9/19(당일) 행은
//   아직 없었다 — "당일완료"의 오늘 건과 "개통처리부"의 과거 건이 개통번호 기준으로 전혀
//   겹치지 않음을 실제로 확인했다(교집합 0건). 즉 "오늘=당일완료, 그 이전 날짜=개통처리부"
//   경계가 데이터 자체에 이미 자연스럽게 존재한다 — 새로 발명한 규칙이 아니라 실측 결과다.
// - "■변경완료"의 요청점은 전부 "기타)"/"유심)" 접두어였고(개통처리부의 "후불)/선불)/단말)"
//   접두어와 요청점 네임스페이스가 완전히 분리됨), 개통번호 기준 개통처리부와의 교집합도
//   5595행 중 7건뿐(대부분 변경완료 행 자체가 개통번호를 비워둠 — 신규 개통이 아니라 사후
//   변경 업무라 개통번호가 없는 게 정상). "00700결합"도 개통처리부/변경완료 어느 쪽과도
//   개통번호 교집합이 0건. → 개통 업무와 변경 업무는 사실상 분리된 모집단이며, 이미
//   기존 performance-calc.ts의 buildSourceBlock(["■변경완료","00700결합"], ...)가 이 둘을
//   "기타업무(otherDuty)" 하나로 묶어온 것이 바로 그 기존 검증된 구분이다 — 그대로 재사용한다.
const MASTER_LEDGER_SHEET = "개통처리부"; // 개통 업무의 "오늘 이전" historical source
const CHANGE_WORK_SHEETS = ["■변경완료", "00700결합"]; // 변경 업무 source(기존 otherDuty 페어링 그대로)

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 특정 날짜의 개통 업무 데이터가 어느 source에서 왔는지(라우트의 최근 7일/내역 표시용). */
export function activationSourceLabel(date: Date, today: Date): string {
  return isSameCalendarDay(date, today) ? LEDGER_SHEET : MASTER_LEDGER_SHEET;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

interface LedgerCacheEntry {
  header: string[];
  rows: string[][];
}

export type LedgerCache = Map<string, LedgerCacheEntry>;

export function createLedgerCache(): LedgerCache {
  return new Map();
}

// MCC_PERSONAL_PERFORMANCE_DASHBOARD_CORRECTION_1: 요청 단위 캐시(LedgerCache)는 같은
// API 호출 안에서 오늘/주/월/추이가 같은 스프레드시트를 여러 번 안 읽게 해줄 뿐, 서로 다른
// 사용자의 요청이나 새로고침 사이에는 공유되지 않는다. 개인 대시보드는 여러 근무자가
// 짧은 시간에 "같은 날"을 반복 조회하는 특성이 있어 Google Sheets API 쿼터(운영에서 429가
// 이미 관측됨)를 그대로 소모하기 쉽다. 그래서 spreadsheetId 기준(서로 다른 월 데이터가
// 절대 섞이지 않는 키)으로 60초 TTL의 프로세스 메모리 공유 캐시를 추가한다.
// - 60초: "오늘" 데이터가 과도하게 stale되지 않으면서 반복 조회 429 위험을 줄이는 절충값
//   (요청 범위 30~120초 중간값).
// - 캐시는 원문 raw rows만 저장하고 계산 결과는 캐시하지 않는다 — LOCK된 계산 함수
//   (summarizeNetworkTotals/summarizeWorkerNetworkMatrix/computeWorkerPerformance)는
//   캐시 여부와 무관하게 항상 이 raw rows에 대해 동일하게 실행되므로 계산값이 캐시로
//   달라지지 않는다.
// - resolveActiveSpreadsheet() 자체의 동작/캐시는 건드리지 않는다(그 함수가 이미 갖고
//   있는 1시간 캐시와는 별개의, 이 파일 전용의 새 캐시다).
const SHARED_CACHE_TTL_MS = 60_000;
interface SharedLedgerCacheEntry extends LedgerCacheEntry {
  expiresAt: number;
}
const sharedLedgerCache = new Map<string, SharedLedgerCacheEntry>();

// MCC_PERFORMANCE_WORKER_MAPPING_DROPDOWN_FIX_1: sheetName을 매개변수화했다(기본값은
// 기존과 동일한 LEDGER_SHEET="■당일완료"). computeWorkerPerformanceForDates()(LOCK된
// 개인 실적 계산에 쓰이는 경로)는 인자를 그대로 생략해서 호출하므로 동작이 전혀 바뀌지
// 않는다. discoverWorkerNamesForDates()만 다른 sheetName으로 이 함수를 재호출한다.
// 캐시 키에 sheetName을 포함시켜 시트별로 독립적으로 캐시된다.
async function fetchLedgerCached(date: Date, cache: LedgerCache, sheetName: string = LEDGER_SHEET): Promise<LedgerCacheEntry> {
  const resolved = await resolveActiveSpreadsheet(date);
  const key = `${resolved.id}::${sheetName}`;

  const local = cache.get(key);
  if (local) return local;

  const shared = sharedLedgerCache.get(key);
  if (shared && shared.expiresAt > Date.now()) {
    const entry: LedgerCacheEntry = { header: shared.header, rows: shared.rows };
    cache.set(key, entry);
    return entry;
  }

  const values = await fetchSheetValuesById(resolved.id, sheetName);
  const header = values[0] || [];
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const entry: LedgerCacheEntry = { header, rows };
  cache.set(key, entry);
  sharedLedgerCache.set(key, { ...entry, expiresAt: Date.now() + SHARED_CACHE_TTL_MS });
  return entry;
}

function classifyForDate(entry: LedgerCacheEntry, date: Date, sheetLabel: string = LEDGER_SHEET): ClassifiedRow[] {
  const workerIdx = entry.header.indexOf("작업자");
  const dateIdx = entry.header.findIndex((h) => h.includes("개통일"));
  const reqIdx = entry.header.indexOf("요청점");
  if (workerIdx < 0 || dateIdx < 0 || reqIdx < 0) {
    throw new Error(
      `[PersonalPerformance] "${sheetLabel}" 시트에서 필수 컬럼(작업자/개통일/요청점)을 찾지 못했습니다. 헤더: ${entry.header.join(", ")}`,
    );
  }

  const out: ClassifiedRow[] = [];
  for (const r of entry.rows) {
    if (!matchesDate(r[dateIdx], date)) continue;
    const requestPoint = String(r[reqIdx] ?? "").trim();
    const worker = String(r[workerIdx] ?? "").trim();
    const c = classifyReq(requestPoint);
    out.push({ worker, requestPoint, net: c.net, cat: c.cat });
  }
  return out;
}

export interface DayWorkerPerformance {
  date: string; // YYYY-MM-DD
  workers: WorkerPerformanceRow[];
  // [MCC_PERFORMANCE_CALCULATION_AND_WORKER_LIFECYCLE_FINAL_FIX_1] 그날의 망별 공식
  // 총수량(NetworkTotals, LOCK된 summarizeNetworkTotals() 그대로) — 특정 근무자가 그날
  // 처리 건이 있었는지와 무관하게 존재하는 값이다. aggregateForWorker()가 "동일 기간
  // homeNetwork 공식 총수량"을 그 근무자의 그날 처리 유무와 상관없이 정확히 합산하려면
  // day.workers(그날 처리한 사람만 들어있는 배열)만으로는 부족하다 — 그래서 별도로 들고
  // 있는다. LOCK 계산 함수 자체는 호출하지 않고 이미 계산된 값을 그대로 보관만 한다.
  totals: NetworkTotals;
}

/**
 * 지정한 날짜들의 "■당일완료" 기준 담당자별 실적을 계산한다(LOCK된 기존 공식 그대로 재사용).
 * 같은 스프레드시트에 속한 날짜는 시트를 한 번만 읽는다(cache 공유 권장).
 */
export async function computeWorkerPerformanceForDates(
  dates: Date[],
  cache: LedgerCache = createLedgerCache(),
): Promise<DayWorkerPerformance[]> {
  const out: DayWorkerPerformance[] = [];
  for (const date of dates) {
    const entry = await fetchLedgerCached(date, cache);
    const rows = classifyForDate(entry, date);
    const totals = summarizeNetworkTotals(rows);
    const matrix = summarizeWorkerNetworkMatrix(rows);
    const workers = computeWorkerPerformance(matrix, totals);
    out.push({ date: ymd(date), workers, totals });
  }
  return out;
}

// [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] 개통 업무의 기간 집계.
// "오늘"(today 인자와 달력상 같은 날)은 실시간 소스("■당일완료")를, 그 이전 날짜는
// 확정 historical 소스("개통처리부")를 사용한다 — 오늘 실적 계산 방식 자체는 전혀
// 바꾸지 않는다(같은 함수, 같은 컬럼 탐지, 같은 classifyForDate/LOCK 계산 재사용). 두
// source가 개통번호 기준으로 절대 겹치지 않음을 실제 데이터로 확인했으므로(위 주석
// 참고) 같은 날짜를 두 source에서 동시에 합산하는 이중 집계 위험이 없다.
export async function computeActivationPerformanceForDates(
  dates: Date[],
  today: Date,
  cache: LedgerCache = createLedgerCache(),
): Promise<DayWorkerPerformance[]> {
  const out: DayWorkerPerformance[] = [];
  for (const date of dates) {
    const sheetName = isSameCalendarDay(date, today) ? LEDGER_SHEET : MASTER_LEDGER_SHEET;
    const entry = await fetchLedgerCached(date, cache, sheetName);
    const rows = classifyForDate(entry, date, sheetName);
    const totals = summarizeNetworkTotals(rows);
    const matrix = summarizeWorkerNetworkMatrix(rows);
    const workers = computeWorkerPerformance(matrix, totals);
    out.push({ date: ymd(date), workers, totals });
  }
  return out;
}

export interface DayChangeWorkerPerformance {
  date: string;
  workers: WorkerNetworkRow[];
}

// [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] 변경 업무(기타업무) 기간
// 집계. source는 기존 performance-calc.ts의 buildSourceBlock(["■변경완료","00700결합"])와
// 동일한 2개 시트다 — 새 페어링이 아니라 기존 "기타업무(otherDuty)" 정의를 그대로 재사용.
// ■변경완료는 오늘 건도 이미 그 시트 안에 존재함을 실제 데이터로 확인했으므로(개통
// 업무처럼 "오늘=별도 시트" 경계가 없다), 날짜와 무관하게 항상 이 2개 시트만 본다.
//
// 중요: computeWorkerPerformance()(officialTotal/기여도% 계산, LOCK)는 절대 호출하지
// 않는다 — 변경 업무의 "기여도/목표율" 공식은 기존 코드/HTML 어디에도 없음을 조사로
// 확인했다(개통 업무처럼 소속망 공식 총실적에 대한 비율 개념 자체가 어디서도 계산되지
// 않았음). 그 공식을 임의로 만들지 않고(개통 공식을 그대로 복사하는 것도 금지) 본업/지원
// 처리량(raw count)만 제공한다 — summarizeWorkerNetworkMatrix()의 순수 구조적 분류
// (작업자의 소속망 대비 어느 망에서 처리했는지)만 재사용한다.
export async function computeChangeWorkForDates(
  dates: Date[],
  cache: LedgerCache = createLedgerCache(),
): Promise<DayChangeWorkerPerformance[]> {
  const out: DayChangeWorkerPerformance[] = [];
  for (const date of dates) {
    const rowsPerSheet: ClassifiedRow[][] = [];
    for (const sheetName of CHANGE_WORK_SHEETS) {
      let entry: LedgerCacheEntry;
      try {
        entry = await fetchLedgerCached(date, cache, sheetName);
      } catch {
        continue; // 해당 월 스프레드시트에 그 시트 탭이 없을 수 있음 — 조용히 건너뜀
      }
      rowsPerSheet.push(classifyForDate(entry, date, sheetName));
    }
    const rows = rowsPerSheet.flat();
    const workers = summarizeWorkerNetworkMatrix(rows);
    out.push({ date: ymd(date), workers });
  }
  return out;
}

export interface AggregatedChangeWorkPerformance {
  self: number;
  supportSK: number;
  supportKT: number;
  supportLG: number;
  supportTOSS: number;
  supportTotal: number;
  total: number; // self + supportTotal — "인정 처리량"이라는 개통 용어와 구분하기 위해 total로 표기
}

/** perDay 결과에서 특정 performanceWorkerName의 기간 변경 업무 합계를 뽑는다. 기여도/목표율은 계산하지 않는다(공식 미확인, HOLD). */
export function aggregateChangeForWorker(
  perDay: DayChangeWorkerPerformance[],
  performanceWorkerName: string,
): AggregatedChangeWorkPerformance {
  let self = 0, supportSK = 0, supportKT = 0, supportLG = 0, supportTOSS = 0;
  for (const day of perDay) {
    const mine = day.workers.find((w) => w.worker === performanceWorkerName);
    if (!mine) continue;
    const home = mine.home;
    if (home === "SK") self += mine.SK; else supportSK += mine.SK;
    if (home === "KT") self += mine.KT; else supportKT += mine.KT;
    if (home === "LG") self += mine.LG; else supportLG += mine.LG;
    // workerHomeNetwork()는 절대 "TOSS"를 반환하지 않으므로(SK/KT/LG/유선/본사/기타만
    // 가능) TOSS 실적은 항상 지원 처리로 집계된다 — LOCK된 computeWorkerPerformance()의
    // 동일한 처리와 일치.
    supportTOSS += mine.TOSS;
  }
  const supportTotal = supportSK + supportKT + supportLG + supportTOSS;
  return { self, supportSK, supportKT, supportLG, supportTOSS, supportTotal, total: self + supportTotal };
}

/** perDay 결과에서 같은 homeNetwork 작업자들의 기간 변경 업무 합계 평균(팀 비교, 본인 포함). */
export function teamAverageChangeForHome(
  perDay: DayChangeWorkerPerformance[],
  home: ReturnType<typeof workerHomeNetwork>,
): number | null {
  const totals = new Map<string, number>();
  const homes = new Map<string, string>();
  for (const day of perDay) {
    for (const w of day.workers) {
      totals.set(w.worker, (totals.get(w.worker) || 0) + w["합계"]);
      homes.set(w.worker, w.home);
    }
  }
  const teammates = Array.from(totals.entries()).filter(([worker]) => homes.get(worker) === home);
  if (teammates.length === 0) return null;
  return teammates.reduce((sum, [, v]) => sum + v, 0) / teammates.length;
}

// MCC_PERFORMANCE_WORKER_MAPPING_DROPDOWN_FIX_1: 관리자 매핑 dropdown 전용 worker 이름
// discovery. LOCK된 개인 실적 계산(computeWorkerPerformanceForDates, "■당일완료" 단일
// 소스)과는 완전히 분리된 별도 경로다 — 여기서 찾은 이름은 어떤 실적 숫자 계산에도
// 재사용되지 않고, 오직 "선택 가능한 문자열 목록"으로만 쓰인다.
//
// "오늘 실적이 있는 사람만" 뜨는 문제(오늘 ■당일완료가 0건이면 dropdown이 비는 구조적
// 결함)를 고치기 위해, 기존 performance-calc.ts의 buildSourceBlock()이 이미 "확정 실적
// source"로 취급하는 3개 시트(■당일완료, ■변경완료, 00700결합 — 전부 "작업자/개통일"
// 컬럼을 갖는 동일 구조, LOCK 파일에서 그대로 확인됨)를 전부 스캔한다. 새 파서를 만들지
// 않는다 — 이미 이 파일에 있는 컬럼 탐지/날짜 매칭(matchesDate) 그대로 재사용하고,
// sheetName만 fetchLedgerCached()에 다르게 넘긴다. 작업자명은 원문 그대로만 모은다 —
// 추정/변환/정규화 없음.
const WORKER_DISCOVERY_SHEETS = [LEDGER_SHEET, "■변경완료", "00700결합"];

function extractWorkerNamesForDate(entry: LedgerCacheEntry, date: Date): string[] {
  const workerIdx = entry.header.indexOf("작업자");
  const dateIdx = entry.header.findIndex((h) => h.includes("개통일"));
  if (workerIdx < 0 || dateIdx < 0) return [];

  const out: string[] = [];
  for (const r of entry.rows) {
    if (!matchesDate(r[dateIdx], date)) continue;
    const worker = String(r[workerIdx] ?? "").trim();
    if (worker) out.push(worker);
  }
  return out;
}

/**
 * 지정한 날짜 범위에서 실제로 등장한 작업자 이름을 모은다(관리자 매핑 dropdown 전용).
 * "오늘 실적 0건"이어도 같은 범위(예: 이번 달) 안의 다른 날짜에 등장한 이름은 그대로 포함된다.
 */
export async function discoverWorkerNamesForDates(
  dates: Date[],
  cache: LedgerCache = createLedgerCache(),
): Promise<string[]> {
  const names = new Set<string>();
  for (const date of dates) {
    for (const sheetName of WORKER_DISCOVERY_SHEETS) {
      let entry: LedgerCacheEntry;
      try {
        entry = await fetchLedgerCached(date, cache, sheetName);
      } catch {
        continue; // 해당 월 스프레드시트에 그 시트 탭이 없을 수 있음 — 조용히 건너뜀
      }
      for (const w of extractWorkerNamesForDate(entry, date)) names.add(w);
    }
  }
  return Array.from(names).sort();
}

/** 오늘 기준으로 today/week(월~오늘)/month(1일~오늘) 날짜 목록을 만든다 — 미래 날짜는 포함하지 않는다. */
export function resolveRangeDates(range: "today" | "week" | "month", today: Date): Date[] {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === "today") return [base];

  if (range === "week") {
    const dow = base.getDay(); // 0=일 ... 6=토
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(base);
    monday.setDate(base.getDate() - diffToMonday);
    const out: Date[] = [];
    for (let d = new Date(monday); d <= base; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }

  // month: 이번 달 1일 ~ 오늘
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const out: Date[] = [];
  for (let d = new Date(first); d <= base; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

/** 최근 7일(오늘 포함) 날짜 목록 — range와 무관하게 추이 차트 전용 */
export function lastNDays(n: number, today: Date): Date[] {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(d);
  }
  return out;
}

export interface AggregatedWorkerPerformance {
  self: number;
  supportSK: number;
  supportKT: number;
  supportLG: number;
  supportTOSS: number;
  supportTotal: number;
  recognized: number; // self + supportTotal
  officialTotal: number; // 소속망 공식 총실적 합계(그 근무자가 등장한 날짜만 합산)
  contributionRate: number | null;
}

// [MCC_PERFORMANCE_CALCULATION_AND_WORKER_LIFECYCLE_FINAL_FIX_1] root cause:
// 이전 로직은 `mine`이 없는 날(그날 처리 건이 0건인 날 — 휴가/휴무/당직 미근무 등, 재직
// 상태와는 무관함)을 통째로 continue해서 그날의 분자(0이 맞음)뿐 아니라 분모
// (officialTotal)까지 함께 건너뛰었다. "동일 기간 homeNetwork 공식 총수량"은 그 근무자의
// 그날 처리 유무와 무관하게 존재하는 값이라, 조회 기간 안의 날짜라면 처리 건이 없는 날도
// 분모에는 반드시 포함되어야 한다 — 실제로 이 누락이 분모를 작게 만들어 기여도가 실제보다
// 부풀려지는 결과(예: 실제 31.8%가 34.0%로 표시)로 이어졌다(DEV 실측으로 확인).
// home은 호출부에서 이미 workerHomeNetwork(performanceWorkerName)로 구한 값을 그대로
// 넘겨받는다 — 조회 기간 전체에서 이 근무자가 단 하루도 등장하지 않아도(예: 이번 달
// 전체 휴직) 분모를 정확히 계산할 수 있어야 하기 때문에 day.workers에서 역산하지 않는다.
/** perDay 결과에서 특정 performanceWorkerName의 기간 합계를 뽑는다(LOCK 공식은 이미 일별로 적용됨 — 여기선 합산만). */
export function aggregateForWorker(
  perDay: DayWorkerPerformance[],
  performanceWorkerName: string,
  home: ReturnType<typeof workerHomeNetwork>,
): AggregatedWorkerPerformance {
  let self = 0, supportSK = 0, supportKT = 0, supportLG = 0, supportTOSS = 0, officialTotal = 0;
  const hasOfficialTotal = home === "SK" || home === "KT" || home === "LG";
  for (const day of perDay) {
    const mine = day.workers.find((w) => w.worker === performanceWorkerName);
    if (mine) {
      self += mine.homeCount;
      supportSK += mine.supportSK;
      supportKT += mine.supportKT;
      supportLG += mine.supportLG;
      supportTOSS += mine.supportTOSS;
    }
    if (hasOfficialTotal) officialTotal += day.totals[home as "SK" | "KT" | "LG"];
  }
  const supportTotal = supportSK + supportKT + supportLG + supportTOSS;
  const recognized = self + supportTotal;
  const contributionRate = officialTotal > 0 ? (recognized / officialTotal) * 100 : null;
  return { self, supportSK, supportKT, supportLG, supportTOSS, supportTotal, recognized, officialTotal, contributionRate };
}

/** perDay 결과에서 같은 homeNetwork 근무자들의 기간 합계 평균(팀 평균, 본인 포함)을 구한다. */
export function teamAverageForHome(perDay: DayWorkerPerformance[], home: ReturnType<typeof workerHomeNetwork>): number | null {
  const totals = new Map<string, number>();
  const homes = new Map<string, string>();
  for (const day of perDay) {
    for (const w of day.workers) {
      totals.set(w.worker, (totals.get(w.worker) || 0) + w.totalHandled);
      homes.set(w.worker, w.homeNetwork);
    }
  }
  const teammates = Array.from(totals.entries()).filter(([worker]) => homes.get(worker) === home);
  if (teammates.length === 0) return null;
  return teammates.reduce((sum, [, v]) => sum + v, 0) / teammates.length;
}

export { workerHomeNetwork };
