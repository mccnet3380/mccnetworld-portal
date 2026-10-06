// scripts/user-permission-override-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2E_2_USER_PERMISSION_OVERRIDE_FOUNDATION_1
//
// server/lib/rbac.ts의 getPrincipalPermissions() override 합성 로직 +
// server/lib/data-scope.ts와의 경계(override가 role/scope 판정에 새지 않는지)에 대한
// standalone self-test. 이 프로젝트에는 아직 vitest/jest가 없어 tsx로 바로 실행 가능한
// 독립 스크립트로 작성한다. DEV DB에만 접속하며 생성한 fixture는 끝에서 전부 정리한다.
//
// 실행: npx tsx --env-file=.env scripts/user-permission-override-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { admins, users, roles, permissions, userRoles, userPermissionOverrides } from "../shared/schema";
import { getPrincipalPermissions, getPrincipalRoles } from "../server/lib/rbac";
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

function sortedSetEqual(label: string, actual: string[], expected: string[]) {
  assertEqual(label, [...actual].sort(), [...expected].sort());
}

async function main() {
  const db = await getDatabase();

  const roleRows = await db.select({ id: roles.id, code: roles.code }).from(roles);
  const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

  const permRows = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
  const permIdByCode = new Map(permRows.map((p) => [p.code, p.id]));

  function permId(code: string): number {
    const id = permIdByCode.get(code);
    if (!id) throw new Error(`permission ${code} not found in DEV seed`);
    return id;
  }

  // ── fixture principals (DEV 전용, 끝에서 삭제) ──────────────────────────
  const noRoleWorker = await db.insert(users).values({
    username: "qa_ovr_norole_worker_2e2_temp",
    password: "not-a-real-hash",
    name: "QA OVR NO-ROLE WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const noRoleWorkerId = noRoleWorker[0].id;

  const middleManagerWorker = await db.insert(users).values({
    username: "qa_ovr_mm_worker_2e2_temp",
    password: "not-a-real-hash",
    name: "QA OVR MIDDLE_MANAGER WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const middleManagerWorkerId = middleManagerWorker[0].id;

  const adminPrincipal = await db.insert(admins).values({
    username: "qa_ovr_admin_2e2_temp",
    password: "not-a-real-hash",
    name: "QA OVR ADMIN",
  }).returning({ id: admins.id });
  const adminPrincipalId = adminPrincipal[0].id;

  const ownerPrincipal = await db.insert(admins).values({
    username: "qa_ovr_owner_2e2_temp",
    password: "not-a-real-hash",
    name: "QA OVR OWNER",
  }).returning({ id: admins.id });
  const ownerPrincipalId = ownerPrincipal[0].id;

  const insertedUserRoles: { principalType: "ADMIN" | "USER"; principalId: number }[] = [];
  const insertedOverrides: { principalType: "ADMIN" | "USER"; principalId: number }[] = [];

  async function assignRole(principalType: "ADMIN" | "USER", principalId: number, roleCode: string) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) throw new Error(`role ${roleCode} not found in DEV seed`);
    await db.insert(userRoles).values({ principalType, principalId, roleId });
    insertedUserRoles.push({ principalType, principalId });
  }

  async function setOverride(
    principalType: "ADMIN" | "USER",
    principalId: number,
    permissionCode: string,
    effect: "ALLOW" | "DENY",
  ) {
    await db.insert(userPermissionOverrides).values({
      principalType,
      principalId,
      permissionId: permId(permissionCode),
      effect,
    });
    insertedOverrides.push({ principalType, principalId });
  }

  try {
    await assignRole("ADMIN", adminPrincipalId, "ADMIN");
    await assignRole("ADMIN", ownerPrincipalId, "OWNER");
    await assignRole("USER", middleManagerWorkerId, "MIDDLE_MANAGER");

    // 기준값: ADMIN role이 실제로 보유한 permission 전체(override 적용 전).
    const adminBasePermissions = await getPrincipalPermissions("ADMIN", adminPrincipalId);
    const ownerBasePermissions = await getPrincipalPermissions("ADMIN", ownerPrincipalId);

    // ── CASE 1: role 없음 + override 없음 → permissions=[] ────────────────
    const c1 = await getPrincipalPermissions("USER", noRoleWorkerId);
    sortedSetEqual("CASE_1: no role + no override -> []", c1, []);

    // ── CASE 2: role 없음 + TYPING_READ ALLOW → ['TYPING_READ'] ───────────
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "ALLOW");
    const c2 = await getPrincipalPermissions("USER", noRoleWorkerId);
    sortedSetEqual("CASE_2: no role + TYPING_READ ALLOW -> [TYPING_READ]", c2, ["TYPING_READ"]);

    // ── CASE 3: ALLOW를 DENY로 바꿔서(동일 permission) role 없음 + DENY만
    //      있을 때 결과가 비는지 확인 (별도 principal로 재현 — unique 제약상
    //      ALLOW와 DENY를 같은 행에 공존시킬 수 없으므로 CASE 2의 ALLOW를 지우고
    //      DENY로 교체) ──────────────────────────────────────────────────
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.principalType, "USER"),
        eq(userPermissionOverrides.principalId, noRoleWorkerId),
        eq(userPermissionOverrides.permissionId, permId("TYPING_READ")),
      ),
    );
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "DENY");
    const c3 = await getPrincipalPermissions("USER", noRoleWorkerId);
    sortedSetEqual("CASE_3: no role + TYPING_READ DENY -> []", c3, []);

    // ── CASE 4: role permission + ALLOW override(무관 permission) → union ─
    await setOverride("ADMIN", adminPrincipalId, "TYPING_READ", "ALLOW");
    const c4 = await getPrincipalPermissions("ADMIN", adminPrincipalId);
    sortedSetEqual("CASE_4: ADMIN role + TYPING_READ ALLOW -> union", c4, [...new Set([...adminBasePermissions, "TYPING_READ"])]);

    // ── CASE 5: role permission + DENY override(그 role이 가진 permission) →
    //      DENY wins (ADMIN은 CARRIER_MANAGE를 role로 보유) ────────────────
    assertTrue("CASE_5 precondition: ADMIN role includes CARRIER_MANAGE", adminBasePermissions.includes("CARRIER_MANAGE"));
    await setOverride("ADMIN", adminPrincipalId, "CARRIER_MANAGE", "DENY");
    const c5 = await getPrincipalPermissions("ADMIN", adminPrincipalId);
    assertTrue("CASE_5: DENY override removes role-granted CARRIER_MANAGE", !c5.includes("CARRIER_MANAGE"));
    assertTrue("CASE_5: other ADMIN role permissions untouched", c5.includes("USER_READ"));

    // ── CASE 6: 동일 principal+permission에 ALLOW와 DENY 동시 저장 금지
    //      (unique index 위반으로 DB가 막아야 함) ─────────────────────────
    let case6DbRejected = false;
    try {
      // CARRIER_MANAGE는 이미 DENY로 들어가 있음(CASE 5) — 같은 조합으로 ALLOW를
      // 또 넣으면 unique(principal_type, principal_id, permission_id) 위반이어야 한다.
      await db.insert(userPermissionOverrides).values({
        principalType: "ADMIN",
        principalId: adminPrincipalId,
        permissionId: permId("CARRIER_MANAGE"),
        effect: "ALLOW",
      });
    } catch (e: any) {
      // DB 서버 locale이 한국어라 에러 메시지 텍스트가 영어가 아닐 수 있다(실측: "중복된
      // 키 값이 ... 고유 제약 조건을 위반함") — 메시지 문자열 매칭 대신 locale과 무관한
      // PostgreSQL SQLSTATE 코드(23505 = unique_violation)로 판정한다.
      case6DbRejected = e?.code === "23505";
    }
    assertTrue("CASE_6: DB unique constraint rejects ALLOW+DENY same principal+permission", case6DbRejected);

    // ── CASE 7: non-owner(ADMIN) + ROLE_MANAGE ALLOW override → 차단 ──────
    await setOverride("ADMIN", adminPrincipalId, "ROLE_MANAGE", "ALLOW");
    const c7 = await getPrincipalPermissions("ADMIN", adminPrincipalId);
    assertTrue("CASE_7: non-owner ALLOW override cannot grant ROLE_MANAGE", !c7.includes("ROLE_MANAGE"));

    // ── CASE 8: non-owner(ADMIN) + MENU_PERMISSION_MANAGE ALLOW override → 차단 ─
    await setOverride("ADMIN", adminPrincipalId, "MENU_PERMISSION_MANAGE", "ALLOW");
    const c8 = await getPrincipalPermissions("ADMIN", adminPrincipalId);
    assertTrue("CASE_8: non-owner ALLOW override cannot grant MENU_PERMISSION_MANAGE", !c8.includes("MENU_PERMISSION_MANAGE"));

    // ── CASE 9: OWNER + ROLE_MANAGE DENY override(잘못 들어간 행 가정) →
    //      OWNER role permission 유지(lockout 방지) ──────────────────────
    assertTrue("CASE_9 precondition: OWNER role includes ROLE_MANAGE", ownerBasePermissions.includes("ROLE_MANAGE"));
    await setOverride("ADMIN", ownerPrincipalId, "ROLE_MANAGE", "DENY");
    const c9 = await getPrincipalPermissions("ADMIN", ownerPrincipalId);
    assertTrue("CASE_9: OWNER keeps ROLE_MANAGE despite DENY override (lockout protection)", c9.includes("ROLE_MANAGE"));

    // ── CASE 10: override만 있는 USER → getPrincipalRoles()=[] ────────────
    const c10 = await getPrincipalRoles("USER", noRoleWorkerId);
    sortedSetEqual("CASE_10: override-only USER -> getPrincipalRoles()=[]", c10, []);

    // ── CASE 11: override만 있는 USER → DOCUMENT_READ Data Scope LEGACY(NO_ROLE) ─
    const c11 = await resolveDataScope({ principalType: "USER", principalId: noRoleWorkerId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("CASE_11: override-only USER -> DOCUMENT_READ scope LEGACY(NO_ROLE)", c11, { mode: "LEGACY", reason: "NO_ROLE" });

    // ── CASE 12: MIDDLE_MANAGER role + 무관 override → DOCUMENT_READ는
    //      여전히 LEGACY_COMPAT(matchedRole=MIDDLE_MANAGER) ────────────────
    await setOverride("USER", middleManagerWorkerId, "TYPING_READ", "ALLOW");
    const c12permissions = await getPrincipalPermissions("USER", middleManagerWorkerId);
    sortedSetEqual(
      "CASE_12a: MIDDLE_MANAGER role + TYPING_READ ALLOW override -> union",
      c12permissions,
      ["AUDIT_READ", "AUDIT_PROCESS", "TYPING_READ"],
    );
    const c12scope = await resolveDataScope({ principalType: "USER", principalId: middleManagerWorkerId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual(
      "CASE_12b: MIDDLE_MANAGER role + override present -> DOCUMENT_READ still LEGACY_COMPAT",
      c12scope,
      { mode: "LEGACY", reason: "LEGACY_COMPAT", matchedRole: "MIDDLE_MANAGER" },
    );

    // ── CASE 13: 무관한 permission으로 scope가 새지 않는지 확인 ───────────
    //     (ADMIN이 TYPING_READ를 override로 가져도, 전혀 다른 permission에
    //      대해서는 여전히 role_permissions 범위를 벗어나지 않는다 — 이미
    //      CASE 4/5에서 ADMIN 본연의 permission들이 그대로인 것으로 검증됨.
    //      추가로: override가 전혀 없는 principal에 대해 기존 scope-bleed
    //      동작도 재확인)
    const c13 = await resolveDataScope({ principalType: "ADMIN", principalId: adminPrincipalId, permissionCode: "SOME_UNDEFINED_PERMISSION", resource: "DOCUMENT" });
    assertEqual("CASE_13: no scope bleed into undefined permission", c13, { mode: "DENY" });
  } finally {
    // ── 정리 ──────────────────────────────────────────────────────────────
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.principalId, noRoleWorkerId));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.principalId, adminPrincipalId));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.principalId, ownerPrincipalId));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.principalId, middleManagerWorkerId));
    for (const p of insertedUserRoles) {
      await db.delete(userRoles).where(eq(userRoles.principalId, p.principalId));
    }
    await db.delete(admins).where(eq(admins.id, adminPrincipalId));
    await db.delete(admins).where(eq(admins.id, ownerPrincipalId));
    await db.delete(users).where(eq(users.id, noRoleWorkerId));
    await db.delete(users).where(eq(users.id, middleManagerWorkerId));
    console.log("[CLEANUP] test fixtures removed");
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SELFTEST_CRASHED", e);
  process.exit(1);
});
