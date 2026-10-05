// server/lib/rbac-guard.ts
//
// 작업명: MCC_RBAC_PHASE_2C_1_OWNER_ADMIN_MANAGEMENT_API_ENFORCEMENT_1
//
// 실제 RBAC permission enforcement용 Express middleware. server/lib/session-rbac.ts의
// loadRbacShadowContext()와는 반드시 분리해서 써야 한다 — 그 함수는 PHASE 2B SHADOW
// MODE 전용 "fail-open"(RBAC 조회 실패 시 빈 배열로 안전하게 넘어가고 기존 로그인을
// 막지 않음) 정책이고, 이 파일은 그 반대인 "fail-closed"(RBAC 조회 자체가 실패하면
// 절대 통과시키지 않고 503) 정책이다. 둘을 섞어 쓰면 안 된다.
//
// 응답 규칙:
// - 401: 인증 자체가 없음(세션 없음/무효)
// - 403: 인증은 됐지만 해당 permission이 없음
// - 503: RBAC DB 조회 자체가 실패함(권한 없음과 다르다 — 절대 통과로 처리하지 않음)
//
// requirePermission()은 req.session(= DB sessions row, requireAuth/requireAdmin이
// 이미 설정)의 userId/userType을 기준으로 principal을 resolve하므로, 반드시
// requireAuth 또는 requireAdmin 등 뒤에 이어서 사용한다(단독으로도 세션이 없으면
// 401로 안전하게 막는다).

import { getPrincipalPermissions } from "./rbac";
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
