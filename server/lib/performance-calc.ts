// server/lib/performance-calc.ts
//
// 작업명: MCC_DAILY_COMPLETION_NETWORK_TOTAL_CONFIRMED_1
//
// 이 파일에는 "검증 완료된" 로직만 넣는다.
//
// 검증 완료 (사용자가 현재 시점 실제 Excel과 대조 후 확정):
// - ■당일완료 통신망별(SK/KT/LG/TOSS) 합계 (MCC_DAILY_COMPLETION_NETWORK_TOTAL_CONFIRMED_1)
// - ■변경완료 + 00700결합("기타업무") 통신망별 합계 (MCC_PERFORMANCE_NETWORK_CLASSIFICATION_CONFIRMED_1)
// - 통신망 분류 규칙 자체 (performance-classify.ts, V17 classifyReq 이식)
//
// 아직 검증되지 않음 (임의로 확정하지 않음):
// - 작업자별 본업/지원업무 매트릭스는 "개인 실적률/지원업무 계산" 단계에서 별도 대조 예정
//   → 이 파일에서는 원시 매트릭스(raw matrix)만 계산해서 제공하고,
//     "검증 완료"라고 표시하지 않는다.
// - 누적 계산(모바일 쪽 전체 보고서 조합) — 기존 Excel 누적/취소 반영 규칙 미확인 (cumulative: null)
// - 공지 텍스트 조합 — 위 항목들이 모두 확정된 후 구성 (noticeText: null)
//
// [MCC_INTERNET_LIVE_STATE_CUMULATIVE_FINALIZE_1] 유선(인터넷) internet 연결:
// server/lib/internet-cumulative.ts의 computeWirePerformanceSnapshot()(읽기 전용, DB 미변경)를
// 사용한다. daily/waiting/received는 "인터넷접수" 시트의 당일 접수분(작업자 있는 건) 기준
// ("설치 접수 수량" 기준, MCC_INTERNET_RECEIPT_PERFORMANCE_RULE_FINALIZE_1). cumulative는
// DB 누적이 아니라 인터넷진행/인터넷이월/인터넷완료(당월)/인터넷이월완료(전월당월) 4개
// 상태 시트를 그때그때 다시 읽은 실시간 합계다(MCC_INTERNET_LIVE_STATE_CUMULATIVE_FINALIZE_1
// — 사람이 화면에서 직접 확인한 총합과 일치 검증됨). 두 값은 서로 더하지 않는다.
// Google Sheets/DB 접근이 실패하면(설정 누락, 네트워크 등) 기존 동작과의 호환을 위해
// internet=null로 안전하게 폴백한다 — mobileCompleted/otherDuty(검증 완료 블록)는
// 이 실패와 무관하게 항상 정상 계산된다.
//
// 취소 시트는 사용하지 않는다 (지침에 따라 절대 읽지 않음).

import { fetchSheetValues } from "./google-sheets-client";
import { classifyReq, workerHomeNetwork, type Network } from "./performance-classify";
import { computeWirePerformanceSnapshot, type WirePerformanceSnapshot } from "./internet-cumulative";
import { normalizeLedgerDate, isSameExactDate } from "./lg-audit-date";

const NETWORKS: Network[] = ["SK", "KT", "LG", "TOSS"];

export interface ClassifiedRow {
  worker: string;
  requestPoint: string;
  net: Network;
  cat: string;
}

export interface NetworkTotals {
  SK: number;
  KT: number;
  LG: number;
  TOSS: number;
  합계: number;
  byCategory: Record<Network, Record<string, number>>;
}

export interface WorkerNetworkRow {
  worker: string;
  home: ReturnType<typeof workerHomeNetwork>;
  SK: number;
  KT: number;
  LG: number;
  TOSS: number;
  합계: number;
}

export interface SourceBlock {
  /** 원본 시트명 (하나 이상) */
  sourceSheets: string[];
  /** 사용자가 현재 실제 Excel과 대조해서 확정했는지 여부 */
  networkTotalsVerified: boolean;
  raw: number;
  totals: NetworkTotals;
  /** 아직 최종 검증 대상 아님 — 개인 실적 계산 단계에서 별도 대조 예정 */
  workerMatrix: WorkerNetworkRow[];
}

export interface DailyPerformanceSnapshot {
  date: string; // YYYY-MM-DD
  mobileCompleted: SourceBlock; // ■당일완료
  otherDuty: SourceBlock; // ■변경완료 + 00700결합
  /**
   * 유선(인터넷) 당일 접수/처리실적/대기(daily/waiting/received) + 현재 월 누적 상태
   * (cumulative, internet-cumulative.ts computeWirePerformanceSnapshot — 읽기 전용, DB 미변경).
   * cumulative는 DB 누적이 아니라 4개 상태 시트 실시간 합계다. Sheets/DB 접근 실패 시
   * 기존 동작 호환을 위해 null로 폴백.
   */
  internet: WirePerformanceSnapshot | null;
  /** TODO(미확정): 기존 Excel 누적/취소 반영 규칙 확인 후 구현 */
  cumulative: null;
  /** TODO(미확정): internet/cumulative 확정 후 구성 */
  noticeText: null;
}

/** internet 블록 계산 실패가 mobileCompleted/otherDuty(검증 완료 블록)에 영향 주지 않도록 격리 */
async function safeComputeInternet(date: Date): Promise<WirePerformanceSnapshot | null> {
  try {
    return await computeWirePerformanceSnapshot(date);
  } catch (err) {
    console.warn("[PerformanceCalc] 유선 실적 계산 실패 — internet=null로 폴백:", err);
    return null;
  }
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateLabel(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

// [MCC_PERFORMANCE_EXACT_DATE_MATCHING_ROOT_FIX_1] 이 함수는 원래 "변형 문자열과
// startsWith 접두어 일치"를 사용했다 — "9/1"이 "9/10"~"9/19"의 접두어와도 일치해서
// 09-01 조회 시 09-10~09-19의 행이 전부 함께 잘못 포함되는 버그가 실측으로 확인됐다
// (2026-09-01 KT: 정확일치 167건, 접두어 버그 포함 시 1165건 — 09-02~09-18의 KT
// 합계 998건이 그대로 더해진 값과 정확히 일치). LG_ACTIVATION_AUDIT_MCC_SITE_
// IMPLEMENTATION_1에서 이미 이 버그를 발견해 독립적인 정확 매칭 파서
// (lg-audit-date.ts의 normalizeLedgerDate/isSameExactDate, prefix 비교 전혀 없음)를
// 만들어뒀으므로 새로 만들지 않고 그대로 재사용한다. 연도가 없는 "M/D" 셀은 date의
// 연도를 fallback으로 사용한다(스프레드시트 자체가 이미 해당 연/월 단위로 분리되어
// 있어 연도 혼동 위험 없음, resolveActiveSpreadsheet() 무변경).
/** 시트의 "개통일" 셀이 주어진 날짜와 정확히 같은지 확인 (prefix/부분 일치 없음) */
export function matchesDate(cell: string, date: Date): boolean {
  const normalized = normalizeLedgerDate(cell, date.getFullYear());
  return isSameExactDate(normalized, { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

/**
 * 시트에서 "작업자/개통일/요청점" 컬럼을 찾아 지정한 날짜의 행만 분류해서 반환.
 * 필수 컬럼이 없으면 예외를 던진다 (조용히 빈 배열을 반환하지 않음 — 시트 구조가
 * 바뀌었을 때 원본 건수가 소리 없이 0이 되는 것을 방지).
 */
export async function loadClassifiedRows(sheetName: string, date: Date): Promise<ClassifiedRow[]> {
  const values = await fetchSheetValues(sheetName);
  if (values.length === 0) return [];

  const header = values[0];
  const workerIdx = header.indexOf("작업자");
  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  const reqIdx = header.indexOf("요청점");

  if (workerIdx < 0 || dateIdx < 0 || reqIdx < 0) {
    throw new Error(
      `[PerformanceCalc] 시트 "${sheetName}"에서 필수 컬럼(작업자/개통일/요청점)을 찾지 못했습니다. ` +
        `헤더: ${header.join(", ")}`,
    );
  }

  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const out: ClassifiedRow[] = [];
  for (const r of rows) {
    if (!matchesDate(r[dateIdx], date)) continue;
    const requestPoint = String(r[reqIdx] ?? "").trim();
    const worker = String(r[workerIdx] ?? "").trim();
    const c = classifyReq(requestPoint);
    out.push({ worker, requestPoint, net: c.net, cat: c.cat });
  }
  return out;
}

export function summarizeNetworkTotals(rows: ClassifiedRow[]): NetworkTotals {
  const totals: NetworkTotals = {
    SK: 0,
    KT: 0,
    LG: 0,
    TOSS: 0,
    합계: 0,
    byCategory: { SK: {}, KT: {}, LG: {}, TOSS: {} },
  };
  for (const r of rows) {
    totals[r.net]++;
    totals.합계++;
    totals.byCategory[r.net][r.cat] = (totals.byCategory[r.net][r.cat] || 0) + 1;
  }
  return totals;
}

export function summarizeWorkerNetworkMatrix(rows: ClassifiedRow[]): WorkerNetworkRow[] {
  const map = new Map<string, WorkerNetworkRow>();
  for (const r of rows) {
    if (!map.has(r.worker)) {
      map.set(r.worker, { worker: r.worker, home: workerHomeNetwork(r.worker), SK: 0, KT: 0, LG: 0, TOSS: 0, 합계: 0 });
    }
    const rec = map.get(r.worker)!;
    rec[r.net]++;
    rec["합계"]++;
  }
  return Array.from(map.values()).sort((a, b) => b["합계"] - a["합계"]);
}

async function buildSourceBlock(sheetNames: string[], date: Date, networkTotalsVerified: boolean): Promise<SourceBlock> {
  const rowsPerSheet = await Promise.all(sheetNames.map((name) => loadClassifiedRows(name, date)));
  const rows = rowsPerSheet.flat();
  return {
    sourceSheets: sheetNames,
    networkTotalsVerified,
    raw: rows.length,
    totals: summarizeNetworkTotals(rows),
    workerMatrix: summarizeWorkerNetworkMatrix(rows),
  };
}

/**
 * 지정한 날짜의 실적 스냅샷을 계산한다.
 * - mobileCompleted / otherDuty: 통신망별 합계는 검증 완료된 규칙만 사용
 * - internet / cumulative / noticeText: 아직 규칙이 확정되지 않아 null (다음 단계에서 채움)
 */
export async function computeDailyPerformanceSnapshot(date: Date): Promise<DailyPerformanceSnapshot> {
  const [mobileCompleted, otherDuty, internet] = await Promise.all([
    buildSourceBlock(["■당일완료"], date, true),
    buildSourceBlock(["■변경완료", "00700결합"], date, true),
    safeComputeInternet(date),
  ]);

  return {
    date: formatDateLabel(date),
    mobileCompleted,
    otherDuty,
    internet,
    cumulative: null,
    noticeText: null,
  };
}
