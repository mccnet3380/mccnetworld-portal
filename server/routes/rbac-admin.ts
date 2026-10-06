// server/routes/rbac-admin.ts
//
// 작업명: MCC_RBAC_PHASE_2E_3_OWNER_PERMISSION_MANAGEMENT_API_1
//
// OWNER 전용 RBAC 사용자별 권한 관리 API. server/routes/typing-versions.ts와 같은 방식으로
// 독립 라우터로 분리해서 server/index.ts에서 마운트한다.
//
// OWNER-only 보장(defense-in-depth, 섹션4):
//   1차: requirePermission('ROLE_READ'|'ROLE_MANAGE') — 이 두 permission은
//        OWNER_ONLY_PERMISSION_CODES에 속하고 role_permissions seed상 OWNER role에만
//        배정돼 있다(server/lib/rbac-seed.ts). 즉 effective permission에 이 코드가
//        있다는 것 자체가 이미 OWNER임을 의미한다(ALLOW override로 non-OWNER가 획득하는
//        것도 getPrincipalPermissions()의 read-time defense로 차단됨 — 2E-2).
//   2차: requireOwnerManagement()가 isOwnerPrincipal()로 OWNER role을 직접 재확인한다 —
//        1차 보호가 어떤 이유로든 무력화되는 미래의 회귀에 대비한 독립적인 2번째 게이트.
//
// 이 라우터가 만들지 않는 것: permission CRUD, role CRUD, TRAINING/TYPING enforcement 변경.

import { Router } from "express";
import { getStorage } from "../storage";
import { requirePermission, isOwnerPrincipal } from "../lib/rbac-guard";
import { resolveSessionPrincipal } from "../lib/session-rbac";
import {
  RbacManagementError,
  assertValidPrincipalType,
  listPrincipals,
  listRoles,
  listPermissions,
  getPrincipalDetail,
  saveRoleAssignment,
  saveOverrideAssignment,
} from "../lib/rbac-management";

const router = Router();

// requireAdmin과 동일한 세션 검증(Bearer + getSession) 후 req.session을 채운다 —
// requirePermission()이 req.session.userId/userType을 읍으므로 반드시 먼저 실행돼야 한다.
async function requireSession(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  req.session = session;
  next();
}

function requireOwnerManagement(permissionCode: "ROLE_READ" | "ROLE_MANAGE") {
  const permCheck = requirePermission(permissionCode);
  return [
    requireSession,
    permCheck,
    async (req: any, res: any, next: any) => {
      const principal = resolveSessionPrincipal(req.session?.userType, req.session?.userId);
      if (!principal) return res.status(401).json({ error: "인증이 필요합니다." });
      try {
        const isOwner = await isOwnerPrincipal(principal.principalType, principal.principalId);
        if (!isOwner) {
          console.log("RBAC_MANAGEMENT_NON_OWNER_BLOCKED", { principalType: principal.principalType, principalId: principal.principalId });
          return res.status(403).json({ error: "OWNER 권한이 필요합니다." });
        }
        next();
      } catch (error) {
        console.error("RBAC_MANAGEMENT_OWNER_CHECK_FAILED", {
          principalType: principal.principalType,
          principalId: principal.principalId,
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(503).json({ error: "권한 확인 중 오류가 발생했습니다." });
      }
    },
  ];
}

function handleError(err: any, res: any) {
  if (err instanceof RbacManagementError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error("RBAC_MANAGEMENT_ERROR", err);
  return res.status(500).json({ error: err.message || "요청을 처리하지 못했습니다." });
}

// ── 1. principal 목록 ────────────────────────────────────────────────────
router.get("/api/admin/rbac/principals", ...requireOwnerManagement("ROLE_READ"), async (req: any, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const principalType = typeof req.query.principalType === "string" ? req.query.principalType : undefined;
    const list = await listPrincipals({
      q,
      principalType: principalType ? assertValidPrincipalType(principalType) : undefined,
    });
    res.set("Cache-Control", "no-store");
    res.json({ principals: list });
  } catch (err: any) {
    handleError(err, res);
  }
});

// ── 2. role 목록 ─────────────────────────────────────────────────────────
router.get("/api/admin/rbac/roles", ...requireOwnerManagement("ROLE_READ"), async (_req, res) => {
  try {
    const list = await listRoles();
    res.set("Cache-Control", "no-store");
    res.json({ roles: list });
  } catch (err: any) {
    handleError(err, res);
  }
});

// ── 3. permission 목록 ───────────────────────────────────────────────────
router.get("/api/admin/rbac/permissions", ...requireOwnerManagement("ROLE_READ"), async (_req, res) => {
  try {
    const list = await listPermissions();
    res.set("Cache-Control", "no-store");
    res.json({ permissions: list });
  } catch (err: any) {
    handleError(err, res);
  }
});

// ── 4-6. principal detail (roles/overrides/effective permissions) ──────
router.get(
  "/api/admin/rbac/principals/:principalType/:principalId",
  ...requireOwnerManagement("ROLE_READ"),
  async (req: any, res) => {
    try {
      const principalType = assertValidPrincipalType(req.params.principalType);
      const principalId = Number(req.params.principalId);
      if (!Number.isInteger(principalId)) {
        return res.status(400).json({ error: "principalId는 정수여야 합니다." });
      }
      const detail = await getPrincipalDetail(principalType, principalId);
      res.set("Cache-Control", "no-store");
      res.json(detail);
    } catch (err: any) {
      handleError(err, res);
    }
  },
);

// ── 7. role assignment 저장 ──────────────────────────────────────────────
router.put(
  "/api/admin/rbac/principals/:principalType/:principalId/roles",
  ...requireOwnerManagement("ROLE_MANAGE"),
  async (req: any, res) => {
    try {
      const principalType = assertValidPrincipalType(req.params.principalType);
      const principalId = Number(req.params.principalId);
      if (!Number.isInteger(principalId)) {
        return res.status(400).json({ error: "principalId는 정수여야 합니다." });
      }
      const { roleCodes } = req.body || {};
      const result = await saveRoleAssignment(principalType, principalId, roleCodes);
      console.log("RBAC_MANAGEMENT_ROLE_SAVED", {
        actorAdminId: req.session.userId,
        targetPrincipalType: principalType,
        targetPrincipalId: principalId,
        roleCodes: result.roleCodes,
      });
      res.json(result);
    } catch (err: any) {
      handleError(err, res);
    }
  },
);

// ── 8. permission override 저장 ──────────────────────────────────────────
router.put(
  "/api/admin/rbac/principals/:principalType/:principalId/overrides",
  ...requireOwnerManagement("ROLE_MANAGE"),
  async (req: any, res) => {
    try {
      const principalType = assertValidPrincipalType(req.params.principalType);
      const principalId = Number(req.params.principalId);
      if (!Number.isInteger(principalId)) {
        return res.status(400).json({ error: "principalId는 정수여야 합니다." });
      }
      const { overrides } = req.body || {};
      const result = await saveOverrideAssignment(principalType, principalId, overrides, req.session.userId);
      console.log("RBAC_MANAGEMENT_OVERRIDE_SAVED", {
        actorAdminId: req.session.userId,
        targetPrincipalType: principalType,
        targetPrincipalId: principalId,
        allowOverrides: result.allowOverrides,
        denyOverrides: result.denyOverrides,
      });
      res.json(result);
    } catch (err: any) {
      handleError(err, res);
    }
  },
);

export default router;
