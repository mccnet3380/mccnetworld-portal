// scripts/data-scope-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2D_DATA_SCOPE_FOUNDATION_AND_SAFE_ENFORCEMENT_1
// (LEGACY_COMPAT 케이스 추가: MCC_RBAC_PHASE_2E_PRE_TRANSITION_SAFETY_AND_TYPING_PERMISSION_AUDIT_1)
//
// server/lib/data-scope.ts의 resolveDataScope()에 대한 standalone self-test.
// 이 프로젝트에는 아직 vitest/jest 등 테스트 러너가 없어 별도 프레임워크를 추가하지
// 않고, tsx로 바로 실행 가능한 독립 스크립트로 작성한다. DEV DB에만 접속하며
// 테스트용으로 생성한 계정/role 배정은 끝에서 전부 정리한다.
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

  // ── role id 조회 (읍기 전용) ─────────────────────────────────────────────
  const roleRows = await db.select({ id: roles.id, code: roles.code }).from(roles);
  const roleIdByCode = new Map(roleRows.map((r) => [r.code, r.id]));

  // ── 테스트 픽스처 생성 (DEV 전용, 끝에서 삭제) ────────────────────────────
  const ownerAdmin = await db.insert(admins).values({
    username: "qa_selftest_owner_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST OWNER",
  }).returning({ id: admins.id });
  const ownerAdminId = ownerAdmin[0].id;

  const adminAdmin = await db.insert(admins).values({
    username: "qa_selftest_admin_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST ADMIN",
  }).returning({ id: admins.id });
  const adminAdminId = adminAdmin[0].id;

  const noRoleAdmin = await db.insert(admins).values({
    username: "qa_selftest_norole_admin_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST NO-ROLE ADMIN",
  }).returning({ id: admins.id });
  const noRoleAdminId = noRoleAdmin[0].id;

  // 정말로 어디에도 scope 정책이 없는 role(SALES_MANAGER — LEGACY_COMPAT 화이트리스트
  // 에서도 의도적으로 제외됨)을 가진 principal: DENY 재현용.
  const unmappedRoleAdmin = await db.insert(admins).values({
    username: "qa_selftest_unmapped_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST UNMAPPED ROLE",
  }).returning({ id: admins.id });
  const unmappedRoleAdminId = unmappedRoleAdmin[0].id;

  const workerUser = await db.insert(users).values({
    username: "qa_selftest_worker_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const workerUserId = workerUser[0].id;

  const dealerUser = await db.insert(users).values({
    dealerId: 888888002,
    username: "qa_selftest_dealer_2e_temp",
    password: "not-a-real-hash",
    name: "QA SELFTEST DEALER",
    userType: "user",
  }).returning({ id: users.id });
  const dealerUserId = dealerUser[0].id;

  // LEGACY_COMPAT 화이트리스트에 등록된 5개 role(MIDDLE_MANAGER/ACTIVATION/AUDIT/
  // SETTLEMENT/SALES)을 각각 하나씩 배정받는 USER principal 5명.
  const compatRoleCodes = ["MIDDLE_MANAGER", "ACTIVATION", "AUDIT", "SETTLEMENT", "SALES"] as const;
  const compatWorkerIds: Record<string, number> = {};
  for (const code of compatRoleCodes) {
    const row = await db.insert(users).values({
      username: `qa_selftest_${code.toLowerCase()}_2e_temp`,
      password: "not-a-real-hash",
      name: `QA SELFTEST ${code}`,
      userType: "user",
    }).returning({ id: users.id });
    compatWorkerIds[code] = row[0].id;
  }

  const insertedUserRolePrincipals: { principalType: "ADMIN" | "USER"; principalId: number }[] = [];

  async function assignRole(principalType: "ADMIN" | "USER", principalId: number, roleCode: string) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) {
      console.log(`[SKIP] role ${roleCode} not found in DEV seed`);
      return false;
    }
    await db.insert(userRoles).values({ principalType, principalId, roleId });
    insertedUserRolePrincipals.push({ principalType, principalId });
    return true;
  }

  try {
    await assignRole("ADMIN", ownerAdminId, "OWNER");
    await assignRole("ADMIN", adminAdminId, "ADMIN");
    const hasUnmapped = await assignRole("ADMIN", unmappedRoleAdminId, "SALES_MANAGER");
    for (const code of compatRoleCodes) {
      await assignRole("USER", compatWorkerIds[code], code);
    }

    // ── 1. OWNER → ALL ──────────────────────────────────────────────────
    const r1 = await resolveDataScope({ principalType: "ADMIN", principalId: ownerAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("OWNER -> ALL", r1, { mode: "RBAC", scopes: ["ALL"] });

    // ── 2. ADMIN → ALL ───────────────────────────────────────────────────
    const r2 = await resolveDataScope({ principalType: "ADMIN", principalId: adminAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("ADMIN -> ALL", r2, { mode: "RBAC", scopes: ["ALL"] });

    // ── 3. NO_ROLE admin principal (role 미배정) → LEGACY(reason=NO_ROLE) ──
    const r3 = await resolveDataScope({ principalType: "ADMIN", principalId: noRoleAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("NO_ROLE admin -> LEGACY(NO_ROLE)", r3, { mode: "LEGACY", reason: "NO_ROLE" });

    // ── 4. NO_ROLE worker (USER, dealerId 없음) → LEGACY(reason=NO_ROLE) ───
    const r4 = await resolveDataScope({ principalType: "USER", principalId: workerUserId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("NO_ROLE worker -> LEGACY(NO_ROLE)", r4, { mode: "LEGACY", reason: "NO_ROLE" });

    // ── 5. DEALER (USER, dealerId 있음, RBAC role 없음) → OWN_DEALER ──────
    //     RBAC role 배정 여부와 무관하게 구조적으로 OWN_DEALER가 나와야 한다.
    const r5 = await resolveDataScope({ principalType: "USER", principalId: dealerUserId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
    assertEqual("DEALER (no RBAC role) -> OWN_DEALER", r5, { mode: "RBAC", scopes: ["OWN_DEALER"] });

    // ── 6. role이 있고 LEGACY_COMPAT에도 등록되지 않은 경우 → DENY
    //      (SALES_MANAGER — "UNKNOWN POLICY" 재현, 절대 ALL/LEGACY로 새지 않음) ──
    if (hasUnmapped) {
      const r6 = await resolveDataScope({ principalType: "ADMIN", principalId: unmappedRoleAdminId, permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
      assertEqual("role with no scope policy & no compat registration -> DENY", r6, { mode: "DENY" });
    }

    // ── 7. LEGACY_COMPAT 화이트리스트에 등록된 5개 role 각각 → LEGACY(reason=
    //      LEGACY_COMPAT, matchedRole=그 role) — role을 배정해도 기존 documents
    //      접근을 뺏지 않는다는 2E 전환 안전성의 핵심 검증 ───────────────────
    for (const code of compatRoleCodes) {
      const r = await resolveDataScope({ principalType: "USER", principalId: compatWorkerIds[code], permissionCode: "DOCUMENT_READ", resource: "DOCUMENT" });
      assertEqual(`${code} role assigned -> LEGACY(LEGACY_COMPAT, matchedRole=${code})`, r, { mode: "LEGACY", reason: "LEGACY_COMPAT", matchedRole: code });
    }

    // ── 8. 무관한 permission/resource로 scope가 새지 않는지 확인 ──────────
    //     (정의되지 않은 permissionCode는 ADMIN/OWNER여도 DENY여야 한다 —
    //      "넓은 역할 하나"가 전역으로 ALL을 주는 모델이 아님을 재확인. LEGACY_COMPAT
    //      화이트리스트도 이 permissionCode에는 등록이 없으므로 DENY가 맞다)
    const r8 = await resolveDataScope({ principalType: "ADMIN", principalId: adminAdminId, permissionCode: "SOME_UNDEFINED_PERMISSION", resource: "DOCUMENT" });
    assertEqual("ADMIN + undefined permission -> DENY (no scope bleed)", r8, { mode: "DENY" });

    // ── 9. LEGACY_COMPAT role이라도 등록되지 않은 permissionCode에는 compat이
    //      적용되지 않는지 확인 (화이트리스트는 resource+permission 단위로만 유효) ──
    const r9 = await resolveDataScope({ principalType: "USER", principalId: compatWorkerIds.SETTLEMENT, permissionCode: "SOME_UNDEFINED_PERMISSION", resource: "DOCUMENT" });
    assertEqual("SETTLEMENT role + undefined permission -> DENY (compat scoped to its own permission only)", r9, { mode: "DENY" });
  } finally {
    // ── 정리 ──────────────────────────────────────────────────────────────
    for (const p of insertedUserRolePrincipals) {
      await db.delete(userRoles).where(eq(userRoles.principalId, p.principalId));
    }
    await db.delete(admins).where(eq(admins.id, ownerAdminId));
    await db.delete(admins).where(eq(admins.id, adminAdminId));
    await db.delete(admins).where(eq(admins.id, noRoleAdminId));
    await db.delete(admins).where(eq(admins.id, unmappedRoleAdminId));
    await db.delete(users).where(eq(users.id, workerUserId));
    await db.delete(users).where(eq(users.id, dealerUserId));
    for (const code of compatRoleCodes) {
      await db.delete(users).where(eq(users.id, compatWorkerIds[code]));
    }
    console.log("[CLEANUP] test fixtures removed");
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SELFTEST_CRASHED", e);
  process.exit(1);
});
