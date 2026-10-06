// server/lib/rbac-guard.ts
//
// 작업명: MCC_RBAC_PHASE_2C_1_OWNER_ADMIN_MANAGEMENT_API_ENFORCEMENT_1
// (OWNER target 보호 추가: MCC_RBAC_PHASE_2C_2A_CRITICAL_SECURITY_HARDENING_1)
//
// 실제 RBAC permission enforcement용 Express middleware. server/lib/session-rbac.ts의
// loadRbacShadowContext()와는 반드시 분리해서 써야 한다 — 그 함수는 PHASE 2B SHADOW
// MODE 전용 "fail-open"(RBAC 조회 실패 시 빈 배열로 안전하게 넘어가고 기존 로그인을
// 막지 않음) 정책이고, 이 파일은 그 반대인 "fail-closed"(RBAC 조회 자체가 실패하면
// 절대 통과시키지 않고 503) 정책이다. 둘을 섞어 쓰면 안 된다.
//
// 응답 규칙:
// - 401: 인증 자체가 없음(세션 없음/무효)
// - 403: 인증은 됐지만 해당 permission이 없음(또는 OWNER target 보호에 걸림)
// - 503: RBAC DB 조회 자체가 실패함(권한 없음과 다르다 — 절대 통과로 처리하지 않음)
//
// requirePermission()은 req.session(= DB sessions row, requireAuth/requireAdmin이
// 이미 설정)의 userId/userType을 기준으로 principal을 resolve하므로, 반드시
// requireAuth 또는 requireAdmin 등 뒤에 이어서 사용한다(단독으로도 세션이 없으면
// 401로 안전하게 막는다).

import { getPrincipalPermissions, getPrincipalRoles, type PrincipalType } from "./rbac";
import { resolveSessionPrincipal } from "./session-rbac";

export function requirePermission(permissionCode: string) {
  return async (req: any, res: any, next: any) => {
    const userId = req.session?.userId;
    const userType = req.session?.userType;

    const principal = resolveSessionPrincipal(userType, userId);
    if (!principal) {
      return res.status(401).json({ error: '인증이 필요합니다.' });
    }

    try {
      const permissions = await getPrincipalPermissions(principal.principalType, principal.principalId);
      if (!permissions.includes(permissionCode)) {
        console.log('RBAC_PERMISSION_DENIED', {
          permissionCode,
          principalType: principal.principalType,
          principalId: principal.principalId,
        });
        return res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다.' });
      }
      next();
    } catch (error) {
      // fail-closed: RBAC 조회 자체가 실패하면 절대 허용으로 통과시키지 않는다.
      console.error('RBAC_PERMISSION_CHECK_FAILED', {
        permissionCode,
        principalType: principal.principalType,
        principalId: principal.principalId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(503).json({ error: '권한 확인 중 오류가 발생했습니다.' });
    }
  };
}

// username 하드코딩('kksnan' 등)이 아니라 user_roles/roles 기준으로 OWNER 여부를 판정한다.
export async function isOwnerPrincipal(principalType: PrincipalType, principalId: number): Promise<boolean> {
  const roleCodes = await getPrincipalRoles(principalType, principalId);
  return roleCodes.includes('OWNER');
}

// admins 테이블의 특정 계정(target)에 대한 삭제/수정 요청을 막아야 하는지 판단한다.
// target이 OWNER role을 가진 경우, 요청자(principal)도 OWNER가 아니면 거부한다.
// target이 OWNER가 아니면(일반 ADMIN끼리의 관리) 기존 동작 그대로 허용한다.
export async function checkOwnerTargetProtection(
  req: any,
  targetAdminId: number,
): Promise<{ allowed: true } | { allowed: false; status: number; body: { error: string } }> {
  const principal = resolveSessionPrincipal(req.session?.userType, req.session?.userId);
  if (!principal) {
    return { allowed: false, status: 401, body: { error: '인증이 필요합니다.' } };
  }

  try {
    const targetIsOwner = await isOwnerPrincipal('ADMIN', targetAdminId);
    if (!targetIsOwner) {
      return { allowed: true };
    }

    const requesterIsOwner = await isOwnerPrincipal(principal.principalType, principal.principalId);
    if (requesterIsOwner) {
      return { allowed: true };
    }

    console.log('RBAC_OWNER_TARGET_PROTECTION_DENIED', {
      requesterPrincipalType: principal.principalType,
      requesterPrincipalId: principal.principalId,
      targetAdminId,
    });
    return { allowed: false, status: 403, body: { error: 'OWNER 계정은 OWNER만 관리할 수 있습니다.' } };
  } catch (error) {
    // fail-closed: RBAC 조회 자체가 실패하면 절대 허용으로 통과시키지 않는다.
    console.error('RBAC_OWNER_TARGET_PROTECTION_CHECK_FAILED', {
      targetAdminId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: false, status: 503, body: { error: '권한 확인 중 오류가 발생했습니다.' } };
  }
}

// PUT/DELETE /api/admin/admins/:id 등 "admins 특정 row를 대상으로 하는" 라우트에 붙이는
// middleware 버전. :id 파싱이 라우트마다 다를 수 있어 getTargetAdminId로 추출 방식을 받는다.
export function requireOwnerTargetProtection(getTargetAdminId: (req: any) => number) {
  return async (req: any, res: any, next: any) => {
    const targetAdminId = getTargetAdminId(req);
    if (!Number.isFinite(targetAdminId)) {
      // 유효하지 않은 id는 이 가드의 책임이 아니다 — 핸들러의 기존 400 처리로 넘긴다.
      return next();
    }

    const result = await checkOwnerTargetProtection(req, targetAdminId);
    if (!result.allowed) {
      return res.status(result.status).json(result.body);
    }
    next();
  };
}
