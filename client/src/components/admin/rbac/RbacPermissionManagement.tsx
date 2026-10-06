// client/src/components/admin/rbac/RbacPermissionManagement.tsx
//
// 작업명: MCC_RBAC_PHASE_2E_PERMISSION_MANAGEMENT_UI_1
//
// OWNER 전용 "권한 관리" 화면. server/routes/rbac-admin.ts(2E-3)의 실제 API만 사용한다
// (DB 직접 접근 없음, 별도 임시 권한 저장 구조 없음). 이 컴포넌트가 렌더링되는 것 자체는
// AdminPanel.tsx의 canManageRbac(=user.rbacRoles.includes('OWNER')) 조건에 의존하지만,
// 최종 방어는 항상 backend(requirePermission('ROLE_READ'/'ROLE_MANAGE') + isOwnerPrincipal()
// 2중 게이트)다 — 이 화면은 그 사실을 전제로 "보여주기"만 한다.
//
// Data Scope(OWN_DEALER/LEGACY/LEGACY_COMPAT/ALL) 편집 UI는 이번 단계에 포함하지 않는다
// (TEAM/ASSIGNED는 모델 미확정이라 편집 옵션으로 노출하지 않음 — 섹션 30).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import { useApiRequest } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

// ── API 응답 shape (server/lib/rbac-management.ts와 1:1 대응, 추측 없음) ──────
type PrincipalType = "ADMIN" | "USER" | "SALES_MANAGER";

interface PrincipalListItem {
  principalType: PrincipalType;
  principalId: number;
  username: string;
  displayName: string;
  legacyUserType?: string;
  legacyRole?: string | null;
  isDealer: boolean;
  roleCodes: string[];
  overrideCount: number;
  effectivePermissionCount: number;
}

interface RoleItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
}

interface PermissionItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isOwnerOnly: boolean;
  enforcementStatus: "ENFORCED" | "NOT_ENFORCED";
}

interface PrincipalDetail {
  principalType: PrincipalType;
  principalId: number;
  roleCodes: string[];
  allowOverrides: string[];
  denyOverrides: string[];
  effectivePermissions: string[];
}

// ADMIN/OWNER role은 ADMIN principal에만 배정 가능 — server/lib/rbac-management.ts의
// ADMIN_PRINCIPAL_ONLY_ROLE_CODES와 동일한 정책을 UI에도 그대로 반영(문구만 따로 추측하지 않음).
const ADMIN_PRINCIPAL_ONLY_ROLE_CODES = ["OWNER", "ADMIN"];

const PRINCIPAL_TYPE_LABEL: Record<PrincipalType, string> = {
  ADMIN: "관리자",
  USER: "직원",
  SALES_MANAGER: "영업관리자",
};

// 섹션16 요청 순서 그대로. permission code는 실제 server/lib/rbac-seed.ts 35개 기준으로
// 전부 명시 매핑(추측 prefix 분리 없음) — 새 permission이 추가돼도 누락되지 않게 "기타" 그룹으로 모은다.
const GROUP_ORDER = [
  "USER", "DEALER", "DOCUMENT", "ACTIVATION", "AUDIT", "PERFORMANCE", "TRAINING", "TYPING",
  "SETTLEMENT", "TEAM", "CONTACT", "CARRIER", "SERVICE_PLAN", "ROLE", "MENU_PERMISSION",
  "HIDDEN_POLICY", "기타",
] as const;

const PERMISSION_GROUP: Record<string, string> = {
  USER_READ: "USER", USER_MANAGE: "USER",
  DEALER_READ: "DEALER", DEALER_MANAGE: "DEALER",
  DOCUMENT_READ: "DOCUMENT", DOCUMENT_CREATE: "DOCUMENT", DOCUMENT_UPDATE: "DOCUMENT",
  DOCUMENT_COMPLETE: "DOCUMENT", DOCUMENT_CANCEL: "DOCUMENT",
  ACTIVATION_READ: "ACTIVATION", ACTIVATION_PROCESS: "ACTIVATION",
  AUDIT_READ: "AUDIT", AUDIT_PROCESS: "AUDIT",
  PERFORMANCE_SELF_READ: "PERFORMANCE", PERFORMANCE_ALL_READ: "PERFORMANCE",
  TRAINING_READ: "TRAINING", TRAINING_MANAGE: "TRAINING",
  TYPING_READ: "TYPING", TYPING_MANAGE: "TYPING",
  SETTLEMENT_READ: "SETTLEMENT", SETTLEMENT_EDIT: "SETTLEMENT",
  SETTLEMENT_POLICY_READ: "SETTLEMENT", SETTLEMENT_POLICY_EDIT: "SETTLEMENT",
  SETTLEMENT_PRICING_MANAGE: "SETTLEMENT",
  TEAM_READ: "TEAM", TEAM_MANAGE: "TEAM",
  CONTACT_CODE_READ: "CONTACT", CONTACT_CODE_EDIT: "CONTACT",
  CARRIER_MANAGE: "CARRIER",
  SERVICE_PLAN_MANAGE: "SERVICE_PLAN",
  ROLE_READ: "ROLE", ROLE_MANAGE: "ROLE",
  MENU_PERMISSION_READ: "MENU_PERMISSION", MENU_PERMISSION_MANAGE: "MENU_PERMISSION",
  HIDDEN_POLICY_MANAGE: "HIDDEN_POLICY",
};

function groupFor(code: string): string {
  return PERMISSION_GROUP[code] ?? "기타";
}

type OverrideDraftValue = "DEFAULT" | "ALLOW" | "DENY";

function detailToOverrideDraft(detail: PrincipalDetail | undefined): Record<string, OverrideDraftValue> {
  const draft: Record<string, OverrideDraftValue> = {};
  for (const code of detail?.allowOverrides ?? []) draft[code] = "ALLOW";
  for (const code of detail?.denyOverrides ?? []) draft[code] = "DENY";
  return draft;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function RbacPermissionManagement() {
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [principalTypeFilter, setPrincipalTypeFilter] = useState<"" | PrincipalType>("");
  const [selected, setSelected] = useState<{ principalType: PrincipalType; principalId: number } | null>(null);

  const [roleDraft, setRoleDraft] = useState<string[] | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<Record<string, OverrideDraftValue> | null>(null);

  const principalsQuery = useQuery<{ principals: PrincipalListItem[] }>({
    queryKey: ["/api/admin/rbac/principals", q, principalTypeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (principalTypeFilter) params.set("principalType", principalTypeFilter);
      return apiRequest(`/api/admin/rbac/principals?${params.toString()}`);
    },
  });

  const rolesQuery = useQuery<{ roles: RoleItem[] }>({
    queryKey: ["/api/admin/rbac/roles"],
    queryFn: () => apiRequest("/api/admin/rbac/roles"),
  });

  const permissionsQuery = useQuery<{ permissions: PermissionItem[] }>({
    queryKey: ["/api/admin/rbac/permissions"],
    queryFn: () => apiRequest("/api/admin/rbac/permissions"),
  });

  const detailQuery = useQuery<PrincipalDetail>({
    queryKey: ["/api/admin/rbac/principals", selected?.principalType, selected?.principalId, "detail"],
    queryFn: () => apiRequest(`/api/admin/rbac/principals/${selected!.principalType}/${selected!.principalId}`),
    enabled: !!selected,
  });

  // principal이 바뀌어 새 detail이 도착하면 draft를 그 값으로 초기화한다.
  useEffect(() => {
    if (detailQuery.data && selected && detailQuery.data.principalId === selected.principalId && detailQuery.data.principalType === selected.principalType) {
      setRoleDraft(detailQuery.data.roleCodes);
      setOverrideDraft(detailToOverrideDraft(detailQuery.data));
    }
  }, [detailQuery.data, selected]);

  const roleDirty = !!detailQuery.data && !!roleDraft && !sameStringSet(roleDraft, detailQuery.data.roleCodes);
  const overrideDirty =
    !!detailQuery.data &&
    !!overrideDraft &&
    JSON.stringify(normalizedOverrideDraft(overrideDraft)) !== JSON.stringify(normalizedOverrideDraft(detailToOverrideDraft(detailQuery.data)));

  function normalizedOverrideDraft(d: Record<string, OverrideDraftValue>) {
    const entries = Object.entries(d).filter(([, v]) => v !== "DEFAULT").sort(([a], [b]) => a.localeCompare(b));
    return entries;
  }

  function hasUnsavedChanges(): boolean {
    return roleDirty || overrideDirty;
  }

  function selectPrincipal(p: { principalType: PrincipalType; principalId: number }) {
    if (selected && (selected.principalType !== p.principalType || selected.principalId !== p.principalId) && hasUnsavedChanges()) {
      const ok = window.confirm("저장하지 않은 변경사항이 있습니다. 계속하시겠습니까?");
      if (!ok) return;
    }
    setSelected(p);
  }

  const saveRolesMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !roleDraft) return;
      return apiRequest(`/api/admin/rbac/principals/${selected.principalType}/${selected.principalId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleCodes: roleDraft }),
      });
    },
    onSuccess: () => {
      toast({ title: "역할이 저장되었습니다.", description: "재로그인 없이 즉시 적용됩니다." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rbac/principals"] });
      detailQuery.refetch();
    },
    onError: (error: any) => {
      toast({ title: "역할 저장 실패", description: error?.message || "요청을 처리하지 못했습니다.", variant: "destructive" });
    },
  });

  const saveOverridesMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !overrideDraft) return;
      const overrides = Object.entries(overrideDraft)
        .filter(([, v]) => v !== "DEFAULT")
        .map(([permissionCode, effect]) => ({ permissionCode, effect }));
      return apiRequest(`/api/admin/rbac/principals/${selected.principalType}/${selected.principalId}/overrides`, {
        method: "PUT",
        body: JSON.stringify({ overrides }),
      });
    },
    onSuccess: () => {
      toast({ title: "개별 권한이 저장되었습니다.", description: "재로그인 없이 즉시 적용됩니다." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rbac/principals"] });
      detailQuery.refetch();
    },
    onError: (error: any) => {
      toast({ title: "개별 권한 저장 실패", description: error?.message || "요청을 처리하지 못했습니다.", variant: "destructive" });
    },
  });

  const permissionsByGroup = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const p of permissionsQuery.data?.permissions ?? []) {
      const g = groupFor(p.code);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return map;
  }, [permissionsQuery.data]);

  const isOwnerSelected = roleDraft?.includes("OWNER") ?? false;
  const selectedIsAdminType = selected?.principalType === "ADMIN";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* 왼쪽: principal 목록 */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>대상 선택</CardTitle>
          <CardDescription>이름/아이디로 검색하거나 유형으로 좁혀서 principal을 선택하세요.</CardDescription>
          <div className="flex gap-2 pt-2">
            <Input placeholder="이름 또는 아이디 검색" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
            <Select value={principalTypeFilter || "ALL"} onValueChange={(v) => setPrincipalTypeFilter(v === "ALL" ? "" : (v as PrincipalType))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="ADMIN">관리자</SelectItem>
                <SelectItem value="USER">직원</SelectItem>
                <SelectItem value="SALES_MANAGER">영업관리자</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {principalsQuery.isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : principalsQuery.isError ? (
            <p className="text-sm text-destructive py-6 text-center">{(principalsQuery.error as any)?.message || "목록을 불러오지 못했습니다."}</p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름 / 아이디</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead>현재 역할</TableHead>
                    <TableHead className="text-right">개별권한</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(principalsQuery.data?.principals ?? []).map((p) => {
                    const isSelected = selected?.principalType === p.principalType && selected?.principalId === p.principalId;
                    return (
                      <TableRow
                        key={`${p.principalType}:${p.principalId}`}
                        className={`cursor-pointer ${isSelected ? "bg-primary/5" : "hover:bg-muted"}`}
                        onClick={() => selectPrincipal({ principalType: p.principalType, principalId: p.principalId })}
                      >
                        <TableCell>
                          <div className="font-medium">{p.displayName}</div>
                          <div className="text-xs text-muted-foreground">{p.username}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline">{PRINCIPAL_TYPE_LABEL[p.principalType]}</Badge>
                            {p.isDealer && <Badge className="bg-amber-500 text-white">대리점</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{p.roleCodes.length > 0 ? p.roleCodes.join(", ") : "역할 없음"}</TableCell>
                        <TableCell className="text-right text-sm">{p.overrideCount}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(principalsQuery.data?.principals ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">검색 결과가 없습니다.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 오른쪽: 선택된 principal 상세 */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>권한 상세</CardTitle>
          <CardDescription>저장은 즉시 적용되며 재로그인이 필요하지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-muted-foreground text-center py-10">왼쪽에서 대상을 선택하세요.</p>
          ) : detailQuery.isLoading || !roleDraft || !overrideDraft ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
            </div>
          ) : detailQuery.isError ? (
            <p className="text-sm text-destructive py-6 text-center">{(detailQuery.error as any)?.message || "상세 정보를 불러오지 못했습니다."}</p>
          ) : (
            <div className="space-y-6">
              {/* 역할 영역 */}
              <section>
                <h3 className="font-semibold mb-2">역할</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(rolesQuery.data?.roles ?? []).map((role) => {
                    const checked = roleDraft.includes(role.code);
                    const disabled = ADMIN_PRINCIPAL_ONLY_ROLE_CODES.includes(role.code) && !selectedIsAdminType;
                    return (
                      <label
                        key={role.code}
                        className={`flex items-start gap-2 rounded border p-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}
                        title={role.description ?? undefined}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(v) => {
                            setRoleDraft((prev) => {
                              const base = prev ?? [];
                              return v ? Array.from(new Set([...base, role.code])) : base.filter((c) => c !== role.code);
                            });
                          }}
                        />
                        <span>
                          <span className="font-medium">{role.name}</span>
                          <span className="block text-xs text-muted-foreground">{role.code}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex justify-end mt-3">
                  <Button size="sm" disabled={!roleDirty || saveRolesMutation.isPending} onClick={() => saveRolesMutation.mutate()}>
                    {saveRolesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    역할 저장
                  </Button>
                </div>
              </section>

              <Separator />

              {/* 개별 permission 영역 */}
              <section>
                <h3 className="font-semibold mb-2">개별 권한(permission override)</h3>
                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                  {GROUP_ORDER.filter((g) => permissionsByGroup.has(g)).map((group) => (
                    <div key={group}>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">{group}</div>
                      <div className="space-y-1">
                        {permissionsByGroup.get(group)!.map((perm) => {
                          const value = overrideDraft[perm.code] ?? "DEFAULT";
                          const allowDisabled = perm.isOwnerOnly && !isOwnerSelected;
                          const denyDisabled = perm.isOwnerOnly && isOwnerSelected;
                          return (
                            <div key={perm.code} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium">{perm.name}</span>
                                  {perm.isOwnerOnly && <Badge className="bg-purple-600 text-white text-[10px]">OWNER 전용</Badge>}
                                  <Badge
                                    variant={perm.enforcementStatus === "ENFORCED" ? "default" : "outline"}
                                    className={`text-[10px] ${perm.enforcementStatus === "ENFORCED" ? "bg-green-600 text-white" : "text-muted-foreground"}`}
                                  >
                                    {perm.enforcementStatus === "ENFORCED" ? "적용중" : "미연결"}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">{perm.code}</div>
                              </div>
                              <Select
                                value={value}
                                onValueChange={(v) => setOverrideDraft((prev) => ({ ...(prev ?? {}), [perm.code]: v as OverrideDraftValue }))}
                              >
                                <SelectTrigger className="w-[110px] shrink-0"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="DEFAULT">기본</SelectItem>
                                  <SelectItem value="ALLOW" disabled={allowDisabled}>허용</SelectItem>
                                  <SelectItem value="DENY" disabled={denyDisabled}>차단</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-3">
                  <Button size="sm" disabled={!overrideDirty || saveOverridesMutation.isPending} onClick={() => saveOverridesMutation.mutate()}>
                    {saveOverridesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    개별 권한 저장
                  </Button>
                </div>
              </section>

              <Separator />

              {/* 최종 적용 권한(effective permissions) */}
              <section>
                <h3 className="font-semibold mb-2">최종 적용 권한 ({detailQuery.data?.effectivePermissions.length ?? 0}개)</h3>
                <div className="flex flex-wrap gap-1">
                  {(detailQuery.data?.effectivePermissions ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">없음</span>
                  ) : (
                    detailQuery.data!.effectivePermissions.map((code) => (
                      <Badge key={code} variant="secondary" className="text-[11px]">{code}</Badge>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
