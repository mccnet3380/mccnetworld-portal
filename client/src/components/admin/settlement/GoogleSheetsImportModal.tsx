// client/src/components/admin/settlement/GoogleSheetsImportModal.tsx
//
// 작업명: MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
//
// "정산 결과 관리" 화면의 "Google Sheets에서 가져오기" 버튼이 여는 모달.
// V1 source는 "개통처리부" 하나만 지원(백엔드가 강제) — 00700결합/데이터유심/인터넷은
// 이번 범위 아님. Preview(DB 무변경) → 사용자 확인 → 실제 Import(activation_records
// 생성 + 기존 판매점 매칭) 2단계로 구성한다. 금액 정산 데이터라 Preview 없이 바로
// 저장하지 않는다.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Cloud, Loader2 } from "lucide-react";

interface PreviewResult {
  spreadsheetName: string;
  sourceSheet: string;
  totalRows: number;
  willCreate: number;
  duplicateExisting: number;
  duplicateWithinBatch: number;
  missingRequired: number;
  dedupeUnknownCount: number;
  errors: { row: number; reason: string }[];
}

interface ImportResult {
  spreadsheetName: string;
  sourceSheet: string;
  totalRows: number;
  created: number;
  duplicateSkipped: number;
  errorSkipped: number;
  dedupeUnknownCount: number;
  errors: { row: number; reason: string }[];
}

interface Props {
  onImportSuccess: () => void;
}

export function GoogleSheetsImportModal({ onImportSuccess }: Props) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();

  const today = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  function resetForOpen() {
    setPreview(null);
    setPreviewError("");
    setImportResult(null);
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    setPreviewError("");
    setImportResult(null);
    try {
      const res: PreviewResult = await apiRequest("/api/admin/settlement/google-sheets/preview", {
        method: "POST",
        body: JSON.stringify({ year, month }),
      });
      setPreview(res);
    } catch (e: any) {
      setPreviewError(e.message || "Preview 실패");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const res: ImportResult = await apiRequest("/api/admin/settlement/google-sheets/import", {
        method: "POST",
        body: JSON.stringify({ year, month }),
      });
      setImportResult(res);
      toast({ title: "Import 완료", description: `신규 ${res.created}건, 중복 제외 ${res.duplicateSkipped}건, 오류 제외 ${res.errorSkipped}건` });
      onImportSuccess();
    } catch (e: any) {
      toast({ title: "Import 실패", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { resetForOpen(); setOpen(true); }}
      >
        <Cloud className="h-4 w-4 mr-1" />
        Google Sheets에서 가져오기
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!previewing && !importing) setOpen(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Google Sheets에서 개통 데이터 가져오기</DialogTitle>
            <DialogDescription>
              해당 월 ★개통현황 Spreadsheet의 "개통처리부" 시트를 정산용 개통 데이터로 가져옵니다.
              가져오기 전 항상 Preview로 먼저 확인합니다. (현재 버전은 개통처리부만 지원 — 00700결합/데이터유심/인터넷은 이번 범위가 아닙니다.)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">정산 대상 월</span>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))} disabled={previewing || importing}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))} disabled={previewing || importing}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handlePreview} disabled={previewing || importing}>
                {previewing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Preview
              </Button>
            </div>

            {previewError && (
              <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">{previewError}</div>
            )}

            {preview && !importResult && (
              <div className="space-y-2 border rounded-md p-3 bg-gray-50">
                <div className="text-xs text-gray-500">연결 Spreadsheet: <span className="font-medium text-gray-800">{preview.spreadsheetName}</span> · Source: <span className="font-medium text-gray-800">{preview.sourceSheet}</span></div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white rounded p-2 border"><div className="text-lg font-bold">{preview.totalRows}</div><div className="text-[11px] text-gray-500">원본 행</div></div>
                  <div className="bg-green-50 rounded p-2 border border-green-200"><div className="text-lg font-bold text-green-700">{preview.willCreate}</div><div className="text-[11px] text-gray-500">신규 예정</div></div>
                  <div className="bg-yellow-50 rounded p-2 border border-yellow-200"><div className="text-lg font-bold text-yellow-700">{preview.duplicateExisting + preview.duplicateWithinBatch}</div><div className="text-[11px] text-gray-500">중복 제외</div></div>
                  <div className="bg-red-50 rounded p-2 border border-red-200"><div className="text-lg font-bold text-red-700">{preview.missingRequired}</div><div className="text-[11px] text-gray-500">필수값 누락</div></div>
                  <div className="bg-red-50 rounded p-2 border border-red-200"><div className="text-lg font-bold text-red-700">{preview.errors.length}</div><div className="text-[11px] text-gray-500">오류</div></div>
                  <div className="bg-gray-100 rounded p-2 border"><div className="text-lg font-bold text-gray-600">{preview.dedupeUnknownCount}</div><div className="text-[11px] text-gray-500">중복검사 불가</div></div>
                </div>
                {preview.errors.length > 0 && (
                  <div className="max-h-32 overflow-auto text-xs border rounded bg-white p-2 space-y-0.5">
                    {preview.errors.map((e, i) => (
                      <div key={i}>행 {e.row}: {e.reason}</div>
                    ))}
                  </div>
                )}
                <Button className="w-full" onClick={handleImport} disabled={importing || preview.willCreate === 0}>
                  {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  가져오기 ({preview.willCreate}건)
                </Button>
              </div>
            )}

            {importResult && (
              <div className="space-y-2 border rounded-md p-3 bg-blue-50 border-blue-200">
                <div className="text-sm font-semibold text-blue-800">Import 완료</div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-lg font-bold text-green-700">{importResult.created}</div><div className="text-[11px] text-gray-500">신규 생성</div></div>
                  <div><div className="text-lg font-bold text-yellow-700">{importResult.duplicateSkipped}</div><div className="text-[11px] text-gray-500">중복 제외</div></div>
                  <div><div className="text-lg font-bold text-red-700">{importResult.errorSkipped}</div><div className="text-[11px] text-gray-500">오류 제외</div></div>
                </div>
                <p className="text-xs text-gray-500">정산 결과 관리 목록이 갱신되었습니다. 판매점/정책 매칭은 기존 "자동 매칭 실행" 버튼을 눌러 진행하세요.</p>
                <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>닫기</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
