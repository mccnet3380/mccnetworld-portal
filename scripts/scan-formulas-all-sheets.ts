// scripts/scan-formulas-all-sheets.ts
//
// 작업명: MCC_INTERNET_EXISTING_EXCEL_RULE_TRACE_1
//
// 목적: 스프레드시트 25개 시트 전체를 훑어서 "수식이 있는 셀"이 있는 시트를 찾는다.
// "인터넷 요약"/누적/당일 계산이 이 스프레드시트 안 어딘가(수식)에 이미 존재하는지
// 확인하기 위한 1차 스캔. 계산 로직을 만들지 않고 관찰만 한다.
//
// 실행: npx tsx --env-file=.env scripts/scan-formulas-all-sheets.ts

import { fetchSheetFormulas, listSpreadsheetSheetNames } from "../server/lib/google-sheets-client";

async function main() {
  const sheetNames = await listSpreadsheetSheetNames();
  console.log(`총 ${sheetNames.length}개 시트 스캔 시작 (각 시트 A1:T30 범위)\n`);

  for (const name of sheetNames) {
    try {
      const values = await fetchSheetFormulas(name, "A1:T30");
      let formulaCount = 0;
      const formulaSamples: string[] = [];
      for (const row of values) {
        for (const cell of row) {
          if (typeof cell === "string" && cell.startsWith("=")) {
            formulaCount++;
            if (formulaSamples.length < 5) formulaSamples.push(cell);
          }
        }
      }
      if (formulaCount > 0) {
        console.log(`📐 [${name}] 수식 셀 ${formulaCount}개 발견`);
        formulaSamples.forEach((f) => console.log(`      ${f}`));
      } else {
        console.log(`   [${name}] 수식 없음 (일반 데이터 시트로 보임)`);
      }
    } catch (err: any) {
      console.log(`   [${name}] 조회 실패: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error("스캔 오류:", err);
  process.exit(1);
});
