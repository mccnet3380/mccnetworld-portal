/**
 * MCC_POLICY_SPLIT_ENGINE_1
 * 원본 MCC 정책 통합본 엑셀 → 채널별 xlsx 파일 분리
 *
 * 실행: npx tsx scripts/split-mcc-policy-excel.ts [입력파일경로]
 * 출력: output/mcc_policy_split/*.xlsx
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  splitPolicyExcelFromBuffer,
  buildSplitXlsxBuffers,
  EXPECTED_FILES,
  TARGET_SHEETS,
} from '../server/lib/mcc-policy-split';

const INPUT_FILE =
  process.argv[2] ??
  'C:\\Users\\admin1000\\Desktop\\카톡\\■MCC정책_통합본_8월 8차(24일~)_유선_8월_20차(21일12시~) 송부용.xlsx';

const OUT_DIR = path.join(process.cwd(), 'output', 'mcc_policy_split');

function main() {
  console.log('\n🔄 MCC_POLICY_SPLIT_ENGINE_1');
  console.log(`   입력: ${INPUT_FILE}`);
  console.log(`   출력: ${OUT_DIR}\n`);

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ 입력 파일 없음: ${INPUT_FILE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buf = fs.readFileSync(INPUT_FILE);
  const srcFn = path.basename(INPUT_FILE);

  const splitResult = splitPolicyExcelFromBuffer(buf, srcFn);
  const { fileMap, warnings, sheetsAnalyzed, sheetsSkipped } = splitResult;

  // 진행 상황 출력
  for (const sheetName of TARGET_SHEETS) {
    if (sheetsSkipped.includes(sheetName)) {
      console.log(`⚠️  시트 없음 — 건너뜀: ${sheetName}`);
    } else {
      console.log(`✅ 시트 처리: ${sheetName}`);
    }
  }
  for (const w of warnings) console.log(`  ⚠️  ${w}`);

  // 파일 저장
  const buffers = buildSplitXlsxBuffers(splitResult);
  type FileSummary = { file: string; sheets: { name: string; rows: number }[] };
  const summaries: FileSummary[] = [];

  for (const [fileName, termMap] of fileMap.entries()) {
    const buf = buffers.get(fileName);
    if (!buf) continue;
    fs.writeFileSync(path.join(OUT_DIR, fileName), buf);

    const summary: FileSummary = { file: fileName, sheets: [] };
    for (const [term, { ok, review }] of termMap.entries()) {
      summary.sheets.push({ name: term, rows: ok.length });
      if (review.length > 0) summary.sheets.push({ name: '검토필요', rows: review.length });
    }
    summaries.push(summary);
  }

  // 완료 리포트
  console.log('\n\n══════════════════════════════════════════════');
  console.log('✅ 완료 리포트');
  console.log('══════════════════════════════════════════════');

  let totalOk = 0, totalReview = 0;
  for (const s of summaries) {
    console.log(`\n📁 ${s.file}`);
    for (const sh of s.sheets) {
      const icon = sh.name === '검토필요' ? '  [검토필요]' : '  ├─';
      console.log(`${icon} ${sh.name.padEnd(22)} ${sh.rows}행`);
      if (sh.name === '검토필요') totalReview += sh.rows;
      else totalOk += sh.rows;
    }
  }

  const missingFiles = EXPECTED_FILES.filter(f => !fileMap.has(f));
  console.log(`\n  생성 파일   : ${summaries.length}개`);
  console.log(`  자동인식 행 : ${totalOk}행`);
  console.log(`  검토필요 행 : ${totalReview}행`);
  if (missingFiles.length > 0) console.log(`\n  ⚠️  미생성 파일 (블록 없음): ${missingFiles.join(', ')}`);
  if (sheetsSkipped.length > 0) console.log(`  ❌ 시트 미존재: ${sheetsSkipped.join(', ')}`);
  console.log(`\n[출력 위치] ${OUT_DIR}`);
}

main();
