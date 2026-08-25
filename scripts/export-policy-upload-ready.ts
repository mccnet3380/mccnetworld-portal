/**
 * MCC_POLICY_UPLOAD_READY_EXPORT_1
 * 채널별 정책 파일(split 결과) → 기존 정산 정책 업로드 10컬럼 양식 변환
 *
 * 실행: npx tsx scripts/export-policy-upload-ready.ts
 * 입력: output/mcc_policy_split/*.xlsx
 * 출력: output/mcc_policy_upload_ready/*_upload.xlsx
 */

import { read, utils, writeFile } from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const SPLIT_DIR  = path.join(process.cwd(), 'output', 'mcc_policy_split');
const OUT_DIR    = path.join(process.cwd(), 'output', 'mcc_policy_upload_ready');

const UPLOAD_HEADERS = [
  '채널', '요금제',
  '내국인_신규', '내국인_번이', '외국인_신규', '외국인_번이',
  '결합조건', '부가서비스조건', '가입비조건', '메모',
];

const GUIDE_ROW1 = [
  '※ 금액 단위: 만원 소수점 (10.0 = 100,000원 / 14.5 = 145,000원)',
  '', '', '', '', '', '', '', '', '',
];
const GUIDE_ROW2 = [
  '※ 빈 금액 셀 = 해당 유형 정책행 미생성 / 빈 조건 셀 = wildcard(모든 조건 적용)',
  '', '', '', '', '', '', '', '', '',
];

const COL_WIDTHS = [
  { wch: 22 }, { wch: 50 },
  { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 35 },
];

type AnyRow = (string | number | null | undefined)[];

// split 결과 21컬럼 → upload 10컬럼 매핑 인덱스
const IDX = {
  channel:   1,   // 시스템채널 → 채널
  plan:      7,   // 요금제
  domNew:    8,   // 내국인_신규
  domMnp:    9,   // 내국인_번이
  forNew:    10,  // 외국인_신규
  forMnp:    11,  // 외국인_번이
  combo:     12,  // 결합조건
  addon:     13,  // 부가서비스조건
  joinFee:   14,  // 가입비조건
  note:      15,  // 비고 → 메모
} as const;

function convertToUploadRows(dataRows: AnyRow[]): any[][] {
  const result: any[][] = [];
  for (const r of dataRows) {
    const plan = r[IDX.plan];
    if (!plan || String(plan).trim() === '') continue;
    result.push([
      r[IDX.channel]  ?? '', plan,
      r[IDX.domNew]   ?? '', r[IDX.domMnp]  ?? '',
      r[IDX.forNew]   ?? '', r[IDX.forMnp]  ?? '',
      r[IDX.combo]    ?? '', r[IDX.addon]   ?? '',
      r[IDX.joinFee]  ?? '', r[IDX.note]    ?? '',
    ]);
  }
  return result;
}

function makeUploadSheet(uploadRows: any[][]): ReturnType<typeof utils.aoa_to_sheet> {
  const aoa = [UPLOAD_HEADERS, GUIDE_ROW1, GUIDE_ROW2, ...uploadRows];
  const ws  = utils.aoa_to_sheet(aoa);
  ws['!cols'] = COL_WIDTHS;
  return ws;
}

function main() {
  console.log('\n🔄 MCC_POLICY_UPLOAD_READY_EXPORT_1');
  console.log(`   입력: ${SPLIT_DIR}`);
  console.log(`   출력: ${OUT_DIR}\n`);

  if (!fs.existsSync(SPLIT_DIR)) {
    console.error(`❌ split 결과 폴더 없음: ${SPLIT_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const splitFiles = fs.readdirSync(SPLIT_DIR).filter(f => f.endsWith('.xlsx'));
  if (splitFiles.length === 0) {
    console.error('❌ split 결과 파일 없음');
    process.exit(1);
  }

  type FileSummary = { srcFile: string; outFile: string; sheets: { name: string; rows: number }[] };
  const summaries: FileSummary[] = [];

  for (const srcName of splitFiles.sort()) {
    const srcPath = path.join(SPLIT_DIR, srcName);
    const buf     = fs.readFileSync(srcPath);
    const wbIn    = read(buf, { type: 'buffer', cellText: false, cellDates: false });

    const baseName = srcName.replace(/\.xlsx$/, '');
    const outName  = `${baseName}_upload.xlsx`;
    const outPath  = path.join(OUT_DIR, outName);

    const wbOut = utils.book_new();
    const summary: FileSummary = { srcFile: srcName, outFile: outName, sheets: [] };

    for (const sheetName of wbIn.SheetNames) {
      if (sheetName === '검토필요') continue;

      const ws   = wbIn.Sheets[sheetName];
      const raw  = utils.sheet_to_json<AnyRow>(ws, { header: 1, defval: null });
      const dataRows = raw.slice(1) as AnyRow[];
      const uploadRows = convertToUploadRows(dataRows);

      if (uploadRows.length === 0) {
        console.log(`  ⚠️  [${srcName}] [${sheetName}] 변환 가능한 행 없음 — 시트 건너뜀`);
        continue;
      }

      const wsOut = makeUploadSheet(uploadRows);
      utils.book_append_sheet(wbOut, wsOut, sheetName);
      summary.sheets.push({ name: sheetName, rows: uploadRows.length });
      console.log(`  ✅ [${srcName}] → [${sheetName}] ${uploadRows.length}행 변환`);
    }

    if (wbOut.SheetNames.length === 0) {
      console.log(`  ⚠️  [${srcName}] 변환된 시트 없음 — 파일 생성 건너뜀`);
      continue;
    }

    writeFile(wbOut, outPath);
    summaries.push(summary);
  }

  console.log('\n\n══════════════════════════════════════════════');
  console.log('✅ 완료 리포트');
  console.log('══════════════════════════════════════════════');

  let totalRows = 0;
  for (const s of summaries) {
    console.log(`\n📁 ${s.outFile}  ← ${s.srcFile}`);
    for (const sh of s.sheets) {
      console.log(`   ├─ [${sh.name}]  ${sh.rows}행`);
      totalRows += sh.rows;
    }
  }

  console.log(`\n  생성 파일 : ${summaries.length}개`);
  console.log(`  변환 행   : ${totalRows}행 (검토필요 제외)`);
  console.log(`  컬럼 수   : 10컬럼 (업로드 양식 기준)`);
  console.log('\n[10컬럼 구성]');
  UPLOAD_HEADERS.forEach((h, i) => console.log(`   ${i + 1}. ${h}`));
  console.log('\n[실행 명령어]');
  console.log('  npx tsx scripts/export-policy-upload-ready.ts');
  console.log(`\n[출력 위치] ${OUT_DIR}`);
}

main();
