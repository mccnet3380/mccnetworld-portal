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
// mobileCompleted가 읽는 것과 동일한 "■당일완료" 시트를 동일한 날짜 조건으로 다시 읽는다
// (performance-calc.ts의 loadClassifiedRows/matchesDate는 export되지 않아 재사용할 수 없고
// 수정도 금지된 파일이라, 동일 로직을 이 파일 안에 그대로 복제했다 — 새 규칙이 아니라 기존
// 규칙의 재사용이다).

import { fetchSheetValues } from "./google-sheets-client";
import { classifyReq } from "./performance-classify";

const DAILY_SHEET = "■당일완료";
const UNGROUPED_LABEL = "(판매점 미기재)";

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDateLabel(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** performance-calc.ts의 matchesDate()와 동일한 로직(그 파일은 export하지 않아 복제) */
function matchesDate(cell: string, date: Date): boolean {
  const s = String(cell ?? "").trim();
  if (!s) return false;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const variants = [
    `${m}/${d}`,
    `${two(m)}/${two(d)}`,
    `${m}.${d}`,
    formatDateLabel(date),
    formatDateLabel(date).replace(/-/g, "."),
    formatDateLabel(date).replace(/-/g, "/"),
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
