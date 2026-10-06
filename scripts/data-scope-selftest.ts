// scripts/data-scope-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2D_DATA_SCOPE_FOUNDATION_AND_SAFE_ENFORCEMENT_1
//
// server/lib/data-scope.ts의 resolveDataScope()에 대한 standalone self-test.
// 이 프로젝트에는 아직 vitest/jest 등 테스트 러너가 없어 별도 프레임워크를 추가하지
// 않고, tsx로 바로 실행 가능한 독립 스크립트로 작성한다. DEV DB에만 접속하며
// 테스트용으로 생성한 계정은 끝에서 전부 정리한다.
//
// 실행: npx tsx --env-file=.env scripts/data-scope-selftest.ts

import { eq } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { admins, users, roles, userRoles } from "../shared/schema";
import { resolveDataScope } from "../server/lib/data-scope";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${label} — expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (!pass) failures++;
}

async function main() {
  const db = await getDatabase();

  // ── 테스트 픽스처 생성 (DEV 전용, 끝에서 삭제) ────────────────────────────
  const ownerAdmin = await db.insert(admins).values({
    username: "qa_selftest_owner_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST OWNER",
  }).returning({ id: admins.id });
  const ownerAdminId = ownerAdmin[0].id;

  const adminAdmin = await db.insert(admins).values({
    username: "qa_selftest_admin_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST ADMIN",
  }).returning({ id: admins.id });
  const adminAdminId = adminAdmin[0].id;

  const noRoleAdmin = await db.insert(admins).values({
    username: "qa_selftest_norole_admin_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST NO-ROLE ADMIN",
  }).returning({ id: admins.id });
  const noRoleAdminId = noRoleAdmin[0].id;

  const workerUser = await db.insert(users).values({
    username: "qa_selftest_worker_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const workerUserId = workerUser[0].id;

  const dealerUser = await db.insert(users).values({
    dealerId: 888888001,
    username: "qa_selftest_dealer_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST DEALER",
    userType: "user",
  }).returning({ id: users.id });
  const dealerUserId = dealerUser[0].id;

  // 가짜 role: 이 resource/permission에 대해 정책 테이블에 아무 항목도 없는 역할
  // (DENY 케이스 재현용). 기존 SETTLEMENT role을 재사용 — DOCUMENT_READ 정책이
  // 정의되어 있지 않다.
  const settlementRole = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, "SETTLEMENT")).limit(1);
  const noScopeAdmin = await db.insert(admins).values({
    username: "qa_selftest_noscope_2d_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST NO-SCOPE-POLICY",
  }).returning({ id: admins.id });
  const noScopeAdminId = noScopeAdmin[0].id;

  const ownerRoleRow = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, "OWNER")).limit(1);
  const adminRoleRow = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, "ADMIN")).limit(1);

  await db.insert(userRoles).values({ principalType: "ADMIN", principalId: ownerAdminId, roleId: ownerRoleRow[0].id });
  await db.insert(userRoles).values({ principalType: "ADMIN", principalId: adminAdminId, roleId: adminRoleRow[0].id });
  if (settlementRole[0]) {
    await db.insert(userRoles).values({ principalType: "ADMIN", principalId: noScopeAdminId, roleId: settlementRole[0].id });
  }

  try {
    // ── 1. OWNER → ALL ──────────────────────────────────────────────────
    const r1 = await resolveDataScope({ principalType: "ADMIN", principalId: ownerAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("OWNER -> ALL", r1, { mode: "RBAC", scopes: ["ALL"] });

    // ── 2. ADMIN → ALL ───────────────────────────────────────────────────
    const r2 = await resolveDataScope({ principalType: "ADMIN", principalId: adminAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("ADMIN -> ALL", r2, { mode: "RBAC", scopes: ["ALL"] });

    // ── 3. NO_ROLE admin principal (role 미배정) → LEGACY ────────────────
    const r3 = await resolveDataScope({ principalType: "ADMIN", principalId: noRoleAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("NO_ROLE admin -> LEGACY", r3, { mode: "LEGACY" });

    // ── 4. NO_ROLE worker (USER, dealerId 없음) → LEGACY ──────────────────
    const r4 = await resolveDataScope({ principalType: "USER", principalId: workerUserId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("NO_ROLE worker -> LEGACY", r4, { mode: "LEGACY" });

    // ── 5. DEALER (USER, dealerId 있음, RBAC role 없음) → OWN_DEALER ──────
    //     RBAC role 배정 여부와 무관하게 구조적으로 OWN_DEALER가 나와야 한다.
    const r5 = await resolveDataScope({ principalType: "USER", principalId: dealerUserId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("DEALER (no RBAC role) -> OWN_DEALER", r5, { mode: "RBAC", scopes: ["OWN_DEALER"] });

    // ── 6. RBAC role 배정되어 있으나 이 resource/permission에 scope 정책이
    //      없는 경우 → DENY (절대 ALL로 새지 않음) ─────────────────────────
    if (settlementRole[0]) {
      const r6 = await resolveDataScope({ principalType: "ADMIN", principalId: noScopeAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
      assertEqual("role with no scope policy -> DENY", r6, { mode: "DENY" });
    } else {
      console.log("[SKIP] SETTLEMENT role not found in DEV seed — DENY case not exercised");
    }

    // ── 7. 무관한 permission/resource로 scope가 새지 않는지 확인 ──────────
    //     (정의되지 않은 permissionCode는 ADMIN/OWNER여도 DENY여야 한다 —
    //      "넓은 역할 하나"가 전역으로 ALL을 주는 모델이 아님을 재확인)
    const r7 = await resolveDataScope({ principalType: "ADMIN", principalId: adminAdminId, permissionCode: "SOME_UNDEFINED_PERMISSION", resource: "DOCUMENT" });
    assertEqual("ADMIN + undefined permission -> DENY (no scope bleed)", r7, { mode: "DENY" });
  } finally {
    // ── 정리 ──────────────────────────────────────────────────────────────
    await db.delete(userRoles).where(eq(userRoles.principalId, ownerAdminId));
    await db.delete(userRoles).where(eq(userRoles.principalId, adminAdminId));
    await db.delete(userRoles).where(eq(userRoles.principalId, noScopeAdminId));
    await db.delete(admins).where(eq(admins.id, ownerAdminId));
    await db.delete(admins).where(eq(admins.id, adminAdminId));
    await db.delete(admins).where(eq(admins.id, noRoleAdminId));
    await db.delete(admins).where(eq(admins.id, noScopeAdminId));
    await db.delete(users).where(eq(users.id, workerUserId));
    await db.delete(users).where(eq(users.id, dealerUserId));
    console.log("[CLEANUP] test fixtures removed");
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SELFTEST_CRASHED", e);
  process.exit(1);
});
