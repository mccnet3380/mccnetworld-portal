// scripts/rbac-management-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2E_3_OWNER_PERMISSION_MANAGEMENT_API_1
//
// server/lib/rbac-management.ts의 비즈니스 로직(principal/role/permission 조회,
// role/override 저장, last-OWNER 보호, OWNER_ONLY write-time 차단)을 DEV DB
// fixture로 self-test한다. CASE_1/2(401/403)와 CASE_8(세션 즉시 반영)은 Express
// 라우팅/인증이 필요해 별도 HTTP QA로 검증한다(이 스크립트는 로직 레이어 전담).
//
// 실행: npx tsx --env-file=.env scripts/rbac-management-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { initStorage } from "../server/storage";
import { admins, users, roles, userRoles, userPermissionOverrides, permissions } from "../shared/schema";
import {
  listPrincipals,
  listRoles,
  listPermissions,
  getPrincipalDetail,
  saveRoleAssignment,
  saveOverrideAssignment,
  RbacManagementError,
} from "../server/lib/rbac-management";
import { getPrincipalRoles } from "../server/lib/rbac";
import { resolveDataScope } from "../server/lib/data-scope";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${label} — expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (!pass) failures++;
}

function assertTrue(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "[PASS]" : "[FAIL]"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function expectError(label: string, fn: () => Promise<unknown>, expectedStatus: number, expectedCode?: string) {
  try {
    await fn();
    assertTrue(label, false, "expected error but succeeded");
  } catch (e: any) {
    if (e instanceof RbacManagementError) {
      const statusOk = e.status === expectedStatus;
      const codeOk = expectedCode ? e.code === expectedCode : true;
      assertTrue(label, statusOk && codeOk, `status=${e.status} code=${e.code} message=${e.message}`);
    } else {
      assertTrue(label, false, `unexpected error type: ${e.message}`);
    }
  }
}

async function main() {
  await initStorage();
  const db = await getDatabase();

  try {
    // ── fixtures ────────────────────────────────────────────────────────
    const ownerA = await db.insert(admins).values({ username: "qa_rbacmgmt_ownerA_temp", password: "x", name: "QA OWNER A" }).returning({ id: admins.id });
    const ownerAId = ownerA[0].id;
    const ownerB = await db.insert(admins).values({ username: "qa_rbacmgmt_ownerB_temp", password: "x", name: "QA OWNER B" }).returning({ id: admins.id });
    const ownerBId = ownerB[0].id;
    const plainAdmin = await db.insert(admins).values({ username: "qa_rbacmgmt_admin_temp", password: "x", name: "QA PLAIN ADMIN" }).returning({ id: admins.id });
    const plainAdminId = plainAdmin[0].id;

    const noRoleWorker = await db.insert(users).values({ username: "qa_rbacmgmt_norole_temp", password: "x", name: "QA NO-ROLE WORKER", userType: "user" }).returning({ id: users.id });
    const noRoleWorkerId = noRoleWorker[0].id;
    const dealerWorker = await db.insert(users).values({ username: "qa_rbacmgmt_dealer_temp", password: "x", name: "QA DEALER", userType: "user", dealerId: 999998 }).returning({ id: users.id });
    const dealerWorkerId = dealerWorker[0].id;

    await db.insert(userRoles).values({ principalType: "ADMIN", principalId: ownerAId, roleId: (await db.select().from(roles).where(eq(roles.code, "OWNER")).limit(1))[0].id });
    await db.insert(userRoles).values({ principalType: "ADMIN", principalId: ownerBId, roleId: (await db.select().from(roles).where(eq(roles.code, "OWNER")).limit(1))[0].id });

    // ── CASE_3/4/5 content shape (OWNER-authorized caller는 Express 레이어 — 여기서는
    // 비즈니스 로직이 올바른 데이터를 돌려주는지만 확인) ──────────────────────────
    const principalsList = await listPrincipals();
    assertTrue("CASE_3: listPrincipals returns non-empty array", Array.isArray(principalsList) && principalsList.length > 0);
    // CASE_20: password/hash 필드 없음
    const anyFieldLeak = principalsList.some((p: any) => "password" in p || "passwordHash" in p || "hashedPassword" in p);
    assertTrue("CASE_20: principal list has no password/hash fields", !anyFieldLeak);

    const rolesList = await listRoles();
    assertEqual("CASE_4: listRoles returns 9 roles", rolesList.length, 9);

    const permsList = await listPermissions();
    assertEqual("CASE_5: listPermissions returns 35 permissions", permsList.length, 35);
    const typingRead = permsList.find((p) => p.code === "TYPING_READ");
    assertEqual("enforcement registry: TYPING_READ=ENFORCED", typingRead?.enforcementStatus, "ENFORCED");
    const trainingRead = permsList.find((p) => p.code === "TRAINING_READ");
    assertEqual("enforcement registry: TRAINING_READ=NOT_ENFORCED", trainingRead?.enforcementStatus, "NOT_ENFORCED");

    // ── CASE_6: roleCodes=[] 저장 성공 ──────────────────────────────────
    const c6 = await saveRoleAssignment("USER", noRoleWorkerId, []);
    assertEqual("CASE_6: empty roleCodes save succeeds", c6.roleCodes, []);
    assertEqual("CASE_6: getPrincipalRoles still []", await getPrincipalRoles("USER", noRoleWorkerId), []);

    // ── CASE_7: MIDDLE_MANAGER 저장 성공 + getPrincipalRoles 반영 ────────
    const c7 = await saveRoleAssignment("USER", noRoleWorkerId, ["MIDDLE_MANAGER"]);
    assertEqual("CASE_7: MIDDLE_MANAGER save succeeds", c7.roleCodes, ["MIDDLE_MANAGER"]);
    const c7Roles = await getPrincipalRoles("USER", noRoleWorkerId);
    assertTrue("CASE_7: getPrincipalRoles includes MIDDLE_MANAGER", c7Roles.includes("MIDDLE_MANAGER"));

    // ── CASE_19: MIDDLE_MANAGER fixture -> DOCUMENT_READ LEGACY_COMPAT ──
    const c19 = await resolveDataScope({ principalType: "USER", principalId: noRoleWorkerId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("CASE_19: MIDDLE_MANAGER DOCUMENT_READ -> LEGACY_COMPAT", c19, { mode: "LEGACY", reason: "LEGACY_COMPAT", matchedRole: "MIDDLE_MANAGER" });

    // ── CASE_9: override TYPING_READ ALLOW -> 즉시 effective permission 포함 ──
    const c9 = await saveOverrideAssignment("USER", noRoleWorkerId, [{ permissionCode: "TYPING_READ", effect: "ALLOW" }], ownerAId);
    assertEqual("CASE_9: ALLOW override save result", c9.allowOverrides, ["TYPING_READ"]);
    const c9Detail = await getPrincipalDetail("USER", noRoleWorkerId);
    assertTrue("CASE_9: effective permissions include TYPING_READ", c9Detail.effectivePermissions.includes("TYPING_READ"));

    // ── CASE_10: override TYPING_READ DENY -> effective permission 제거 ──
    const c10 = await saveOverrideAssignment("USER", noRoleWorkerId, [{ permissionCode: "TYPING_READ", effect: "DENY" }], ownerAId);
    assertEqual("CASE_10: DENY override save result", c10.denyOverrides, ["TYPING_READ"]);
    const c10Detail = await getPrincipalDetail("USER", noRoleWorkerId);
    assertTrue("CASE_10: effective permissions no longer include TYPING_READ", !c10Detail.effectivePermissions.includes("TYPING_READ"));

    // ── CASE_11: 같은 permission ALLOW+DENY 동시 -> 400 ─────────────────
    await expectError(
      "CASE_11: duplicate permission code in overrides -> 400",
      () => saveOverrideAssignment("USER", noRoleWorkerId, [
        { permissionCode: "AUDIT_PROCESS", effect: "ALLOW" },
        { permissionCode: "AUDIT_PROCESS", effect: "DENY" },
      ], ownerAId),
      400,
    );
    // 부분 적용 없음 확인 — 이전 상태(TYPING_READ DENY) 그대로 유지
    const c11Detail = await getPrincipalDetail("USER", noRoleWorkerId);
    assertEqual("CASE_11: no partial apply, override state unchanged", c11Detail.denyOverrides, ["TYPING_READ"]);

    // ── CASE_12: non-owner에게 ROLE_MANAGE ALLOW -> 400 ─────────────────
    await expectError(
      "CASE_12: non-owner ALLOW override on ROLE_MANAGE -> 400",
      () => saveOverrideAssignment("USER", noRoleWorkerId, [{ permissionCode: "ROLE_MANAGE", effect: "ALLOW" }], ownerAId),
      400,
    );

    // ── CASE_13: OWNER에게 ROLE_MANAGE DENY -> 차단(400) ────────────────
    await expectError(
      "CASE_13: OWNER DENY override on ROLE_MANAGE -> 400",
      () => saveOverrideAssignment("ADMIN", ownerAId, [{ permissionCode: "ROLE_MANAGE", effect: "DENY" }], ownerAId),
      400,
    );

    // ── CASE_16: 존재하지 않는 role code -> 400, 부분 적용 없음 ─────────
    await expectError(
      "CASE_16: invalid role code -> 400",
      () => saveRoleAssignment("USER", noRoleWorkerId, ["MIDDLE_MANAGER", "NOT_A_REAL_ROLE"]),
      400,
    );
    const c16Roles = await getPrincipalRoles("USER", noRoleWorkerId);
    assertEqual("CASE_16: no partial apply, roles unchanged", c16Roles, ["MIDDLE_MANAGER"]);

    // ── CASE_17: 존재하지 않는 permission code -> 400, 부분 적용 없음 ──
    await expectError(
      "CASE_17: invalid permission code -> 400",
      () => saveOverrideAssignment("USER", noRoleWorkerId, [{ permissionCode: "NOT_A_REAL_PERMISSION", effect: "ALLOW" }], ownerAId),
      400,
    );
    const c17Detail = await getPrincipalDetail("USER", noRoleWorkerId);
    assertEqual("CASE_17: no partial apply, overrides unchanged", c17Detail.denyOverrides, ["TYPING_READ"]);

    // ── CASE_18: dealer fixture role 저장 후 DOCUMENT scope=OWN_DEALER 유지 ──
    await saveRoleAssignment("USER", dealerWorkerId, ["MIDDLE_MANAGER"]);
    const c18 = await resolveDataScope({ principalType: "USER", principalId: dealerWorkerId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("CASE_18: dealer + role assigned -> still OWN_DEALER (structural dealer identity wins)", c18, { mode: "RBAC", scopes: ["OWN_DEALER"] });

    // ── OWNER principalType 정책: USER principal에 OWNER role 배정 금지 ──
    await expectError(
      "EXTRA: OWNER role on USER principal -> 400 (ADMIN-only policy)",
      () => saveRoleAssignment("USER", noRoleWorkerId, ["OWNER"]),
      400,
    );

    // ── CASE_14: 마지막 OWNER 제거 -> 차단(409, LAST_OWNER_CANNOT_BE_REMOVED) ──
    // 먼저 ownerB를 제거해 ownerA만 남긴 뒤, ownerA 제거 시도.
    await saveRoleAssignment("ADMIN", ownerBId, []);
    await expectError(
      "CASE_14: removing last OWNER -> 409 LAST_OWNER_CANNOT_BE_REMOVED",
      () => saveRoleAssignment("ADMIN", ownerAId, []),
      409,
      "LAST_OWNER_CANNOT_BE_REMOVED",
    );

    // ── CASE_15: 다른 OWNER가 있을 때 한 OWNER 제거 -> 허용 ─────────────
    // plainAdmin에게 OWNER를 부여해 2명으로 만든 뒤, ownerA 제거.
    await saveRoleAssignment("ADMIN", plainAdminId, ["OWNER"]);
    const c15 = await saveRoleAssignment("ADMIN", ownerAId, []);
    assertEqual("CASE_15: removing OWNER when another OWNER exists -> allowed", c15.roleCodes, []);
    const c15Roles = await getPrincipalRoles("ADMIN", ownerAId);
    assertEqual("CASE_15: ownerA no longer has OWNER", c15Roles, []);

    console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);

    // ── cleanup ──────────────────────────────────────────────────────────
    async function removeOverridesFor(principalType: "ADMIN" | "USER", principalId: number) {
      await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.principalType, principalType), eq(userPermissionOverrides.principalId, principalId)));
    }
    await removeOverridesFor("USER", noRoleWorkerId);
    await db.delete(userRoles).where(and(eq(userRoles.principalType, "USER"), eq(userRoles.principalId, noRoleWorkerId)));
    await db.delete(userRoles).where(and(eq(userRoles.principalType, "USER"), eq(userRoles.principalId, dealerWorkerId)));
    await db.delete(userRoles).where(and(eq(userRoles.principalType, "ADMIN"), eq(userRoles.principalId, plainAdminId)));
    await db.delete(userRoles).where(and(eq(userRoles.principalType, "ADMIN"), eq(userRoles.principalId, ownerAId)));
    await db.delete(userRoles).where(and(eq(userRoles.principalType, "ADMIN"), eq(userRoles.principalId, ownerBId)));
    await db.delete(users).where(eq(users.id, noRoleWorkerId));
    await db.delete(users).where(eq(users.id, dealerWorkerId));
    await db.delete(admins).where(eq(admins.id, ownerAId));
    await db.delete(admins).where(eq(admins.id, ownerBId));
    await db.delete(admins).where(eq(admins.id, plainAdminId));
    console.log("[CLEANUP] test fixtures removed");
  } catch (e) {
    console.error("FATAL during test run:", e);
    failures++;
  }
}

main().then(() => process.exit(failures === 0 ? 0 : 1)).catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
