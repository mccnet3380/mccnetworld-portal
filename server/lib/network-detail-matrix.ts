// server/lib/network-detail-matrix.ts
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
//
// "전사 공지용 당일실적"(performance.html, MCC 업무지원 라우팅 허브의 routes.daily가
// performance.html을 직접 가리킴 — index.html 참고)의 KT/LG/SK "개통 현황"(당일완료)/
// "기타 현황"(변경완료+00700결합) 작업자×업무유형 상세표 집계.
//
// 업무유형 컬럼 목록은 performance.html의 실제 JS 상수 ACT_HEADERS/EXTRA_HEADERS를
// 그대로 가져왔다(추측 아님, 원본 그대로):
//   ACT_HEADERS.KT  = ['작업자','당일총합계','기여도','단말)KTM','후불)엠모바일','후불)카카오KT','후불)중고KT','후불)스카이','선불)코드','단말)KT']
//   ACT_HEADERS.LG  = ['작업자','당일총합계','기여도','단말)미디어','후불)미디어','후불)헬로','후불)프리티LG','선불)밸류컴','선불)프리티LG']
//   ACT_HEADERS.SK  = ['작업자','당일총합계','기여도','후불)텔링크','후불)카카오SK','후불)프리티SK','후불)중고SK','선불)프리티SK']
//   ACT_HEADERS.TOSS= ['작업자','당일총합계','선불)스마텔']
//   EXTRA_HEADERS.KT= ['작업자','합계','기타-K','기타)엠모바일','기타)카카오KT','기타)스카이','기타-코드K','기타)중고KT','유심-K']
//   EXTRA_HEADERS.LG= ['작업자','합계','기타-L','기타)미디어','기타)헬로','기타)프리티LG','기타)밸류컴','유심-L']
//   EXTRA_HEADERS.SK= ['작업자','합계','기타-S','기타)텔링크','00700','기타-프리S','유심-S']
//
// 기여도 = performance.html의 renderTable() 그대로: 이 표(네트워크) 안에서
// (작업자의 당일총합계) ÷ (표 전체 합계) × 100.
//
// classifyReq()(performance-classify.ts, 무변경)를 그대로 재사용한다. 날짜/컬럼 탐색은
// performance-calc.ts의 loadClassifiedRows와 동일한 규칙을 복제했다(그 파일은 export하지
// 않고 수정 금지라서 재사용 불가 — 새 규칙이 아니라 기존 규칙의 재사용).

import { fetchSheetValues } from "./google-sheets-client";
import { classifyReq, type Network } from "./performance-classify";

export const ACT_COLUMNS: Record<Network, string[]> = {
  KT: ["단말)KTM", "후불)엠모바일", "후불)카카오KT", "후불)중고KT", "후불)스카이", "선불)코드", "단말)KT"],
  LG: ["단말)미디어", "후불)미디어", "후불)헬로", "후불)프리티LG", "선불)밸류컴", "선불)프리티LG"],
  SK: ["후불)텔링크", "후불)카카오SK", "후불)프리티SK", "후불)중고SK", "선불)프리티SK"],
  TOSS: ["선불)스마텔"],
};

export const EXTRA_COLUMNS: Record<"KT" | "LG" | "SK", string[]> = {
  KT: ["기타-K", "기타)엠모바일", "기타)카카오KT", "기타)스카이", "기타-코드K", "기타)중고KT", "유심-K"],
  LG: ["기타-L", "기타)미디어", "기타)헬로", "기타)프리티LG", "기타)밸류컴", "유심-L"],
  SK: ["기타-S", "기타)텔링크", "00700", "기타-프리S", "유심-S"],
};

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function formatDateLabel(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
/** performance-calc.ts의 matchesDate()와 동일 로직(그 파일은 export하지 않아 복제) */
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
    return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate();
  }
  return false;
}

interface Row {
  worker: string;
  net: Network;
  cat: string;
}

async function loadRows(sheetNames: string[], date: Date): Promise<Row[]> {
  const out: Row[] = [];
  for (const sheetName of sheetNames) {
    const values = await fetchSheetValues(sheetName);
    if (values.length === 0) continue;
    const header = values[0];
    const workerIdx = header.indexOf("작업자");
    const dateIdx = header.findIndex((h) => h.includes("개통일"));
    const reqIdx = header.indexOf("요청점");
    if (workerIdx < 0 || dateIdx < 0 || reqIdx < 0) {
      throw new Error(`[NetworkDetailMatrix] "${sheetName}" 시트에서 필수 컬럼(작업자/개통일/요청점)을 찾지 못했습니다. 헤더: ${header.join(", ")}`);
    }
    const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    for (const r of rows) {
      if (!matchesDate(r[dateIdx], date)) continue;
      const requestPoint = String(r[reqIdx] ?? "").trim();
      if (!requestPoint) continue;
      const worker = String(r[workerIdx] ?? "").trim();
      const c = classifyReq(requestPoint);
      out.push({ worker, net: c.net, cat: c.cat });
    }
  }
  return out;
}

export interface DetailWorkerRow {
  worker: string;
  total: number;
  contribution: number; // % (이 표 전체 합계 대비)
  categories: Record<string, number>;
}

export interface NetworkDetailTable {
  columns: string[];
  rows: DetailWorkerRow[];
  total: number;
}

function buildTable(rows: Row[], net: Network, columns: string[]): NetworkDetailTable {
  const byWorker = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (r.net !== net) continue;
    if (!byWorker.has(r.worker)) byWorker.set(r.worker, {});
    const rec = byWorker.get(r.worker)!;
    rec[r.cat] = (rec[r.cat] || 0) + 1;
  }

  const rowsOut: DetailWorkerRow[] = [];
  let grandTotal = 0;
  for (const [worker, cats] of Array.from(byWorker.entries())) {
    const total = Object.values(cats).reduce((s, n) => s + n, 0);
    if (total === 0) continue;
    grandTotal += total;
    rowsOut.push({ worker, total, contribution: 0, categories: cats });
  }
  rowsOut.forEach((r) => {
    r.contribution = grandTotal > 0 ? Math.round((r.total / grandTotal) * 1000) / 10 : 0;
  });
  rowsOut.sort((a, b) => b.total - a.total || a.worker.localeCompare(b.worker, "ko"));

  return { columns, rows: rowsOut, total: grandTotal };
}

export interface NetworkDetailMatrix {
  activation: Record<Network, NetworkDetailTable>;
  extra: Record<"KT" | "LG" | "SK", NetworkDetailTable>;
}

/** performance.html의 "KT/LG/SK 개통 현황"(당일완료) + "KT/LG/SK 기타 현황"(변경완료+00700결합) 재현 */
export async function computeNetworkDetailMatrix(date: Date): Promise<NetworkDetailMatrix> {
  const [activationRows, extraRows] = await Promise.all([
    loadRows(["■당일완료"], date),
    loadRows(["■변경완료", "00700결합"], date),
  ]);

  return {
    activation: {
      KT: buildTable(activationRows, "KT", ACT_COLUMNS.KT),
      LG: buildTable(activationRows, "LG", ACT_COLUMNS.LG),
      SK: buildTable(activationRows, "SK", ACT_COLUMNS.SK),
      TOSS: buildTable(activationRows, "TOSS", ACT_COLUMNS.TOSS),
    },
    extra: {
      KT: buildTable(extraRows, "KT", EXTRA_COLUMNS.KT),
      LG: buildTable(extraRows, "LG", EXTRA_COLUMNS.LG),
      SK: buildTable(extraRows, "SK", EXTRA_COLUMNS.SK),
    },
  };
}
