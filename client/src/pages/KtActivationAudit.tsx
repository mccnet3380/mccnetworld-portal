// client/src/pages/KtActivationAudit.tsx
//
// 작업명: KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// KT 개통 검수 — KT_ACTIVATION_AUDIT_INTEGRATION_V1.html의 검수 로직(XLSX/XLS/CSV 업로드,
// header 자동탐지, provider 자동판정, 채널별 matching key 선택+localStorage 저장, 가입번호/
// 계약번호/청구번호 매칭, 중복후보 narrowing, 요금제/개통유형 정규화, 스카이 POS 특수 비교,
// 마스킹 고객명, 법인/대표자명 처리, 필터/검색, CSV 저장)을 기존 MCC Layout/Sidebar/Header
// 안에서 그대로 포팅한다. standalone topbar/sidebar 없음, iframe 사용 없음.
//
// 감사(KT_ACTIVATION_AUDIT_MCC_SITE_INTEGRATION_AUDIT_REPORT_1) 및 승인된 결정사항 반영:
// - billing 매칭은 참고 HTML과 동일하게 "KT 파일 청구번호 숫자 ↔ 원장 가입번호 숫자"
//   구조를 그대로 유지한다(새 billing 원장 인덱스를 만들지 않음).
// - 요금제/POS normalization은 LG의 보정(전각괄호, P접두어 제거)을 섞지 않고 KT 참고 HTML
//   그대로 유지한다.
// - matching rule은 참고 HTML과 동일하게 localStorage(KT_AUDIT_CHANNEL_RULES_V1)에 저장한다.
// - LG에는 없던 안전장치를 새로 추가: 처리일자가 여러 개면 사용자가 선택해야 하고, 선택한
//   날짜의 KT 행만(ktRowsForAudit) 검수 루프에 들어간다(참고 HTML은 이 필터가 없었음).
// - Google 원장 연결 표시는 하드코딩하지 않고 /api/kt-audit/sheet가 실제로 resolve한
//   spreadsheet/sheet 값을 그대로 보여준다.
// - "매칭키 누락"은 review(확인 필요) kind로 통일한다(참고 HTML의 요약/필터 불일치를 바로잡음).
//
// KT 원본 파일(XLSX/XLS/CSV)은 이 화면(브라우저) 안에서만 파싱한다 — 서버는 원장(스프레드시트)
// 조회만 담당하고, 파일 전체를 서버로 업로드하지 않는다.

import { useMemo, useState, type DragEvent } from 'react';
import * as XLSX from 'xlsx';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiRequest } from '@/lib/auth';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────
// 순수 유틸 함수 (KT_ACTIVATION_AUDIT_INTEGRATION_V1.html 포팅, 승인된 범위 내에서만 조정)
// ─────────────────────────────────────────────────────────

type Row = Record<string, any>;
type ColumnKey =
  | 'date' | 'channel' | 'subscriber' | 'billing' | 'name' | 'customerType'
  | 'openPlan' | 'currentPlan' | 'openType' | 'pos' | 'status' | 'product';
type ProviderType = '스카이' | '엠모바일' | '기타';
type MatchRule = 'subscriber' | 'billing';

const ALIASES: Record<ColumnKey, string[]> = {
  date: ['처리일자', '개통일자', '개통일', '완료일', '처리일'],
  channel: ['채널', '요청점', '판매채널', '유통망', '대리점'],
  subscriber: ['계약번호', '계약 No', '계약No', '가입번호', '서비스번호', '회선번호', '개통번호', '전화번호', '휴대폰번호', '서비스No'],
  billing: ['청구계정', '청구계정번호', '청구번호', '납부계정', '계정번호'],
  name: ['고객명', '가입자명', '명의자명', '대표자명', '고객성명'],
  customerType: ['명의구분', '고객구분', '가입자유형', '개인법인', '고객유형'],
  openPlan: ['최초요금제', '개통요금제명', '가입요금제', '개통요금제', '요금제명', '요금제'],
  currentPlan: ['현재요금제명', '현재요금제', '사용요금제'],
  openType: ['개통유형', '가입유형', '업무구분', '신규번이', '이전사업자명'],
  pos: ['실판매POS코드', 'POS코드', '판매점코드', '대리점코드', '접점코드'],
  status: ['현재상태명', '현재상태', '처리상태', '가입상태', '상태'],
  product: ['상품번호', '상품ID', '서비스상품번호'],
};

const COMPARE: ColumnKey[] = ['openPlan', 'currentPlan', 'openType', 'pos', 'status', 'product', 'name'];

const LABELS: Record<string, string> = {
  subscriber: '가입번호 ↔ 계약번호',
  billing: '가입번호 ↔ 청구번호',
  name: '고객명',
  customerType: '고객구분',
  openPlan: '개통요금제명',
  currentPlan: '현재요금제명',
  openType: '개통유형',
  pos: '실판매POS코드',
  status: '현재상태명',
  product: '상품번호',
};

const RULES_STORAGE_KEY = 'KT_AUDIT_CHANNEL_RULES_V1';

function text(v: unknown): string {
  return String(v ?? '').trim();
}
function digits(v: unknown): string {
  return text(v).replace(/\D/g, '');
}
/** 헤더 텍스트 정규화(대괄호 접두어/공백/구분자 제거 후 대문자) — alias 매칭용 */
function headerNorm(v: unknown): string {
  return text(v)
    .normalize('NFKC')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[\s_.\-/()（）]/g, '')
    .toUpperCase();
}
function detectExact(headers: string[], aliases: string[]): string {
  for (const a of aliases) {
    const x = headers.find((h) => headerNorm(h) === headerNorm(a));
    if (x) return x;
  }
  return '';
}
function detectCol(headers: string[], aliases: string[]): string {
  for (const a of aliases) {
    const x = headers.find((h) => headerNorm(h) === headerNorm(a));
    if (x) return x;
  }
  for (const a of aliases) {
    const x = headers.find((h) => headerNorm(h).includes(headerNorm(a)));
    if (x) return x;
  }
  return '';
}
function detectProvider(headers: string[]): ProviderType {
  const hs = new Set(headers.map(headerNorm));
  if (['접수번호', '계약번호', '서비스번호', '모집점명'].every((v) => hs.has(headerNorm(v)))) return '스카이';
  if (hs.has(headerNorm('최초요금제')) || hs.has(headerNorm('현재요금제')) || hs.has(headerNorm('최초요금제코드'))) return '엠모바일';
  return '기타';
}
function matchLabel(rule: MatchRule, provider: ProviderType): string {
  return rule === 'billing'
    ? `원장 가입번호 ↔ (${provider === '기타' ? '기타 채널' : provider}) 청구번호`
    : `원장 가입번호 ↔ (${provider}) 계약번호`;
}
function normalize(v: unknown, key: string): string {
  const s = text(v).normalize('NFKC');
  if (key === 'subscriber' || key === 'billing' || key === 'product') return digits(s);
  if (key === 'name') return s.replace(/[\s._-]/g, '').toUpperCase();
  if (key === 'pos') return s.replace(/\s/g, '').replace(/\.0$/, '').toUpperCase();
  if (key === 'openType') {
    const t = s.replace(/\s/g, '').toUpperCase();
    if (['1', '10', '010', '신규'].includes(t)) return 'NEW';
    if (['2', 'MNP', '번호이동'].includes(t)) return 'MNP';
    return t;
  }
  if (key === 'openPlan' || key === 'currentPlan') {
    return s
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^[^(）)]{1,20}\)\s*/, '')
      .replace(/\/\s*\d+(?:\s*\/\s*\d+)*\s*\/?\s*$/, '')
      .replace(/\s/g, '')
      .toUpperCase();
  }
  return s.replace(/\s/g, '').toUpperCase();
}
/** masked(원장 기준 마스킹 값)의 '*'를 정규식 와일드카드로 바꿔 full(비교 대상 전체 이름)과 대조.
 *  full이 '/' 또는 '|'로 여러 이름을 병기하면 그중 하나라도 매칭되면 호환으로 본다. */
function maskedNameCompatible(masked: unknown, full: unknown): boolean {
  const m = normalize(masked, 'name');
  if (!m || !m.includes('*')) return false;
  const pattern = '^' + m.split('*').map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
  const re = new RegExp(pattern);
  return String(full ?? '')
    .split(/[/|]/)
    .map((v) => normalize(v, 'name'))
    .filter(Boolean)
    .some((f) => re.test(f));
}
/** 스카이 전용: 실판매POS코드만, digits 기준 뒤 5자리가 같으면 호환으로 본다. */
function skyPosCompatible(base: unknown, kt: unknown, provider: ProviderType): boolean {
  const a = digits(base);
  const b = digits(kt);
  return provider === '스카이' && a.length >= 5 && b.length >= 5 && a.slice(-5) === b.slice(-5);
}
function isCorporate(row: Row, columns: Record<string, string>): boolean | null {
  const t = normalize(getValue(row, 'customerType', columns), 'customerType');
  const n = text(getValue(row, 'name', columns));
  if (/법인|기업|CORP/.test(t)) return true;
  if (/개인/.test(t)) return false;
  return /(주식회사|\(주\)|㈜|유한회사|\(유\)|재단|협회|조합|법인)/.test(n) ? true : null;
}

/** 행에서 값을 읽는다 — columns[key]로 감지된 실제 컬럼명이 이 행에 있으면 그걸 쓰고,
 *  없으면(원장 행처럼 헤더가 다른 경우) ALIASES로 다시 감지해서 읁는다. */
function getValue(row: Row, key: string, columns: Record<string, string>): string {
  const preferred = columns[key];
  if (preferred && Object.prototype.hasOwnProperty.call(row, preferred)) {
    return text(row[preferred]);
  }
  const col = detectCol(Object.keys(row), (ALIASES as Record<string, string[]>)[key] || []);
  return col ? text(row[col]) : '';
}

function parseDateValue(v: unknown): { y: number; m: number; d: number } | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  if (typeof v === 'number') {
    try {
      const p = (XLSX as any).SSF?.parse_date_code?.(v);
      if (p) return { y: p.y, m: p.m, d: p.d };
    } catch {
      // 무시 — 아래 텍스트 파싱으로 폴백
    }
  }
  const m = text(v).match(/(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  return { y, m: Number(m[2]), d: Number(m[3]) };
}
function isoDateStr(v: unknown): string {
  const p = parseDateValue(v);
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '';
}

function parseCsvMatrix(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      if (quote && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quote = !quote;
      }
    } else if (c === ',' && !quote) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface ParsedSheet {
  heads: string[];
  rows: Row[];
  headerRow: number;
}
/** 첫 25행 범위에서 ALIASES 매칭 점수가 가장 높은 행을 헤더 행으로 채택한다. */
function matrixToRows(matrix: any[][]): ParsedSheet {
  let best = -1;
  let score = -1;
  for (let i = 0; i < Math.min(25, matrix.length); i++) {
    const r = matrix[i] || [];
    const rTexts = r.map(text);
    const s = Object.values(ALIASES).filter((a) => detectCol(rTexts, a)).length;
    if (s > score) {
      score = s;
      best = i;
    }
  }
  if (best < 0 || score < 2) {
    throw new Error('컬럼 제목 행을 찾지 못했습니다. 가입번호·청구계정·고객명 등이 있는 행을 확인하세요.');
  }
  const heads = (matrix[best] || []).map((v: any, i: number) => text(v) || `미지정_${i + 1}`);
  const rows: Row[] = matrix
    .slice(best + 1)
    .filter((r: any[]) => r.some((v) => text(v) !== ''))
    .map((r: any[], i: number) => {
      const obj: Row = {};
      heads.forEach((h, j) => {
        obj[h] = r[j] ?? '';
      });
      obj.__row = String(best + i + 2);
      return obj;
    });
  return { heads, rows, headerRow: best + 1 };
}

function detectColumns(heads: string[]): Record<string, string> {
  const columns: Record<string, string> = {};
  (Object.keys(ALIASES) as ColumnKey[]).forEach((key) => {
    columns[key] = key === 'channel' ? detectExact(heads, ALIASES[key]) : detectCol(heads, ALIASES[key]);
  });
  return columns;
}

function loadSavedRules(): Record<string, MatchRule> {
  try {
    return JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function persistRules(rules: Record<string, MatchRule>) {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // 저장 실패는 무시 — 이번 세션 내 동작에는 영향 없음
  }
}

type ResultKind = 'ok' | 'mismatch' | 'missing' | 'review' | 'info';
interface ResultRow {
  status: string;
  kind: ResultKind;
  channel: string;
  key: string;
  id: string;
  name: string;
  field: string;
  base: string;
  kt: string;
  reason: string;
}
interface Summary {
  kt: number;
  base: number;
  matched: number;
  normal: number;
  mismatch: number;
  review: number;
  corpInfo: number;
  skipped: number;
}

function computeResults(
  ledgerRows: Row[],
  ktRows: Row[],
  columns: Record<string, string>,
  provider: ProviderType,
  hasChannel: boolean,
  rules: Record<string, MatchRule>,
): { results: ResultRow[]; summary: Summary } {
  const subMap = new Map<string, Row[]>();
  for (const r of ledgerRows) {
    const k = normalize(getValue(r, 'subscriber', columns), 'subscriber');
    if (!k) continue;
    if (!subMap.has(k)) subMap.set(k, []);
    subMap.get(k)!.push(r);
  }

  const results: ResultRow[] = [];
  let matched = 0;
  let normal = 0;
  let mismatch = 0;
  let review = 0;
  let unmatched = 0;
  let corpInfo = 0;
  let skipped = 0;

  for (const kt of ktRows) {
    // 참고 HTML과 동일한 채널 판정: 채널 컬럼이 있어도 그 행 값이 비어있으면 '미분류'로
    // 처리한다(규칙 테이블 설정 단계의 '(provider)' 그룹과는 별개 — 참고 HTML의 기존 동작을
    // 그대로 포팅했다. 감사 보고서에서 이 불일치를 별도로 지적함).
    const rawChannel = hasChannel ? text(getValue(kt, 'channel', columns)) : '';
    const channel = hasChannel ? rawChannel || '미분류' : '파일 전체 채널';
    const ruleKey = hasChannel ? channel : '파일 전체 채널';
    const rule = rules[ruleKey];
    const ktName = text(getValue(kt, 'name', columns));

    if (!rule) {
      results.push({
        status: '매칭키 누락', kind: 'review', channel, key: '', id: '', name: ktName,
        field: '매칭 기준', base: '', kt: '', reason: '이 채널에 매칭 기준이 설정되지 않았습니다.',
      });
      review++;
      continue;
    }

    const raw = getValue(kt, rule, columns);
    const id = normalize(raw, rule);
    const keyLabel = matchLabel(rule, provider);

    if (!id) {
      results.push({
        status: '매칭키 누락', kind: 'review', channel, key: keyLabel, id: '', name: ktName,
        field: LABELS[rule], base: '', kt: text(raw), reason: `${LABELS[rule]} 값이 없어 매칭할 수 없습니다.`,
      });
      review++;
      continue;
    }

    let candidates = subMap.get(id) || [];
    if (candidates.length > 1) {
      const sub = normalize(getValue(kt, 'subscriber', columns), 'subscriber');
      if (sub) {
        const narrowed = candidates.filter(
          (r) => normalize(getValue(r, 'subscriber', columns), 'subscriber') === sub,
        );
        if (narrowed.length === 1) candidates = narrowed;
      }
    }

    if (candidates.length === 0) {
      results.push({
        status: '미매칭', kind: 'missing', channel, key: keyLabel, id, name: ktName,
        field: keyLabel, base: '원장에 없음', kt: text(raw),
        reason: `${keyLabel}가 스프레드시트에 존재하지 않습니다.`,
      });
      unmatched++;
      continue;
    }
    if (candidates.length > 1) {
      results.push({
        status: '중복후보', kind: 'review', channel, key: keyLabel, id, name: ktName,
        field: keyLabel, base: `${candidates.length}건`, kt: text(raw),
        reason: '동일 식별값이 여러 건이라 자동 확정하지 않았습니다.',
      });
      review++;
      continue;
    }

    const base = candidates[0];
    const displayName = text(getValue(base, 'name', columns)) || ktName;
    matched++;
    let rowIssue = 0;
    const corp = isCorporate(base, columns);

    for (const field of COMPARE) {
      const bv = getValue(base, field, columns);
      const kv = getValue(kt, field, columns);
      if (!text(bv) || !text(kv)) {
        skipped++;
        continue;
      }

      if (field === 'name' && normalize(bv, field) !== normalize(kv, field)) {
        if (String(kv).includes('*') && maskedNameCompatible(kv, bv)) continue;
        if (corp === true) {
          results.push({
            status: '법인명/대표자명 차이', kind: 'info', channel, key: keyLabel, id, name: displayName,
            field: LABELS[field], base: text(bv), kt: text(kv),
            reason: '법인 건으로 확인되어 법인명과 대표자명 차이를 오류에서 제외했습니다.',
          });
          corpInfo++;
          continue;
        }
        if (corp === null) {
          results.push({
            status: '명의 확인 필요', kind: 'review', channel, key: keyLabel, id, name: displayName,
            field: LABELS[field], base: text(bv), kt: text(kv),
            reason: '마스킹 이름이 원장 이름과 연결되지 않아 확인이 필요합니다.',
          });
          review++;
          rowIssue++;
          continue;
        }
      }

      if (field === 'pos' && skyPosCompatible(bv, kv, provider)) continue;

      if (normalize(bv, field) !== normalize(kv, field)) {
        results.push({
          status: '값 불일치', kind: 'mismatch', channel, key: keyLabel, id, name: displayName,
          field: LABELS[field], base: text(bv), kt: text(kv),
          reason: `${keyLabel} 정확 매칭 후 값이 다릅니다.`,
        });
        mismatch++;
        rowIssue++;
      }
    }

    if (!rowIssue) {
      results.push({
        status: '정상', kind: 'ok', channel, key: keyLabel, id, name: displayName,
        field: '전체 비교', base: '', kt: '', reason: '비교 가능한 검수 항목이 모두 일치합니다.',
      });
      normal++;
    }
  }

  return {
    results,
    summary: {
      kt: ktRows.length, base: ledgerRows.length, matched, normal, mismatch,
      review: review + unmatched, corpInfo, skipped,
    },
  };
}

// ─────────────────────────────────────────────────────────
// React 컴포넌트
// ─────────────────────────────────────────────────────────

interface BookHandle {
  isCsv: boolean;
  sheetNames: string[];
  getMatrix: (sheetName: string) => any[][];
}
interface DateOption {
  date: string;
  count: number;
}
type StatusFilter = 'issues' | 'all' | 'mismatch' | 'review' | 'missing' | 'info';

export function KtActivationAudit() {
  const apiRequest = useApiRequest();

  const [book, setBook] = useState<BookHandle | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [analyzed, setAnalyzed] = useState(false);
  const [ktRows, setKtRows] = useState<Row[]>([]);
  const [provider, setProvider] = useState<ProviderType>('기타');
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<string[]>([]);
  const [rules, setRules] = useState<Record<string, MatchRule>>({});
  const [mappingLine, setMappingLine] = useState('');

  const [csvDateOptions, setCsvDateOptions] = useState<DateOption[]>([]);
  const [dateNeedsSelection, setDateNeedsSelection] = useState(false);
  const [auditDate, setAuditDate] = useState('');

  const [notice, setNotice] = useState('KT 원본 파일을 선택하세요.');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const [spreadsheetLabel, setSpreadsheetLabel] = useState('');
  const [sheetLabel, setSheetLabel] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('issues');
  const [searchQuery, setSearchQuery] = useState('');

  const hasChannel = !!columns.channel;

  const ktRowsForAudit = useMemo(() => {
    if (!columns.date) return ktRows; // 처리일자 컬럼 자체를 못 찾으면 필터링 불가 — 전체 사용
    if (!auditDate) return [];
    return ktRows.filter((r) => isoDateStr(r[columns.date]) === auditDate);
  }, [ktRows, columns.date, auditDate]);

  const missingRuleChannels = useMemo(() => channels.filter((c) => !rules[c]), [channels, rules]);
  const canRun = analyzed && !!auditDate && !dateNeedsSelection && missingRuleChannels.length === 0;

  async function handleFile(file: File) {
    setError('');
    setAnalyzed(false);
    setResults([]);
    setSummary(null);
    setCsvDateOptions([]);
    setDateNeedsSelection(false);
    setAuditDate('');

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError('XLSX, XLS 또는 CSV 파일을 선택하세요.');
      return;
    }
    setFileLabel(file.name);

    try {
      if (/\.csv$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        let src: string;
        try {
          src = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch {
          src = new TextDecoder('euc-kr').decode(buf);
        }
        const matrix = parseCsvMatrix(src.replace(/^﻿/, ''));
        setBook({ isCsv: true, sheetNames: ['CSV'], getMatrix: () => matrix });
        setSelectedSheet('CSV');
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        setBook({
          isCsv: false,
          sheetNames: wb.SheetNames,
          getMatrix: (name: string) =>
            XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }) as any[][],
        });
        setSelectedSheet(wb.SheetNames[0] || '');
      }
      setNotice('시트를 확인한 뒤 컬럼·채널 분석을 누르세요.');
    } catch (e: any) {
      setBook(null);
      setError('파일 읽기 오류: ' + (e?.message ?? String(e)));
    }
  }

  function handleSheetChange(name: string) {
    setSelectedSheet(name);
    setAnalyzed(false);
    setResults([]);
    setSummary(null);
  }

  function runAnalyze() {
    if (!book) return;
    setError('');
    try {
      const matrix = book.getMatrix(selectedSheet);
      const parsed = matrixToRows(matrix);
      const cols = detectColumns(parsed.heads);
      if (!cols.subscriber && !cols.billing) {
        throw new Error('계약번호·가입번호·청구번호 컬럼을 찾지 못했습니다.');
      }
      const detectedProvider = detectProvider(parsed.heads);

      const dateCounts = new Map<string, number>();
      if (cols.date) {
        for (const r of parsed.rows) {
          const d = isoDateStr(r[cols.date]);
          if (d) dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
        }
      }
      const distinctDates = Array.from(dateCounts.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const channelCol = cols.channel;
      const detectedChannels = channelCol
        ? Array.from(new Set(parsed.rows.map((r) => text(r[channelCol]) || `(${detectedProvider})`)))
        : ['파일 전체 채널'];

      const savedRules = loadSavedRules();
      const nextRules = { ...savedRules };
      if (!channelCol && !nextRules['파일 전체 채널']) {
        if (cols.subscriber) nextRules['파일 전체 채널'] = 'subscriber';
        else if (cols.billing) nextRules['파일 전체 채널'] = 'billing';
      }

      setKtRows(parsed.rows);
      setColumns(cols);
      setProvider(detectedProvider);
      setChannels(detectedChannels);
      setRules(nextRules);
      setAnalyzed(true);

      const found = (Object.keys(cols) as ColumnKey[])
        .filter((k) => cols[k])
        .map((k) => `${LABELS[k] || k}: ${cols[k]}`);
      setMappingLine(`(${detectedProvider}) 파일 · 제목 행 ${parsed.headerRow}행 · 데이터 ${parsed.rows.length}건 — ${found.join(' · ')}`);

      if (distinctDates.length === 1) {
        setAuditDate(distinctDates[0].date);
        setCsvDateOptions([]);
        setDateNeedsSelection(false);
        setNotice(`(${detectedProvider}) ${parsed.rows.length}건, 채널 ${detectedChannels.length}개를 분석했습니다.`);
      } else if (distinctDates.length > 1) {
        setCsvDateOptions(distinctDates);
        setDateNeedsSelection(true);
        setAuditDate('');
        setNotice('처리일자가 여러 개 있습니다. 검수할 날짜를 선택하세요.');
      } else {
        setCsvDateOptions([]);
        setDateNeedsSelection(false);
        setNotice(`(${detectedProvider}) ${parsed.rows.length}건, 채널 ${detectedChannels.length}개를 분석했습니다. 검수일을 직접 선택하세요.`);
      }
    } catch (e: any) {
      setAnalyzed(false);
      setError('분석 오류: ' + (e?.message ?? String(e)));
    }
  }

  function selectAuditDate(date: string) {
    setAuditDate(date);
    setDateNeedsSelection(false);
    setError('');
  }

  function handleRuleChange(channel: string, value: string) {
    setRules((prev) => {
      const next = { ...prev };
      if (value) next[channel] = value as MatchRule;
      else delete next[channel];
      persistRules(next);
      return next;
    });
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function runAudit() {
    if (!auditDate) {
      setError('검수일을 선택하세요.');
      return;
    }
    if (missingRuleChannels.length > 0) {
      setError(`매칭 기준을 선택하지 않은 채널이 있습니다: ${missingRuleChannels.join(', ')}`);
      return;
    }
    if (ktRowsForAudit.length === 0) {
      setError('검수 대상 KT 행이 없습니다. 선택한 날짜의 데이터를 확인하세요.');
      return;
    }
    setRunning(true);
    setError('');
    setNotice('LG와 동일한 스프레드시트 원장의 최신 값을 조회하고 있습니다...');
    try {
      const payload = await apiRequest(`/api/kt-audit/sheet?date=${auditDate}`);
      const ledgerRows = (payload.rows || []) as Row[];
      setSpreadsheetLabel(payload.spreadsheet || '');
      setSheetLabel(payload.sheet || '');

      const { results: computedResults, summary: computedSummary } = computeResults(
        ledgerRows, ktRowsForAudit, columns, provider, hasChannel, rules,
      );
      setResults(computedResults);
      setSummary(computedSummary);
      setNotice('검수가 완료되었습니다.');
    } catch (e: any) {
      setError('검수 중 오류: ' + (e?.message ?? String(e)));
    } finally {
      setRunning(false);
    }
  }

  const filteredResults = useMemo(() => {
    const q = normalize(searchQuery, 'name');
    return results.filter((r) => {
      const statusOk =
        statusFilter === 'all' ||
        (statusFilter === 'issues' && r.kind !== 'ok' && r.kind !== 'info') ||
        statusFilter === r.kind;
      if (!statusOk) return false;
      if (!q) return true;
      return normalize(`${r.channel} ${r.id} ${r.name}`, 'name').includes(q);
    });
  }, [results, statusFilter, searchQuery]);

  function exportCsv() {
    const data = [
      ['상태', '채널', '적용키', '식별값', '고객명', '문제항목', '스프레드시트', 'KT파일', '판정사유'],
      ...filteredResults.map((r) => [r.status, r.channel, r.key, r.id, r.name, r.field, r.base, r.kt, r.reason]),
    ];
    const csv =
      '﻿' + data.map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KT_개통검수_${auditDate || 'unknown'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Layout title="KT 검수">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">KT 개통 검수</h1>
          <p className="text-sm text-muted-foreground mt-1">
            (엠모바일)과 (스카이) 파일을 구분하여 계약번호 기준으로 원장과 대조합니다.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. KT 파일 및 검수일 설정</CardTitle>
            <CardDescription>엑셀·CSV 파일을 직접 올리면 컬럼과 채널을 자동 탐지합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-dashed p-4 bg-muted/30">
                <div className="font-medium text-sm">Google 스프레드시트 연결 상태</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {spreadsheetLabel ? `${spreadsheetLabel} · ${sheetLabel}` : '검수를 실행하면 LG와 동일한 원장 최신 값을 조회합니다.'}
                </div>
              </div>

              <label
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                className={cn(
                  'flex flex-col items-center justify-center rounded-md border-2 border-dashed p-4 cursor-pointer text-center min-h-[96px] transition-colors',
                  dragActive ? 'border-primary bg-primary/5' : 'border-input bg-background hover:bg-muted/40',
                )}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <div className="font-medium text-sm">KT 원본 파일</div>
                <div className="text-xs text-muted-foreground mt-0.5">XLSX · XLS · CSV (선택 또는 드래그 앤 드롭)</div>
                <div className="text-xs text-primary mt-1 truncate max-w-full">{fileLabel || '파일 선택'}</div>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-[220px_1fr_180px] items-end">
              <div>
                <label className="text-sm font-medium block mb-1">검수할 개통일</label>
                <Input
                  type="date"
                  value={auditDate}
                  disabled={dateNeedsSelection}
                  onChange={(e) => setAuditDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">KT 파일 시트</label>
                <Select value={selectedSheet} onValueChange={handleSheetChange} disabled={!book}>
                  <SelectTrigger>
                    <SelectValue placeholder="파일을 먼저 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {(book?.sheetNames || []).map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={runAnalyze} disabled={!book}>컬럼·채널 분석</Button>
            </div>

            {dateNeedsSelection && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <div className="text-sm font-semibold text-amber-800">처리일자가 여러 개 있습니다</div>
                <div className="text-sm text-amber-700 mt-1">
                  검수할 날짜를 선택하세요. 선택한 날짜의 KT 행만 검수 대상이 되고, 스프레드시트 원장도 같은 날짜로만 조회합니다.
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {csvDateOptions.map((opt) => (
                    <Button key={opt.date} type="button" size="sm" variant="outline" onClick={() => selectAuditDate(opt.date)}>
                      {opt.date} ({opt.count}건)
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {mappingLine && (
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{mappingLine}</div>
            )}

            {error ? (
              <p className="text-sm text-red-600 font-semibold">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{notice}</p>
            )}
          </CardContent>
        </Card>

        {analyzed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. 채널별 매칭 기준</CardTitle>
              <CardDescription>처음 한 번 확인한 규칙은 이 브라우저에 저장되어 다음 파일부터 자동 적용됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <RuleHelpCard tag="(엠모바일)" title="원장 가입번호 ↔ 엠모바일 계약번호" desc="기존 엠모바일 검수 방식" />
                <RuleHelpCard tag="(스카이)" title="원장 가입번호 ↔ 스카이 계약번호" desc="계약번호로 자동 매칭" />
                <RuleHelpCard tag="(기타 채널)" title="원장 가입번호 ↔ 청구번호" desc="실제 청구번호 컬럼이 있는 파일에만 사용" />
                <RuleHelpCard tag="안전장치" title="복수 후보 자동 보류" desc="임의 매칭 없이 중복후보로 출력" />
              </div>

              <div className="overflow-auto border rounded-md">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-left font-medium">탐지 채널</th>
                      <th className="p-2 text-left font-medium">적용 매칭키</th>
                      <th className="p-2 text-left font-medium">파일 채널값</th>
                      <th className="p-2 text-left font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((c) => {
                      const saved = rules[c] || '';
                      const shown = hasChannel ? c : `(${provider})`;
                      return (
                        <tr key={c} className="border-t">
                          <td className="p-2 font-semibold">{shown}</td>
                          <td className="p-2">
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                              value={saved}
                              onChange={(e) => handleRuleChange(c, e.target.value)}
                            >
                              <option value="">기준 선택</option>
                              <option value="subscriber" disabled={!columns.subscriber}>{matchLabel('subscriber', provider)}</option>
                              <option value="billing" disabled={!columns.billing}>{matchLabel('billing', provider)}</option>
                            </select>
                          </td>
                          <td className="p-2">
                            {hasChannel ? c : <Input value={`(${provider})`} disabled />}
                          </td>
                          <td className="p-2 text-muted-foreground">{saved ? '자동 적용' : '확인 필요'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">채널 컬럼이 없는 파일은 '파일 전체 채널'에 지정한 기준으로 처리합니다.</p>
                <Button onClick={runAudit} disabled={!canRun || running}>
                  {running ? '검수 중...' : '검수 실행'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {summary && (
          <>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard label="KT 검수대상" value={summary.kt} />
              <SummaryCard label="원장 대상일" value={summary.base} />
              <SummaryCard label="매칭 완료" value={summary.matched} tone="good" />
              <SummaryCard label="정상 행" value={summary.normal} tone="good" />
              <SummaryCard label="불일치 항목" value={summary.mismatch} tone="issue" />
              <SummaryCard label="확인 필요" value={summary.review} tone="issue" />
            </div>

            <Card>
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-base">검수 결과</CardTitle>
                  <CardDescription>
                    {auditDate} 기준 · 법인명/대표자명 차이 {summary.corpInfo}건 · 양쪽 중 빈 값이라 비교하지 않은 항목 {summary.skipped}개
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="issues">이상 건만</SelectItem>
                      <SelectItem value="all">전체 보기</SelectItem>
                      <SelectItem value="mismatch">값 불일치</SelectItem>
                      <SelectItem value="review">확인 필요</SelectItem>
                      <SelectItem value="missing">미매칭</SelectItem>
                      <SelectItem value="info">법인명/대표자명</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="채널·번호·고객명 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-[210px]"
                  />
                  <Button variant="outline" onClick={exportCsv}>결과 CSV 저장</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto border rounded-md max-h-[620px]">
                  <table className="w-full text-sm min-w-[1000px]">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left font-medium">상태</th>
                        <th className="p-2 text-left font-medium">채널</th>
                        <th className="p-2 text-left font-medium">적용키</th>
                        <th className="p-2 text-left font-medium">식별값</th>
                        <th className="p-2 text-left font-medium">고객명</th>
                        <th className="p-2 text-left font-medium">문제항목</th>
                        <th className="p-2 text-left font-medium">스프레드시트</th>
                        <th className="p-2 text-left font-medium">KT 파일</th>
                        <th className="p-2 text-left font-medium">판정 사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r, i) => (
                        <tr key={i} className="border-t hover:bg-muted/40">
                          <td className="p-2"><StatusBadge kind={r.kind}>{r.status}</StatusBadge></td>
                          <td className="p-2">{r.channel}</td>
                          <td className="p-2 text-xs text-muted-foreground">{r.key}</td>
                          <td className="p-2">{r.id}</td>
                          <td className="p-2">{r.name}</td>
                          <td className="p-2">{r.field}</td>
                          <td className="p-2">{r.base || '-'}</td>
                          <td className="p-2">{r.kt || '-'}</td>
                          <td className="p-2">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredResults.length === 0 && (
                    <div className="p-10 text-center text-muted-foreground">조건에 해당하는 결과가 없습니다.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

function RuleHelpCard({ tag, title, desc }: { tag: string; title: string; desc: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-bold text-primary">{tag}</div>
      <div className="text-sm font-semibold mt-1">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'issue' }) {
  return (
    <div
      className={cn(
        'rounded-md border border-t-[3px] bg-white p-3',
        tone === 'good' && 'border-t-emerald-500',
        tone === 'issue' && 'border-t-red-500',
        !tone && 'border-t-gray-400',
      )}
    >
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function StatusBadge({ kind, children }: { kind: ResultKind; children: React.ReactNode }) {
  const styles: Record<ResultKind, string> = {
    mismatch: 'bg-red-100 text-red-700',
    review: 'bg-amber-100 text-amber-800',
    missing: 'bg-slate-100 text-slate-600',
    ok: 'bg-emerald-100 text-emerald-700',
    info: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap', styles[kind])}>
      {children}
    </span>
  );
}
