// server/lib/session-rbac.ts
//
// 작업명: MCC_RBAC_PHASE_2B_SESSION_SHADOW_CONTEXT_1
//
// 로그인한 session(userType/userId)을 RBAC principal로 변환하고, 그 principal의
// roles/permissions를 조회해 "SHADOW RBAC context"를 만든다.
//
// 중요: 이 모듈이 반환하는 rbacRoles/rbacPermissions는 이번 단계에서 아무 곳에서도
// 접근 차단/허용 판정에 쓰이지 않는다 — 응답에 실어 보내기만 하는 SHADOW MODE다.
// 기존 requireAdmin/requireWorker/requireDealerOrWorker, Sidebar, App.tsx route 가드는
// 전혀 건드리지 않고 그대로 유지된다.
//
// ---------------------------------------------------------------------------
// Principal 해석 규칙 (PHASE 2A canonical 결정을 그대로 따름)
// ---------------------------------------------------------------------------
// - userType === 'admin'          -> principalType='ADMIN',         principalId=admins.id
// - userType === 'sales_manager'  -> principalType='SALES_MANAGER', principalId=sales_managers.id
//   (authenticateSalesManager가 항상 null을 반환하므로 현재 실제 로그인 경로는 없다 — 구조만 대비)
// - 그 외(userType === 'user', 일반 근무자/middle_manager/dealer 전부 포함)
//                                  -> principalType='USER',          principalId=users.id
//
// dealerId/dealerRegistrationId는 절대 principalId로 쓰지 않는다. dealer 계정도 결국 users
// row이므로 USER principal로 다루고, DEALER role은 (아직 실제로는 아무도 배정되지 않았지만)
// 추후 이 USER principal에 user_roles로 부여하는 모델을 유지한다
// (MCC_RBAC_PHASE_2A_FOUNDATION_SCHEMA_AND_READONLY_RESOLVER_1에서 확정한 결정 — 이번
// 작업에서 다시 바꾸지 않는다).
//
// ---------------------------------------------------------------------------
// 실패 정책 (SHADOW MODE 전용 — fail-open)
// ---------------------------------------------------------------------------
// RBAC 조회(DB 쿼리)가 실패해도 기존 로그인/인증 흐름은 절대 막지 않는다. 에러는
// RBAC_SHADOW_CONTEXT_LOAD_FAILED로 로그만 남기고, rbacRoles=[]/rbacPermissions=[]로
// 안전하게 폴백한다. 이 fail-open은 "아직 아무도 이 값을 권한 판정에 쓰지 않기 때문에"만
// 허용되는 것이다 — 실제 enforcement를 시작하는 PHASE 2C 이후에는 이 fail-open 정책을
// 그대로 재사용하면 안 되고 별도의 fail-closed 정책을 다시 설계해야 한다.

import { getPrincipalRoles, getPrincipalPermissions, type PrincipalType } from "./rbac";

export interface SessionPrincipal {
  principalType: PrincipalType;
  principalId: number;
}

export interface RbacShadowContext {
  rbacPrincipalType: PrincipalType;
  rbacPrincipalId: number;
  rbacRoles: string[];
  rbacPermissions: string[];
}

export function resolveSessionPrincipal(userType: string | undefined, userId: number | undefined | null): SessionPrincipal | null {
  if (!userId) return null;
  if (userType === "admin") return { principalType: "ADMIN", principalId: userId };
  if (userType === "sales_manager") return { principalType: "SALES_MANAGER", principalId: userId };
  return { principalType: "USER", principalId: userId };
}

// 공통 shadow context loader. login(/login, /dealer-login)과 /me가 각자 중복 구현하지
// 않도록 여기 한 곳에서만 principal resolve + roles/permissions 조회를 수행한다.
export async function loadRbacShadowContext(
  userType: string | undefined,
  userId: number | undefined | null,
): Promise<RbacShadowContext | null> {
  const principal = resolveSessionPrincipal(userType, userId);
  if (!principal) return null;

  try {
    const [rbacRoles, rbacPermissions] = await Promise.all([
      getPrincipalRoles(principal.principalType, principal.principalId),
      getPrincipalPermissions(principal.principalType, principal.principalId),
    ]);

    console.log("RBAC_SHADOW_LOADED", {
      principalType: principal.principalType,
      principalId: principal.principalId,
      roleCount: rbacRoles.length,
      permissionCount: rbacPermissions.length,
    });

    return {
      rbacPrincipalType: principal.principalType,
      rbacPrincipalId: principal.principalId,
      rbacRoles,
      rbacPermissions,
    };
  } catch (error) {
    console.error("RBAC_SHADOW_CONTEXT_LOAD_FAILED", {
      principalType: principal.principalType,
      principalId: principal.principalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      rbacPrincipalType: principal.principalType,
      rbacPrincipalId: principal.principalId,
      rbacRoles: [],
      rbacPermissions: [],
    };
  }
}
