// scripts/verify-performance-20260916.ts
//
// 작업명: MCC_PERFORMANCE_CLOSING_LIVE_INTEGRATION_1
//
// 목적:
// 1) Google Sheets 서버 연결이 실제로 되는지 확인
// 2) 2026-09-16 기준 원본 데이터 검증
//    - ■변경완료 개통일 9/16 = 236건 (기대값)
//    - 00700결합 9/16 = 2건 (기대값)
//
// 이 스크립트는 "기존 Excel 최종 실적"을 재현하는 것이 아니라,
// Google Sheets 원본 행을 정상적으로 읽고 있는지를 확인하는 1차 검증 도구다.
// (기타업무/누적/유선 계산 로직은 이후 단계에서 별도로 확정한다)
//
// 실행:
//   npx tsx --env-file=.env scripts/verify-performance-20260916.ts
// 또는:
//   npm run verify:performance-0916

import {
  fetchSheetValues,
  listSpreadsheetSheetNames,
  getGoogleSheetsConfigStatus,
} from "../server/lib/google-sheets-client";

const TARGET_YEAR = 2026;
const TARGET_MONTH_INDEX = 8; // 0-indexed → 9월
const TARGET_DAY = 16;
const TARGET_LABEL = "2026-09-16";
const TARGET_TEXT_VARIANTS = ["9/16", "09/16", "9.16", "2026-09-16", "2026.09.16", "2026/09/16"];

const EXPECTED: Record<string, number> = {
  "■변경완료": 236,
  "00700결합": 2,
};

const DATE_COLUMN_KEYWORDS = ["개통일", "개통일자", "처리일", "완료일", "일자"];

function matchesTargetDate(cell: string): boolean {
  const s = String(cell ?? "").trim();
  if (!s) return false;

  if (TARGET_TEXT_VARIANTS.some((v) => s === v || s.startsWith(v))) return true;

  // 엑셀 시리얼 넘버 형태(UNFORMATTED_VALUE인데 날짜서식이 아닌 셀일 경우)는 건너뜀
  if (/^\d+$/.test(s)) return false;

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return (
      parsed.getFullYear() === TARGET_YEAR &&
      parsed.getMonth() === TARGET_MONTH_INDEX &&
      parsed.getDate() === TARGET_DAY
    );
  }
  return false;
}

function findColumnIndex(header: string[], keywords: string[]): number {
  return header.findIndex((h) => keywords.some((k) => String(h ?? "").includes(k)));
}

interface InspectResult {
  sheetName: string;
  headerRow: string[];
  totalRows: number;
  dateColIndex: number;
  matchedCount: number;
  sampleMatched: string[][];
}

async function inspectSheet(actualSheetName: string): Promise<InspectResult> {
  console.log(`\n--- 시트: ${actualSheetName} ---`);
  const values = await fetchSheetValues(actualSheetName);

  if (values.length === 0) {
    console.log("  ⚠️ 조회 결과가 비어 있습니다 (빈 시트이거나 범위 문제).");
    return { sheetName: actualSheetName, headerRow: [], totalRows: 0, dateColIndex: -1, matchedCount: 0, sampleMatched: [] };
  }

  const headerRow = values[0];
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  console.log(`  헤더(${headerRow.length}열): ${headerRow.join(" | ")}`);
  console.log(`  전체 데이터 행수(빈 행 제외): ${rows.length}`);

  const dateColIndex = findColumnIndex(headerRow, DATE_COLUMN_KEYWORDS);
  console.log(
    `  날짜 컬럼 추정: index=${dateColIndex} ${dateColIndex >= 0 ? `("${headerRow[dateColIndex]}")` : "(자동으로 찾지 못함 — 헤더 목록을 보고 수동 확인 필요)"}`,
  );

  let matchedCount = 0;
  const sampleMatched: string[][] = [];

  if (dateColIndex >= 0) {
    for (const row of rows) {
      if (matchesTargetDate(row[dateColIndex])) {
        matchedCount++;
        if (sampleMatched.length < 5) sampleMatched.push(row);
      }
    }
  }

  console.log(`  ${TARGET_LABEL} 매칭 행수: ${matchedCount}`);
  if (sampleMatched.length > 0) {
    console.log(`  샘플(최대 5건, 앞 8열만 표시):`);
    for (const r of sampleMatched) {
      console.log(`    ${r.slice(0, 8).join(" | ")}`);
    }
  }

  return { sheetName: actualSheetName, headerRow, totalRows: rows.length, dateColIndex, matchedCount, sampleMatched };
}

async function main() {
  const status = getGoogleSheetsConfigStatus();
  if (!status.configured) {
    console.error("=".repeat(72));
    console.error("❌ Google Sheets 인증정보가 설정되지 않았습니다.");
    console.error(`   누락된 환경변수: ${status.missing.join(", ")}`);
    console.error("   설정 절차는 server/lib/google-sheets-client.ts 상단 주석을 참고하세요.");
    console.error("=".repeat(72));
    process.exit(1);
  }

  console.log("Google Sheets 연결 시도 중...");
  let sheetNames: string[];
  try {
    sheetNames = await listSpreadsheetSheetNames();
  } catch (err) {
    console.error("❌ 스프레드시트 연결 실패:", err);
    console.error("   - 서비스 계정 이메일이 해당 스프레드시트에 '뷰어'로 공유되어 있는지 확인하세요.");
    console.error("   - GOOGLE_SHEETS_SPREADSHEET_ID 값이 올바른지 확인하세요.");
    process.exit(1);
    return;
  }

  console.log(`✅ 연결 성공. 시트(탭) 개수: ${sheetNames.length}`);
  sheetNames.forEach((n) => console.log(`  - ${n}`));

  const results: Record<string, InspectResult> = {};
  for (const targetName of Object.keys(EXPECTED)) {
    const found =
      sheetNames.find((n) => n === targetName) ||
      sheetNames.find((n) => n.replace(/\s/g, "") === targetName.replace(/\s/g, ""));

    if (!found) {
      console.log(`\n--- 시트: ${targetName} ---`);
      console.log(`  ⚠️ 스프레드시트에서 이 이름의 시트를 찾지 못했습니다. 위 시트 목록에서 실제 이름을 확인하세요.`);
      continue;
    }
    results[targetName] = await inspectSheet(found);
  }

  console.log("\n" + "=".repeat(72));
  console.log(`검증 결과 요약 (기준일: ${TARGET_LABEL})`);
  console.log("-".repeat(72));
  let allMatched = true;
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const actual = results[name]?.matchedCount;
    const ok = actual === expected;
    if (!ok) allMatched = false;
    console.log(
      `  ${name}: 기대값=${expected}건, 실측값=${actual ?? "조회 실패"}건  ${ok ? "✅ 일치" : "❌ 불일치"}`,
    );
  }
  console.log("=".repeat(72));

  if (!allMatched) {
    console.log(
      "\n불일치 시 확인할 것: 날짜 컬럼 자동 인식이 맞는지, 헤더 이름이 위 목록과 다른지, " +
        "시트 안에 병합 셀/필터/숨김 행이 있는지 등을 위 헤더/샘플 출력으로 먼저 확인하세요.",
    );
  }
}

main().catch((err) => {
  console.error("검증 스크립트 실행 중 오류:", err);
  process.exit(1);
});
