import React, { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { McodeUploadResultSummary, type McodeUploadResult } from './McodeUploadResultSummary';

// 업로드 타임아웃: 10분 (대용량 파일 고려)
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

type LimitOption = '100' | '1000' | '5000' | 'all';

interface McodeMasterUploadPanelProps {
  onUploadSuccess: () => void;
}

export function McodeMasterUploadPanel({ onUploadSuccess }: McodeMasterUploadPanelProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<McodeUploadResult | null>(null);
  const [limitRows, setLimitRows] = useState<LimitOption>('all');
  const [elapsedSec, setElapsedSec] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  // 경과 시간 타이머
  const startTimer = () => {
    setElapsedSec(0);
    timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => () => { stopTimer(); abortRef.current?.abort(); }, []);

  const handleOpen = () => {
    setResult(null);
    setElapsedSec(0);
    setOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResult(null);
    startTimer();

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const sessionId = useAuth.getState().sessionId;

      const url = limitRows !== 'all'
        ? `/api/admin/dealer-registrations/mcode-master-upload?limit=${limitRows}`
        : '/api/admin/dealer-registrations/mcode-master-upload';

      const resp = await fetch(url, {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
        signal: controller.signal,
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '업로드 실패');
      setResult(data);
      if (data.drCreated > 0 || data.drUpdated > 0) onUploadSuccess();
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      toast({
        title: isTimeout ? 'M코드 업로드 타임아웃' : 'M코드 원장 업로드 실패',
        description: isTimeout
          ? `${UPLOAD_TIMEOUT_MS / 60000}분 내 응답 없음. 행 제한을 줄여서 재시도하세요.`
          : err.message,
        variant: 'destructive',
      });
    } finally {
      clearTimeout(timeoutId);
      stopTimer();
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const formatElapsed = (sec: number) => {
    if (sec < 60) return `${sec}초`;
    return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  };

  return (
    <>
      <Button
        variant="outline"
        className="border-blue-400 text-blue-700 hover:bg-blue-50"
        onClick={handleOpen}
      >
        <Upload className="mr-2 h-4 w-4" />
        M코드 기준 원장 업로드
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!uploading) setOpen(v); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>M코드 기준 원장 업로드</DialogTitle>
            <DialogDescription>
              실제 M코드/판매점 내역 엑셀을 업로드하여 판매점 원장과 접점코드 원장을 자동 생성/갱신합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800 space-y-1">
              <p className="font-semibold">엑셀 컬럼 순서 (A~J)</p>
              <p className="font-mono text-xs">A:판매점명 | B:접점코드 | C:판매점명(수식) | D:별칭 | E:하부점명 | F:채널 | G:M코드 | H:접점코드 | I:KP번호 | J:지역명</p>
              <p className="text-xs text-blue-600 mt-1">G열 M코드가 없는 행은 검토필요로 분류됩니다. 삭제점/제외/개인/테스트 포함 행도 검토필요로 분류됩니다.</p>
              <p className="text-xs text-blue-600">같은 파일 재업로드 시 중복 생성 없이 갱신됩니다.</p>
            </div>

            {!result ? (
              <>
                {/* 행 제한 선택 (테스트용) */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 whitespace-nowrap">처리 행 수 제한:</span>
                  <Select value={limitRows} onValueChange={(v) => setLimitRows(v as LimitOption)} disabled={uploading}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100">100행 (테스트)</SelectItem>
                      <SelectItem value="1000">1,000행</SelectItem>
                      <SelectItem value="5000">5,000행</SelectItem>
                      <SelectItem value="all">전체 (운영)</SelectItem>
                    </SelectContent>
                  </Select>
                  {limitRows !== 'all' && (
                    <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-1 rounded">
                      테스트 모드 — 상위 {limitRows}행만 처리
                    </span>
                  )}
                </div>

                <div className="border-2 border-dashed border-blue-300 rounded-lg p-6 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <Upload className="mx-auto h-10 w-10 text-blue-400 mb-3" />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-blue-400 text-blue-700"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? '처리 중...' : '파일 선택'}
                  </Button>
                  {uploading && (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm text-blue-700 font-medium animate-pulse">
                        서버에서 처리 중입니다. 창을 닫지 마세요.
                      </p>
                      <p className="text-xs text-gray-500">
                        경과 시간: {formatElapsed(elapsedSec)} / 최대 {UPLOAD_TIMEOUT_MS / 60000}분
                      </p>
                      <p className="text-xs text-gray-400">
                        대용량 파일(2만 행+)은 수 분이 소요될 수 있습니다.
                      </p>
                    </div>
                  )}
                  {!uploading && <p className="mt-2 text-xs text-gray-500">.xlsx 파일만 지원됩니다</p>}
                </div>
              </>
            ) : (
              <McodeUploadResultSummary
                result={result}
                onReset={() => setResult(null)}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
