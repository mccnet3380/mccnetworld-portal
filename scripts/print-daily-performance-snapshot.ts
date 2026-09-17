// scripts/print-daily-performance-snapshot.ts
//
// 작업명: MCC_DAILY_COMPLETION_NETWORK_TOTAL_CONFIRMED_1
//
// performance-calc.ts의 computeDailyPerformanceSnapshot()이 기존에 확정된
// 통신망별 합계(■당일완료 SK49/KT122/LG125/TOSS3, 기타업무 SK48/KT116/LG142)를
// 그대로 재현하는지 회귀 확인하는 스크립트.
//
// 실행: npx tsx --env-file=.env scripts/print-daily-performance-snapshot.ts [YYYY-MM-DD]

import { computeDailyPerformanceSnapshot } from "../server/lib/performance-calc";

const EXPECTED = {
  mobileCompleted: { SK: 49, KT: 122, LG: 125, TOSS: 3, 합계: 299 },
  otherDuty: { SK: 48, KT: 116, LG: 142, TOSS: 0, 합계: 306 },
};

function printBlock(title: string, block: any, expected?: Record<string, number>) {
  console.log(`\n--- ${title} (원본: ${block.sourceSheets.join(", ")}) ---`);
  console.log(`  원본 건수: ${block.raw}`);
  console.log(`  networkTotalsVerified: ${block.networkTotalsVerified}`);
  for (const net of ["SK", "KT", "LG", "TOSS"]) {
    const actual = block.totals[net];
    const exp = expected?.[net];
    const mark = exp === undefined ? "" : actual === exp ? " ✅" : ` ❌ (기대 ${exp})`;
    console.log(`  ${net}: ${actual}${mark}`);
  }
  const totalMark = expected ? (block.totals.합계 === expected.합계 ? " ✅" : ` ❌ (기대 ${expected.합계})`) : "";
  console.log(`  합계: ${block.totals.합계}${totalMark}`);
}

async function main() {
  const arg = process.argv[2];
  const date = arg ? new Date(arg) : new Date("2026-09-16");

  const snapshot = await computeDailyPerformanceSnapshot(date);
  console.log(`날짜: ${snapshot.date}`);

  printBlock("당일완료(모바일)", snapshot.mobileCompleted, EXPECTED.mobileCompleted);
  printBlock("기타업무", snapshot.otherDuty, EXPECTED.otherDuty);

  console.log(`\ninternet: ${snapshot.internet === null ? "null (TODO — 유선 구조 분석 전)" : "구현됨"}`);
  console.log(`cumulative: ${snapshot.cumulative === null ? "null (TODO — 누적 규칙 미확인)" : "구현됨"}`);
  console.log(`noticeText: ${snapshot.noticeText === null ? "null (TODO)" : "구현됨"}`);
}

main().catch((err) => {
  console.error("스냅샷 출력 오류:", err);
  process.exit(1);
});
