/**
 * 채널별 split 결과 → 업로드 양식(10컬럼) 변환 핵심 로직 (공용 라이브러리)
 * CLI: scripts/export-policy-upload-ready.ts
 * API: POST /api/admin/policies/parse-original-policy-excel
 */
import { utils, write } from 'xlsx';
import { SplitResult, safeSheetName } from './mcc-policy-split';

// ── 업로드 양식 10컬럼 ────────────────────────────────────────────────────────

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

// split 결과 행의 컬럼 인덱스 (OUTPUT_HEADERS 기준)
const IDX = {
  channel: 1,   // 시스템채널
  plan:    7,   // 요금제
  domNew:  8,   // 내국인_신규
  domMnp:  9,   // 내국인_번이
  forNew:  10,  // 외국인_신규
  forMnp:  11,  // 외국인_번이
  combo:   12,  // 결합조건
  addon:   13,  // 부가서비스조건
  joinFee: 14,  // 가입비조건
  note:    15,  // 비고 → 메모
} as const;

type AnyRow = (string | number | null | undefined)[];

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ExportedFile {
  name: string;
  buffer: Buffer;
  sheets: Array<{ name: string; rows: number }>;
  totalRows: number;
}

export interface ExportResult {
  files: ExportedFile[];
  totalOk: number;
  totalReview: number;
}

// ── 변환 함수 ─────────────────────────────────────────────────────────────────

function convertToUploadRows(splitRows: AnyRow[]): any[][] {
  const result: any[][] = [];
  for (const r of splitRows) {
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

function makeUploadSheet(uploadRows: any[][]): any {
  const aoa = [UPLOAD_HEADERS, GUIDE_ROW1, GUIDE_ROW2, ...uploadRows];
  const ws = utils.aoa_to_sheet(aoa);
  ws['!cols'] = COL_WIDTHS;
  return ws;
}

// ── 메인 공용 함수 ────────────────────────────────────────────────────────────

export function exportPolicyUploadReadyFromSplit(splitResult: SplitResult): ExportResult {
  const { fileMap } = splitResult;
  const files: ExportedFile[] = [];
  let totalOk = 0;
  let totalReview = 0;

  for (const [fileName, termMap] of fileMap.entries()) {
    const wbOut = utils.book_new();
    const sheets: Array<{ name: string; rows: number }> = [];

    const terms = [...termMap.keys()].sort();
    let fileReview = 0;

    for (const term of terms) {
      const { ok, review } = termMap.get(term)!;
      const uploadRows = convertToUploadRows(ok as AnyRow[]);
      if (uploadRows.length > 0) {
        utils.book_append_sheet(wbOut, makeUploadSheet(uploadRows), safeSheetName(term));
        sheets.push({ name: term, rows: uploadRows.length });
        totalOk += uploadRows.length;
      }
      fileReview += review.length;
    }
    totalReview += fileReview;

    if (wbOut.SheetNames.length === 0) continue;

    const baseName = fileName.replace(/\.xlsx$/, '');
    const outName = `${baseName}_upload.xlsx`;
    const rawBuf = write(wbOut, { type: 'buffer', bookType: 'xlsx' });

    files.push({
      name: outName,
      buffer: Buffer.from(rawBuf),
      sheets,
      totalRows: sheets.reduce((s, sh) => s + sh.rows, 0),
    });
  }

  return { files, totalOk, totalReview };
}
