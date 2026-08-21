import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { McodeUploadResultSummary, type McodeUploadResult } from './McodeUploadResultSummary';

interface McodeMasterUploadPanelProps {
  onUploadSuccess: () => void;
}

export function McodeMasterUploadPanel({ onUploadSuccess }: McodeMasterUploadPanelProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<McodeUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleOpen = () => {
    setResult(null);
    setOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/dealer-registrations/mcode-master-upload', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '업로드 실패');
      setResult(data);
      if (data.drCreated > 0 || data.drUpdated > 0) onUploadSuccess();
    } catch (err: any) {
      toast({ title: 'M코드 원장 업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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

      <Dialog open={open} onOpenChange={setOpen}>
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
                <p className="mt-2 text-xs text-gray-500">.xlsx 파일만 지원됩니다</p>
              </div>
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
