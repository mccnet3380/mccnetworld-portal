// scripts/training-permission-selftest.ts
//
// 작업명: MCC_RBAC_PHASE_2F_TYPING_TRAINING_LEGACY_REMOVAL_1
//
// server/routes/training.ts의 resolveTrainingPermission()(legacy fallback 제거 후,
// 실제 requireTrainingViewer/requireTrainingAdmin이 쓰는 바로 그 함수, export만 추가 —
// 중복 구현 없음)를 직접 호출해 새 우선순위(explicit DENY > effective RBAC ALLOW >
// DENY, legacy 분기 없음)를 self-test한다. scripts/typing-permission-selftest.ts와
// 완전히 동일한 구조를 그대로 재사용했다.
//
// DEV DB에만 접속하며 생성한 fixture는 끝에서 전부 정리한다. 실제 운영 worker/
// 박예진·이진주 등 실제 사용자 계정, training_articles의 기존 행은 전혀 건드리지 않는다.
//
// 실행: npx tsx --env-file=.env scripts/training-permission-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { initStorage } from "../server/storage";
import { admins, users, roles, userRoles, userPermissionOverrides, permissions, trainingArticles } from "../shared/schema";
import { resolveTrainingPermission } from "../server/routes/training";
import { resolveTypingPermission } from "../server/routes/typing-versions";
import { TRAINING_CATEGORIES } from "../shared/training-markdown";

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

  // ── CASE 16(동치) baseline: training_articles 행 수(이 스크립트는 article을 전혀
  // 쓰지 않으므로 끝까지 변하지 않아야 한다) ─────────────────────────────────
  const articleCountBefore = (await db.select({ id: trainingArticles.id }).from(trainingArticles)).length;

  // ── fixtures (DEV 전용, 끝에서 삭제) ──────────────────────────────────────
  const noRoleWorker = await db.insert(users).values({
    username: "qa_training_norole_worker_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING NO-ROLE WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const noRoleWorkerId = noRoleWorker[0].id;

  const dealerWorker = await db.insert(users).values({
    username: "qa_training_dealer_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING DEALER",
    userType: "user",
    dealerId: 999998, // dealerId는 DB에 FK가 없어 임의 값으로 dealer 상태만 시뮬레이션
  }).returning({ id: users.id });
  const dealerWorkerId = dealerWorker[0].id;

  const adminWithRole = await db.insert(admins).values({
    username: "qa_training_admin_withrole_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING ADMIN WITH-ROLE",
  }).returning({ id: admins.id });
  const adminWithRoleId = adminWithRole[0].id;

  const adminNoRole = await db.insert(admins).values({
    username: "qa_training_admin_norole_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING ADMIN NO-ROLE",
  }).returning({ id: admins.id });
  const adminNoRoleId = adminNoRole[0].id;

  try {
    await assignRole("ADMIN", adminWithRoleId, "ADMIN");

    // ── CASE_8: internal USER, role 없음, override 없음 → TRAINING_READ DENY ──
    // (legacy fallback 제거 이전에는 이 케이스가 ALLOW였다 — 이번 작업의 핵심 변경점)
    const noRoleSession = { userType: "user", userId: noRoleWorkerId };
    const c8 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ");
    assertEqual("CASE_8: internal USER, role=0, override=0 -> TRAINING_READ DENY (no legacy fallback)", c8, "DENY");

    // ── CASE_9: 위 USER + TRAINING_READ direct ALLOW → ALLOW ────────────────
    await setOverride("USER", noRoleWorkerId, "TRAINING_READ", "ALLOW");
    const c9 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ");
    assertEqual("CASE_9: internal USER + TRAINING_READ direct ALLOW -> ALLOW", c9, "ALLOW");

    // ── CASE_10: 같은 override를 DENY로 교체 → DENY (explicit DENY 우선) ────
    await db.delete(userPermissionOverrides).where(
      and(eq(userPermissionOverrides.principalType, "USER"), eq(userPermissionOverrides.principalId, noRoleWorkerId), eq(userPermissionOverrides.permissionId, permId("TRAINING_READ"))),
    );
    await setOverride("USER", noRoleWorkerId, "TRAINING_READ", "DENY");
    const c10 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ");
    assertEqual("CASE_10: internal USER + TRAINING_READ direct DENY -> DENY", c10, "DENY");

    // ── CASE_11: dealer + TRAINING_READ direct ALLOW → ALLOW ────────────────
    const dealerSession = { userType: "user", userId: dealerWorkerId };
    const c11Deny = await resolveTrainingPermission(dealerSession, "TRAINING_READ");
    assertEqual("CASE_11 precondition: dealer USER, no override -> TRAINING_READ DENY", c11Deny, "DENY");
    await setOverride("USER", dealerWorkerId, "TRAINING_READ", "ALLOW");
    const c11 = await resolveTrainingPermission(dealerSession, "TRAINING_READ");
    assertEqual("CASE_11: dealer USER + TRAINING_READ direct ALLOW -> ALLOW", c11, "ALLOW");

    // ── CASE_12: ADMIN role(TRAINING_MANAGE role permission) → ALLOW ────────
    const adminWithRoleSession = { userType: "admin", userId: adminWithRoleId };
    const c12 = await resolveTrainingPermission(adminWithRoleSession, "TRAINING_MANAGE");
    assertEqual("CASE_12: admin with ADMIN role -> TRAINING_MANAGE ALLOW (role-granted)", c12, "ALLOW");

    // ── CASE_13: ADMIN principal, role 없음 → TRAINING_MANAGE DENY ──────────
    // 가장 중요한 회귀 검증: 예전 legacy admin fallback("admin이면 무조건 허용")이
    // 완전히 사라졌는지 확인.
    const adminNoRoleSession = { userType: "admin", userId: adminNoRoleId };
    const c13 = await resolveTrainingPermission(adminNoRoleSession, "TRAINING_MANAGE");
    assertEqual("CASE_13: admin WITHOUT any role, no override -> TRAINING_MANAGE DENY (legacy admin fallback removed)", c13, "DENY");

    // ── 추가: explicit DENY가 role ALLOW보다 우선하는지(기존 회귀, legacy와 무관) ──
    await setOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE", "DENY");
    const extraDeny = await resolveTrainingPermission(adminWithRoleSession, "TRAINING_MANAGE");
    assertEqual("EXTRA: admin with ADMIN role + TRAINING_MANAGE DENY override -> DENY (explicit DENY beats role)", extraDeny, "DENY");

    // ── 추가: RBAC lookup 자체 실패 → FAIL_CLOSED ───────────────────────────
    const malformedSession = { userType: "user", userId: "not-a-number" as any };
    const extraFailClosed = await resolveTrainingPermission(malformedSession, "TRAINING_READ");
    assertEqual("EXTRA: malformed principalId causes DB error -> FAIL_CLOSED (never silently deny-open or legacy-allow)", extraFailClosed, "FAIL_CLOSED");

    // ── 유선 교육(WIRED) 카테고리 회귀 — permission resolver는 카테고리와 무관 ──
    assertEqual("EXTRA: WIRED category still exists (bdaa989 regression)", TRAINING_CATEGORIES.includes("WIRED" as any), true);

    // ── TYPING_READ 회귀 없음 — training.ts 변경이 typing-versions.ts의 새 동작에
    // 영향을 주지 않는지 같은 fixture로 재확인(둘 다 legacy 제거됨, 같은 모양 기대) ──
    const typingNoRole = await resolveTypingPermission(noRoleSession, "TYPING_READ");
    assertEqual("EXTRA: TYPING_READ unaffected by this file's changes -> no-role internal worker still DENY (legacy removed there too)", typingNoRole, "DENY");

    // ── training_articles 행 수 불변(이 스크립트는 article을 전혀 건드리지 않음) ──
    const articleCountAfter = (await db.select({ id: trainingArticles.id }).from(trainingArticles)).length;
    assertEqual("EXTRA: training_articles row count unchanged (no real data touched)", articleCountAfter, articleCountBefore);

    console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  } finally {
    // ── cleanup: 이번에 만든 fixture principal의 override만 정확히 삭제(블랭킷 삭제 금지) ──
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
