// client/src/pages/TrainingArticleDetail.tsx
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료 상세 화면 — 본문(경량 마크다운 렌더), 첨부파일(이미지/영상/PDF/기타) 표시.
// ADMIN에게는 편집/삭제/게시/고정 버튼이 추가로 보인다.

import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApiRequest, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { TrainingEditor, type TrainingArticleData } from "@/components/TrainingEditor";
import { renderTrainingContentToHtml, TRAINING_CATEGORY_LABEL, type TrainingCategory } from "@shared/training-markdown";
import { ArrowLeft, Edit, Trash2, Pin, FileText, Download, Video, File as FileIcon } from "lucide-react";

interface AttachmentData {
  id: number;
  originalName: string;
  attachmentType: "IMAGE" | "VIDEO" | "PDF" | "FILE";
  fileSize: number;
  mimeType: string;
}

const CATEGORY_COLOR: Record<TrainingCategory, string> = {
  ALL: "#5b6b82",
  SK: "#ef7f47",
  KT: "#2c74e8",
  LG: "#7e5bef",
  OTHER: "#22b57d",
};

export function TrainingArticleDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.userType === "admin";

  const [article, setArticle] = useState<TrainingArticleData | null>(null);
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(`/api/training/articles/${params.id}`);
      setArticle(res.article);
      setAttachments(res.attachments || []);
    } catch (e: any) {
      setError(e.message || "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleDelete() {
    if (!article || !confirm(`"${article.title}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await apiRequest(`/api/training/articles/${article.id}`, { method: "DELETE" });
      navigate("/training");
    } catch (e: any) {
      toast({ title: "삭제 실패", description: e.message, variant: "destructive" });
    }
  }

  async function togglePublish() {
    if (!article) return;
    try {
      await apiRequest(`/api/training/articles/${article.id}`, { method: "PATCH", body: JSON.stringify({ status: article.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" }) });
      load();
    } catch (e: any) {
      toast({ title: "변경 실패", description: e.message, variant: "destructive" });
    }
  }

  async function togglePin() {
    if (!article) return;
    try {
      await apiRequest(`/api/training/articles/${article.id}`, { method: "PATCH", body: JSON.stringify({ isPinned: !article.isPinned }) });
      load();
    } catch (e: any) {
      toast({ title: "변경 실패", description: e.message, variant: "destructive" });
    }
  }

  const images = attachments.filter((a) => a.attachmentType === "IMAGE");
  const others = attachments.filter((a) => a.attachmentType !== "IMAGE");

  return (
    <Layout title="교육자료">
      <div className="space-y-4 max-w-3xl">
        <Link href="/training" className="inline-flex items-center text-sm text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="h-4 w-4 mr-1" />목록으로
        </Link>

        {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
        {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}

        {!loading && !error && article && (
          <>
            <Card>
              <CardContent className="py-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {article.isPinned && <Pin className="h-4 w-4 text-amber-500" />}
                      <Badge style={{ background: CATEGORY_COLOR[article.category], color: "#fff" }}>{TRAINING_CATEGORY_LABEL[article.category]}</Badge>
                      {article.status === "DRAFT" && <Badge variant="outline">초안</Badge>}
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">{article.title}</h1>
                    {article.summary && <p className="text-sm text-muted-foreground mt-1">{article.summary}</p>}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={togglePin}><Pin className="h-3.5 w-3.5 mr-1" />고정</Button>
                      <Button size="sm" variant="outline" onClick={togglePublish}>{article.status === "PUBLISHED" ? "초안으로" : "게시"}</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}><Edit className="h-3.5 w-3.5 mr-1" />수정</Button>
                      <Button size="sm" variant="outline" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                    </div>
                  )}
                </div>

                <div className="mt-4 tc-content" dangerouslySetInnerHTML={{ __html: renderTrainingContentToHtml(article.content) }} />
              </CardContent>
            </Card>

            {others.length > 0 && (
              <Card>
                <CardContent className="py-4">
                  <h3 className="text-sm font-semibold mb-3">첨부자료</h3>
                  <div className="space-y-3">
                    {others.map((a) => (
                      <div key={a.id} className="border rounded-md p-3">
                        {a.attachmentType === "VIDEO" && (
                          <video controls className="w-full max-h-[420px] rounded-md mb-2" src={`/api/training/attachments/${a.id}/file`} />
                        )}
                        {a.attachmentType === "PDF" && (
                          <iframe title={a.originalName} src={`/api/training/attachments/${a.id}/file`} className="w-full h-[500px] rounded-md mb-2 border" />
                        )}
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            {a.attachmentType === "VIDEO" ? <Video className="h-4 w-4" /> : a.attachmentType === "PDF" ? <FileText className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />}
                            {a.originalName} · {(a.fileSize / 1024 / 1024).toFixed(2)}MB
                          </span>
                          <a href={`/api/training/attachments/${a.id}/file`} target="_blank" rel="noreferrer" download={a.originalName}>
                            <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /></Button>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-muted-foreground">첨부 이미지 {images.length}장 · 최종 수정 정보는 관리자 화면에서 확인 가능합니다.</p>
          </>
        )}
      </div>

      {article && (
        <TrainingEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          article={article}
          onSaved={() => { setEditorOpen(false); load(); }}
        />
      )}
    </Layout>
  );
}
