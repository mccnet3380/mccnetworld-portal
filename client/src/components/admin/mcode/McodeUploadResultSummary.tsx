import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface RowDetailItem {
  row: number;
  reason: string;
  mCode?: string;
  name?: string;
  subDealer?: string;
  channel?: string;
  contactCodeB?: string;
  contactCodeH?: string;
}

export interface McodeUploadResult {
  totalRows: number;
  readRows: number;
  processedRows?: number;
  drCreated: number;
  drUpdated: number;
  ccCreated: number;
  ccUpdated: number;
  needReview: number;
  skippedRows?: number;
  failed: number;
  elapsedSec?: number;
  reviewSamples: RowDetailItem[];
  skippedSamples?: RowDetailItem[];
  failedSamples: { row: number; reason: string }[];
}

// ── 아코디언 상세 섹션 ────────────────────────────────────────────────────
interface AccordionSectionProps {
  title: string;
  count: number;
  badgeColor: 'yellow' | 'gray' | 'red';
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function AccordionSection({ title, count, badgeColor, defaultOpen = false, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const badge = {
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    gray:   'bg-gray-100  text-gray-700   border-gray-300',
    red:    'bg-red-100   text-red-800    border-red-300',
  }[badgeColor];

  const border = {
    yellow: 'border-yellow-200',
    gray:   'border-gray-200',
    red:    'border-red-200',
  }[badgeColor];

  return (
    <div className={`border rounded ${border}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-gray-700">{title}</span>
        <span className="flex items-center gap-2">
          <span className={`border rounded px-1.5 py-0.5 text-xs font-bold ${badge}`}>{count}건</span>
          <span className="text-gray-400 text-xs">{open ? '▲ 접기' : '▼ 상세 보기'}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}

// ── 행 상세 테이블 (검토필요/스킵 공용) ──────────────────────────────────
// 셀 공통 스타일: table-layout:fixed 환경에서 overflow:hidden + ellipsis
const cellBase: React.CSSProperties = {
  padding: '2px 5px',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #f3f4f6',
};

function RowDetailTable({ items, reasonLabel }: { items: RowDetailItem[]; reasonLabel: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 20);

  if (items.length === 0) {
    return <p className="px-3 py-2 text-xs text-gray-400">없음</p>;
  }

  return (
    <div>
      {/*
        레이아웃 원칙:
        - 바깥 div: overflow:hidden → 테이블이 이 박스 밖으로 절대 나가지 않음
        - 안쪽 div: overflow-x:auto → 내용이 넘칠 때 내부 가로 스크롤
        - table: table-layout:fixed + width:100% → 컬럼 폭을 colgroup 기준으로 고정
        - min-width:420px → 최소 가독성 확보, 부족하면 내부 스크롤
      */}
      <div style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', overflowX: 'auto', overflowY: 'auto', maxHeight: 220 }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: 420 }}>
            <colgroup>
              <col style={{ width: 30 }} />   {/* 행 */}
              <col style={{ width: 54 }} />   {/* M코드 */}
              <col style={{ width: 88 }} />   {/* 판매점명 */}
              <col style={{ width: 76 }} />   {/* 하부점명 */}
              <col style={{ width: 38 }} />   {/* 채널 */}
              <col style={{ width: 68 }} />   {/* B열 */}
              <col style={{ width: 68 }} />   {/* H열 */}
              <col />                         {/* 사유 — 나머지 공간 모두 */}
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }}>
                {['행', 'M코드', '판매점명', '하부점명', '채널', 'B열', 'H열', reasonLabel].map((h) => (
                  <th
                    key={h}
                    style={{
                      ...cellBase,
                      fontWeight: 600,
                      fontSize: 10,
                      color: '#6b7280',
                      borderBottom: '1px solid #e5e7eb',
                      backgroundColor: '#f9fafb',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ ...cellBase, color: '#92400e', fontWeight: 600 }}>{r.row}</td>
                  <td style={{ ...cellBase, fontFamily: 'monospace' }} title={r.mCode}>{r.mCode || '-'}</td>
                  <td style={{ ...cellBase }} title={r.name}>{r.name || '-'}</td>
                  <td style={{ ...cellBase }} title={r.subDealer}>{r.subDealer || '-'}</td>
                  <td style={{ ...cellBase }}>{r.channel || '-'}</td>
                  <td style={{ ...cellBase, color: r.contactCodeB ? '#b45309' : '#9ca3af' }} title={r.contactCodeB}>{r.contactCodeB || '-'}</td>
                  <td style={{ ...cellBase, color: r.contactCodeH ? '#b45309' : '#9ca3af' }} title={r.contactCodeH}>{r.contactCodeH || '-'}</td>
                  <td style={{ ...cellBase, color: '#374151' }} title={r.reason}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {items.length > 20 && (
        <div className="px-3 py-1.5 border-t border-gray-100 text-right">
          <button
            className="text-xs text-blue-600 underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? '접기' : `전체 ${items.length}건 보기`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
interface McodeUploadResultSummaryProps {
  result: McodeUploadResult;
  onReset: () => void;
  onClose: () => void;
}

export function McodeUploadResultSummary({ result, onReset, onClose }: McodeUploadResultSummaryProps) {
  const limitNote =
    result.processedRows != null && result.processedRows < result.totalRows
      ? ` (${result.processedRows.toLocaleString()}행 제한 처리)`
      : '';
  const elapsedNote = result.elapsedSec != null ? ` · ${result.elapsedSec}초` : '';
  const skipped = result.skippedRows ?? 0;
  const skippedSamples = result.skippedSamples ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* 처리 정보 메모 */}
      {(limitNote || elapsedNote) && (
        <p className="text-xs text-gray-400 text-right">{limitNote}{elapsedNote}</p>
      )}

      {/* ── 요약 카드 1행: 행 수 / 검토필요 / 실패 ──────────────────────── */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 bg-gray-50 rounded border">
          <p className="text-xs text-gray-500">전체행</p>
          <p className="text-base font-bold">{result.totalRows}</p>
        </div>
        <div className="p-2 bg-gray-50 rounded border">
          <p className="text-xs text-gray-500">읽은행</p>
          <p className="text-base font-bold">{result.readRows}</p>
        </div>
        <div className={`p-2 rounded border ${result.needReview > 0 ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}>
          <p className={`text-xs ${result.needReview > 0 ? 'text-yellow-700' : 'text-gray-500'}`}>검토필요</p>
          <p className={`text-base font-bold ${result.needReview > 0 ? 'text-yellow-700' : 'text-gray-700'}`}>{result.needReview}</p>
        </div>
        <div className={`p-2 rounded border ${result.failed > 0 ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'}`}>
          <p className={`text-xs ${result.failed > 0 ? 'text-red-600' : 'text-gray-500'}`}>실패</p>
          <p className={`text-base font-bold ${result.failed > 0 ? 'text-red-600' : 'text-gray-700'}`}>{result.failed}</p>
        </div>
      </div>

      {/* ── 요약 카드 2행: 판매점/접점코드/스킵 ─────────────────────────── */}
      <div className="grid grid-cols-5 gap-2 text-center">
        <div className="p-2 bg-green-50 rounded border border-green-200">
          <p className="text-xs text-green-600">판매점 신규</p>
          <p className="text-base font-bold text-green-700">{result.drCreated}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded border border-blue-200">
          <p className="text-xs text-blue-600">판매점 갱신</p>
          <p className="text-base font-bold text-blue-700">{result.drUpdated}</p>
        </div>
        <div className="p-2 bg-green-50 rounded border border-green-200">
          <p className="text-xs text-green-600">접점코드 신규</p>
          <p className="text-base font-bold text-green-700">{result.ccCreated}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded border border-blue-200">
          <p className="text-xs text-blue-600">접점코드 갱신</p>
          <p className="text-base font-bold text-blue-700">{result.ccUpdated}</p>
        </div>
        <div className="p-2 bg-gray-50 rounded border border-gray-200">
          <p className="text-xs text-gray-500">대표행 스킵</p>
          <p className="text-base font-bold text-gray-600">{skipped}</p>
        </div>
      </div>

      {/* ── 상세 아코디언 (기본 접힘, 클릭 시 모달 내부 스크롤) ─────────── */}
      <div className="space-y-1.5">
        <AccordionSection
          title="검토필요 — contact_codes 미저장 (원장 확인 필요)"
          count={result.reviewSamples.length}
          badgeColor="yellow"
        >
          <RowDetailTable items={result.reviewSamples} reasonLabel="사유" />
        </AccordionSection>

        <AccordionSection
          title="대표행 스킵 — H열 접점코드 없음, CC 미저장 (정상)"
          count={skippedSamples.length}
          badgeColor="gray"
        >
          <RowDetailTable items={skippedSamples} reasonLabel="스킵 사유" />
        </AccordionSection>

        <AccordionSection
          title="실패"
          count={result.failedSamples.length}
          badgeColor="red"
        >
          {result.failedSamples.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">없음</p>
          ) : (
            <div style={{ maxHeight: 160, overflowY: 'auto' }} className="p-2 space-y-0.5">
              {result.failedSamples.map((r, i) => (
                <p key={i} className="text-xs text-red-700">행 {r.row}: {r.reason}</p>
              ))}
            </div>
          )}
        </AccordionSection>
      </div>

      {/* ── 버튼 (항상 하단 고정) ─────────────────────────────────────────── */}
      <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
        <Button variant="outline" size="sm" onClick={onReset}>다시 업로드</Button>
        <Button size="sm" onClick={onClose}>닫기</Button>
      </div>
    </div>
  );
}
