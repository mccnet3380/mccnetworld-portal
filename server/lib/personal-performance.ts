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
// 날짜-매칭 판정은 performance-calc.ts의 비공개 matchesDate()를 그대로 복사했다(그 파일을
// export 추가로도 건드리지 않기 위함) — 판정 로직 자체는 한 글자도 바꾸지 않았다.

import { fetchSheetValuesById } from "./google-sheets-client";
import { resolveActiveSpreadsheet } from "./spreadsheet-resolver";
import { classifyReq, workerHomeNetwork } from "./performance-classify";
import { summarizeNetworkTotals, summarizeWorkerNetworkMatrix, type ClassifiedRow } from "./performance-calc";
import { computeWorkerPerformance, type WorkerPerformanceRow } from "./worker-performance";

const LEDGER_SHEET = "■당일완료";

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** performance-calc.ts의 matchesDate()를 그대로 복사(그 파일 무수정 원칙) — 판정 로직 동일. */
function matchesDateCopy(cell: string, date: Date): boolean {
  const s = String(cell ?? "").trim();
  if (!s) return false;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const variants = [
    `${m}/${d}`,
    `${two(m)}/${two(d)}`,
    `${m}.${d}`,
    ymd(date),
    ymd(date).replace(/-/g, "."),
    ymd(date).replace(/-/g, "/"),
  ];
  if (variants.some((v) => s === v || s.startsWith(v))) return true;

  if (/^\d+$/.test(s)) return false;

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return (
      parsed.getFullYear() === date.getFullYear() &&
      parsed.getMonth() === date.getMonth() &&
      parsed.getDate() === date.getDate()
    );
  }
  return false;
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

function classifyForDate(entry: LedgerCacheEntry, date: Date): ClassifiedRow[] {
  const workerIdx = entry.header.indexOf("작업자");
  const dateIdx = entry.header.findIndex((h) => h.includes("개통일"));
  const reqIdx = entry.header.indexOf("요청점");
  if (workerIdx < 0 || dateIdx < 0 || reqIdx < 0) {
    throw new Error(
      `[PersonalPerformance] "${LEDGER_SHEET}" 시트에서 필수 컬럼(작업자/개통일/요청점)을 찾지 못했습니다. 헤더: ${entry.header.join(", ")}`,
    );
  }

  const out: ClassifiedRow[] = [];
  for (const r of entry.rows) {
    if (!matchesDateCopy(r[dateIdx], date)) continue;
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
    out.push({ date: ymd(date), workers });
  }
  return out;
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
// 않는다 — 이미 이 파일에 있는 컬럼 탐지/날짜 매칭(matchesDateCopy) 그대로 재사용하고,
// sheetName만 fetchLedgerCached()에 다르게 넘긴다. 작업자명은 원문 그대로만 모은다 —
// 추정/변환/정규화 없음.
const WORKER_DISCOVERY_SHEETS = [LEDGER_SHEET, "■변경완료", "00700결합"];

function extractWorkerNamesForDate(entry: LedgerCacheEntry, date: Date): string[] {
  const workerIdx = entry.header.indexOf("작업자");
  const dateIdx = entry.header.findIndex((h) => h.includes("개통일"));
  if (workerIdx < 0 || dateIdx < 0) return [];

  const out: string[] = [];
  for (const r of entry.rows) {
    if (!matchesDateCopy(r[dateIdx], date)) continue;
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

/** perDay 결과에서 특정 performanceWorkerName의 기간 합계를 뽑는다(LOCK 공식은 이미 일별로 적용됨 — 여기선 합산만). */
export function aggregateForWorker(perDay: DayWorkerPerformance[], performanceWorkerName: string): AggregatedWorkerPerformance {
  let self = 0, supportSK = 0, supportKT = 0, supportLG = 0, supportTOSS = 0, officialTotal = 0;
  for (const day of perDay) {
    const mine = day.workers.find((w) => w.worker === performanceWorkerName);
    if (!mine) continue;
    self += mine.homeCount;
    supportSK += mine.supportSK;
    supportKT += mine.supportKT;
    supportLG += mine.supportLG;
    supportTOSS += mine.supportTOSS;
    if (mine.homeNetworkOfficialTotal) officialTotal += mine.homeNetworkOfficialTotal;
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
