// scripts/inspect-internet-sheets.ts
//
// 작업명: MCC_DAILY_COMPLETION_NETWORK_TOTAL_CONFIRMED_1 (유선 분석 단계)
//
// 목적: 유선(인터넷) 관련 5개 시트의 실제 컬럼 구조/행수/샘플을 확인.
// 계산 공식을 만들지 않고 관찰만 한다. ("인터넷 요약", "인터넷 작업자별 당일"을
// 기존 Excel이 어떻게 만드는지는 이 결과를 보고 사용자와 함께 분석한다)
//
// 실행: npx tsx --env-file=.env scripts/inspect-internet-sheets.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";

const SHEETS = [
  "인터넷접수",
  "인터넷진행",
  "인터넷이월",
  "인터넷완료(9월접수,9월개통)",
  "인터넷이월완료(8월접수,9월개통)",
];

async function inspect(sheetName: string) {
  console.log("\n" + "=".repeat(72));
  console.log(`시트: ${sheetName}`);
  console.log("=".repeat(72));

  let values: string[][];
  try {
    values = await fetchSheetValues(sheetName);
  } catch (err) {
    console.log(`  ⚠️ 조회 실패: ${err}`);
    return;
  }

  if (values.length === 0) {
    console.log("  (빈 시트이거나 조회 결과 없음)");
    return;
  }

  const header = values[0];
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  console.log(`  헤더(${header.length}열):`);
  header.forEach((h, i) => console.log(`    [${i}] ${h}`));
  console.log(`  전체 데이터 행수: ${rows.length}`);

  console.log(`  샘플 5건 (값 있는 컬럼만):`);
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`   #${i + 1}:`);
    header.forEach((h, ci) => {
      const v = r[ci];
      if (v !== undefined && String(v).trim() !== "") console.log(`      ${h}: ${v}`);
    });
  });
}

async function main() {
  for (const sheet of SHEETS) {
    await inspect(sheet);
  }
}

main().catch((err) => {
  console.error("진단 스크립트 오류:", err);
  process.exit(1);
});
