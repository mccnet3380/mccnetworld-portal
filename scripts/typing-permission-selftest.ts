// scripts/typing-permission-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2F_TYPING_TRAINING_LEGACY_REMOVAL_1
//
// server/routes/typing-versions.ts의 resolveTypingPermission()(legacy fallback 제거 후,
// 실제 requireTypingViewer/requireTypingAdmin/typing-static 미들웨어가 쓰는 바로 그
// 함수, export만 추가 — 중복 구현 없음)를 직접 호출해 새 우선순위(explicit DENY >
// effective RBAC ALLOW > DENY, legacy 분기 없음)를 self-test한다.
//
// DEV DB에만 접속하며 생성한 fixture는 끝에서 전부 정리한다. 실제 운영 worker/
// 박예진·이진주 등 실제 사용자 계정은 전혀 건드리지 않는다.
//
// CASE_1(unauth -> 401)은 세션 객체 자체가 없어 이 resolver-level 스크립트로는 표현할 수
// 없다 — 별도 HTTP QA로 검증한다(과거 typing/training enforcement 작업 때와 동일한 이유).
//
// 실행: npx tsx --env-file=.env scripts/typing-permission-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { initStorage } from "../server/storage";
import { admins, users, roles, userRoles, userPermissionOverrides, permissions } from "../shared/schema";
import { resolveTypingPermission } from "../server/routes/typing-versions";

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

  const adminWithRole = await db.insert(admins).values({
    username: "qa_typing_admin_withrole_temp",
    password: "not-a-real-hash",
    name: "QA TYPING ADMIN WITH-ROLE",
  }).returning({ id: admins.id });
  const adminWithRoleId = adminWithRole[0].id;

  const adminNoRole = await db.insert(admins).values({
    username: "qa_typing_admin_norole_temp",
    password: "not-a-real-hash",
    name: "QA TYPING ADMIN NO-ROLE",
  }).returning({ id: admins.id });
  const adminNoRoleId = adminNoRole[0].id;

  try {
    await assignRole("ADMIN", adminWithRoleId, "ADMIN");

    // ── CASE_1: internal USER, role 없음, override 없음 → TYPING_READ DENY ──
    // (legacy fallback 제거 이전에는 이 케이스가 ALLOW였다 — 이번 작업의 핵심 변경점)
    const noRoleSession = { userType: "user", userId: noRoleWorkerId };
    const c1 = await resolveTypingPermission(noRoleSession, "TYPING_READ");
    assertEqual("CASE_1: internal USER, role=0, override=0 -> TYPING_READ DENY (no legacy fallback)", c1, "DENY");

    // ── CASE_2: 위 USER + TYPING_READ direct ALLOW → ALLOW ──────────────────
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "ALLOW");
    const c2 = await resolveTypingPermission(noRoleSession, "TYPING_READ");
    assertEqual("CASE_2: internal USER + TYPING_READ direct ALLOW -> ALLOW", c2, "ALLOW");

    // ── CASE_3: 같은 override를 DENY로 교체 → DENY (explicit DENY 우선) ─────
    await db.delete(userPermissionOverrides).where(
      and(eq(userPermissionOverrides.principalType, "USER"), eq(userPermissionOverrides.principalId, noRoleWorkerId), eq(userPermissionOverrides.permissionId, permId("TYPING_READ"))),
    );
    await setOverride("USER", noRoleWorkerId, "TYPING_READ", "DENY");
    const c3 = await resolveTypingPermission(noRoleSession, "TYPING_READ");
    assertEqual("CASE_3: internal USER + TYPING_READ direct DENY -> DENY", c3, "DENY");

    // ── CASE_4: dealer USER, override 없음 → TYPING_READ DENY ───────────────
    const dealerSession = { userType: "user", userId: dealerWorkerId };
    const c4 = await resolveTypingPermission(dealerSession, "TYPING_READ");
    assertEqual("CASE_4: dealer USER, no override -> TYPING_READ DENY", c4, "DENY");

    // ── CASE_5: dealer USER + TYPING_READ direct ALLOW → ALLOW ──────────────
    await setOverride("USER", dealerWorkerId, "TYPING_READ", "ALLOW");
    const c5 = await resolveTypingPermission(dealerSession, "TYPING_READ");
    assertEqual("CASE_5: dealer USER + TYPING_READ direct ALLOW -> ALLOW", c5, "ALLOW");

    // ── CASE_6: ADMIN role(TYPING_MANAGE role permission) → ALLOW ───────────
    const adminWithRoleSession = { userType: "admin", userId: adminWithRoleId };
    const c6 = await resolveTypingPermission(adminWithRoleSession, "TYPING_MANAGE");
    assertEqual("CASE_6: admin with ADMIN role -> TYPING_MANAGE ALLOW (role-granted)", c6, "ALLOW");

    // ── CASE_7: ADMIN principal, role 없음, override 없음 → DENY ────────────
    // 가장 중요한 회귀 검증: 예전 legacy admin fallback("admin이면 무조건 허용")이
    // 완전히 사라졌는지 확인.
    const adminNoRoleSession = { userType: "admin", userId: adminNoRoleId };
    const c7 = await resolveTypingPermission(adminNoRoleSession, "TYPING_MANAGE");
    assertEqual("CASE_7: admin WITHOUT any role, no override -> TYPING_MANAGE DENY (legacy admin fallback removed)", c7, "DENY");

    // ── 추가: explicit DENY가 role ALLOW보다 우선하는지(기존 회귀, legacy와 무관) ──
    await setOverride("ADMIN", adminWithRoleId, "TYPING_MANAGE", "DENY");
    const extraDeny = await resolveTypingPermission(adminWithRoleSession, "TYPING_MANAGE");
    assertEqual("EXTRA: admin with ADMIN role + TYPING_MANAGE DENY override -> DENY (explicit DENY beats role)", extraDeny, "DENY");

    // ── 추가: RBAC lookup 자체 실패 → FAIL_CLOSED ───────────────────────────
    const malformedSession = { userType: "user", userId: "not-a-number" as any };
    const extraFailClosed = await resolveTypingPermission(malformedSession, "TYPING_READ");
    assertEqual("EXTRA: malformed principalId causes DB error -> FAIL_CLOSED (never silently deny-open or legacy-allow)", extraFailClosed, "FAIL_CLOSED");

    console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  } finally {
    // ── cleanup: 이번에 만든 fixture principal의 override만 정확히 삭제(블랭킷 삭제 금지,
    // 다른 principalId의 override를 건드리지 않는다) ────────────────────────
    await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.principalType, "USER"), eq(userPermissionOverrides.principalId, noRoleWorkerId))).catch(() => {});
    await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.principalType, "USER"), eq(userPermissionOverrides.principalId, dealerWorkerId))).catch(() => {});
    await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.principalType, "ADMIN"), eq(userPermissionOverrides.principalId, adminWithRoleId))).catch(() => {});

    await db.delete(userRoles).where(and(eq(userRoles.principalType, "ADMIN"), eq(userRoles.principalId, adminWithRoleId))).catch(() => {});

    await db.delete(users).where(eq(users.id, noRoleWorkerId));
    await db.delete(users).where(eq(users.id, dealerWorkerId));
    await db.delete(admins).where(eq(admins.id, adminWithRoleId));
    await db.delete(admins).where(eq(admins.id, adminNoRoleId));
    console.log("[CLEANUP] test fixtures removed");
  }
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
