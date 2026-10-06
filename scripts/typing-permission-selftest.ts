// scripts/typing-permission-selftest.ts
//
// 작업명: MCC_RBAC_TYPING_PERMISSION_ENFORCEMENT_TRANSITION_1
//
// server/routes/typing-versions.ts의 resolveTypingPermission()/legacyTypingViewerAllowed()/
// legacyTypingAdminAllowed()(실제 requireTypingViewer/requireTypingAdmin/typing-static
// 미들웨어가 쓰는 바로 그 함수들, export만 추가 — 중복 구현 없음)를 직접 호출해
// transition-safe enforcement의 우선순위(explicit DENY > effective ALLOW > legacy
// fallback > deny)를 self-test한다. DEV DB에만 접속하며 생성한 fixture는 끝에서
// 전부 정리한다. 실제 운영 worker/박예진(USER id=34) 계정은 전혀 건드리지 않는다.
//
// 실행: npx tsx --env-file=.env scripts/typing-permission-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { initStorage } from "../server/storage";
import { admins, users, roles, userRoles, userPermissionOverrides, permissions } from "../shared/schema";
import {
  resolveTypingPermission,
  legacyTypingViewerAllowed,
  legacyTypingAdminAllowed,
} from "../server/routes/typing-versions";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${label} — expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (!pass) failures++;
}

async function main() {
  await initStorage();
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

  async function assignRole(principalType: "ADMIN" | "USER", principalId: number, roleCode: string) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) throw new Error(`role ${roleCode} not found in DEV seed`);
    await db.insert(userRoles).values({ principalType, principalId, roleId });
  }

  async function removeUserRole(principalType: "ADMIN" | "USER", principalId: number, roleCode: string) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) return;
    await db.delete(userRoles).where(
      and(
        eq(userRoles.principalType, principalType),
        eq(userRoles.principalId, principalId),
        eq(userRoles.roleId, roleId),
      ),
    );
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
  }

  async function removeOverride(principalType: "ADMIN" | "USER", principalId: number, permissionCode: string) {
    await db.delete(userPermissionOverrides).where(
      and(
        eq(userPermissionOverrides.principalType, principalType),
        eq(userPermissionOverrides.principalId, principalId),
        eq(userPermissionOverrides.permissionId, permId(permissionCode)),
      ),
    );
  }

  // ── fixtures (DEV 전용, 끝에서 삭제) ──────────────────────────────────────
  const noRoleWorker = await db.insert(users).values({
    username: "qa_typing_norole_worker_temp",
    password: "not-a-real-hash",
    name: "QA TYPING NO-ROLE WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const noRoleWorkerId = noRoleWorker[0].id;

  const dealerWorker = await db.insert(users).values({
    username: "qa_typing_dealer_temp",
    password: "not-a-real-hash",
    name: "QA TYPING DEALER",
    userType: "user",
    dealerId: 999999, // dealerId는 DB에 FK가 없어 임의 값으로 dealer 상태만 시뮬레이션
  }).returning({ id: users.id });
  const dealerWorkerId = dealerWorker[0].id;

  const manageAllowWorker = await db.insert(users).values({
    username: "qa_typing_manage_allow_worker_temp",
    password: "not-a-real-hash",
    name: "QA TYPING MANAGE-ALLOW WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const manageAllowWorkerId = manageAllowWorker[0].id;

  const adminNoRole = await db.insert(admins).values({
    username: "qa_typing_admin_norole_temp",
    password: "not-a-real-hash",
    name: "QA TYPING ADMIN NO-ROLE",
  }).returning({ id: admins.id });
  const adminNoRoleId = adminNoRole[0].id;

  const adminWithRole = await db.insert(admins).values({
    username: "qa_typing_admin_withrole_temp",
    password: "not-a-real-hash",
    name: "QA TYPING ADMIN WITH-ROLE",
  }).returning({ id: admins.id });
  const adminWithRoleId = adminWithRole[0].id;

  const ownerFixture = await db.insert(admins).values({
    username: "qa_typing_owner_temp",
    password: "not-a-real-hash",
    name: "QA TYPING OWNER",
  }).returning({ id: admins.id });
  const ownerFixtureId = ownerFixture[0].id;

  // sales_manager principalId — principal_id에 DB FK가 없어(user_roles와 동일한 polymorphic
  // 구조) 실제 sales_managers row 없이도 안전하게 시뮬레이션 가능.
  const SALES_MANAGER_FIXTURE_ID = 999901;

  try {
    await assignRole("ADMIN", adminWithRoleId, "ADMIN");
    await assignRole("ADMIN", ownerFixtureId, "OWNER");

    // ── CASE_2: legacy internal USER, role=0, override=0 → READ ALLOW ──────
    const noRoleSession = { userType: "user", userId: noRoleWorkerId };
    const c2Legacy = await legacyTypingViewerAllowed(noRoleSession);
    assertEqual("CASE_2 precondition: non-dealer internal worker legacy viewer allowed", c2Legacy, true);
    const c2 = await resolveTypingPermission(noRoleSession, "TYPING_READ", c2Legacy);
    assertEqual("CASE_2: no-role internal worker -> READ ALLOW (legacy fallback)", c2, "ALLOW");

    // ── CASE_3: 위 worker + TYPING_READ DENY override → READ DENY ──────────
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "DENY");
    const c3 = await resolveTypingPermission(noRoleSession, "TYPING_READ", c2Legacy);
    assertEqual("CASE_3: no-role worker + TYPING_READ DENY override -> DENY (explicit DENY beats legacy)", c3, "DENY");

    // ── CASE_4: DENY를 ALLOW로 교체 → READ ALLOW ────────────────────────────
    await removeOverride("USER", noRoleWorkerId, "TYPING_READ");
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "ALLOW");
    const c4 = await resolveTypingPermission(noRoleSession, "TYPING_READ", c2Legacy);
    assertEqual("CASE_4: no-role worker + TYPING_READ ALLOW override -> ALLOW", c4, "ALLOW");

    // ── CASE_5: dealer, override 없음 → READ DENY ───────────────────────────
    const dealerSession = { userType: "user", userId: dealerWorkerId };
    const c5Legacy = await legacyTypingViewerAllowed(dealerSession);
    assertEqual("CASE_5 precondition: dealer legacy viewer blocked", c5Legacy, false);
    const c5 = await resolveTypingPermission(dealerSession, "TYPING_READ", c5Legacy);
    assertEqual("CASE_5: dealer, no override -> READ DENY", c5, "DENY");

    // ── CASE_6: dealer + TYPING_READ ALLOW override → READ ALLOW ───────────
    await setOverride("USER", dealerWorkerId, "TYPING_READ", "ALLOW");
    const c6 = await resolveTypingPermission(dealerSession, "TYPING_READ", c5Legacy);
    assertEqual("CASE_6: dealer + TYPING_READ ALLOW override -> READ ALLOW", c6, "ALLOW");

    // ── CASE_7: sales_manager, override 없음 → READ ALLOW(legacy 유지) ──────
    const salesManagerSession = { userType: "sales_manager", userId: SALES_MANAGER_FIXTURE_ID };
    const c7Legacy = await legacyTypingViewerAllowed(salesManagerSession);
    assertEqual("CASE_7 precondition: sales_manager legacy viewer allowed", c7Legacy, true);
    const c7 = await resolveTypingPermission(salesManagerSession, "TYPING_READ", c7Legacy);
    assertEqual("CASE_7: sales_manager, no override -> READ ALLOW (legacy fallback)", c7, "ALLOW");

    // ── CASE_8a: admin(역할 있음), override 없음 → MANAGE ALLOW(role로 이미 허용) ─
    const adminWithRoleSession = { userType: "admin", userId: adminWithRoleId };
    const c8aLegacy = legacyTypingAdminAllowed(adminWithRoleSession);
    assertEqual("CASE_8a precondition: admin legacy admin allowed", c8aLegacy, true);
    const c8a = await resolveTypingPermission(adminWithRoleSession, "TYPING_MANAGE", c8aLegacy);
    assertEqual("CASE_8a: admin with ADMIN role -> MANAGE ALLOW (role-granted, legacy also true)", c8a, "ALLOW");

    // CASE_8b: 역할이 전혀 없는 admin(가정 상황)도 legacy fallback만으로 MANAGE ALLOW —
    // "기존 admin 관리 기능을 끊지 않는다"는 섹션7 요구의 직접 증거.
    const adminNoRoleSession = { userType: "admin", userId: adminNoRoleId };
    const c8bLegacy = legacyTypingAdminAllowed(adminNoRoleSession);
    const c8b = await resolveTypingPermission(adminNoRoleSession, "TYPING_MANAGE", c8bLegacy);
    assertEqual("CASE_8b: admin WITHOUT any role -> MANAGE ALLOW (pure legacy fallback)", c8b, "ALLOW");

    // ── CASE_9: admin(역할 있음) + TYPING_MANAGE DENY override → MANAGE DENY ─
    await setOverride("ADMIN", adminWithRoleId, "TYPING_MANAGE", "DENY");
    const c9 = await resolveTypingPermission(adminWithRoleSession, "TYPING_MANAGE", c8aLegacy);
    assertEqual("CASE_9: admin with ADMIN role + TYPING_MANAGE DENY override -> MANAGE DENY (explicit DENY beats role AND legacy)", c9, "DENY");

    // ── CASE_10: 일반 USER + TYPING_MANAGE ALLOW override → MANAGE ALLOW ───
    const manageAllowSession = { userType: "user", userId: manageAllowWorkerId };
    const c10Legacy = legacyTypingAdminAllowed(manageAllowSession);
    assertEqual("CASE_10 precondition: plain user legacy admin blocked", c10Legacy, false);
    await setOverride("USER", manageAllowWorkerId, "TYPING_MANAGE", "ALLOW");
    const c10 = await resolveTypingPermission(manageAllowSession, "TYPING_MANAGE", c10Legacy);
    assertEqual("CASE_10: plain USER + TYPING_MANAGE ALLOW override -> MANAGE ALLOW", c10, "ALLOW");

    // ── CASE_11: 일반 USER, override 없음 → MANAGE DENY ─────────────────────
    const c11Legacy = legacyTypingAdminAllowed(noRoleSession);
    const c11 = await resolveTypingPermission(noRoleSession, "TYPING_MANAGE", c11Legacy);
    assertEqual("CASE_11: plain USER, no override -> MANAGE DENY", c11, "DENY");

    // ── CASE_12: RBAC lookup 자체 실패 → FAIL_CLOSED (가드에서 503로 이어짐) ─
    const malformedSession = { userType: "user", userId: "not-a-number" as any };
    const c12 = await resolveTypingPermission(malformedSession, "TYPING_READ", true);
    assertEqual("CASE_12: malformed principalId causes DB error -> FAIL_CLOSED (never silently legacy-allow)", c12, "FAIL_CLOSED");

    // ── 추가 케이스: OWNER + TYPING_MANAGE DENY override → OWNER도 MANAGE 상실
    // (TYPING_MANAGE는 OWNER_ONLY 4종에 포함되지 않으므로 lockout 보호 대상이 아님 —
    // 섹션12에서 명시적으로 요구한 정책, 실제 override=0이라 운영 영향 없음을 확인만 한다)
    const ownerSession = { userType: "admin", userId: ownerFixtureId };
    const ownerLegacy = legacyTypingAdminAllowed(ownerSession); // OWNER의 userType도 "admin"이므로 true
    await setOverride("ADMIN", ownerFixtureId, "TYPING_MANAGE", "DENY");
    const ownerDenied = await resolveTypingPermission(ownerSession, "TYPING_MANAGE", ownerLegacy);
    assertEqual(
      "EXTRA: OWNER + TYPING_MANAGE DENY override -> DENY (TYPING_MANAGE is not OWNER_ONLY, no lockout protection)",
      ownerDenied,
      "DENY",
    );

    console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  } finally {
    // ── cleanup: fixture 전부 삭제, DEV 기준선 복원 ──────────────────────────
    await removeOverride("USER", noRoleWorkerId, "TYPING_READ").catch(() => {});
    await removeOverride("USER", dealerWorkerId, "TYPING_READ").catch(() => {});
    await removeOverride("USER", manageAllowWorkerId, "TYPING_MANAGE").catch(() => {});
    await removeOverride("ADMIN", adminWithRoleId, "TYPING_MANAGE").catch(() => {});
    await removeOverride("ADMIN", ownerFixtureId, "TYPING_MANAGE").catch(() => {});

    await removeUserRole("ADMIN", adminWithRoleId, "ADMIN").catch(() => {});
    await removeUserRole("ADMIN", ownerFixtureId, "OWNER").catch(() => {});

    await db.delete(users).where(eq(users.id, noRoleWorkerId));
    await db.delete(users).where(eq(users.id, dealerWorkerId));
    await db.delete(users).where(eq(users.id, manageAllowWorkerId));
    await db.delete(admins).where(eq(admins.id, adminNoRoleId));
    await db.delete(admins).where(eq(admins.id, adminWithRoleId));
    await db.delete(admins).where(eq(admins.id, ownerFixtureId));
    console.log("[CLEANUP] test fixtures removed");
  }
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
