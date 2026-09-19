// scripts/verify-network-official-totals.ts
//
// 작업명: MCC_NETWORK_CHANNEL_TOTAL_AND_PERSONAL_KPI_FINAL_REBUILD_1
//
// "왜 KT officialTotal이 이 숫자인가?"를 개발자가 즉시 재현/추적할 수 있게 하는
// 진단 스크립트. 핵심 검증 원칙: officialTotal은 "업무 채널(요청점 분류) 기준 전체
// 처리량"이며 작업자 prefix/performanceWorkerName mapping/roster 등록 여부와
// 완전히 무관해야 한다 — 이 스크립트는 그 원칙이 실제로 지켜지는지를
// "각 망의 raw 채널 전체 건수"와 "그 망을 처리한 모든 작업자별 건수의 합"이
// 정확히 같은지 비교해서 증명한다(차이=0이어야 정상).
//
// 계산 로직 자체는 새로 만들지 않는다 — server/lib/performance-calc.ts의
// matchesDate()/classifyReq()(둘 다 LOCK, import만)를 그대로 재사용한다.
//
// 실행: npx tsx --env-file=.env scripts/verify-network-official-totals.ts [YYYY-MM-DD 종료일]
// 인자 생략 시 이번 달 1일~오늘을 기본 조회 기간으로 사용한다.
//
// 개인정보(고객명 등)는 출력하지 않는다 — 작업자 label과 건수만 출력한다.

import { resolveActiveSpreadsheet } from "../server/lib/spreadsheet-resolver";
import { fetchSheetValuesById } from "../server/lib/google-sheets-client";
import { classifyReq, type Network } from "../server/lib/performance-classify";
import { matchesDate } from "../server/lib/performance-calc";

const NETWORKS: Network[] = ["SK", "KT", "LG", "TOSS"];

function parseArgDate(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`날짜 형식 오류(YYYY-MM-DD): ${v}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

interface Row {
  worker: string;
  net: Network;
  actNo: string;
}

async function loadSheetRows(spreadsheetId: string, sheetName: string): Promise<{
  header: string[];
  workerIdx: number;
  dateIdx: number;
  reqIdx: number;
  actNoIdx: number;
  rows: string[][];
} | null> {
  let values: string[][];
  try {
    values = await fetchSheetValuesById(spreadsheetId, sheetName);
  } catch {
    return null; // 해당 월 스프레드시트에 그 시트 탭이 없을 수 있음
  }
  const header = values[0] || [];
  const workerIdx = header.indexOf("작업자");
  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  const reqIdx = header.indexOf("요청점");
  const actNoIdx = header.findIndex((h) => h.includes("개통번호"));
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return { header, workerIdx, dateIdx, reqIdx, actNoIdx, rows };
}

function exactDateRowsFromSheet(
  sheet: NonNullable<Awaited<ReturnType<typeof loadSheetRows>>>,
  dates: Date[],
): Row[] {
  const out: Row[] = [];
  for (const d of dates) {
    for (const r of sheet.rows) {
      if (!matchesDate(r[sheet.dateIdx], d)) continue;
      const req = String(r[sheet.reqIdx] ?? "").trim();
      const worker = String(r[sheet.workerIdx] ?? "").trim();
      const actNo = sheet.actNoIdx >= 0 ? String(r[sheet.actNoIdx] ?? "").trim() : "";
      out.push({ worker, net: classifyReq(req).net, actNo });
    }
  }
  return out;
}

function networkTotals(rows: Row[]): Record<Network, number> {
  const t: Record<Network, number> = { SK: 0, KT: 0, LG: 0, TOSS: 0 };
  for (const r of rows) t[r.net]++;
  return t;
}

function workerSumsByNetwork(rows: Row[], net: Network): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.net !== net) continue;
    const label = r.worker || "(빈 작업자)";
    m.set(label, (m.get(label) || 0) + 1);
  }
  return m;
}

function printBreakdown(label: string, rows: Row[], officialTotal: Record<Network, number>) {
  console.log(`\n--- ${label}: 망별 raw vs worker-sum 대조 ---`);
  for (const net of NETWORKS) {
    const wb = workerSumsByNetwork(rows, net);
    const sum = Array.from(wb.values()).reduce((a, b) => a + b, 0);
    const diff = officialTotal[net] - sum;
    const workers = Array.from(wb.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([w, c]) => `${w}=${c}`)
      .join(", ");
    console.log(`  [${net}] officialTotal=${officialTotal[net]}  worker합계=${sum}  차이=${diff}${diff !== 0 ? "  ⚠ 불일치!" : ""}`);
    console.log(`         작업자별: ${workers || "(없음)"}`);
  }
}

async function main() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = parseArgDate(process.argv[2], today);
  const dates: Date[] = [];
  for (let d = new Date(monthStart); d <= endDate; d.setDate(d.getDate() + 1)) dates.push(new Date(d));

  const resolved = await resolveActiveSpreadsheet(endDate);
  console.log(`=== 검증 대상: ${resolved.name ?? ""} (${resolved.id}) ===`);
  console.log(`조회 기간: 이번 달 1일 ~ ${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`);

  // ── [ACTIVATION] 개통처리부(과거) + ■당일완료(오늘) ─────────────────────
  console.log("\n\n########## [ACTIVATION] ##########");
  const master = await loadSheetRows(resolved.id, "개통처리부");
  const live = await loadSheetRows(resolved.id, "■당일완료");
  const masterRows = master ? exactDateRowsFromSheet(master, dates) : [];
  const liveRows = live ? exactDateRowsFromSheet(live, dates) : [];
  const actAllRows = [...masterRows, ...liveRows];
  const actTotals = networkTotals(actAllRows);
  console.log("[개통처리부(과거) 망별]", networkTotals(masterRows));
  console.log("[■당일완료(오늘) 망별]", networkTotals(liveRows));
  console.log("[activation officialTotal(최종, 망별)]", actTotals);
  printBreakdown("ACTIVATION", actAllRows, actTotals);

  // ── [CHANGE] ■변경완료 + 00700결합 ───────────────────────────────────
  console.log("\n\n########## [CHANGE] ##########");
  const change = await loadSheetRows(resolved.id, "■변경완료");
  const combine = await loadSheetRows(resolved.id, "00700결합");
  const changeRows = change ? exactDateRowsFromSheet(change, dates) : [];
  const combineRows = combine ? exactDateRowsFromSheet(combine, dates) : [];

  const changeActNos = new Set(changeRows.map((r) => r.actNo).filter(Boolean));
  const combineActNos = new Set(combineRows.map((r) => r.actNo).filter(Boolean));
  let overlap = 0;
  for (const n of combineActNos) if (changeActNos.has(n)) overlap++;
  console.log("[■변경완료 vs 00700결합 개통번호 교집합(중복 방지 확인, 0이어야 정상)]", overlap);

  const chgAllRows = [...changeRows, ...combineRows];
  const chgTotals = networkTotals(chgAllRows);
  console.log("[■변경완료 망별]", networkTotals(changeRows));
  console.log("[00700결합 망별]", networkTotals(combineRows));
  console.log("[change officialTotal(최종, 망별)]", chgTotals);
  printBreakdown("CHANGE", chgAllRows, chgTotals);

  console.log("\n=== 완료 ===");
  console.log("모든 [차이]가 0이면: officialTotal이 작업자와 무관하게 채널 전체를 정확히 반영하고 있다는 뜻입니다.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
