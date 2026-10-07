// scripts/training-permission-selftest.ts
//
// 작업명: MCC_TRAINING_PERMISSION_ENFORCEMENT_1
//
// server/routes/training.ts의 resolveTrainingPermission()/legacyTrainingViewerAllowed()/
// legacyTrainingAdminAllowed()(실제 requireTrainingViewer/requireTrainingAdmin이 쓰는 바로
// 그 함수들, export만 추가 — 중복 구현 없음)를 직접 호출해 transition-safe enforcement의
// 우선순위(explicit DENY > effective ALLOW > legacy fallback > deny)를 self-test한다.
// scripts/typing-permission-selftest.ts와 완전히 동일한 구조/정책을 그대로 재사용했다.
//
// DEV DB에만 접속하며 생성한 fixture는 끝에서 전부 정리한다. 실제 운영 worker/
// 박예진 등 실제 사용자 계정, training_articles의 기존 행은 전혀 건드리지 않는다.
//
// CASE_1(unauth -> 401)은 세션 객체 자체가 없어 이 resolver-level 스크립트로는 표현할 수
// 없다(typing-permission-selftest.ts의 CASE_1/2와 동일한 이유로 express 라우팅이 필요) —
// 별도 HTTP QA(섹션24)로 검증한다.
//
// 실행: npx tsx --env-file=.env scripts/training-permission-selftest.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { initStorage } from "../server/storage";
import { admins, users, roles, userRoles, userPermissionOverrides, permissions, trainingArticles } from "../shared/schema";
import {
  resolveTrainingPermission,
  legacyTrainingViewerAllowed,
  legacyTrainingAdminAllowed,
} from "../server/routes/training";
import {
  resolveTypingPermission,
  legacyTypingViewerAllowed,
} from "../server/routes/typing-versions";
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

  // ── CASE_16 baseline: training_articles 행 수(이 스크립트는 article을 전혀
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

  const manageAllowWorker = await db.insert(users).values({
    username: "qa_training_manage_allow_worker_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING MANAGE-ALLOW WORKER",
    userType: "user",
  }).returning({ id: users.id });
  const manageAllowWorkerId = manageAllowWorker[0].id;

  const adminNoRole = await db.insert(admins).values({
    username: "qa_training_admin_norole_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING ADMIN NO-ROLE",
  }).returning({ id: admins.id });
  const adminNoRoleId = adminNoRole[0].id;

  const adminWithRole = await db.insert(admins).values({
    username: "qa_training_admin_withrole_temp",
    password: "not-a-real-hash",
    name: "QA TRAINING ADMIN WITH-ROLE",
  }).returning({ id: admins.id });
  const adminWithRoleId = adminWithRole[0].id;

  try {
    await assignRole("ADMIN", adminWithRoleId, "ADMIN");

    // ── CASE_2: legacy internal USER, role=0, override=0 → READ ALLOW ──────
    const noRoleSession = { userType: "user", userId: noRoleWorkerId };
    const c2Legacy = await legacyTrainingViewerAllowed(noRoleSession);
    assertEqual("CASE_2 precondition: non-dealer internal worker legacy viewer allowed", c2Legacy, true);
    const c2 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ", c2Legacy);
    assertEqual("CASE_2: no-role internal worker -> READ ALLOW (legacy fallback, = HTTP 200)", c2, "ALLOW");

    // ── CASE_3: 위 worker + TRAINING_READ DENY override → READ DENY(=403) ──
    await setOverride("USER", noRoleWorkerId, "TRAINING_READ", "DENY");
    const c3 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ", c2Legacy);
    assertEqual("CASE_3: legacy worker + TRAINING_READ DENY override -> DENY (explicit DENY beats legacy, = HTTP 403)", c3, "DENY");

    // ── CASE_13/14 same-session immediate effect (READ) ─────────────────────
    // DENY 저장 직후 재조회(위 c3)가 이미 "즉시 반영"의 증거다 — 재로그인/세션 재발급 없이
    // 같은 session 객체로 다시 resolve만 호출했을 뿐이다(resolver가 매번 fresh DB lookup).
    assertEqual("CASE_14: same session, READ DENY override saved -> next lookup immediately DENY (no re-login)", c3, "DENY");
    await removeOverride("USER", noRoleWorkerId, "TRAINING_READ");
    await setOverride("USER", noRoleWorkerId, "TRAINING_READ", "ALLOW");
    const c13 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ", c2Legacy);
    assertEqual("CASE_13: same session, READ ALLOW override saved -> next lookup immediately ALLOW (no re-login)", c13, "ALLOW");
    await removeOverride("USER", noRoleWorkerId, "TRAINING_READ");

    // ── CASE_4: non-legacy principal(dealer) + TRAINING_READ ALLOW override → READ ALLOW ──
    const dealerSession = { userType: "user", userId: dealerWorkerId };
    const c5Legacy = await legacyTrainingViewerAllowed(dealerSession);
    assertEqual("CASE_5 precondition: dealer legacy viewer blocked", c5Legacy, false);
    // ── CASE_5: dealer, override 없음 → READ DENY(기존 legacy 정책 그대로) ───
    const c5 = await resolveTrainingPermission(dealerSession, "TRAINING_READ", c5Legacy);
    assertEqual("CASE_5: dealer default (no override) -> READ DENY (existing legacy policy preserved)", c5, "DENY");

    await setOverride("USER", dealerWorkerId, "TRAINING_READ", "ALLOW");
    const c4 = await resolveTrainingPermission(dealerSession, "TRAINING_READ", c5Legacy);
    assertEqual("CASE_4: non-legacy principal + TRAINING_READ ALLOW override -> READ ALLOW", c4, "ALLOW");
    // ── CASE_6: dealer + TRAINING_READ ALLOW override → READ ALLOW (typing과 동일 원칙) ──
    assertEqual("CASE_6: dealer + TRAINING_READ ALLOW override -> READ ALLOW (same principle as TYPING_READ)", c4, "ALLOW");
    await removeOverride("USER", dealerWorkerId, "TRAINING_READ");

    // ── CASE_7: legacy admin(역할 없음), override 없음 → MANAGE ALLOW(순수 legacy) ──
    const adminNoRoleSession = { userType: "admin", userId: adminNoRoleId };
    const c7Legacy = legacyTrainingAdminAllowed(adminNoRoleSession);
    assertEqual("CASE_7 precondition: admin legacy admin allowed", c7Legacy, true);
    const c7 = await resolveTrainingPermission(adminNoRoleSession, "TRAINING_MANAGE", c7Legacy);
    assertEqual("CASE_7: legacy admin, no override -> MANAGE ALLOW (pure legacy fallback, = mutation allowed)", c7, "ALLOW");

    // ── CASE_8: legacy admin + TRAINING_MANAGE DENY override → MANAGE DENY(=403, legacy여도) ──
    const adminWithRoleSession = { userType: "admin", userId: adminWithRoleId };
    const c8aLegacy = legacyTrainingAdminAllowed(adminWithRoleSession);
    const c8a = await resolveTrainingPermission(adminWithRoleSession, "TRAINING_MANAGE", c8aLegacy);
    assertEqual("CASE_8 precondition: admin with ADMIN role -> MANAGE ALLOW (role-granted)", c8a, "ALLOW");
    await setOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE", "DENY");
    const c8 = await resolveTrainingPermission(adminWithRoleSession, "TRAINING_MANAGE", c8aLegacy);
    assertEqual("CASE_8: legacy admin + TRAINING_MANAGE DENY override -> MANAGE DENY (explicit DENY beats role AND legacy)", c8, "DENY");

    // ── CASE_15 same-session immediate effect (MANAGE) ───────────────────────
    assertEqual("CASE_15a: same session, MANAGE DENY override saved -> next lookup immediately DENY", c8, "DENY");
    await removeOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE");
    await setOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE", "ALLOW");
    const c15 = await resolveTrainingPermission(adminWithRoleSession, "TRAINING_MANAGE", c8aLegacy);
    assertEqual("CASE_15b: same session, MANAGE ALLOW override saved -> next lookup immediately ALLOW", c15, "ALLOW");
    await removeOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE");

    // ── CASE_9: non-legacy principal(일반 USER) + TRAINING_MANAGE ALLOW → MANAGE ALLOW ──
    const manageAllowSession = { userType: "user", userId: manageAllowWorkerId };
    const c9Legacy = legacyTrainingAdminAllowed(manageAllowSession);
    assertEqual("CASE_9 precondition: plain user legacy admin blocked", c9Legacy, false);
    await setOverride("USER", manageAllowWorkerId, "TRAINING_MANAGE", "ALLOW");
    const c9 = await resolveTrainingPermission(manageAllowSession, "TRAINING_MANAGE", c9Legacy);
    assertEqual("CASE_9: non-legacy principal + TRAINING_MANAGE ALLOW override -> MANAGE ALLOW", c9, "ALLOW");

    // ── CASE_10: TRAINING_READ ALLOW만 있고 MANAGE 없음 → read 200 / mutation 403 ──
    // dealer 재사용(legacy 양쪽 모두 차단된 principal이라 "ALLOW가 준 permission만" 효과를
    // 가장 깨끗하게 보여준다). READ만 ALLOW로 다시 세팅.
    await setOverride("USER", dealerWorkerId, "TRAINING_READ", "ALLOW");
    const c10Read = await resolveTrainingPermission(dealerSession, "TRAINING_READ", c5Legacy);
    const c10Manage = await resolveTrainingPermission(dealerSession, "TRAINING_MANAGE", legacyTrainingAdminAllowed(dealerSession));
    assertEqual("CASE_10a: TRAINING_READ ALLOW only -> READ ALLOW", c10Read, "ALLOW");
    assertEqual("CASE_10b: TRAINING_READ ALLOW only, no MANAGE grant -> MANAGE DENY (READ does not imply MANAGE)", c10Manage, "DENY");
    await removeOverride("USER", dealerWorkerId, "TRAINING_READ");

    // ── CASE_11: TRAINING_MANAGE ALLOW만 있고 READ 없음 → MANAGE는 허용, READ는 별도 정책 결과 ──
    await setOverride("USER", dealerWorkerId, "TRAINING_MANAGE", "ALLOW");
    const c11Manage = await resolveTrainingPermission(dealerSession, "TRAINING_MANAGE", legacyTrainingAdminAllowed(dealerSession));
    const c11Read = await resolveTrainingPermission(dealerSession, "TRAINING_READ", c5Legacy);
    assertEqual("CASE_11a: TRAINING_MANAGE ALLOW only -> MANAGE ALLOW", c11Manage, "ALLOW");
    assertEqual("CASE_11b: TRAINING_MANAGE ALLOW only, no READ grant, dealer(legacy READ blocked) -> READ DENY (MANAGE does not imply READ)", c11Read, "DENY");
    await removeOverride("USER", dealerWorkerId, "TRAINING_MANAGE");

    // ── CASE_12: RBAC lookup 자체 실패 → FAIL_CLOSED (가드에서 503으로 이어짐) ──
    const malformedSession = { userType: "user", userId: "not-a-number" as any };
    const c12 = await resolveTrainingPermission(malformedSession, "TRAINING_READ", true);
    assertEqual("CASE_12: malformed principalId causes DB error -> FAIL_CLOSED (never silently legacy-allow)", c12, "FAIL_CLOSED");

    // ── CASE_17: 유선 교육(WIRED) 카테고리 — permission resolver는 카테고리와 완전히
    // 무관하게 동작한다(enforcement는 requireTrainingViewer 단계, 카테고리 필터는 그
    // 다음 route 핸들러 단계라 서로 분리) — WIRED 카테고리가 여전히 존재하는지와 함께
    // 정상 ALLOW 경로(legacy internal worker)로 재확인한다.
    assertEqual("CASE_17 precondition: WIRED category still exists (bdaa989 regression)", TRAINING_CATEGORIES.includes("WIRED" as any), true);
    const c17 = await resolveTrainingPermission(noRoleSession, "TRAINING_READ", c2Legacy);
    assertEqual("CASE_17: legacy internal worker READ ALLOW is category-agnostic (WIRED included)", c17, "ALLOW");

    // ── CASE_18: TYPING_READ 회귀 없음 — training.ts 변경이 typing-versions.ts의
    // 기존 동작에 전혀 영향을 주지 않았는지 같은 fixture로 재확인 ─────────────────
    const typingLegacy = await legacyTypingViewerAllowed(noRoleSession);
    const c18 = await resolveTypingPermission(noRoleSession, "TYPING_READ", typingLegacy);
    assertEqual("CASE_18: TYPING_READ unaffected by this task -> legacy internal worker still ALLOW", c18, "ALLOW");

    // ── CASE_16: training_articles 행 수 불변(이 스크립트는 article을 전혀 건드리지 않음) ──
    const articleCountAfter = (await db.select({ id: trainingArticles.id }).from(trainingArticles)).length;
    assertEqual("CASE_16: training_articles row count unchanged (no real data touched)", articleCountAfter, articleCountBefore);

    console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  } finally {
    // ── cleanup: fixture 전부 삭제, DEV 기준선 복원 ──────────────────────────
    await removeOverride("USER", noRoleWorkerId, "TRAINING_READ").catch(() => {});
    await removeOverride("USER", dealerWorkerId, "TRAINING_READ").catch(() => {});
    await removeOverride("USER", dealerWorkerId, "TRAINING_MANAGE").catch(() => {});
    await removeOverride("USER", manageAllowWorkerId, "TRAINING_MANAGE").catch(() => {});
    await removeOverride("ADMIN", adminWithRoleId, "TRAINING_MANAGE").catch(() => {});

    await removeUserRole("ADMIN", adminWithRoleId, "ADMIN").catch(() => {});

    await db.delete(users).where(eq(users.id, noRoleWorkerId));
    await db.delete(users).where(eq(users.id, dealerWorkerId));
    await db.delete(users).where(eq(users.id, manageAllowWorkerId));
    await db.delete(admins).where(eq(admins.id, adminNoRoleId));
    await db.delete(admins).where(eq(admins.id, adminWithRoleId));
    console.log("[CLEANUP] test fixtures removed");
  }
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
