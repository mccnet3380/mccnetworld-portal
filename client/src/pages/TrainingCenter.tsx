// client/src/pages/TrainingCenter.tsx
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료 메인 화면 — 검색 + 카테고리(전체/SK/KT/LG/기타업무) + 목록.
// ADMIN에게는 "새 교육자료" 버튼과 각 카드의 편집/삭제/고정/게시 컨트롤이 추가로 보인다.
// WORKER 화면에는 관리 UI를 렌더링하지 않는다(실제 권한 강제는 백엔드 requireTrainingAdmin).

import { useEffect, useRef, useState } from "react";
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
import { Search, Plus, Pin, Edit, Trash2, GraduationCap, GripVertical, ChevronUp, ChevronDown, RotateCcw, ListOrdered, Loader2 } from "lucide-react";

const CATEGORY_COLOR: Record<TrainingCategory, string> = {
  ALL: "#5b6b82",
  SK: "#ef7f47",
  KT: "#2c74e8",
  LG: "#7e5bef",
  WIRED: "#0d9488",
  OTHER: "#22b57d",
};

export function TrainingCenter() {
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const { toast } = useToast();
  // [MCC_TRAINING_PERMISSION_ENFORCEMENT_1] legacy admin은 그대로 유지 + /api/auth/me가
  // 이미 내려주는 fresh effective permission(server/lib/session-rbac.ts)에 TRAINING_MANAGE
  // ALLOW가 있으면 비-admin에게도 관리 버튼을 보여준다. 실제 보안 source-of-truth는 여전히
  // server/routes/training.ts의 requireTrainingAdmin(resolveTrainingPermission)이고, 이 조건은
  // UX 노출일 뿐이다.
  const isAdmin = user?.userType === "admin" || !!user?.rbacPermissions?.includes("TRAINING_MANAGE");

  const [category, setCategory] = useState<TrainingCategory | "">("");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [articles, setArticles] = useState<TrainingArticleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrainingArticleData | null>(null);

  // [MCC_TRAINING_PERSONAL_ORDER_AND_ATTACHMENT_UPLOAD_FIX_1] 각 로그인 사용자가 자기
  // 계정 기준으로만 교육자료 순서를 정하는 기능. 다른 principal에게는 영향 없음(서버가
  // session principal로만 저장 — § 계획 6/7). 전체 목록(필터/검색 없음) 상태에서만 순서
  // 편집을 허용한다 — 그래야 PUT에 "전체" articleIds를 보낼 수 있고, 일부 카테고리만
  // 보낼 경우 다른 카테고리 article의 기존 개인 순서가 통째로 삭제되는 사고를 막는다.
  const [editMode, setEditMode] = useState(false);
  const [hasPersonalOrder, setHasPersonalOrder] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEditOrder = category === "" && appliedQ.trim() === "";

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (q.trim()) params.set("q", q.trim());
      if (isAdmin) params.set("status", "ALL");
      const res = await apiRequest(`/api/training/articles?${params.toString()}`);
      setArticles(res.articles || []);
      setHasPersonalOrder(Boolean(res.hasPersonalOrder));
      setAppliedQ(q);
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

  useEffect(() => {
    if (!canEditOrder) setEditMode(false);
  }, [canEditOrder]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  function scheduleOrderSave(list: TrainingArticleData[]) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSavingOrder(true);
      try {
        await apiRequest("/api/training/user-order", {
          method: "PUT",
          body: JSON.stringify({ articleIds: list.map((a) => a.id) }),
        });
        setHasPersonalOrder(true);
      } catch (e: any) {
        toast({ title: "순서 저장 실패", description: e.message, variant: "destructive" });
      } finally {
        setSavingOrder(false);
      }
    }, 600);
  }

  function moveArticle(from: number, to: number) {
    if (to < 0 || to >= articles.length || from === to) return;
    setArticles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      scheduleOrderSave(next);
      return next;
    });
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null) return;
    moveArticle(from, targetIndex);
  }

  async function resetPersonalOrder() {
    if (!confirm("개인 순서를 초기화하고 기본(관리자 노출) 순서로 되돌리시겠습니까?")) return;
    try {
      await apiRequest("/api/training/user-order", { method: "DELETE" });
      setHasPersonalOrder(false);
      setEditMode(false);
      load();
    } catch (e: any) {
      toast({ title: "초기화 실패", description: e.message, variant: "destructive" });
    }
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
          <div className="flex items-center gap-2 flex-wrap">
            {canEditOrder && (
              <>
                {editMode && savingOrder && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {hasPersonalOrder && (
                  <Button size="sm" variant="outline" onClick={resetPersonalOrder}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />기본 순서로 초기화
                  </Button>
                )}
                <Button size="sm" variant={editMode ? "default" : "outline"} onClick={() => setEditMode((v) => !v)}>
                  <ListOrdered className="h-3.5 w-3.5 mr-1" />{editMode ? "순서 편집 완료" : "내 순서 편집"}
                </Button>
              </>
            )}
            {isAdmin && (
              <Button onClick={() => { setEditTarget(null); setEditorOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" />새 교육자료
              </Button>
            )}
          </div>
        </div>
        {editMode && canEditOrder && (
          <p className="text-xs text-muted-foreground -mt-4">
            카드를 드래그하거나 ↑/↓ 버튼으로 순서를 바꾸세요. 이 순서는 내 계정에만 적용되며 다른 사용자에게는 영향을 주지 않습니다.
          </p>
        )}
        {!canEditOrder && category !== "" && (
          <p className="text-xs text-muted-foreground -mt-4">개인 순서 편집은 "전체" 목록에서만 가능합니다.</p>
        )}

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
          {articles.map((a, index) => (
            <Card
              key={a.id}
              draggable={editMode}
              onDragStart={() => { dragIndexRef.current = index; }}
              onDragOver={(e) => editMode && e.preventDefault()}
              onDrop={() => editMode && handleDrop(index)}
              className={editMode ? "border-primary/40 bg-primary/[0.02]" : undefined}
            >
              <CardContent className="py-4 flex items-center justify-between gap-3">
                {editMode && (
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 text-muted-foreground">
                    <GripVertical className="h-4 w-4 cursor-grab" />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="disabled:opacity-30 hover:text-gray-900"
                        disabled={index === 0}
                        onClick={() => moveArticle(index, index - 1)}
                        title="위로"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="disabled:opacity-30 hover:text-gray-900"
                        disabled={index === articles.length - 1}
                        onClick={() => moveArticle(index, index + 1)}
                        title="아래로"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
                <Link href={`/training/${a.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.isPinned && <Pin className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                    <Badge style={{ background: CATEGORY_COLOR[a.category], color: "#fff" }}>{TRAINING_CATEGORY_LABEL[a.category]}</Badge>
                    {a.status === "DRAFT" && <Badge variant="outline">초안</Badge>}
                    <span className="font-semibold text-gray-900 truncate">{a.title}</span>
                  </div>
                  {a.summary && <p className="text-sm text-muted-foreground mt-1 truncate">{a.summary}</p>}
                </Link>
                {isAdmin && !editMode && (
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
