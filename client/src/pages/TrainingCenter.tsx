// client/src/pages/TrainingCenter.tsx
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료 메인 화면 — 검색 + 카테고리(전체/SK/KT/LG/기타업무) + 목록.
// ADMIN에게는 "새 교육자료" 버튼과 각 카드의 편집/삭제/고정/게시 컨트롤이 추가로 보인다.
// WORKER 화면에는 관리 UI를 렌더링하지 않는다(실제 권한 강제는 백엔드 requireTrainingAdmin).

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useApiRequest } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { TrainingEditor, type TrainingArticleData } from "@/components/TrainingEditor";
import { TRAINING_CATEGORIES, TRAINING_CATEGORY_LABEL, type TrainingCategory } from "@shared/training-markdown";
import { Search, Plus, Pin, Edit, Trash2, GraduationCap } from "lucide-react";

const CATEGORY_COLOR: Record<TrainingCategory, string> = {
  ALL: "#5b6b82",
  SK: "#ef7f47",
  KT: "#2c74e8",
  LG: "#7e5bef",
  OTHER: "#22b57d",
};

export function TrainingCenter() {
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.userType === "admin";

  const [category, setCategory] = useState<TrainingCategory | "">("");
  const [q, setQ] = useState("");
  const [articles, setArticles] = useState<TrainingArticleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrainingArticleData | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (q.trim()) params.set("q", q.trim());
      if (isAdmin) params.set("status", "ALL");
      const res = await apiRequest(`/api/training/articles?${params.toString()}`);
      setArticles(res.articles || []);
    } catch (e: any) {
      toast({ title: "목록을 불러오지 못했습니다.", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  async function togglePin(a: TrainingArticleData) {
    try {
      await apiRequest(`/api/training/articles/${a.id}`, { method: "PATCH", body: JSON.stringify({ isPinned: !a.isPinned }) });
      load();
    } catch (e: any) {
      toast({ title: "변경 실패", description: e.message, variant: "destructive" });
    }
  }

  async function togglePublish(a: TrainingArticleData) {
    try {
      await apiRequest(`/api/training/articles/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: a.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" }) });
      load();
    } catch (e: any) {
      toast({ title: "변경 실패", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(a: TrainingArticleData) {
    if (!confirm(`"${a.title}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await apiRequest(`/api/training/articles/${a.id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      toast({ title: "삭제 실패", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Layout title="교육자료">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold text-gray-900">교육자료</h1>
          </div>
          {isAdmin && (
            <Button onClick={() => { setEditTarget(null); setEditorOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />새 교육자료
            </Button>
          )}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="제목·본문 검색 (예: 명의 불일치, IMEI)" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">검색</Button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <button
            onClick={() => setCategory("")}
            className={`rounded-lg border p-3 text-center transition-colors ${category === "" ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
          >
            <div className="font-semibold text-sm">전체</div>
          </button>
          {TRAINING_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-lg border p-3 text-center transition-colors ${category === c ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
              style={{ borderColor: category === c ? CATEGORY_COLOR[c] : undefined }}
            >
              <div className="font-semibold text-sm" style={{ color: CATEGORY_COLOR[c] }}>{TRAINING_CATEGORY_LABEL[c]}</div>
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
        {!loading && articles.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">등록된 교육자료가 없습니다.</CardContent></Card>
        )}

        <div className="space-y-2">
          {articles.map((a) => (
            <Card key={a.id}>
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <Link href={`/training/${a.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.isPinned && <Pin className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                    <Badge style={{ background: CATEGORY_COLOR[a.category], color: "#fff" }}>{TRAINING_CATEGORY_LABEL[a.category]}</Badge>
                    {a.status === "DRAFT" && <Badge variant="outline">초안</Badge>}
                    <span className="font-semibold text-gray-900 truncate">{a.title}</span>
                  </div>
                  {a.summary && <p className="text-sm text-muted-foreground mt-1 truncate">{a.summary}</p>}
                </Link>
                {isAdmin && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => togglePin(a)} title="상단 고정 토글"><Pin className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => togglePublish(a)}>{a.status === "PUBLISHED" ? "초안으로" : "게시"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditTarget(a); setEditorOpen(true); }}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(a)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <TrainingEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        article={editTarget}
        onSaved={() => { setEditorOpen(false); load(); }}
      />
    </Layout>
  );
}
