// server/lib/dealer-performance.ts
//
// 작업명: MCC_ENTERPRISE_DAILY_REPORT_EXACT_HTML_RESTORE_1
//
// 전사 공지용 당일실적 화면 오른쪽의 "담당판매점별 상세 실적표"용 집계.
// 기존 확정본 closing.html(마감보고)의 실제 DOM(.sales-block/.excel-pivot/.totalrow)에
// 나타난 판매점별 피벗 구조를 그대로 재현하기 위한 backend 집계다 — 새 분류 규칙을
// 만들지 않는다:
// - 업무유형 분류: classifyReq()(performance-classify.ts, 기존·무변경) 그대로 재사용
// - 그룹 규칙: 판매점명의 "코드)" 접두어(예: "강)다원통신(평택)" → 그룹 "강") — closing.html
//   실제 예시 데이터(강/구/수/영/우/웅/준/형/호 그룹)에 나타난 접두어 그룹 구조를 그대로 포팅
// - 정렬: 그룹/판매점/업무유형 컬럼 전부 가나다순(closing.html 예시와 동일한 순서 원리)
//
// 왼쪽 공지텍스트(closing-notice.ts)와 같은 "당일" 모집단을 써야 총합계가 일치하므로,
// mobileCompleted가 읽는 것과 동일한 "■당일완료" 시트를 동일한 날짜 조건으로 다시 읽는다.
//
// [MCC_SIDEBAR_REORDER_AND_REMAINING_DATE_PREFIX_MATCH_ROOT_FIX_1] 원래 이 파일은
// performance-calc.ts의 matchesDate()가 export되지 않는다는 이유로 동일 로직을 복제해서
// 갖고 있었는데, 그 복제본에 접두어(startsWith) 오매칭 버그(예: "9/1"이 "9/10"~"9/19"에도
// 매치)가 그대로 들어있었다. MCC_PERFORMANCE_EXACT_DATE_MATCHING_ROOT_FIX_1에서
// performance-calc.ts의 matchesDate()가 이미 export되고 정확 매칭으로 수정됐으므로,
// 복제본을 삭제하고 그 함수를 그대로 재사용한다(새 parser를 만들지 않음).
import { fetchSheetValues } from "./google-sheets-client";
import { classifyReq } from "./performance-classify";
import { matchesDate } from "./performance-calc";
import type { DataUsimDealerBreakdown } from "./mobile-cumulative";

const DAILY_SHEET = "■당일완료";
const UNGROUPED_LABEL = "(판매점 미기재)";

function extractGroup(dealer: string): string {
  const idx = dealer.indexOf(")");
  if (idx <= 0) return UNGROUPED_LABEL;
  return dealer.slice(0, idx);
}

export interface DealerPerformanceRow {
  dealer: string; // 판매점명(접두어 포함), 총합계 행은 "총합계"
  total: number;
  counts: Record<string, number>; // 업무유형(cat) -> 건수
}

export interface DealerPerformanceGroup {
  group: string; // 판매점명 접두어(예: "강") 또는 UNGROUPED_LABEL
  rows: DealerPerformanceRow[];
  totalRow: DealerPerformanceRow; // 그룹 총합계 행
}

export interface DealerPerformanceMatrix {
  sourceSheet: string;
  columns: string[]; // 오늘 등장한 업무유형, 가나다순(고정 순서 — closing.html과 동일 원리)
  groups: DealerPerformanceGroup[];
  grandTotal: DealerPerformanceRow; // 전체 총합계 행
  raw: number; // mobileCompleted.raw와 반드시 같아야 하는 검증용 건수
}

export async function computeDealerPerformanceMatrix(date: Date): Promise<DealerPerformanceMatrix> {
  const values = await fetchSheetValues(DAILY_SHEET);
  const emptyTotal: DealerPerformanceRow = { dealer: "총합계", total: 0, counts: {} };
  if (values.length === 0) {
    return { sourceSheet: DAILY_SHEET, columns: [], groups: [], grandTotal: emptyTotal, raw: 0 };
  }

  const header = values[0];
  const workerIdx = header.indexOf("작업자");
  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  const reqIdx = header.indexOf("요청점");
  const dealerIdx = header.indexOf("판매점명");
  if (workerIdx < 0 || dateIdx < 0 || reqIdx < 0 || dealerIdx < 0) {
    throw new Error(
      `[DealerPerformance] "${DAILY_SHEET}" 시트에서 필수 컬럼(작업자/개통일/요청점/판매점명)을 ` +
        `찾지 못했습니다. 헤더: ${header.join(", ")}`,
    );
  }

  const rawRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const byDealer = new Map<string, { counts: Map<string, number>; total: number }>();
  const columnSet = new Set<string>();
  let raw = 0;

  for (const r of rawRows) {
    if (!matchesDate(r[dateIdx], date)) continue;
    const requestPoint = String(r[reqIdx] ?? "").trim();
    if (!requestPoint) continue;

    const dealer = String(r[dealerIdx] ?? "").trim() || UNGROUPED_LABEL;
    const cls = classifyReq(requestPoint);

    if (!byDealer.has(dealer)) byDealer.set(dealer, { counts: new Map(), total: 0 });
    const rec = byDealer.get(dealer)!;
    rec.counts.set(cls.cat, (rec.counts.get(cls.cat) || 0) + 1);
    rec.total++;
    columnSet.add(cls.cat);
    raw++;
  }

  const columns = Array.from(columnSet).sort((a, b) => a.localeCompare(b, "ko"));

  const groupMap = new Map<string, DealerPerformanceRow[]>();
  for (const [dealer, rec] of Array.from(byDealer.entries())) {
    const group = extractGroup(dealer);
    const counts: Record<string, number> = {};
    for (const c of columns) counts[c] = rec.counts.get(c) || 0;
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push({ dealer, total: rec.total, counts });
  }

  const groups: DealerPerformanceGroup[] = Array.from(groupMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([group, dealerRows]) => {
      dealerRows.sort((a, b) => a.dealer.localeCompare(b.dealer, "ko"));
      const totalCounts: Record<string, number> = {};
      let total = 0;
      for (const c of columns) totalCounts[c] = dealerRows.reduce((s, r) => s + (r.counts[c] || 0), 0);
      for (const r of dealerRows) total += r.total;
      return { group, rows: dealerRows, totalRow: { dealer: "총합계", total, counts: totalCounts } };
    });

  const grandCounts: Record<string, number> = {};
  for (const c of columns) grandCounts[c] = groups.reduce((s, g) => s + (g.totalRow.counts[c] || 0), 0);
  const grandTotal: DealerPerformanceRow = { dealer: "총합계", total: raw, counts: grandCounts };

  return { sourceSheet: DAILY_SHEET, columns, groups, grandTotal, raw };
}

//===============================================
// [DATA_USIM_DAILY_PERFORMANCE_RECONCILIATION_1 / DATA_USIM_CUMULATIVE_AND_DAILY_FIX_1]
//
// 데이터유심은 "■당일완료"/classifyReq() 체계가 아니라 전용 시트("데이터유심")라서
// computeDealerPerformanceMatrix() 자체(검증 완료, 위 함수는 이 작업에서 전혀 수정하지
// 않았다)에는 넣지 않는다. 대신 이미 계산된 matrix에 "데이터유심" 컬럼 하나를 순수하게
// 병합만 하는 함수를 추가한다 — dealerMatrix의 "당일" 모집단(오늘 하루)에는 당일 6건만
// 넣는다(누적 14는 여기 넣지 않는다 — 마감 공지텍스트 쪽에서만 쓰는 별도 숫자다).
//
// 병합 규칙:
// - "데이터유심" 컬럼은 항상 columns 배열의 가나다순 정렬 대상에서 제외하고 맨 끝에
//   고정한다(요청 사양: 상세표 가장 오른쪽 독립 컬럼).
// - 판매점명이 기존 dealerMatrix 행과 정확히 일치하면 그 행에 컬럼만 추가(총합계도 갱신).
// - 일치하는 행이 없으면(그날 모바일 개통 실적이 0인 판매점) 해당 그룹(extractGroup()
//   규칙 재사용, 그룹이 아예 없으면 새로 만듦) 안에 새 행을 만든다.
// - 판매점명이 비어있거나 ")" 접두어가 없으면 extractGroup()의 기존 UNGROUPED_LABEL
//   폴백을 그대로 써서 조용히 버리지 않고 노출한다(새 규칙 아님, 기존 폴백 재사용).
// - 그룹 소계/전체 총합계는 병합 후 다시 합산해서 만든다 — 기존 total(행 표시 컬럼 총합)
//   불변식을 유지한다. raw(기존 mobileCompleted.raw 대조용 검증 필드)는 건드리지 않는다.
//===============================================

export const DATA_USIM_COLUMN_LABEL = "데이터유심";

function emptyCounts(columns: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const col of columns) c[col] = 0;
  return c;
}

/** dealerMatrix에 "데이터유심" 컬럼(당일 건만)을 순수 병합한다 — computeDealerPerformanceMatrix() 자체는 무변경. */
export function mergeDataUsimIntoDealerMatrix(
  matrix: DealerPerformanceMatrix,
  breakdown: DataUsimDealerBreakdown,
): DealerPerformanceMatrix {
  const columns = [...matrix.columns, DATA_USIM_COLUMN_LABEL];

  // 그룹별 dealer -> row 맵으로 복제(기존 결과를 그대로 두고 새 구조를 만든다)
  const groupRowMaps = new Map<string, Map<string, DealerPerformanceRow>>();
  for (const g of matrix.groups) {
    const rowMap = new Map<string, DealerPerformanceRow>();
    for (const r of g.rows) {
      rowMap.set(r.dealer, { dealer: r.dealer, total: r.total, counts: { ...r.counts, [DATA_USIM_COLUMN_LABEL]: 0 } });
    }
    groupRowMaps.set(g.group, rowMap);
  }

  for (const { dealer, count } of breakdown.byDealer) {
    if (count <= 0) continue;
    const group = extractGroup(dealer);
    if (!groupRowMaps.has(group)) groupRowMaps.set(group, new Map());
    const rowMap = groupRowMaps.get(group)!;
    const existing = rowMap.get(dealer);
    if (existing) {
      existing.counts[DATA_USIM_COLUMN_LABEL] = (existing.counts[DATA_USIM_COLUMN_LABEL] || 0) + count;
      existing.total += count;
    } else {
      const counts = emptyCounts(matrix.columns);
      counts[DATA_USIM_COLUMN_LABEL] = count;
      rowMap.set(dealer, { dealer, total: count, counts });
    }
  }

  const groups: DealerPerformanceGroup[] = Array.from(groupRowMaps.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([group, rowMap]) => {
      const rows = Array.from(rowMap.values()).sort((a, b) => a.dealer.localeCompare(b.dealer, "ko"));
      const totalCounts: Record<string, number> = {};
      let total = 0;
      for (const c of columns) totalCounts[c] = rows.reduce((s, r) => s + (r.counts[c] || 0), 0);
      for (const r of rows) total += r.total;
      return { group, rows, totalRow: { dealer: "총합계", total, counts: totalCounts } };
    });

  const grandCounts: Record<string, number> = {};
  for (const c of columns) grandCounts[c] = groups.reduce((s, g) => s + (g.totalRow.counts[c] || 0), 0);
  const grandTotal: DealerPerformanceRow = {
    dealer: "총합계",
    total: groups.reduce((s, g) => s + g.totalRow.total, 0),
    counts: grandCounts,
  };

  return { sourceSheet: matrix.sourceSheet, columns, groups, grandTotal, raw: matrix.raw };
}
