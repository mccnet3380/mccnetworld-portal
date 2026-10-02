// client/src/pages/TypingVersions.tsx
//
// 작업명: MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1
//         + MCC_TYPING_VERSION_MANAGER_UI_ALIGNMENT_1 (화면 정리)
//
// 별도 MCCNETWORLD/public 프로젝트의 기존 타이핑 사이트(각 채널 index.html +
// ?mode=design 개발도구)를 재작성하지 않고, CURRENT/PREVIOUS/DRAFT 3-상태 버전관리
// 화면만 Portal에 추가한다. 실제 타이핑/개발도구 화면은 그대로 새 탭에서 연다
// (서버가 /typing-static/<version>/... 로 서빙 — server/routes/typing-versions.ts).
//
// 쓰기(새 버전 생성/개발도구/운영적용/버전명 수정)는 admin만 가능 — 실제 게이트는
// 서버의 requireTypingAdmin이며, 여기서는 버튼 노출만 제어한다(UX일 뿐).
//
// 버전명 표시: manifest.<state>.label이 "사용자용 버전명"이고, current/previous/draft는
// 내부 상태명(폴더명)일 뿐 화면에 그대로 노출하지 않는다. 최초 부트스트랩 CURRENT는
// label이 "current" placeholder로 생성되므로, 관리자는 CURRENT 카드의 연필 아이콘으로
// PUT /api/typing-versions/current/label을 호출해 실제 버전명(YYYY-MM)으로 바꿀 수 있다.

import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiRequest } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Pencil } from "lucide-react";

type VersionInfo = { label: string; note: string; createdAt: string } | null;
type Manifest = { current: VersionInfo; previous: VersionInfo; draft: VersionInfo };
type Channel = { carrier: string; brand: string; name: string };

// 섹션9: 버전명 기본 형식 YYYY-MM (서버와 동일한 규칙 — server/routes/typing-versions.ts의
// VERSION_LABEL_RE). 클라이언트에서는 즉시 피드백용으로만 쓰고, 최종 검증은 서버가 한다.
const VERSION_LABEL_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isPlaceholderLabel(label: string | undefined) {
  return !label || !VERSION_LABEL_RE.test(label);
}

export function TypingVersions() {
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.userType === "admin";

  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);

  const [editCurrentOpen, setEditCurrentOpen] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);

  const [previousChannel, setPreviousChannel] = useState<string>("");
  const [draftChannel, setDraftChannel] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest("/api/typing-versions");
      setManifest(res.manifest);
      setChannels(res.channels || []);
      if (res.channels?.length) {
        setPreviousChannel(`${res.channels[0].carrier}/${res.channels[0].brand}`);
        setDraftChannel(`${res.channels[0].carrier}/${res.channels[0].brand}`);
      }
    } catch (e: any) {
      toast({ title: "버전 정보를 불러오지 못했습니다.", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MCC_TYPING_VERSION_POC_EXACT_BEHAVIOR_AUDIT_1: window.open()은 일반 브라우저
  // 네비게이션이라 Authorization 헤더를 못 붙인다. 열기 직전에 매번 인증된 fetch로
  // nav-session을 발급받아(Path=/typing-static 한정 HttpOnly 쿠키) 그 쿠키로
  // /typing-static/* 접근이 되도록 한다 — URL에는 어떤 토큰도 노출하지 않는다.
  async function ensureNavSession(): Promise<boolean> {
    try {
      await apiRequest("/api/typing-versions/nav-session", { method: "POST" });
      return true;
    } catch (e: any) {
      toast({ title: "타이핑 화면을 열 수 없습니다.", description: e.message, variant: "destructive" });
      return false;
    }
  }

  async function openTyping(version: "current" | "previous" | "draft") {
    if (!(await ensureNavSession())) return;
    window.open(`/typing-static/${version}/index.html`, "_blank");
  }

  async function openDesignTool(version: "previous" | "draft", channelKey: string) {
    if (!channelKey) {
      toast({ title: "채널을 선택해주세요.", variant: "destructive" });
      return;
    }
    if (version === "previous") {
      const ok = window.confirm(
        "이전 버전을 직접 수정합니다.\n현재 운영 버전에는 영향을 주지 않습니다."
      );
      if (!ok) return;
    }
    if (!(await ensureNavSession())) return;
    const [carrier, brand] = channelKey.split("/");
    const url = `/typing-static/${version}/brands/${carrier}/${brand}/index.html?mode=design`;
    window.open(url, "_blank");
  }

  function openCreateDialog() {
    setNewLabel("");
    setNewNote("");
    setCreateOpen(true);
  }

  async function handleCreateDraft() {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      toast({ title: "버전명을 입력해주세요.", variant: "destructive" });
      return;
    }
    if (!VERSION_LABEL_RE.test(trimmed)) {
      toast({ title: "버전명은 YYYY-MM 형식이어야 합니다.", description: "예: 2026-11", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await apiRequest("/api/typing-versions/draft", {
        method: "POST",
        body: JSON.stringify({ label: trimmed, note: newNote.trim() }),
      });
      toast({ title: "새 버전(DRAFT)이 생성되었습니다." });
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "DRAFT 생성에 실패했습니다.", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  function openEditCurrentDialog() {
    const current = manifest?.current;
    setEditLabel(current && !isPlaceholderLabel(current.label) ? current.label : "");
    setEditNote(current?.note && current.note !== "초기 버전(부트스트랩)" ? current.note : "");
    setEditCurrentOpen(true);
  }

  async function handleSaveCurrentLabel() {
    const trimmed = editLabel.trim();
    if (!VERSION_LABEL_RE.test(trimmed)) {
      toast({ title: "버전명은 YYYY-MM 형식이어야 합니다.", description: "예: 2026-10", variant: "destructive" });
      return;
    }
    setSavingLabel(true);
    try {
      await apiRequest("/api/typing-versions/current/label", {
        method: "PUT",
        body: JSON.stringify({ label: trimmed, note: editNote.trim() }),
      });
      toast({ title: "현재 운영 버전명이 저장되었습니다." });
      setEditCurrentOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "버전명 저장에 실패했습니다.", description: e.message, variant: "destructive" });
    } finally {
      setSavingLabel(false);
    }
  }

  async function handlePromote() {
    if (!manifest?.draft) return;
    const curLabel = manifest.current?.label || "(없음)";
    const draftLabel = manifest.draft.label;
    const prevLabel = manifest.previous?.label;
    const confirmMsg =
      `${draftLabel} 버전을 운영에 적용하시겠습니까?\n\n` +
      `현재 운영: ${curLabel}\n새 운영: ${draftLabel}\n\n` +
      `적용 후:\n` +
      (prevLabel ? `${prevLabel}는 삭제됩니다.\n` : "") +
      `${curLabel}은 이전 버전이 됩니다.\n${draftLabel}은 현재 운영 버전이 됩니다.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await apiRequest("/api/typing-versions/promote", { method: "POST" });
      toast({ title: "운영 적용이 완료되었습니다." });
      await load();
    } catch (e: any) {
      toast({ title: "운영 적용에 실패했습니다.", description: e.message, variant: "destructive" });
    }
  }

  const channelOptions = useMemo(
    () => channels.map((c) => ({ key: `${c.carrier}/${c.brand}`, label: `${c.name} (${c.carrier}/${c.brand})` })),
    [channels]
  );

  if (loading) {
    return (
      <Layout title="타이핑 버전관리">
        <div className="text-sm text-muted-foreground">불러오는 중...</div>
      </Layout>
    );
  }

  const currentDisplayLabel = manifest?.current && !isPlaceholderLabel(manifest.current.label)
    ? manifest.current.label
    : "버전명 미설정";

  return (
    <Layout title="타이핑 버전관리">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          현재 운영 · 이전 버전 · 개발 중 버전을 한 곳에서 관리합니다.
        </p>

        <div className="grid gap-4 md:grid-cols-3 items-stretch">
          {/* PREVIOUS */}
          <Card className="flex flex-col h-full">
            <CardContent className="flex flex-col flex-1 pt-6">
              <div className="space-y-2">
                <Badge variant="secondary">PREVIOUS</Badge>
                {manifest?.previous ? (
                  <>
                    <div className="text-2xl font-bold">{manifest.previous.label}</div>
                    <div className="text-sm text-muted-foreground">이전 버전</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground pt-1">없음</div>
                )}
              </div>

              <div className="flex-1" />

              {manifest?.previous && (
                <div className="space-y-2 mt-4">
                  <Button size="sm" variant="outline" className="w-full" onClick={() => openTyping("previous")}>
                    이전 버전 열기
                  </Button>
                  {isAdmin && (
                    <>
                      <Select value={previousChannel} onValueChange={setPreviousChannel}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="채널 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {channelOptions.map((o) => (
                            <SelectItem key={o.key} value={o.key}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={() => openDesignTool("previous", previousChannel)}>
                        개발도구 열기
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* CURRENT */}
          <Card className="flex flex-col h-full border-emerald-200">
            <CardContent className="flex flex-col flex-1 pt-6">
              <div className="space-y-2">
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                  CURRENT
                </Badge>
                {manifest?.current ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <div className="text-2xl font-bold">{currentDisplayLabel}</div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={openEditCurrentDialog}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="현재 운영 버전명 수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="text-sm font-medium text-emerald-700">현재 운영</div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground pt-1">없음</div>
                )}
              </div>

              <div className="flex-1" />

              {manifest?.current && (
                <div className="space-y-2 mt-4">
                  <Button size="sm" className="w-full" onClick={() => openTyping("current")}>
                    현재 타이핑 열기
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* DRAFT */}
          <Card className="flex flex-col h-full border-amber-200">
            <CardContent className="flex flex-col flex-1 pt-6">
              <div className="space-y-2">
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">DRAFT</Badge>
                {manifest?.draft ? (
                  <>
                    <div className="text-2xl font-bold">{manifest.draft.label}</div>
                    <div className="text-sm font-medium text-amber-700">개발 중</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground pt-1">없음</div>
                    <div className="text-xs text-muted-foreground">새 버전을 만들면 CURRENT가 복제됩니다.</div>
                  </>
                )}
              </div>

              <div className="flex-1" />

              <div className="space-y-2 mt-4">
                {manifest?.draft ? (
                  isAdmin && (
                    <>
                      <Select value={draftChannel} onValueChange={setDraftChannel}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="채널 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {channelOptions.map((o) => (
                            <SelectItem key={o.key} value={o.key}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={() => openDesignTool("draft", draftChannel)}>
                        개발도구 열기
                      </Button>
                      <Button size="sm" variant="outline" className="w-full" onClick={() => openTyping("draft")}>
                        실제화면 테스트
                      </Button>
                      <Button size="sm" variant="destructive" className="w-full" onClick={handlePromote}>
                        운영 적용
                      </Button>
                    </>
                  )
                ) : (
                  isAdmin && (
                    <Button size="sm" className="w-full" onClick={openCreateDialog}>
                      + 새 버전 만들기
                    </Button>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 새 버전 만들기 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 버전 만들기</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">버전명</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="예: 2026-11" />
              <p className="text-xs text-muted-foreground mt-1">YYYY-MM 형식으로 입력하세요.</p>
            </div>
            <div>
              <label className="text-sm font-medium">변경내용</label>
              <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="예: 11월 신청서 변경" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              취소
            </Button>
            <Button onClick={handleCreateDraft} disabled={creating}>
              생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 현재 운영 버전 설정 */}
      <Dialog open={editCurrentOpen} onOpenChange={setEditCurrentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>현재 운영 버전 설정</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">버전명</label>
              <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="예: 2026-10" />
              <p className="text-xs text-muted-foreground mt-1">YYYY-MM 형식으로 입력하세요.</p>
            </div>
            <div>
              <label className="text-sm font-medium">설명(선택)</label>
              <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="예: 10월 운영 버전" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCurrentOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSaveCurrentLabel} disabled={savingLabel}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
