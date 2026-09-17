// scripts/test-spreadsheet-auto-route.ts
//
// 작업명: MCC_INTERNET_RULE_AND_MONTHLY_SHEET_AUTO_ROUTING_1
//
// GOOGLE_SHEETS_AUTO_ROUTE=true 상태에서 spreadsheet-resolver가
// 실제로 "★개통현황_N월YY년"을 Drive에서 찾을 수 있는지 확인하는 1회성 테스트.
// .env의 기본값(false)은 건드리지 않고, 이 스크립트를 실행할 때만
// 환경변수를 오버라이드해서 테스트한다.
//
// 실행:
//   GOOGLE_SHEETS_AUTO_ROUTE=true npx tsx --env-file=.env scripts/test-spreadsheet-auto-route.ts

import { resolveActiveSpreadsheet, buildExpectedFileName } from "../server/lib/spreadsheet-resolver";

async function main() {
  const now = new Date();
  console.log(`오늘 날짜 기준 예상 파일명: ${buildExpectedFileName(now)}`);
  console.log(`GOOGLE_SHEETS_AUTO_ROUTE=${process.env.GOOGLE_SHEETS_AUTO_ROUTE}`);
  console.log(`GOOGLE_DRIVE_FOLDER_ID=${process.env.GOOGLE_DRIVE_FOLDER_ID || "(비어있음 — 전체 범위 검색)"}`);

  try {
    const result = await resolveActiveSpreadsheet(now, { force: true });
    console.log("\n✅ 자동 탐색 성공:");
    console.log(`  spreadsheetId: ${result.id}`);
    console.log(`  fileName: ${result.name}`);
    console.log(`  targetYearMonth: ${result.targetYearMonth}`);
    console.log(`  resolvedVia: ${result.resolvedVia}`);
  } catch (err: any) {
    console.error("\n❌ 자동 탐색 실패:");
    console.error(err.message);
    process.exit(1);
  }
}

main();
