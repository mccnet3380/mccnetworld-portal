// server/lib/rbac.ts
//
// 작업명: MCC_RBAC_PHASE_2A_FOUNDATION_SCHEMA_AND_READONLY_RESOLVER_1
//
// 읽기 전용 RBAC resolver. roles/permissions/user_roles/role_permissions을 조회만 한다.
//
// 중요: 이 모듈은 아직 어떤 route middleware에도 연결되지 않는다. 기존 requireAdmin/
// requireWorker/requireDealerOrWorker, Sidebar 권한, App.tsx route 권한은 전혀 건드리지
// 않고 그대로 유지된다 — 이 resolver는 "관찰 가능한 기반 데이터"를 읽는 용도일 뿐이다.
//
// principal이 없거나 role이 없으면 항상 빈 배열을 반환한다. "role이 없으면 OWNER/ADMIN
// 허용" 같은 fallback은 절대 넣지 않는다 — OWNER도 코드에서 특별 취급하지 않고 오직
// role_permissions seed 데이터에 의해 permission을 받는다(server/lib/rbac-seed.ts 참고).
//
// ---------------------------------------------------------------------------
// DEALER principal canonical 결정 (MCC_RBAC_PHASE_2A 작업 당시 근거)
// ---------------------------------------------------------------------------
// principalType 컬럼은 스키마 레벨에서 'ADMIN' | 'USER' | 'SALES_MANAGER' | 'DEALER' 4개
// 값을 모두 허용한다(varchar, DB enum 강제 아님). 그러나 이번 단계에서 실제 dealer 계정을
// RBAC principal로 다룰 때는 principalType='DEALER'가 아니라 principalType='USER' +
// principalId=users.id 를 canonical로 쓴다.
//
// 근거: server/auth-routes.ts의 POST /api/auth/dealer-login은 getStorage().authenticateUser()
// 로 users 테이블만 조회하고, 세션도 createSession(userResult.id, userResult.userType)로
// **users.id 기준**으로만 생성된다(dealer_registrations.id는 세션/식별에 전혀 쓰이지 않고
// dealerCode/isHiddenPos 조회용 원장 데이터로만 쓰인다). 또한 dealer 계정은 dealerId만 있는
// 경우(legacy)/dealerRegistrationId만 있는 경우/둘 다 있는 경우가 모두 존재하며 모두 users
// row다(client/src/lib/auth.ts의 isDealerUser 판정과 동일 — MCC_RBAC_PRE_DEALER_IDENTITY_
// UNIFICATION_1에서 통일함). dealer_registrations.id를 principal_id로 쓰면 dealerId-only
// 계정을 표현할 수 없어 누락이 생긴다. 따라서 "DEALER 역할을 가진 USER principal"로
// 표현하는 것이 현재 로그인/세션 구조와 정확히 일치한다.
//
// 'DEALER' principalType 값 자체는 스키마에 남겨두되(추후 dealer 전용 세션/식별 모델이
// 따로 생기면 재검토), 이번 단계의 resolver 호출부와 QA 테스트는 전부 principalType='USER'
// 로 dealer 계정을 다룬다.

import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import { userRoles, roles, rolePermissions, permissions } from "../../shared/schema";

export type PrincipalType = "ADMIN" | "USER" | "SALES_MANAGER" | "DEALER";

export async function getPrincipalRoles(
  principalType: PrincipalType,
  principalId: number,
): Promise<string[]> {
  if (!principalId) return [];
  const db = await getDatabase();
  const rows = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.principalType, principalType), eq(userRoles.principalId, principalId)));

  return Array.from(new Set(rows.map((r) => r.code)));
}

export async function getPrincipalPermissions(
  principalType: PrincipalType,
  principalId: number,
): Promise<string[]> {
  if (!principalId) return [];
  const db = await getDatabase();
  const rows = await db
    .select({ code: permissions.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.principalType, principalType), eq(userRoles.principalId, principalId)));

  return Array.from(new Set(rows.map((r) => r.code)));
}

export async function hasPermission(
  principalType: PrincipalType,
  principalId: number,
  permissionCode: string,
): Promise<boolean> {
  const permissionCodes = await getPrincipalPermissions(principalType, principalId);
  return permissionCodes.includes(permissionCode);
}

// 여러 principal의 role을 한 번에 조회할 때 쓰는 보조 함수(N+1 방지용, 읽기 전용).
export async function getRolesForPrincipals(
  principalType: PrincipalType,
  principalIds: number[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (principalIds.length === 0) return result;
  const db = await getDatabase();
  const rows = await db
    .select({ principalId: userRoles.principalId, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.principalType, principalType), inArray(userRoles.principalId, principalIds)));

  for (const row of rows) {
    const existing = result.get(row.principalId) ?? [];
    existing.push(row.code);
    result.set(row.principalId, existing);
  }
  return result;
}
