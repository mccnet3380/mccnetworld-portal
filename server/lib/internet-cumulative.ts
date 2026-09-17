// server/lib/internet-cumulative.ts
//
// 작업명: MCC_INTERNET_LIVE_STATE_CUMULATIVE_FINALIZE_1
//
// 유선(인터넷) 실적 계산 — "당일 접수 실적"(daily/waiting/received)과
// "현재 월 누적 상태"(cumulative)를 별도 소스에서 계산해서 합치는 엔진.
//
// [MCC_INTERNET_LIVE_STATE_CUMULATIVE_FINALIZE_1] 사용자 최종 확정 — cumulative의 source of truth:
// 유선 누적(cumulative)은 더 이상 "DB에 저장된 전일 cumulative + 오늘 daily"로 만들어가지
// 않는다. Google Spreadsheet의 다음 4개 상태 시트가 이미 월 실적 상태를 유지하고 있고,
// 사람이 직접 확인한 총합(211)과 코드가 동일 시점에 계산한 값이 정확히 일치했기 때문이다:
//   - 인터넷진행
//   - 인터넷이월
//   - 인터넷완료(당월접수,당월개통)
//   - 인터넷이월완료(전월접수,당월개통)
// cumulative = 이 4개 시트의 "요청점이 존재하는 실제 데이터 행" 합계를 그때그때 다시 읽어서
// 계산한다(물리 used-range 행수 아님, 빈 행/요청점 공백 행 제외). DB는 이 값을 만들어내는
// source of truth가 아니라, "그날 마감 당시 읽은 결과를 보존"하는 snapshot 저장소로 역할이
// 바뀌었다 — 다음 날 계산 때 전날 DB cumulative에 daily를 더하지 않는다.
//
// daily/waiting/received는 이전 규칙 그대로 유지한다:
// [MCC_INTERNET_RECEIPT_PERFORMANCE_RULE_FINALIZE_1] 유선 "당일 실적"은 설치 접수 수량
// 기준이다. daily는 오직 "인터넷접수" 시트의 당일 접수분(작업자 이름 있는 건)이며,
// 인터넷완료/인터넷이월완료의 개통 수량은 daily 소스가 아니다 — 그러나 이 두 시트는
// (인터넷진행/인터넷이월과 함께) cumulative의 소스로는 그대로 사용된다. 완료 시트를
// "daily 계산에는 미사용, cumulative 계산에는 사용"하는 이 구분을 혼동하지 않는다.
//
// 절대 원칙 (계속 유지):
// - internet-classify.ts(WIRE_CODE_TO_CATEGORY, classifyWireRequestPoint,
//   summarizeWireWorkerMatrix)를 그대로 재사용한다 — 재구현하지 않는다.
// - 모바일 classifyReq()(performance-classify.ts)는 사용하지 않는다.
// - 매핑표에 없는 요청점("기타-유선" 포함)은 UNRESOLVED로 명시적으로 집계하고,
//   기존 10개 카테고리 중 하나로 임의 귀속하지 않는다.
// - 판정 기준은 오직 "작업자 이름 존재 여부"다(daily/waiting). 18:00 같은 시각을
//   실적 제외 조건으로 사용하지 않는다.
// - "미배정"이라는 가상 작업자 실적을 만들지 않는다.
// - 4개 상태 시트의 "유효 행"은 오직 "완전 빈 행 제외 + 요청점 공백 제외" 두 조건만 적용한다
//   (작업자 공백 제외, 유형/상태값 제외, 접수일·개통일 파싱 실패 제외, 중복 제거 등 다른
//   필터는 걸지 않는다 — MCC_INTERNET_LIVE_211_RECONCILIATION_1에서 이 최소 필터만으로
//   사람이 화면에서 센 211과 정확히 일치함을 확인했다).
// - 4개 상태 시트 간 동일 건으로 보이는 행이 있어도 이 모듈에서는 dedupe하지 않는다
//   (사용자가 보는 화면 그대로의 총합을 재현하는 것이 목적).
// - 월별 시트명은 internet-sheet-names.ts의 buildMonthlyInternetSheetNames(date)를
//   그대로 사용한다(하드코딩 금지) — 월이 바뀌면 그 달의 4개 시트를 다시 읽는다.
//
// [MCC_INTERNET_LEGACY_CUMULATIVE_CLEANUP_1] 구형 DB 체인 누적 모델(전일 cumulative +
// 오늘 daily로 이어가던 방식, baseline, previousCumulative)은 완전히 제거했다.
// 사용처를 재검색한 결과 server/routes/performance-admin.ts의 baseline 라우트와
// 이미 비활성화돼 있던 closing PATCH 라우트 외에는 참조가 없었고, 그 라우트들도
// 이번에 함께 제거했다. internet_daily_closings는 이제 "마감 시점 결과를 보존하는
// snapshot 저장소"일 뿐이며 previousCumulative 컬럼 없이 date/yearMonth/category/
// received/daily/waiting/cumulative/closedAt/updatedAt만 가진다.

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../db";
import { internetDailyClosings, internetWorkerDailyClosings } from "../../shared/schema";
import { fetchSheetValues } from "./google-sheets-client";
import {
  classifyWireRequestPoint,
  summarizeWireWorkerMatrix,
  KNOWN_WIRE_CATEGORIES,
  type WireCategory,
  type WireEntry,
  type WireWorkerMatrix,
} from "./internet-classify";
import { buildMonthlyInternetSheetNames, STATIC_INTERNET_SHEET_NAMES } from "./internet-sheet-names";

// ─────────────────────────────────────────────────────────
// 날짜/컬럼 유틸
// ─────────────────────────────────────────────────────────

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateLabel(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function yearMonthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function isFirstOfMonth(dateStr: string): boolean {
  return dateStr.slice(-2) === "01";
}

/**
 * "인터넷접수" 시트의 접수일 셀(예: "9/17-10:19")이 주어진 날짜와 같은 날인지 확인.
 * 뒤에 "-HH:MM" 시각이 붙어 있으면 그 부분만 떼어내고 날짜 부분만 비교한다.
 * (시각 자체는 실적 판정에 쓰지 않는다 — 오직 "같은 날인지"만 확인)
 */
function matchesReceiptDate(cell: string, date: Date): boolean {
  const s = String(cell ?? "").trim();
  if (!s) return false;

  const timeSuffix = s.match(/^(.*?)-\d{1,2}:\d{2}$/);
  const datePart = (timeSuffix ? timeSuffix[1] : s).trim();

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const variants = [`${m}/${d}`, `${two(m)}/${two(d)}`, `${m}.${d}`, formatDateLabel(date)];
  return variants.includes(datePart);
}

/**
 * "인터넷접수" 시트에서만 확인된 예외: 작업자 컬럼(0번째 열)의 헤더 텍스트가 공백이다
 * (인터넷진행/인터넷이월/인터넷완료류 4개 시트는 모두 header[0]="작업자"로 정상 — 이 함수는
 * "인터넷접수" 조회 경로에서만 사용하고, 다른 시트에 광범위하게 적용하지 않는다).
 */
function resolveReceiptWorkerColumnIndex(header: string[]): number {
  const idx = header.indexOf("작업자");
  if (idx >= 0) return idx;
  if (String(header[0] ?? "").trim() === "") return 0;
  throw new Error(
    `[InternetCumulative] "${STATIC_INTERNET_SHEET_NAMES.receipt}" 시트에서 작업자 컬럼을 찾지 못했습니다. ` +
      `헤더: ${header.join(", ")}`,
  );
}

// ─────────────────────────────────────────────────────────
// 1) 당일 접수/처리실적/대기 원시 집계 (인터넷접수 시트, DB 미접근) — 변경 없음
// ─────────────────────────────────────────────────────────

export interface WireCategoryDailyRaw {
  received: number;
  daily: number;
  waiting: number;
}

export interface WireDailyRaw {
  date: string; // YYYY-MM-DD
  yearMonth: string; // YYYY-MM
  matrix: WireWorkerMatrix; // 원본 요청점 × 실제 작업자 (internet-classify.ts 그대로 재사용)
  byCategory: Record<WireCategory, WireCategoryDailyRaw>; // 10개 카테고리 전부 항상 존재 (0건이어도 포함)
  unresolvedCodes: string[]; // WIRE_CODE_TO_CATEGORY에 없는 원본 요청점 코드 (중복 제거, 가나다순)
  unresolved: WireCategoryDailyRaw; // UNRESOLVED 버킷 합계 — 절대 기존 카테고리에 합치지 않는다
}

/**
 * "인터넷접수" 시트에서 지정한 날짜의 유효 행(요청점 존재)만 뽑아
 * internet-classify.ts의 summarizeWireWorkerMatrix()로 작업자별 매트릭스를 만들고,
 * 각 원본 요청점 행을 classifyWireRequestPoint()로 카테고리에 롤업한다.
 */
export async function computeWireDailyRaw(date: Date): Promise<WireDailyRaw> {
  const values = await fetchSheetValues(STATIC_INTERNET_SHEET_NAMES.receipt);
  const dateStr = formatDateLabel(date);
  const yearMonth = yearMonthOf(dateStr);

  const byCategory = Object.fromEntries(
    KNOWN_WIRE_CATEGORIES.map((c) => [c, { received: 0, daily: 0, waiting: 0 }]),
  ) as Record<WireCategory, WireCategoryDailyRaw>;
  const unresolved: WireCategoryDailyRaw = { received: 0, daily: 0, waiting: 0 };

  if (values.length === 0) {
    return {
      date: dateStr,
      yearMonth,
      matrix: { workers: [], rows: [], grandTotal: 0, grandWaiting: 0, grandReceived: 0 },
      byCategory,
      unresolvedCodes: [],
      unresolved,
    };
  }

  const header = values[0];
  const workerIdx = resolveReceiptWorkerColumnIndex(header);
  const reqIdx = header.indexOf("요청점");
  const receiptDateIdx = header.indexOf("접수일");
  if (reqIdx < 0 || receiptDateIdx < 0) {
    throw new Error(
      `[InternetCumulative] "${STATIC_INTERNET_SHEET_NAMES.receipt}" 시트에서 필수 컬럼(요청점/접수일)을 ` +
        `찾지 못했습니다. 헤더: ${header.join(", ")}`,
    );
  }

  const rawRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const entries: WireEntry[] = [];
  for (const r of rawRows) {
    const req = String(r[reqIdx] ?? "").trim();
    if (!req) continue;
    if (!matchesReceiptDate(String(r[receiptDateIdx] ?? ""), date)) continue;
    entries.push({ worker: String(r[workerIdx] ?? "").trim(), requestPoint: req });
  }

  const matrix = summarizeWireWorkerMatrix(entries);
  const unresolvedCodeSet = new Set<string>();

  for (const row of matrix.rows) {
    const cls = classifyWireRequestPoint(row.code);
    const bucket = cls.resolved ? byCategory[cls.category as WireCategory] : unresolved;
    bucket.received += row.received;
    bucket.daily += row.total;
    bucket.waiting += row.waiting;
    if (!cls.resolved) unresolvedCodeSet.add(row.code);
  }

  return {
    date: dateStr,
    yearMonth,
    matrix,
    byCategory,
    unresolvedCodes: Array.from(unresolvedCodeSet).sort((a, b) => a.localeCompare(b, "ko")),
    unresolved,
  };
}

// ─────────────────────────────────────────────────────────
// 2) 현재 월 누적 상태 원시 집계 (4개 상태 시트) — cumulative의 새 source of truth
// ─────────────────────────────────────────────────────────

export interface WireCumulativeSheetCounts {
  inProgress: number; // 인터넷진행
  carriedOver: number; // 인터넷이월
  completedThisMonth: number; // 인터넷완료(당월접수,당월개통)
  carriedOverCompleted: number; // 인터넷이월완료(전월접수,당월개통)
}

export interface WireCumulativeSheetNames {
  inProgress: string;
  carriedOver: string;
  completedThisMonth: string;
  carriedOverCompleted: string;
}

export interface WireCurrentCumulativeRaw {
  yearMonth: string;
  sheetNames: WireCumulativeSheetNames;
  sheetCounts: WireCumulativeSheetCounts; // 시트별 "요청점 존재" 유효 행수
  byCategory: Record<WireCategory, number>; // 10개 카테고리 전부 항상 존재
  unresolvedCodes: string[];
  unresolvedCount: number;
  totalCumulative: number; // sheetCounts 4개 합 === byCategory 합 + unresolvedCount
}

/** 시트 하나를 읽어 "요청점 존재" 유효 행만 반환 (완전 빈 행 + 요청점 공백만 제외, 다른 필터 없음) */
async function loadValidRequestPoints(sheetName: string): Promise<string[]> {
  const values = await fetchSheetValues(sheetName);
  if (values.length === 0) return [];
  const header = values[0];
  const reqIdx = header.indexOf("요청점");
  if (reqIdx < 0) {
    throw new Error(`[InternetCumulative] "${sheetName}" 시트에서 요청점 컬럼을 찾지 못했습니다. 헤더: ${header.join(", ")}`);
  }
  const dataRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return dataRows.map((r) => String(r[reqIdx] ?? "").trim()).filter((req) => req !== "");
}

/**
 * 4개 상태 시트(인터넷진행/인터넷이월/인터넷완료(당월)/인터넷이월완료(전월당월))를
 * 지금 이 순간 다시 읽어 "현재 월 누적 상태"를 계산한다. DB는 전혀 조회하지 않는다 —
 * 이 함수의 결과 자체가 cumulative의 source of truth다.
 */
export async function computeWireCurrentCumulativeRaw(date: Date): Promise<WireCurrentCumulativeRaw> {
  const names = buildMonthlyInternetSheetNames(date);
  const yearMonth = yearMonthOf(formatDateLabel(date));

  const [inProgress, carriedOver, completedThisMonth, carriedOverCompleted] = await Promise.all([
    loadValidRequestPoints(STATIC_INTERNET_SHEET_NAMES.inProgress),
    loadValidRequestPoints(STATIC_INTERNET_SHEET_NAMES.carriedOver),
    loadValidRequestPoints(names.completedThisMonth),
    loadValidRequestPoints(names.carriedOverCompleted),
  ]);

  const byCategory = Object.fromEntries(KNOWN_WIRE_CATEGORIES.map((c) => [c, 0])) as Record<WireCategory, number>;
  const unresolvedCodeSet = new Set<string>();
  let unresolvedCount = 0;

  for (const req of [...inProgress, ...carriedOver, ...completedThisMonth, ...carriedOverCompleted]) {
    const cls = classifyWireRequestPoint(req);
    if (cls.resolved) {
      byCategory[cls.category as WireCategory]++;
    } else {
      unresolvedCount++;
      unresolvedCodeSet.add(req);
    }
  }

  const sheetCounts: WireCumulativeSheetCounts = {
    inProgress: inProgress.length,
    carriedOver: carriedOver.length,
    completedThisMonth: completedThisMonth.length,
    carriedOverCompleted: carriedOverCompleted.length,
  };
  const totalCumulative = sheetCounts.inProgress + sheetCounts.carriedOver + sheetCounts.completedThisMonth + sheetCounts.carriedOverCompleted;

  return {
    yearMonth,
    sheetNames: {
      inProgress: STATIC_INTERNET_SHEET_NAMES.inProgress,
      carriedOver: STATIC_INTERNET_SHEET_NAMES.carriedOver,
      completedThisMonth: names.completedThisMonth,
      carriedOverCompleted: names.carriedOverCompleted,
    },
    sheetCounts,
    byCategory,
    unresolvedCodes: Array.from(unresolvedCodeSet).sort((a, b) => a.localeCompare(b, "ko")),
    unresolvedCount,
    totalCumulative,
  };
}

// ─────────────────────────────────────────────────────────
// 3) 최종 합성 — daily(인터넷접수) + cumulative(4개 상태 시트). 서로 더하지 않는다.
// ─────────────────────────────────────────────────────────

export interface WireCategorySnapshot {
  category: WireCategory;
  received: number;
  daily: number;
  waiting: number;
  cumulative: number;
}

export interface WireWorkerDailyEntry {
  worker: string;
  requestPoint: string;
  count: number;
}

export interface WirePerformanceSnapshot {
  date: string;
  yearMonth: string;
  categories: WireCategorySnapshot[];
  totalReceived: number;
  totalDaily: number;
  totalWaiting: number;
  totalCumulative: number;
  workerDaily: WireWorkerDailyEntry[];
  cumulativeSheetCounts: WireCumulativeSheetCounts;
  unresolvedDailyCodes: string[]; // 인터넷접수 쪽 미분류 코드
  unresolvedCumulativeCodes: string[]; // 4개 상태 시트 쪽 미분류 코드
  /** [최종 확정] daily는 설치 접수 기준, 완료/이월완료는 daily 소스가 아니다(그러나 cumulative 소스로는 사용됨) */
  carryOverProcessing: "NOT_USED_BY_DESIGN";
}

function workerDailyFromMatrix(raw: WireDailyRaw): WireWorkerDailyEntry[] {
  const out: WireWorkerDailyEntry[] = [];
  for (const row of raw.matrix.rows) {
    for (const worker of raw.matrix.workers) {
      const count = row.counts[worker] || 0;
      if (count > 0) out.push({ worker, requestPoint: row.code, count });
    }
  }
  return out;
}

/**
 * 유선 실적 스냅샷. cumulative(4개 상태 시트 실시간 재조회)와 daily/waiting/received
 * (인터넷접수 당일분)를 각각 독립적으로 계산해서 합친다 — 두 값을 서로 더하지 않는다
 * (211 + 5 = 216 같은 임의 가산 금지). DB에는 아무것도 쓰지 않는다(읽기 전용, 부작용 없음).
 */
export async function computeWirePerformanceSnapshot(date: Date): Promise<WirePerformanceSnapshot> {
  const [dailyRaw, cumulativeRaw] = await Promise.all([
    computeWireDailyRaw(date),
    computeWireCurrentCumulativeRaw(date),
  ]);

  const categories: WireCategorySnapshot[] = KNOWN_WIRE_CATEGORIES.map((category) => ({
    category,
    received: dailyRaw.byCategory[category].received,
    daily: dailyRaw.byCategory[category].daily,
    waiting: dailyRaw.byCategory[category].waiting,
    cumulative: cumulativeRaw.byCategory[category],
  }));

  return {
    date: dailyRaw.date,
    yearMonth: dailyRaw.yearMonth,
    categories,
    totalReceived: categories.reduce((s, c) => s + c.received, 0),
    totalDaily: categories.reduce((s, c) => s + c.daily, 0),
    totalWaiting: categories.reduce((s, c) => s + c.waiting, 0),
    totalCumulative: cumulativeRaw.totalCumulative,
    workerDaily: workerDailyFromMatrix(dailyRaw),
    cumulativeSheetCounts: cumulativeRaw.sheetCounts,
    unresolvedDailyCodes: dailyRaw.unresolvedCodes,
    unresolvedCumulativeCodes: cumulativeRaw.unresolvedCodes,
    carryOverProcessing: "NOT_USED_BY_DESIGN",
  };
}

// ─────────────────────────────────────────────────────────
// 4) 마감 스냅샷 저장 — "그 순간 읽은 결과를 보존"하는 용도로만 사용 (source of truth 아님)
// ─────────────────────────────────────────────────────────

/**
 * 지정한 날짜의 유선 실적 스냅샷(computeWirePerformanceSnapshot 결과)을 DB에 저장한다.
 * DB는 이 값을 "만들어내는" 곳이 아니라 "그날 마감 당시 라이브 시트에서 읽은 결과를
 * 보존"하는 저장소다 — 다시 마감해도(재마감) 매번 라이브 시트를 다시 읽어 같은 계산을
 * 반복할 뿐, 이전 DB 값에 무언가를 더하지 않으므로 중복 가산이 구조적으로 없다(단,
 * 그 사이 라이브 시트 자체가 바뀌었다면 스냅샷 값도 최신 상태로 갱신된다 — 이것은
 * "매번 다른 값을 더하는 버그"가 아니라 "현재 상태를 다시 캡처"하는 정상 동작이다).
 *
 */
export async function closeWireDay(date: Date): Promise<WirePerformanceSnapshot> {
  const snapshot = await computeWirePerformanceSnapshot(date);
  const db = await getDatabase();

  for (const cat of snapshot.categories) {
    await db
      .insert(internetDailyClosings)
      .values({
        date: snapshot.date,
        yearMonth: snapshot.yearMonth,
        category: cat.category,
        received: cat.received,
        daily: cat.daily,
        waiting: cat.waiting,
        cumulative: cat.cumulative,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [internetDailyClosings.date, internetDailyClosings.category],
        set: {
          received: cat.received,
          daily: cat.daily,
          waiting: cat.waiting,
          cumulative: cat.cumulative,
          updatedAt: new Date(),
        },
      });
  }

  const dailyRaw = await computeWireDailyRaw(date); // 작업자별 원본 행 저장용(카테고리 매핑 재사용)
  for (const row of dailyRaw.matrix.rows) {
    const category = classifyWireRequestPoint(row.code).category;
    if (category === "UNRESOLVED") continue;
    for (const worker of dailyRaw.matrix.workers) {
      const count = row.counts[worker] || 0;
      if (count === 0) continue;
      await db
        .insert(internetWorkerDailyClosings)
        .values({ date: snapshot.date, worker, requestPoint: row.code, category, count, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [
            internetWorkerDailyClosings.date,
            internetWorkerDailyClosings.worker,
            internetWorkerDailyClosings.requestPoint,
          ],
          set: { category, count, updatedAt: new Date() },
        });
    }
  }

  return snapshot;
}
