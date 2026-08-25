/**
 * MCC 정책 통합본 엑셀 → 채널별 split 핵심 로직 (공용 라이브러리)
 * CLI: scripts/split-mcc-policy-excel.ts
 * API: POST /api/admin/policies/parse-original-policy-excel
 */
import { read, utils, write } from 'xlsx';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ChannelDef {
  file: string;
  systemChannel: string;
  carrier: string;
}

export type Row = (string | number | null | undefined)[];

export interface SplitSlot { ok: any[][]; review: any[][] }
export type SplitFileMap = Map<string, Map<string, SplitSlot>>;

export interface SplitResult {
  fileMap: SplitFileMap;
  warnings: string[];
  srcFileName: string;
  sheetsAnalyzed: string[];
  sheetsSkipped: string[];
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

export const TARGET_SHEETS = [
  '①후불(스테이지5,7모바일,프리티)',
  '①후불(M모바일)',
  '①후불(skyLife)',
  '①후불(유모바일,LG헬로)',
];

export const EXPECTED_FILES = [
  '스테이지SK.xlsx', '스테이지KT.xlsx', '텔링크.xlsx',
  '프리티SK.xlsx', '프리티LG.xlsx', '엠모바일.xlsx',
  '스카이.xlsx', '미디어.xlsx', '헬로.xlsx',
];

const CODE_MAP: Record<string, ChannelDef> = {
  SFD0004: { file: '스테이지SK.xlsx', systemChannel: '후불)스테이지5SK', carrier: 'SK알뜰폰' },
  VPI0001: { file: '스테이지KT.xlsx', systemChannel: '후불)스테이지5KT', carrier: 'KT알뜰폰' },
  STD0913: { file: '텔링크.xlsx',    systemChannel: '후불)텔링크',    carrier: 'SK알뜰폰' },
  FRD3204: { file: '프리티SK.xlsx',  systemChannel: '후불)프리티SK',  carrier: 'SK알뜰폰' },
  '332109': { file: '프리티LG.xlsx', systemChannel: '후불)프리티LG',  carrier: 'LG알뜰폰' },
  '331674': { file: '미디어.xlsx',   systemChannel: '후불)미디어',    carrier: 'LG알뜰폰' },
  '316829': { file: '헬로.xlsx',     systemChannel: '후불)헬로',      carrier: 'LG알뜰폰' },
};

const NAME_MAP: Array<[RegExp, ChannelDef]> = [
  [/KTM|M모바일/i,           { file: '엠모바일.xlsx',   systemChannel: '후불)엠모바일',    carrier: 'KT알뜰폰' }],
  [/SKYLIFE|스카이라이프/i,  { file: '스카이.xlsx',     systemChannel: '후불)스카이',      carrier: 'KT알뜰폰' }],
  [/텔링크|STD/i,            { file: '텔링크.xlsx',     systemChannel: '후불)텔링크',      carrier: 'SK알뜰폰' }],
  [/프리텔레콤/i,            { file: '프리티SK.xlsx',   systemChannel: '후불)프리티SK',    carrier: 'SK알뜰폰' }],
  [/인스코비/i,              { file: '프리티LG.xlsx',   systemChannel: '후불)프리티LG',    carrier: 'LG알뜰폰' }],
  [/스테이지.*KT|VPI/i,     { file: '스테이지KT.xlsx', systemChannel: '후불)스테이지5KT', carrier: 'KT알뜰폰' }],
  [/스테이지.*SK|SFD/i,     { file: '스테이지SK.xlsx', systemChannel: '후불)스테이지5SK', carrier: 'SK알뜰폰' }],
  [/미디어로그/i,            { file: '미디어.xlsx',     systemChannel: '후불)미디어',      carrier: 'LG알뜰폰' }],
  [/LG헬로|헬로비전/i,      { file: '헬로.xlsx',       systemChannel: '후불)헬로',        carrier: 'LG알뜰폰' }],
];

export const OUTPUT_HEADERS = [
  '통신사', '시스템채널', '정책차수', '적용기준',
  '적용시작일시', '적용종료일시', '접수_개통기준',
  '요금제', '내국인_신규', '내국인_번이', '외국인_신규', '외국인_번이',
  '결합조건', '부가서비스조건', '가입비조건', '비고',
  '원본파일명', '원본시트명', '원본행번호', '자동인식상태', '검토필요사유',
];

export const SPLIT_COL_WIDTHS = [
  12, 18, 10, 10, 16, 16, 12,
  45, 10, 10, 10, 10,
  14, 16, 14, 35,
  50, 30, 8, 10, 25,
];

// ── 유틸 ─────────────────────────────────────────────────────────────────────

export function safeSheetName(name: string): string {
  return name.replace(/[\/\\?\*\[\]:]/g, '_').slice(0, 31);
}

function parsePolicyTerm(qVal: string) {
  const m = qVal.match(/■\s*(\d+)월\s*(\d+)차(?:\((\d+)일(?:(\d+)시)?~\))?(\(수정\))?/);
  if (!m) return null;
  const [, month, order, day, hour, rev] = m;
  let label = `${month}월${order}차`;
  if (day) { label += `_${day}일`; if (hour) label += `${hour}시`; label += '접수'; }
  if (rev) label += '_수정';
  return { label, rawTerm: `${month}월${order}차` };
}

function parseChannelFromCell(qVal: string): { channelRaw: string; code: string } {
  const lines = qVal.split('\n').map(l => l.trim()).filter(Boolean);
  const nameLine = lines.find(l => /알뜰폰|KTM|SKYLIFE/i.test(l)) ?? lines[1] ?? '';
  const codeLine = lines.find(l => /^[A-Z0-9]{5,8}$/.test(l)) ?? '';
  return { channelRaw: nameLine, code: codeLine };
}

function resolveChannel(code: string, namePlusSheet: string): ChannelDef | null {
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  for (const [pat, def] of NAME_MAP) {
    if (pat.test(namePlusSheet)) return def;
  }
  return null;
}

function cellNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s.startsWith('#') || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function isErrorCell(val: any): boolean {
  if (val === null || val === undefined) return false;
  return String(val).startsWith('#');
}

function skipBVal(bVal: any): boolean {
  if (!bVal && bVal !== 0) return true;
  const s = String(bVal).trim();
  if (s === '') return true;
  if (/^(요금제명|그룹|상품명|구분)$/.test(s)) return true;
  if (s === '통화') return true;
  return false;
}

// ── 시트 파싱 ─────────────────────────────────────────────────────────────────

interface BlockMeta {
  channel: ChannelDef;
  termLabel: string;
  rawTerm: string;
  conditionText: string;
  srcSheet: string;
  dataRows: { row: Row; rowIdx: number }[];
}

function parseSheet(ws: any, sheetName: string, warnings: string[]): BlockMeta[] {
  const raw = utils.sheet_to_json<Row>(ws, { header: 1, defval: null });
  const Q = 16;
  const blocks: BlockMeta[] = [];

  const headerRows: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i][Q];
    if (q && typeof q === 'string' && /■\s*\d+월\s*\d+차/.test(q)) headerRows.push(i);
  }

  if (headerRows.length === 0) {
    warnings.push(`[${sheetName}] 블록 헤더 없음 — 건너뜀`);
    return [];
  }

  for (let bi = 0; bi < headerRows.length; bi++) {
    const bStart = headerRows[bi];
    const bEnd = bi + 1 < headerRows.length ? headerRows[bi + 1] : raw.length;
    const qVal = String(raw[bStart][Q] ?? '');
    const parsed = parsePolicyTerm(qVal);
    if (!parsed) continue;

    const { channelRaw, code } = parseChannelFromCell(qVal);
    const ch = resolveChannel(code, channelRaw + ' ' + sheetName);
    if (!ch) {
      warnings.push(`[${sheetName}] 행${bStart + 1} 채널 미인식: "${channelRaw}" code="${code}"`);
      continue;
    }

    const condParts: string[] = [];
    for (let ri = bStart; ri < Math.min(bStart + 4, bEnd); ri++) {
      for (const ci of [2, 8, 9]) {
        const v = raw[ri][ci];
        if (v && typeof v === 'string' && v.includes('■')) condParts.push(v.trim());
      }
    }

    let inData = false;
    const dataRows: { row: Row; rowIdx: number }[] = [];
    for (let ri = bStart + 1; ri < bEnd; ri++) {
      const r = raw[ri];
      if (r[1] && String(r[1]).trim() === '요금제명') { inData = true; continue; }
      if (!inData) continue;
      if (r[2] && String(r[2]).trim() === '통화') continue;
      dataRows.push({ row: r, rowIdx: ri + 1 });
    }

    blocks.push({
      channel: ch,
      termLabel: parsed.label,
      rawTerm: parsed.rawTerm,
      conditionText: condParts.join(' | '),
      srcSheet: sheetName,
      dataRows,
    });
  }

  return blocks;
}

function convertRows(block: BlockMeta, srcFileName: string): { ok: any[][]; review: any[][] } {
  const ok: any[][] = [];
  const review: any[][] = [];

  for (const { row, rowIdx } of block.dataRows) {
    const bVal = row[1];
    const issues: string[] = [];

    if (skipBVal(bVal)) { issues.push('요금제명 비어있음/구분자'); }
    else if (/^(소계|합계|계)\b/.test(String(bVal).trim())) { issues.push('소계/합계 행'); }

    if (isErrorCell(row[11]) || isErrorCell(row[13])) issues.push('#N/A 오류값');

    const lv = cellNum(row[11]), mv = cellNum(row[12]);
    const nv = cellNum(row[13]), ov = cellNum(row[14]);
    if (lv === null && mv === null && nv === null && ov === null && issues.length === 0) {
      issues.push('R/B 전체 공란');
    }

    const qNote = row[16] != null ? String(row[16]).trim() : '';
    const rNote = row[17] != null ? String(row[17]).trim() : '';
    const perRowNote = /■\s*\d+월/.test(qNote) ? rNote : [qNote, rNote].filter(Boolean).join(' / ');
    const noteText = perRowNote || block.conditionText;

    const outRow = [
      block.channel.carrier, block.channel.systemChannel,
      block.rawTerm, '접수기준', '', '', '',
      bVal ?? '',
      lv ?? '', mv ?? '', nv ?? '', ov ?? '',
      '', '', '',
      noteText,
      srcFileName, block.srcSheet, rowIdx,
      issues.length === 0 ? '자동인식' : '검토필요',
      issues.join(', '),
    ];

    (issues.length === 0 ? ok : review).push(outRow);
  }

  return { ok, review };
}

export function makeSplitSheet(rows: any[][]): any {
  const ws = utils.aoa_to_sheet([OUTPUT_HEADERS, ...rows]);
  ws['!cols'] = SPLIT_COL_WIDTHS.map(w => ({ wch: w }));
  return ws;
}

// ── 메인 공용 함수 ────────────────────────────────────────────────────────────

export function splitPolicyExcelFromBuffer(buf: Buffer, srcFileName: string): SplitResult {
  const warnings: string[] = [];
  const sheetsAnalyzed: string[] = [];
  const sheetsSkipped: string[] = [];
  const wbIn = read(buf, { cellText: false, cellDates: false, type: 'buffer' });
  const fileMap: SplitFileMap = new Map();

  for (const sheetName of TARGET_SHEETS) {
    if (!wbIn.SheetNames.includes(sheetName)) {
      warnings.push(`시트 없음 — 건너뜀: ${sheetName}`);
      sheetsSkipped.push(sheetName);
      continue;
    }
    sheetsAnalyzed.push(sheetName);
    const blocks = parseSheet(wbIn.Sheets[sheetName], sheetName, warnings);

    for (const block of blocks) {
      const fk = block.channel.file;
      if (!fileMap.has(fk)) fileMap.set(fk, new Map());
      const tm = fileMap.get(fk)!;
      if (!tm.has(block.termLabel)) tm.set(block.termLabel, { ok: [], review: [] });
      const slot = tm.get(block.termLabel)!;
      const { ok, review } = convertRows(block, srcFileName);
      slot.ok.push(...ok);
      slot.review.push(...review);
    }
  }

  return { fileMap, warnings, srcFileName, sheetsAnalyzed, sheetsSkipped };
}

/** split 결과를 xlsx 파일별 Buffer Map으로 변환 (CLI 출력용) */
export function buildSplitXlsxBuffers(splitResult: SplitResult): Map<string, Buffer> {
  const { fileMap } = splitResult;
  const out = new Map<string, Buffer>();

  for (const [fileName, termMap] of fileMap.entries()) {
    const wbOut = utils.book_new();
    const allReview: any[][] = [];
    for (const term of [...termMap.keys()].sort()) {
      const { ok, review } = termMap.get(term)!;
      utils.book_append_sheet(wbOut, makeSplitSheet(ok), safeSheetName(term));
      allReview.push(...review);
    }
    if (allReview.length > 0) {
      utils.book_append_sheet(wbOut, makeSplitSheet(allReview), '검토필요');
    }
    const rawBuf = write(wbOut, { type: 'buffer', bookType: 'xlsx' });
    out.set(fileName, Buffer.from(rawBuf));
  }

  return out;
}
