// server/lib/internal-access.ts
//
// 작업명: KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// KT 검수 전용 내부 접근 판정 helper. LG 검수의 requireLgAuditAccess
// (server/routes/lg-audit.ts)와 판정 로직은 동일하지만, LG 파일을 절대 수정하지 않기 위해
// 완전히 독립된 파일로 둔다 — 이 helper는 KT에서만 사용한다.
//
// dealer 계정도 DB상 userType='user'로 저장될 수 있으므로 session.userType만으로는
// 내부 워커를 판정할 수 없다 — getUserById로 재조회해서 dealerId/dealerRegistrationId
// 부재를 직접 확인한다.

import { getStorage } from "../storage";

export async function requireInternalOrAdminAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }

  if (session.userType === "admin" || session.userType === "sales_manager") {
    req.session = session;
    return next();
  }

  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (user && !user.dealerId && !user.dealerRegistrationId) {
      req.session = session;
      return next();
    }
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }

  return res.status(403).json({ error: "접근 권한이 없습니다." });
}
