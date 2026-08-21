import React from 'react';
import { Button } from '@/components/ui/button';

export interface McodeUploadResult {
  totalRows: number;
  readRows: number;
  drCreated: number;
  drUpdated: number;
  ccCreated: number;
  ccUpdated: number;
  needReview: number;
  failed: number;
  reviewSamples: { row: number; reason: string; mCode?: string; name?: string }[];
  failedSamples: { row: number; reason: string }[];
}

interface McodeUploadResultSummaryProps {
  result: McodeUploadResult;
  onReset: () => void;
  onClose: () => void;
}

export function McodeUploadResultSummary({ result, onReset, onClose }: McodeUploadResultSummaryProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div className="p-2 bg-gray-50 rounded border">
          <p className="text-xs text-gray-500">전체행</p>
          <p className="text-lg font-bold">{result.totalRows}</p>
        </div>
        <div className="p-2 bg-gray-50 rounded border">
          <p className="text-xs text-gray-500">읽은행</p>
          <p className="text-lg font-bold">{result.readRows}</p>
        </div>
        <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
          <p className="text-xs text-yellow-600">검토필요</p>
          <p className="text-lg font-bold text-yellow-700">{result.needReview}</p>
        </div>
        <div className="p-2 bg-red-50 rounded border border-red-200">
          <p className="text-xs text-red-600">실패</p>
          <p className="text-lg font-bold text-red-700">{result.failed}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div className="p-2 bg-green-50 rounded border border-green-200">
          <p className="text-xs text-green-600">판매점 신규</p>
          <p className="text-lg font-bold text-green-700">{result.drCreated}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded border border-blue-200">
          <p className="text-xs text-blue-600">판매점 갱신</p>
          <p className="text-lg font-bold text-blue-700">{result.drUpdated}</p>
        </div>
        <div className="p-2 bg-green-50 rounded border border-green-200">
          <p className="text-xs text-green-600">접점코드 신규</p>
          <p className="text-lg font-bold text-green-700">{result.ccCreated}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded border border-blue-200">
          <p className="text-xs text-blue-600">접점코드 갱신</p>
          <p className="text-lg font-bold text-blue-700">{result.ccUpdated}</p>
        </div>
      </div>
      {result.reviewSamples.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-yellow-700 mb-1">검토필요 샘플 (최대 20건)</p>
          <div className="max-h-36 overflow-y-auto border rounded p-2 bg-yellow-50 space-y-1">
            {result.reviewSamples.map((r, i) => (
              <p key={i} className="text-xs text-yellow-800">
                행 {r.row}: {r.reason}{r.mCode ? ` [M코드: ${r.mCode}]` : ''}{r.name ? ` (${r.name})` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
      {result.failedSamples.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-red-700 mb-1">실패 샘플 (최대 20건)</p>
          <div className="max-h-28 overflow-y-auto border rounded p-2 bg-red-50 space-y-1">
            {result.failedSamples.map((r, i) => (
              <p key={i} className="text-xs text-red-700">행 {r.row}: {r.reason}</p>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onReset}>다시 업로드</Button>
        <Button onClick={onClose}>닫기</Button>
      </div>
    </div>
  );
}
