// scripts/inspect-performance-columns.ts
//
// 작업명: MCC_PERFORMANCE_CLOSING_LIVE_INTEGRATION_1
//
// 목적: ■변경완료/00700결합 9/16 원본이 236/2와 다르게 나온 원인을 찾기 위한
// 1회성 진단 스크립트. 컬럼별 값 분포를 덤프해서 "포함/제외 규칙"의 단서를 찾는다.
// 계산 로직을 확정하지 않고 관찰만 한다.
//
// 실행: npx tsx --env-file=.env scripts/inspect-performance-columns.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";

const TARGET_TEXT_VARIANTS = ["9/16", "09/16", "9.16"];

function isTargetDate(cell: string): boolean {
  const s = String(cell ?? "").trim();
  return TARGET_TEXT_VARIANTS.some((v) => s === v || s.startsWith(v));
}

function countBy(rows: string[][], colIndex: number): Map<string, number> {
  const m = new Map<string, number>();
  if (colIndex < 0) return m;
  for (const r of rows) {
    const v = String(r[colIndex] ?? "").trim() || "(공백)";
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function printDist(title: string, m: Map<string, number>) {
  console.log(`  [${title}] 고유값 ${m.size}개`);
  const sorted = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted.slice(0, 40)) {
    console.log(`    ${v.toString().padStart(4)}건  "${k}"`);
  }
  if (sorted.length > 40) console.log(`    ... 외 ${sorted.length - 40}개`);
}

async function inspect(sheetName: string) {
  console.log("\n" + "=".repeat(72));
  console.log(`시트: ${sheetName}`);
  console.log("=".repeat(72));
  const values = await fetchSheetValues(sheetName);
  const header = values[0];
  const allRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  header.forEach((h, i) => console.log(`  [${i}] ${h}`));

  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  const rows916 = allRows.filter((r) => isTargetDate(r[dateIdx]));
  console.log(`\n9/16 매칭 행수: ${rows916.length}`);

  const colsToCheck = ["요청점", "중복값", "업무 처리 유형", "고객유형", "유형", "코드"];
  for (const colName of colsToCheck) {
    const idx = header.indexOf(colName);
    if (idx < 0) {
      console.log(`\n  (컬럼 "${colName}" 없음)`);
      continue;
    }
    console.log("");
    printDist(colName, countBy(rows916, idx));
  }

  // 전체 행 원본을 그대로 몇 건 출력 (모든 컬럼)
  console.log(`\n9/16 원본 샘플 10건 (전체 컬럼):`);
  rows916.slice(0, 10).forEach((r, i) => {
    console.log(`  #${i + 1}:`);
    header.forEach((h, ci) => {
      const v = r[ci];
      if (v !== undefined && String(v).trim() !== "") {
        console.log(`     ${h}: ${v}`);
      }
    });
  });
}

async function main() {
  await inspect("■변경완료");
  await inspect("00700결합");
}

main().catch((err) => {
  console.error("진단 스크립트 오류:", err);
  process.exit(1);
});
