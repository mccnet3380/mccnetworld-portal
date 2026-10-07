// server/lib/rbac-management.ts
//
// 작업명: MCC_RBAC_PHASE_2E_3_OWNER_PERMISSION_MANAGEMENT_API_1
//
// OWNER 전용 RBAC 관리 기능(principal/role/permission 조회, role assignment,
// permission override 저장)의 순수 비즈니스 로직. Express 핸들러(server/routes/
// rbac-admin.ts)는 이 모듈의 함수만 호출하고, 여기서 직접 req/res를 다루지 않는다.
//
// 이 파일이 하지 않는 것(명시적으로 범위 밖):
// - permission CRUD(생성/수정/삭제) — permission registry는 rbac-seed.ts/migration으로만 관리.
// - role CRUD(생성/수정/삭제) — roles는 조회만. 이미 존재하는 role을 principal에 배정/해제만 한다.
// - TYPING_READ/MANAGE enforcement 변경 — 이 파일은 기존 enforcement 상태를 "읍어서
//   보여주기만" 한다(ENFORCEMENT_REGISTRY), 새로 연결하지 않는다.
//   (TRAINING_READ/MANAGE는 MCC_TRAINING_PERMISSION_ENFORCEMENT_1에서 server/routes/
//   training.ts에 실제로 연결되었으므로 ENFORCED로 갱신 — 이 파일 자체가 그 변경은
//   아니고, 실제 enforcement 변경을 뒤따라 레지스트리만 맞춘 것이다.)

import { and, count, eq, getTableColumns, inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import {
  admins,
  users,
  salesManagers,
  roles,
  permissions,
  userRoles,
  rolePermissions,
  userPermissionOverrides,
} from "../../shared/schema";
import {
  getPrincipalPermissions,
  getPrincipalPermissionOverrides,
  getPrincipalRoles,
  getRolesForPrincipals,
  type PrincipalType,
  type PermissionOverrideEffect,
} from "./rbac";
import { OWNER_ONLY_PERMISSION_CODES } from "./rbac-seed";

export class RbacManagementError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Enforcement status registry — 실제 repo 검색(requirePermission/custom guard
// 호출부) 결과를 그대로 코드로 옮긴 것이다. 추측 없음, UI가 사용자를 속이지 않기
// 위한 "현재 상태 표시"일 뿐 — 이 레지스트리를 바꾼다고 실제 enforcement가 바뀌지
// 않는다(그 반대: 실제 enforcement가 바뀌면 이 레지스트리를 다시 감사해서 맞춰야 함).
//
// 확인 방법(이번 작업에서 실제로 실행한 명령):
//   grep -rn "requirePermission(" server/routes.ts server/routes/*.ts
//     | grep -oP "requirePermission\('[A-Z_]+'\)" | sort -u
// 로 찾은 14개 코드 + DOCUMENT_READ(server/lib/data-scope.ts 기반, routes.ts의
// GET /api/documents 및 export/excel에서 resolveDataScope()로 enforcement) +
// TYPING_READ/TYPING_MANAGE(server/routes/typing-versions.ts의 legacy-transition
// 커스텀 가드 — MCC_RBAC_TYPING_PERMISSION_ENFORCEMENT_PRODUCTION_DEPLOYMENT_1로
// 운영 반영 완료) = 17개 ENFORCED. TRAINING_READ/TRAINING_MANAGE는
// MCC_TRAINING_PERMISSION_ENFORCEMENT_1에서 server/routes/training.ts에 동일한
// legacy-transition 커스텀 가드(resolveTrainingPermission)로 연결 완료 — 19개
// ENFORCED. 나머지는 전부 NOT_ENFORCED(seed만 존재, 어떤 코드 경로도 아직 확인하지
// 않음).
//
// ROLE_READ/ROLE_MANAGE: 바로 이 파일이 추가하는 OWNER 관리 API 자신이 최초의
// 실제 enforcement 지점이다(server/routes/rbac-admin.ts가 requirePermission()으로
// 직접 사용) — 그래서 ENFORCED로 올린다. 다른 코드를 건드려서가 아니라, 이 API
// 구현 자체가 "그 permission을 쓰는 실제 코드"가 됐기 때문이다.
export type EnforcementStatus = "ENFORCED" | "NOT_ENFORCED";

const ENFORCEMENT_REGISTRY: Record<string, EnforcementStatus> = {
  // requirePermission() 직접 호출 (server/routes.ts)
  CARRIER_MANAGE: "ENFORCED",
  CONTACT_CODE_EDIT: "ENFORCED",
  CONTACT_CODE_READ: "ENFORCED",
  DEALER_MANAGE: "ENFORCED",
  DEALER_READ: "ENFORCED",
  HIDDEN_POLICY_MANAGE: "ENFORCED",
  MENU_PERMISSION_MANAGE: "ENFORCED",
  SERVICE_PLAN_MANAGE: "ENFORCED",
  SETTLEMENT_POLICY_EDIT: "ENFORCED",
  SETTLEMENT_POLICY_READ: "ENFORCED",
  SETTLEMENT_PRICING_MANAGE: "ENFORCED",
  TEAM_READ: "ENFORCED",
  USER_MANAGE: "ENFORCED",
  USER_READ: "ENFORCED",
  // Data Scope resolver 기반 (server/lib/data-scope.ts + routes.ts 문서 목록/export)
  DOCUMENT_READ: "ENFORCED",
  // Legacy-transition 커스텀 가드, 운영 반영 완료 (server/routes/typing-versions.ts)
  TYPING_READ: "ENFORCED",
  TYPING_MANAGE: "ENFORCED",
  // Legacy-transition 커스텀 가드 (server/routes/training.ts, MCC_TRAINING_PERMISSION_ENFORCEMENT_1)
  TRAINING_READ: "ENFORCED",
  TRAINING_MANAGE: "ENFORCED",
  // 이 관리 API 자신이 최초 enforcement 지점 (server/routes/rbac-admin.ts)
  ROLE_READ: "ENFORCED",
  ROLE_MANAGE: "ENFORCED",
};

export function getEnforcementStatus(permissionCode: string): EnforcementStatus {
  return ENFORCEMENT_REGISTRY[permissionCode] ?? "NOT_ENFORCED";
}

// ───────────────────────────────────────────────────────────────────────────
// principalType 정책 — OWNER/ADMIN role은 ADMIN principal에만 배정 가능.
// 근거: 실제 운영 user_roles 4건 전부 OWNER→admins, ADMIN→admins이고, admin
// 로그인 자체가 principalType='ADMIN'만 생성하는 구조(server/lib/session-rbac.ts
// resolveSessionPrincipal)이므로 이 정책이 기존 구조와 일치한다. MIDDLE_MANAGER/
// ACTIVATION/AUDIT/SETTLEMENT/SALES/DEALER는 USER principal에 배정 가능(기존
// LEGACY_COMPAT_POLICY가 이미 이 전제로 설계됨 — server/lib/data-scope.ts 참고).
const ADMIN_PRINCIPAL_ONLY_ROLE_CODES = ["OWNER", "ADMIN"];

const VALID_PRINCIPAL_TYPES: PrincipalType[] = ["ADMIN", "USER", "SALES_MANAGER"];

export function assertValidPrincipalType(v: unknown): PrincipalType {
  if (typeof v === "string" && (VALID_PRINCIPAL_TYPES as string[]).includes(v)) {
    return v as PrincipalType;
  }
  throw new RbacManagementError(400, "principalType은 ADMIN/USER/SALES_MANAGER 중 하나여야 합니다.");
}

async function assertPrincipalExists(principalType: PrincipalType, principalId: number): Promise<void> {
  const db = await getDatabase();
  if (principalType === "ADMIN") {
    const rows = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, principalId)).limit(1);
    if (!rows[0]) throw new RbacManagementError(404, "해당 admin principal을 찾을 수 없습니다.");
  } else if (principalType === "USER") {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, principalId)).limit(1);
    if (!rows[0]) throw new RbacManagementError(404, "해당 user principal을 찾을 수 없습니다.");
  } else {
    const rows = await db.select({ id: salesManagers.id }).from(salesManagers).where(eq(salesManagers.id, principalId)).limit(1);
    if (!rows[0]) throw new RbacManagementError(404, "해당 sales_manager principal을 찾을 수 없습니다.");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. principal 목록 — admins/users/sales_managers 전부를 unified list로.
// password/hash/token/secret 등 인증정보는 절대 select하지 않는다(기존
// getAdmins()/getSalesManagers()의 명시적 컬럼 선택 관례를 그대로 따름).
// ───────────────────────────────────────────────────────────────────────────
export interface PrincipalListItem {
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

export async function listPrincipals(filter?: { q?: string; principalType?: PrincipalType }): Promise<PrincipalListItem[]> {
  const db = await getDatabase();

  const adminRows = await db.select({ id: admins.id, username: admins.username, name: admins.name }).from(admins);
  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      userType: users.userType,
      role: users.role,
      dealerId: users.dealerId,
      dealerRegistrationId: users.dealerRegistrationId,
    })
    .from(users);
  const smCols = getTableColumns(salesManagers);
  const smRows = await db
    .select({ id: smCols.id, username: smCols.username, managerName: smCols.managerName })
    .from(salesManagers);

  type Raw = { principalType: PrincipalType; principalId: number; username: string; displayName: string; legacyUserType?: string; legacyRole?: string | null; isDealer: boolean };
  const raw: Raw[] = [
    ...adminRows.map((a) => ({ principalType: "ADMIN" as const, principalId: a.id, username: a.username, displayName: a.name, isDealer: false })),
    ...userRows.map((u) => ({
      principalType: "USER" as const,
      principalId: u.id,
      username: u.username,
      displayName: u.name,
      legacyUserType: u.userType,
      legacyRole: u.role,
      isDealer: u.dealerId != null || u.dealerRegistrationId != null,
    })),
    ...smRows.map((s) => ({ principalType: "SALES_MANAGER" as const, principalId: s.id, username: s.username, displayName: s.managerName, isDealer: false })),
  ];

  const filtered = raw.filter((r) => {
    if (filter?.principalType && r.principalType !== filter.principalType) return false;
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      if (!r.username.toLowerCase().includes(q) && !r.displayName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // role/override/effective-permission 배치 조회 — N+1 방지(ADMIN/USER/SALES_MANAGER 각각 분리된
  // getRolesForPrincipals 호출, 기존 rbac.ts 함수 그대로 재사용, 중복 구현 없음).
  const rolesByType = new Map<PrincipalType, Map<number, string[]>>();
  for (const pt of VALID_PRINCIPAL_TYPES) {
    const ids = filtered.filter((r) => r.principalType === pt).map((r) => r.principalId);
    rolesByType.set(pt, await getRolesForPrincipals(pt, ids));
  }

  const overrideCounts = await db
    .select({ principalType: userPermissionOverrides.principalType, principalId: userPermissionOverrides.principalId, c: count() })
    .from(userPermissionOverrides)
    .groupBy(userPermissionOverrides.principalType, userPermissionOverrides.principalId);
  const overrideCountMap = new Map<string, number>(overrideCounts.map((r) => [`${r.principalType}::${r.principalId}`, Number(r.c)]));

  const results = await Promise.all(
    filtered.map(async (r): Promise<PrincipalListItem> => {
      const roleCodes = rolesByType.get(r.principalType)?.get(r.principalId) ?? [];
      const overrideCount = overrideCountMap.get(`${r.principalType}::${r.principalId}`) ?? 0;
      const effectivePermissions = await getPrincipalPermissions(r.principalType, r.principalId);
      return {
        principalType: r.principalType,
        principalId: r.principalId,
        username: r.username,
        displayName: r.displayName,
        legacyUserType: r.legacyUserType,
        legacyRole: r.legacyRole,
        isDealer: r.isDealer,
        roleCodes,
        overrideCount,
        effectivePermissionCount: effectivePermissions.length,
      };
    }),
  );

  return results;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. roles 조회
// ───────────────────────────────────────────────────────────────────────────
export interface RoleListItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
}

export async function listRoles(): Promise<RoleListItem[]> {
  const db = await getDatabase();
  const roleRows = await db.select().from(roles);
  const permCounts = await db
    .select({ roleId: rolePermissions.roleId, c: count() })
    .from(rolePermissions)
    .groupBy(rolePermissions.roleId);
  const countByRoleId = new Map(permCounts.map((r) => [r.roleId, Number(r.c)]));

  return roleRows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissionCount: countByRoleId.get(r.id) ?? 0,
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// 3. permissions 조회
// ───────────────────────────────────────────────────────────────────────────
export interface PermissionListItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isOwnerOnly: boolean;
  enforcementStatus: EnforcementStatus;
}

export async function listPermissions(): Promise<PermissionListItem[]> {
  const db = await getDatabase();
  const rows = await db.select().from(permissions);
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    isOwnerOnly: OWNER_ONLY_PERMISSION_CODES.includes(p.code),
    enforcementStatus: getEnforcementStatus(p.code),
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// 4-6. principal detail — roles/overrides/effective permissions
// ───────────────────────────────────────────────────────────────────────────
export interface PrincipalDetail {
  principalType: PrincipalType;
  principalId: number;
  roleCodes: string[];
  allowOverrides: string[];
  denyOverrides: string[];
  effectivePermissions: string[];
}

export async function getPrincipalDetail(principalType: PrincipalType, principalId: number): Promise<PrincipalDetail> {
  await assertPrincipalExists(principalType, principalId);

  const [roleCodes, overrides, effectivePermissions] = await Promise.all([
    getPrincipalRoles(principalType, principalId),
    getPrincipalPermissionOverrides(principalType, principalId),
    getPrincipalPermissions(principalType, principalId),
  ]);

  return {
    principalType,
    principalId,
    roleCodes,
    allowOverrides: overrides.filter((o) => o.effect === "ALLOW").map((o) => o.code),
    denyOverrides: overrides.filter((o) => o.effect === "DENY").map((o) => o.code),
    effectivePermissions,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 7. role assignment 저장 (full sync) — section 12-17
// ───────────────────────────────────────────────────────────────────────────
export async function saveRoleAssignment(
  principalType: PrincipalType,
  principalId: number,
  roleCodes: string[],
): Promise<{ roleCodes: string[] }> {
  await assertPrincipalExists(principalType, principalId);

  if (!Array.isArray(roleCodes) || roleCodes.some((c) => typeof c !== "string")) {
    throw new RbacManagementError(400, "roleCodes는 문자열 배열이어야 합니다.");
  }
  const uniqueRoleCodes = Array.from(new Set(roleCodes));

  const db = await getDatabase();

  await db.transaction(async (tx: any) => {
    const roleRows = uniqueRoleCodes.length > 0
      ? await tx.select().from(roles).where(inArray(roles.code, uniqueRoleCodes))
      : [];
    if (roleRows.length !== uniqueRoleCodes.length) {
      const foundCodes = new Set(roleRows.map((r: any) => r.code));
      const missing = uniqueRoleCodes.filter((c) => !foundCodes.has(c));
      throw new RbacManagementError(400, `존재하지 않는 role code: ${missing.join(", ")}`);
    }

    const willHaveOwner = uniqueRoleCodes.includes("OWNER");
    const willHaveAdminOnlyRole = uniqueRoleCodes.some((c) => ADMIN_PRINCIPAL_ONLY_ROLE_CODES.includes(c));
    if (willHaveAdminOnlyRole && principalType !== "ADMIN") {
      throw new RbacManagementError(
        400,
        `${ADMIN_PRINCIPAL_ONLY_ROLE_CODES.filter((c) => uniqueRoleCodes.includes(c)).join(", ")} role은 ADMIN principal에만 배정할 수 있습니다.`,
      );
    }

    const currentRoleRows = await tx
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.principalType, principalType), eq(userRoles.principalId, principalId)));
    const currentlyHasOwner = currentRoleRows.some((r: any) => r.code === "OWNER");

    if (currentlyHasOwner && !willHaveOwner) {
      const ownerRoleRow = await tx.select().from(roles).where(eq(roles.code, "OWNER")).limit(1);
      const ownerRoleId = ownerRoleRow[0]?.id;
      const [{ c: ownerCount }] = ownerRoleId
        ? await tx.select({ c: count() }).from(userRoles).where(eq(userRoles.roleId, ownerRoleId))
        : [{ c: 0 }];
      if (Number(ownerCount) <= 1) {
        throw new RbacManagementError(409, "마지막 OWNER는 제거할 수 없습니다.", "LAST_OWNER_CANNOT_BE_REMOVED");
      }
    }

    await tx.delete(userRoles).where(and(eq(userRoles.principalType, principalType), eq(userRoles.principalId, principalId)));
    if (uniqueRoleCodes.length > 0) {
      const roleIdByCode = new Map(roleRows.map((r: any) => [r.code, r.id]));
      await tx.insert(userRoles).values(
        uniqueRoleCodes.map((code) => ({ principalType, principalId, roleId: roleIdByCode.get(code)! })),
      );
    }
  });

  return { roleCodes: uniqueRoleCodes };
}

// ───────────────────────────────────────────────────────────────────────────
// 8. permission override 저장 (full sync) — section 18-24
// ───────────────────────────────────────────────────────────────────────────
export interface OverrideInput {
  permissionCode: string;
  effect: PermissionOverrideEffect;
}

export async function saveOverrideAssignment(
  principalType: PrincipalType,
  principalId: number,
  overrides: OverrideInput[],
  actorAdminId: number,
): Promise<{ allowOverrides: string[]; denyOverrides: string[] }> {
  await assertPrincipalExists(principalType, principalId);

  if (!Array.isArray(overrides)) {
    throw new RbacManagementError(400, "overrides는 배열이어야 합니다.");
  }
  for (const o of overrides) {
    if (!o || typeof o.permissionCode !== "string" || (o.effect !== "ALLOW" && o.effect !== "DENY")) {
      throw new RbacManagementError(400, "각 override는 {permissionCode: string, effect: 'ALLOW'|'DENY'} 형식이어야 합니다.");
    }
  }

  const codes = overrides.map((o) => o.permissionCode);
  const duplicates = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (duplicates.length > 0) {
    throw new RbacManagementError(400, `중복된 permission code: ${Array.from(new Set(duplicates)).join(", ")}`);
  }

  const db = await getDatabase();
  const permRows = codes.length > 0 ? await db.select().from(permissions).where(inArray(permissions.code, codes)) : [];
  const foundCodes = new Set(permRows.map((p) => p.code));
  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length > 0) {
    throw new RbacManagementError(400, `존재하지 않는 permission code: ${missing.join(", ")}`);
  }

  // OWNER_ONLY write-time 차단 (resolver의 read-time defense와 동일한 정책을 쓰기 시점에도 적용).
  const roleCodes = await getPrincipalRoles(principalType, principalId);
  const isOwner = roleCodes.includes("OWNER");
  for (const o of overrides) {
    if (OWNER_ONLY_PERMISSION_CODES.includes(o.permissionCode)) {
      if (o.effect === "ALLOW" && !isOwner) {
        throw new RbacManagementError(400, `${o.permissionCode}는 OWNER_ONLY permission이라 OWNER가 아닌 principal에게 ALLOW override를 줄 수 없습니다.`);
      }
      if (o.effect === "DENY" && isOwner) {
        throw new RbacManagementError(400, `${o.permissionCode}는 OWNER_ONLY permission이라 OWNER principal에게 DENY override를 적용할 수 없습니다.`);
      }
    }
  }

  const permissionIdByCode = new Map(permRows.map((p) => [p.code, p.id]));

  await db.transaction(async (tx: any) => {
    await tx.delete(userPermissionOverrides).where(
      and(eq(userPermissionOverrides.principalType, principalType), eq(userPermissionOverrides.principalId, principalId)),
    );
    if (overrides.length > 0) {
      await tx.insert(userPermissionOverrides).values(
        overrides.map((o) => ({
          principalType,
          principalId,
          permissionId: permissionIdByCode.get(o.permissionCode)!,
          effect: o.effect,
          createdByAdminId: actorAdminId,
        })),
      );
    }
  });

  return {
    allowOverrides: overrides.filter((o) => o.effect === "ALLOW").map((o) => o.permissionCode),
    denyOverrides: overrides.filter((o) => o.effect === "DENY").map((o) => o.permissionCode),
  };
}
