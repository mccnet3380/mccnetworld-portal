// client/src/components/TrainingEditor.tsx
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료 작성/수정 모달(ADMIN 전용). 무거운 리치에디터 대신 shared/training-markdown.ts의
// 경량 서브셋 textarea + 실시간 미리보기를 사용한다. TrainingCenter(신규 작성)와
// TrainingArticleDetail(수정) 양쪽에서 재사용한다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { renderTrainingContentToHtml, TRAINING_CATEGORIES, TRAINING_CATEGORY_LABEL, type TrainingCategory } from "@shared/training-markdown";
import { Loader2, Image as ImageIcon, Trash2 } from "lucide-react";

export interface TrainingArticleData {
  id: number;
  title: string;
  summary: string | null;
  category: TrainingCategory;
  content: string;
  status: "DRAFT" | "PUBLISHED";
  isPinned: boolean;
  sortOrder: number;
}

interface AttachmentData {
  id: number;
  originalName: string;
  attachmentType: "IMAGE" | "VIDEO" | "PDF" | "FILE";
  fileSize: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  article: TrainingArticleData | null; // null = 신규 작성
  onSaved: () => void;
}

export function TrainingEditor({ open, onClose, article, onSaved }: Props) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<TrainingCategory>("ALL");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [isPinned, setIsPinned] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (article) {
      setTitle(article.title);
      setSummary(article.summary || "");
      setCategory(article.category);
      setContent(article.content);
      setStatus(article.status);
      setIsPinned(article.isPinned);
      setSortOrder(article.sortOrder);
      setSavedId(article.id);
      apiRequest(`/api/training/articles/${article.id}`)
        .then((res) => setAttachments(res.attachments || []))
        .catch(() => setAttachments([]));
    } else {
      setTitle("");
      setSummary("");
      setCategory("ALL");
      setContent("");
      setStatus("DRAFT");
      setIsPinned(false);
      setSortOrder(0);
      setSavedId(null);
      setAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, article]);

  async function handleSave() {
    if (!title.trim()) {
      toast({ title: "제목을 입력하세요.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = { title, summary, category, content, status, isPinned, sortOrder };
      if (savedId) {
        await apiRequest(`/api/training/articles/${savedId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await apiRequest("/api/training/articles", { method: "POST", body: JSON.stringify(body) });
        setSavedId(res.article.id);
      }
      toast({ title: "저장되었습니다." });
      onSaved();
    } catch (e: any) {
      toast({ title: "저장 실패", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    if (!savedId) {
      toast({ title: "먼저 저장한 뒤 첨부파일을 추가할 수 있습니다.", description: "제목만 입력하고 저장을 눌러주세요.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiRequest(`/api/training/articles/${savedId}/attachments`, { method: "POST", body: formData });
      const att: AttachmentData = res.attachment;
      setAttachments((prev) => [...prev, att]);
      if (att.attachmentType === "IMAGE") {
        setContent((prev) => `${prev}${prev ? "\n" : ""}![](/api/training/attachments/${att.id}/file)`);
      }
    } catch (e: any) {
      toast({ title: "업로드 실패", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(id: number) {
    try {
      await apiRequest(`/api/training/attachments/${id}`, { method: "DELETE" });
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      toast({ title: "삭제 실패", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{article ? "교육자료 수정" : "새 교육자료"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>제목 *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: KT 번호이동 개통 절차" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>요약</Label>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="목록에 표시될 한 줄 요약" />
            </div>
            <div className="space-y-1">
              <Label>카테고리</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TrainingCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{TRAINING_CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>게시상태</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "DRAFT" | "PUBLISHED")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">초안</SelectItem>
                  <SelectItem value="PUBLISHED">게시</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pinned" checked={isPinned} onCheckedChange={(v) => setIsPinned(Boolean(v))} />
              <Label htmlFor="pinned">상단 고정</Label>
            </div>
            <div className="space-y-1">
              <Label>노출 순서(작을수록 먼저)</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
            </div>
          </div>

          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">본문 작성</TabsTrigger>
              <TabsTrigger value="preview">미리보기</TabsTrigger>
            </TabsList>
            <TabsContent value="write" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                문법: <code># 제목</code> <code>## 소제목</code> <code>**굵게**</code> <code>[!주의] 문구</code> <code>[!경고] 문구</code> <code>[!팁] 문구</code>
              </p>
              <Textarea rows={14} value={content} onChange={(e) => setContent(e.target.value)} placeholder="본문을 입력하세요." />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  이미지 삽입
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
                </label>
                <label className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "첨부파일 추가"}
                  <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
                </label>
                {!savedId && <span className="text-xs text-muted-foreground">※ 먼저 저장해야 첨부파일을 추가할 수 있습니다.</span>}
              </div>
              {attachments.length > 0 && (
                <div className="space-y-1">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-sm border rounded-md px-2 py-1">
                      <span>{a.attachmentType} · {a.originalName} ({(a.fileSize / 1024).toFixed(0)}KB)</span>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteAttachment(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="preview">
              <div className="border rounded-md p-4 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderTrainingContentToHtml(content) }} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}저장
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
