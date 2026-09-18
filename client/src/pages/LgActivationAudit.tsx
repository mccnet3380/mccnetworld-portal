// client/src/pages/LgActivationAudit.tsx
//
// 작업명: LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// LG 개통 검수 — LG_ACTIVATION_AUDIT_INTEGRATION_V1.html의 검수 로직(CSV 파싱, 가입번호
// 정규화/매칭, 요금제/개통유형 정규화, 마스킹 상품번호/고객명 검증, 채널 결정, 필터/검색,
// CSV 저장)을 기존 MCC Layout/Sidebar/Header/AuthGuard 안에서 그대로 포팅한다.
// standalone topbar/sidebar 없음, iframe 사용 없음.
//
// 감사에서 확정한 차이점 반영:
// - 가입번호는 매칭 KEY로만 쓰고 필드 비교 대상에서 제외한다(FIELDS에 subscriber 없음).
// - 채널은 "존재하는 첫 컬럼"이 아니라 "행 값이 비어있지 않은 첫 컬럼"(요청점>채널>통신사>통신망)이다.
// - 판정 문구는 "가입번호 원장 누락" / "동일 가입번호 원장 중복" / "고객 매칭 성공 / {필드} 불일치"로 통일한다.
// - CSV에 처리일자가 여러 개면 사용자가 하나를 선택해야 하고, 선택한 날짜의 CSV 행만 검수 대상이 되며
//   원장 조회(/api/lg-audit/sheet)도 동일한 날짜로만 조회한다(CSV/원장 양쪽 모두 같은 audit date로 제한).
// - CSV/파일은 이 화면(브라우저) 안에서만 파싱한다 — 서버는 원장(스프레드시트) 조회만 담당한다.

import { useMemo, useState, type DragEvent } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApiRequest } from '@/lib/auth';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────
// 순수 유틸 함수 (LG_ACTIVATION_AUDIT_INTEGRATION_V1.html 포팅, 로직 변경 없음)
// ─────────────────────────────────────────────────────────

type Row = Record<string, string>;

function text(v: unknown): string {
  return String(v ?? '').trim();
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function cleanHeader(v: unknown): string {
  return String(v ?? '')
    .replace(/^\[[A-Z]+\]\s*/i, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 요금제명 정규화 — 시스템 접두어/채널 접두어/충전개월 표기 제거 후 비교(원본 표시값은 별도 보존) */
function normalizePlan(v: unknown): string {
  const s = text(v)
    .normalize('NFKC')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[^(）)]{1,20}\)\s*/, '')
    .replace(/\/\s*\d+(?:\s*\/\s*\d+)*\s*\/?\s*$/, '');
  return s
    .replace(/\s/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toUpperCase();
}

type FieldKey = 'subscriber' | 'pos' | 'product' | 'name' | 'openType' | 'openPlan' | 'currentPlan';

function normalize(v: unknown, key: FieldKey): string {
  const s = text(v).normalize('NFKC');
  if (key === 'subscriber') return digits(s);
  if (key === 'pos') return s.replace(/^P/i, '').replace(/\.0$/, '').replace(/\s/g, '').toUpperCase();
  if (key === 'product') return digits(s);
  if (key === 'name') return s.replace(/[\s._-]/g, '').toUpperCase();
  if (key === 'openType') {
    const type = s.replace(/\s/g, '').toUpperCase();
    if (['1', '10', '010'].includes(type)) return 'OPEN_010';
    if (['2', 'MNP'].includes(type)) return 'MNP';
    return type;
  }
  if (key === 'openPlan' || key === 'currentPlan') return normalizePlan(s);
  return s.replace(/\s/g, '').toUpperCase();
}

/** 마스킹된 고객명(masked)의 visible 첫/끝 글자가 원장 고객명(full)의 시작/끝과 일치하는지 확인 */
function maskedNameCompatible(masked: unknown, full: unknown): boolean | null {
  const m = normalize(masked, 'name');
  const f = normalize(full, 'name');
  if (!m || !f) return null;
  if (!m.includes('*')) return m === f;
  const visible = m.split('').filter((c) => c !== '*');
  if (!visible.length) return null;
  return f.startsWith(visible[0]) && f.endsWith(visible[visible.length - 1]);
}

function last4(v: unknown): string {
  const d = digits(v);
  return d.length >= 4 ? d.slice(-4) : '';
}

/** CSV 처리일자 텍스트에서 YYYY-MM-DD만 추출한다(엑셀 시리얼/날짜 객체는 없음 — CSV는 항상 텍스트). */
function isoDateFromText(v: unknown): string {
  const s = text(v);
  if (!s) return '';
  const m = s.match(/(\d{2,4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (!m) return '';
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCsv(src: string): string[][] {
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

function rowObjects(matrix: string[][]): Row[] {
  const head = matrix[0] || [];
  return matrix
    .slice(1)
    .filter((r) => r.some((v) => text(v) !== ''))
    .map((r) => Object.fromEntries(head.map((h, j) => [text(h) || `__${j}`, r[j] ?? ''])));
}

function detect(headers: string[], aliases: string[]): string | null {
  const pairs = headers.map((h) => [h, cleanHeader(h)] as const);
  for (const a of aliases) {
    const hit = pairs.find(([, c]) => c === cleanHeader(a));
    if (hit) return hit[0];
  }
  return null;
}

function getValue(row: Row, aliases: string[]): string {
  const key = detect(Object.keys(row), aliases);
  return key ? row[key] : '';
}

/**
 * 채널 결정 — "존재하는 첫 컬럼"이 아니라 "행 값이 비어있지 않은 첫 컬럼"을 우선순위대로 찾는다.
 * 예: 요청점 컬럼은 있지만 이 행의 값이 빈칸이고 채널 컬럼에 값이 있으면 채널 값을 쓴다.
 */
function resolveChannel(baseRow: Row): string {
  const priority = ['요청점', '채널', '통신사', '통신망'];
  const keys = Object.keys(baseRow);
  for (const alias of priority) {
    const matchedKey = keys.find((k) => cleanHeader(k) === cleanHeader(alias));
    if (matchedKey) {
      const v = text(baseRow[matchedKey]);
      if (v) return v;
    }
  }
  return '미분류';
}

interface FieldDef {
  key: FieldKey;
  label: string;
  base: string[];
  lg: string[];
}

// 가입번호는 매칭 KEY로만 사용 — 필드 비교 대상에는 포함하지 않는다(감사에서 확인된 차이 반영).
const FIELDS: FieldDef[] = [
  { key: 'openPlan', label: '개통요금제명', base: ['개통요금제명', '요금제'], lg: ['개통요금제명'] },
  { key: 'currentPlan', label: '현재요금제명', base: ['현재요금제명'], lg: ['현재요금제명'] },
  { key: 'openType', label: '개통유형 또는 이전사업자명', base: ['이전사업자명', '개통유형', '유형'], lg: ['이전사업자명', '개통유형'] },
  { key: 'pos', label: '실판매POS코드', base: ['실판매POS코드', 'POS코드', '코드'], lg: ['실판매POS코드'] },
  { key: 'product', label: '상품번호', base: ['상품번호', '개통번호'], lg: ['상품번호'] },
  { key: 'name', label: '고객명', base: ['고객명'], lg: ['고객명'] },
];

type ResultKind = 'ok' | 'mismatch' | 'missing' | 'review';

interface ResultRow {
  status: string;
  kind: ResultKind;
  channel: string;
  sub: string;
  name: string;
  field: string;
  base: string;
  lg: string;
  reason: string;
}

interface Summary {
  lg: number;
  base: number;
  matched: number;
  normal: number;
  fieldIssues: number;
  review: number;
  unavailable: number;
}

// LG_ACTIVATION_AUDIT_PRODUCTION_DEPLOY_1: export는 배포 전 가입번호 매칭 실제 실행 테스트가
// 이 함수(실제 shipped 코드)를 그대로 import해서 검증할 수 있게 하기 위한 것이다 — 동작/구조는
// 전혀 바꾸지 않았다(가시성만 추가).
export function computeResults(ledgerRows: Row[], lgRows: Row[]): { results: ResultRow[]; summary: Summary } {
  const bySub = new Map<string, Row[]>();
  ledgerRows.forEach((r) => {
    const k = normalize(getValue(r, ['가입번호']), 'subscriber');
    if (!k) return;
    if (!bySub.has(k)) bySub.set(k, []);
    bySub.get(k)!.push(r);
  });

  const results: ResultRow[] = [];
  let matched = 0;
  let duplicate = 0;
  let unmatched = 0;
  let fieldIssues = 0;
  let unavailable = 0;
  let normalCount = 0;

  for (const lg of lgRows) {
    const subRaw = getValue(lg, ['가입번호']);
    const sub = normalize(subRaw, 'subscriber');
    const candidates = sub ? bySub.get(sub) || [] : [];
    const lgName = getValue(lg, ['고객명']);

    if (candidates.length === 0) {
      unmatched++;
      results.push({
        status: '미매칭',
        kind: 'missing',
        channel: '미분류',
        sub,
        name: lgName,
        field: '가입번호',
        base: '',
        lg: subRaw || '빈 값',
        reason:
          '가입번호 원장 누락 — 가입번호가 원장에 존재하지 않습니다. 이름·전화번호 뒷자리·POS로 추정 매칭하지 않았습니다.',
      });
      continue;
    }

    if (candidates.length > 1) {
      duplicate++;
      results.push({
        status: '확인 필요',
        kind: 'review',
        channel: '미분류',
        sub,
        name: lgName,
        field: '가입번호',
        base: '',
        lg: subRaw,
        reason: `동일 가입번호 원장 중복 — 동일 가입번호가 원장에 ${candidates.length}건 존재하여 자동 매칭을 보류했습니다.`,
      });
      continue;
    }

    matched++;
    const base = candidates[0];
    const channel = resolveChannel(base);
    const baseName = getValue(base, ['고객명']) || lgName;
    let rowIssue = 0;

    for (const f of FIELDS) {
      const bv = getValue(base, f.base);
      const lv = getValue(lg, f.lg);
      if (!text(bv) || !text(lv)) {
        unavailable++;
        continue;
      }

      let same: boolean | null;
      if (f.key === 'name' && String(lv).includes('*')) {
        same = maskedNameCompatible(lv, bv);
      } else if (f.key === 'product' && (String(lv).includes('*') || String(bv).includes('*'))) {
        const l4 = last4(lv);
        same = !!l4 && l4 === last4(bv);
      } else {
        same = normalize(bv, f.key) === normalize(lv, f.key);
      }

      if (same === false) {
        rowIssue++;
        fieldIssues++;
        results.push({
          status: '값 불일치',
          kind: 'mismatch',
          channel,
          sub,
          name: baseName,
          field: f.label,
          base: text(bv),
          lg: text(lv),
          reason: `고객 매칭 성공 / ${f.label} 불일치`,
        });
      }
    }

    if (!rowIssue) {
      normalCount++;
      results.push({
        status: '정상',
        kind: 'ok',
        channel,
        sub,
        name: baseName,
        field: '전체 비교',
        base: '',
        lg: '',
        reason: '비교 가능한 항목이 모두 일치합니다.',
      });
    }
  }

  return {
    results,
    summary: { lg: lgRows.length, base: ledgerRows.length, matched, normal: normalCount, fieldIssues, review: duplicate + unmatched, unavailable },
  };
}

// ─────────────────────────────────────────────────────────
// React 컴포넌트
// ─────────────────────────────────────────────────────────

interface DateOption {
  date: string;
  count: number;
}

type StatusFilter = 'issues' | 'all' | 'mismatch' | 'missing' | 'review';

export function LgActivationAudit() {
  const apiRequest = useApiRequest();

  const [lgRows, setLgRows] = useState<Row[]>([]);
  const [lgDateKey, setLgDateKey] = useState<string | null>(null);
  const [lgFileLabel, setLgFileLabel] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [csvDateOptions, setCsvDateOptions] = useState<DateOption[]>([]);
  const [dateNeedsSelection, setDateNeedsSelection] = useState(false);
  const [auditDate, setAuditDate] = useState('');

  const [notice, setNotice] = useState('LG 복원 파일을 선택하면 검수를 실행할 수 있습니다.');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const [spreadsheetLabel, setSpreadsheetLabel] = useState('');
  const [sheetLabel, setSheetLabel] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('issues');
  const [searchQuery, setSearchQuery] = useState('');

  const lgRowsForAudit = useMemo(() => {
    if (!lgDateKey) return lgRows;
    if (!auditDate) return [];
    return lgRows.filter((r) => isoDateFromText(r[lgDateKey]) === auditDate);
  }, [lgRows, lgDateKey, auditDate]);

  const canRun = !!auditDate && !dateNeedsSelection && lgRowsForAudit.length > 0;

  async function handleLgFile(file: File) {
    setError('');
    setResults([]);
    setSummary(null);
    setNotice('파일을 읽는 중입니다...');
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('LG QR 복원 CSV 파일을 선택하세요.');
      const buf = await file.arrayBuffer();
      let src: string;
      try {
        src = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        src = new TextDecoder('euc-kr').decode(buf);
      }
      const matrix = parseCsv(src.replace(/^﻿/, ''));
      const rows = rowObjects(matrix);
      const dateKey = rows.length ? detect(Object.keys(rows[0]), ['처리일자']) : null;

      setLgRows(rows);
      setLgDateKey(dateKey);
      setLgFileLabel(`${file.name} · ${rows.length}건`);

      const dateCounts = new Map<string, number>();
      if (dateKey) {
        for (const r of rows) {
          const d = isoDateFromText(r[dateKey]);
          if (d) dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
        }
      }
      const distinctDates = Array.from(dateCounts.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (distinctDates.length === 1) {
        setAuditDate(distinctDates[0].date);
        setCsvDateOptions([]);
        setDateNeedsSelection(false);
        setNotice('준비되었습니다. 검수 실행 시 스프레드시트 최신 값을 불러옵니다.');
      } else if (distinctDates.length > 1) {
        setCsvDateOptions(distinctDates);
        setDateNeedsSelection(true);
        setAuditDate('');
        setNotice('CSV에 여러 처리일자가 있습니다. 검수할 날짜를 선택하세요.');
      } else {
        setCsvDateOptions([]);
        setDateNeedsSelection(false);
        setAuditDate('');
        setNotice('처리일자를 CSV에서 확인하지 못했습니다. 검수일을 직접 선택하세요.');
      }
    } catch (e: any) {
      setError('파일 읽기 오류: ' + (e?.message ?? String(e)));
    }
  }

  function selectAuditDate(date: string) {
    setAuditDate(date);
    setDateNeedsSelection(false);
    setError('');
    setNotice('준비되었습니다. 검수 실행 시 스프레드시트 최신 값을 불러옵니다.');
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLgFile(file);
  }

  async function runAudit() {
    if (!auditDate) {
      setError('검수일을 선택하세요.');
      return;
    }
    if (lgRowsForAudit.length === 0) {
      setError('검수 대상 CSV 행이 없습니다. 선택한 날짜의 데이터를 확인하세요.');
      return;
    }
    setRunning(true);
    setError('');
    setNotice('스프레드시트 최신 값을 조회하고 있습니다...');
    try {
      const payload = await apiRequest(`/api/lg-audit/sheet?date=${auditDate}`);
      const ledgerRows = (payload.rows || []) as Row[];
      setSpreadsheetLabel(payload.spreadsheet || '');
      setSheetLabel(payload.sheet || '');

      const { results: computedResults, summary: computedSummary } = computeResults(ledgerRows, lgRowsForAudit);
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
        (statusFilter === 'issues' && r.kind !== 'ok') ||
        (statusFilter === 'mismatch' && r.kind === 'mismatch') ||
        (statusFilter === 'missing' && r.kind === 'missing') ||
        (statusFilter === 'review' && r.kind === 'review');
      if (!statusOk) return false;
      if (!q) return true;
      return normalize(`${r.sub} ${r.name} ${r.channel}`, 'name').includes(q);
    });
  }, [results, statusFilter, searchQuery]);

  function exportCsv() {
    const data = [
      ['상태', '채널', '가입번호', '고객명', '문제항목', '스프레드시트', 'LG파일', '판정사유'],
      ...filteredResults.map((r) => [r.status, r.channel, r.sub, r.name, r.field, r.base, r.lg, r.reason]),
    ];
    const csv =
      '﻿' + data.map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LG_개통검수_${auditDate || 'unknown'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Layout title="LG 검수">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">LG 개통 검수</h1>
          <p className="text-sm text-muted-foreground mt-1">
            스프레드시트 원장과 LG 복원 파일을 가입번호 중심으로 대조합니다.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. LG 파일 및 검수일 설정</CardTitle>
            <CardDescription>스프레드시트 원장은 검수 실행 시 자동으로 연결됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-dashed p-4 bg-muted/30">
                <div className="font-medium text-sm">Google 스프레드시트 연결 상태</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {spreadsheetLabel ? `${spreadsheetLabel} · ${sheetLabel}` : '검수를 실행하면 자동으로 연결됩니다.'}
                </div>
              </div>

              <label
                onDrop={onDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                className={cn(
                  'flex flex-col items-center justify-center rounded-md border-2 border-dashed p-4 cursor-pointer text-center min-h-[96px] transition-colors',
                  dragActive ? 'border-primary bg-primary/5' : 'border-input bg-background hover:bg-muted/40',
                )}
              >
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleLgFile(e.target.files[0])}
                />
                <div className="font-medium text-sm">LG 복원 파일</div>
                <div className="text-xs text-muted-foreground mt-0.5">QR 그리드 복원 결과 · CSV (선택 또는 드래그 앤 드롭)</div>
                <div className="text-xs text-primary mt-1 truncate max-w-full">{lgFileLabel || '파일 선택'}</div>
              </label>
            </div>

            {dateNeedsSelection && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <div className="text-sm font-semibold text-amber-800">CSV에 여러 처리일자가 있습니다</div>
                <div className="text-sm text-amber-700 mt-1">
                  검수할 날짜를 선택하세요. 선택한 날짜의 CSV 행만 검수 대상이 되고, 스프레드시트 원장도 같은 날짜로만 조회합니다.
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

            <div className="grid gap-4 md:grid-cols-[220px_1fr_150px] items-end">
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
                <label className="text-sm font-medium block mb-1">원장 시트</label>
                <Input value="개통처리부 (자동 연결)" disabled />
              </div>
              <Button onClick={runAudit} disabled={!canRun || running}>
                {running ? '검수 중...' : '검수 실행'}
              </Button>
            </div>

            {error ? (
              <p className="text-sm text-red-600 font-semibold">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{notice}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. 적용 중인 매칭 규칙</CardTitle>
            <CardDescription>가입번호로 고객을 확정한 뒤 양쪽에서 같은 의미로 확인되는 항목만 비교합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <RuleCard tag="1순위" title="가입번호 정확 일치" desc="중복이 없을 때만 자동 확정" />
              <RuleCard tag="예외" title="복수 후보 자동 보류" desc="후보가 2건 이상이면 작업자 확인" />
              <RuleCard tag="검사항목" title="공통 값만 비교" desc="요금제·개통유형·POS·상품번호·고객명" />
              <RuleCard tag="표기 보정" title="시스템별 부가표시 제외" desc="개통유형 코드와 요금제 충전개월 표기를 자동 보정" />
            </div>
          </CardContent>
        </Card>

        {summary && (
          <>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard label="LG 검수대상" value={summary.lg} />
              <SummaryCard label="원장 대상일" value={summary.base} />
              <SummaryCard label="매칭 완료" value={summary.matched} tone="good" />
              <SummaryCard label="정상 행" value={summary.normal} tone="good" />
              <SummaryCard label="불일치 항목" value={summary.fieldIssues} tone="issue" />
              <SummaryCard label="확인 필요" value={summary.review} tone="issue" />
            </div>

            <Card>
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-base">검수 결과</CardTitle>
                  <CardDescription>
                    {auditDate} 기준 · 양쪽에 같은 의미의 값이 있는 항목만 비교했습니다. 비교 항목의 빈 값 {summary.unavailable}
                    개는 불일치에 포함하지 않았습니다.
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="w-[135px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="issues">이상 건만</SelectItem>
                      <SelectItem value="all">전체 보기</SelectItem>
                      <SelectItem value="mismatch">값 불일치</SelectItem>
                      <SelectItem value="missing">누락/미매칭</SelectItem>
                      <SelectItem value="review">확인 필요</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="채널·가입번호·고객명 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-[210px]"
                  />
                  <Button variant="outline" onClick={exportCsv}>
                    결과 CSV 저장
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center text-xs text-muted-foreground mb-2 gap-1">
                  <LegendDot className="bg-red-500" />
                  값 불일치
                  <LegendDot className="bg-amber-500 ml-3" />
                  확인 필요
                  <LegendDot className="bg-gray-400 ml-3" />
                  비교 불가
                </div>
                <div className="overflow-auto border rounded-md max-h-[620px]">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left font-medium">상태</th>
                        <th className="p-2 text-left font-medium">채널</th>
                        <th className="p-2 text-left font-medium">가입번호</th>
                        <th className="p-2 text-left font-medium">고객명</th>
                        <th className="p-2 text-left font-medium">문제항목</th>
                        <th className="p-2 text-left font-medium">스프레드시트</th>
                        <th className="p-2 text-left font-medium">LG 파일</th>
                        <th className="p-2 text-left font-medium">판정 사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r, i) => (
                        <tr key={i} className="border-t hover:bg-muted/40">
                          <td className="p-2">
                            <StatusBadge kind={r.kind}>{r.status}</StatusBadge>
                          </td>
                          <td className="p-2">{r.channel}</td>
                          <td className="p-2">{r.sub}</td>
                          <td className="p-2">{r.name}</td>
                          <td className="p-2">{r.field}</td>
                          <td className="p-2">{r.base || '-'}</td>
                          <td className="p-2">{r.lg || '-'}</td>
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

function RuleCard({ tag, title, desc }: { tag: string; title: string; desc: string }) {
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

function LegendDot({ className }: { className?: string }) {
  return <span className={cn('inline-block w-2 h-2 rounded-full', className)} />;
}

function StatusBadge({ kind, children }: { kind: ResultKind; children: React.ReactNode }) {
  const styles: Record<ResultKind, string> = {
    mismatch: 'bg-red-100 text-red-700',
    review: 'bg-amber-100 text-amber-800',
    missing: 'bg-slate-100 text-slate-600',
    ok: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap', styles[kind])}>
      {children}
    </span>
  );
}
