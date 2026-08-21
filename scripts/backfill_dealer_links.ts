#!/usr/bin/env tsx
/**
 * backfill_dealer_links.ts
 *
 * 실행 전 db:push로 dealer_registration_id 컬럼이 추가된 상태여야 합니다.
 *
 * 실행 방법 (개발 DB):
 *   npx tsx --env-file=.env scripts/backfill_dealer_links.ts
 *
 * 실행 방법 (운영 DB):
 *   APP_ENV=production npx tsx --env-file=.env scripts/backfill_dealer_links.ts
 *
 * 작동:
 *   1. dealer_registrations 전체 로드
 *   2. users(dealerId IS NOT NULL)에서 name ↔ businessName LOWER() 매칭
 *   3. contact_codes에서 dealerName ↔ businessName LOWER() 매칭
 *   4. 매칭 성공 → dealer_registration_id UPDATE (dry-run이면 실제 저장 안 함)
 *   5. 매칭 실패 목록 출력
 *
 * 옵션:
 *   --dry-run  : 실제 UPDATE 없이 매칭 결과만 출력
 */

import { Pool } from "pg";

// ── 환경 설정 ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes("--dry-run");

function getDbUrl(): string {
  const isProduction = process.env.APP_ENV === "production";
  if (isProduction) {
    const url = process.env.DATABASE_URL_PROD;
    if (!url) throw new Error("APP_ENV=production 이지만 DATABASE_URL_PROD 가 없습니다.");
    console.log("🚀 운영 DB 사용");
    return url;
  }
  const url = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_DEV 또는 DATABASE_URL 환경변수가 필요합니다.");
  console.log("🔧 개발 DB 사용");
  return url;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log(" dealer_registration_id Backfill 스크립트");
  console.log(`  모드: ${isDryRun ? "DRY-RUN (실제 저장 안 함)" : "실제 저장"}`);
  console.log("=".repeat(60));
  console.log();

  const dbUrl = getDbUrl();
  const isLocal = /127\.0\.0\.1|localhost/.test(dbUrl) || /sslmode=disable/.test(dbUrl);

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
    max: 3,
  });

  try {
    const client = await pool.connect();
    try {
      await run(client, isDryRun);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// ── 핵심 로직 ─────────────────────────────────────────────────────────────────

type DealerReg = { id: number; businessName: string };
type UserRow = { id: number; name: string; dealerId: number | null };
type ContactCodeRow = { id: number; dealerName: string };

async function run(client: any, dryRun: boolean) {
  // 1. dealer_registrations 전체 로드
  const { rows: regs }: { rows: DealerReg[] } = await client.query(
    "SELECT id, business_name AS \"businessName\" FROM dealer_registrations ORDER BY id"
  );
  console.log(`dealer_registrations 총 ${regs.length}건`);
  if (regs.length === 0) {
    console.log("⚠️  dealer_registrations 가 비어 있습니다. 종료합니다.");
    return;
  }

  // LOWER() → Map 으로 빠른 룩업
  const regByName = new Map<string, DealerReg>();
  for (const r of regs) {
    regByName.set(r.businessName.toLowerCase().trim(), r);
  }

  // ── 섹션 A: users 테이블 ────────────────────────────────────────────────────
  console.log();
  console.log("─".repeat(50));
  console.log("[A] users 테이블 처리");
  console.log("─".repeat(50));

  const { rows: userRows }: { rows: UserRow[] } = await client.query(
    `SELECT id, name, dealer_id AS "dealerId"
     FROM users
     WHERE dealer_id IS NOT NULL
     ORDER BY id`
  );
  console.log(`  판매점 계정(dealerId IS NOT NULL) ${userRows.length}건`);

  const userMatched: Array<{ userId: number; userName: string; regId: number; regName: string }> = [];
  const userFailed: Array<{ userId: number; userName: string }> = [];

  for (const u of userRows) {
    const key = u.name.toLowerCase().trim();
    const reg = regByName.get(key);
    if (reg) {
      userMatched.push({ userId: u.id, userName: u.name, regId: reg.id, regName: reg.businessName });
    } else {
      userFailed.push({ userId: u.id, userName: u.name });
    }
  }

  console.log(`  매칭 성공: ${userMatched.length}건 / 실패: ${userFailed.length}건`);

  if (!dryRun && userMatched.length > 0) {
    for (const m of userMatched) {
      await client.query(
        "UPDATE users SET dealer_registration_id = $1 WHERE id = $2",
        [m.regId, m.userId]
      );
    }
    console.log(`  ✅ users.dealer_registration_id UPDATE 완료 (${userMatched.length}건)`);
  } else if (dryRun && userMatched.length > 0) {
    console.log("  (DRY-RUN) 아래 행이 업데이트될 예정:");
    for (const m of userMatched) {
      console.log(`    users.id=${m.userId}  name="${m.userName}"  → dealer_registration_id=${m.regId} ("${m.regName}")`);
    }
  }

  if (userFailed.length > 0) {
    console.log();
    console.log("  ⚠️  [users] 매칭 실패 목록 (dealer_registrations에 동일 이름 없음):");
    for (const f of userFailed) {
      console.log(`    users.id=${f.userId}  name="${f.userName}"`);
    }
  }

  // ── 섹션 B: contact_codes 테이블 ───────────────────────────────────────────
  console.log();
  console.log("─".repeat(50));
  console.log("[B] contact_codes 테이블 처리");
  console.log("─".repeat(50));

  const { rows: ccRows }: { rows: ContactCodeRow[] } = await client.query(
    `SELECT id, dealer_name AS "dealerName"
     FROM contact_codes
     ORDER BY id`
  );
  console.log(`  contact_codes 총 ${ccRows.length}건`);

  const ccMatched: Array<{ ccId: number; dealerName: string; regId: number; regName: string }> = [];
  const ccFailed: Array<{ ccId: number; dealerName: string }> = [];

  for (const cc of ccRows) {
    const key = cc.dealerName.toLowerCase().trim();
    const reg = regByName.get(key);
    if (reg) {
      ccMatched.push({ ccId: cc.id, dealerName: cc.dealerName, regId: reg.id, regName: reg.businessName });
    } else {
      ccFailed.push({ ccId: cc.id, dealerName: cc.dealerName });
    }
  }

  console.log(`  매칭 성공: ${ccMatched.length}건 / 실패: ${ccFailed.length}건`);

  if (!dryRun && ccMatched.length > 0) {
    for (const m of ccMatched) {
      await client.query(
        "UPDATE contact_codes SET dealer_registration_id = $1 WHERE id = $2",
        [m.regId, m.ccId]
      );
    }
    console.log(`  ✅ contact_codes.dealer_registration_id UPDATE 완료 (${ccMatched.length}건)`);
  } else if (dryRun && ccMatched.length > 0) {
    console.log("  (DRY-RUN) 아래 행이 업데이트될 예정:");
    for (const m of ccMatched) {
      console.log(`    contact_codes.id=${m.ccId}  dealerName="${m.dealerName}"  → dealer_registration_id=${m.regId} ("${m.regName}")`);
    }
  }

  if (ccFailed.length > 0) {
    console.log();
    console.log("  ⚠️  [contact_codes] 매칭 실패 목록 (dealer_registrations에 동일 이름 없음):");
    for (const f of ccFailed) {
      console.log(`    contact_codes.id=${f.ccId}  dealerName="${f.dealerName}"`);
    }
  }

  // ── 최종 요약 ──────────────────────────────────────────────────────────────
  console.log();
  console.log("=".repeat(60));
  console.log(" 최종 요약");
  console.log("=".repeat(60));
  console.log(`  dealer_registrations : ${regs.length}건`);
  console.log(`  users 매칭 성공      : ${userMatched.length} / ${userRows.length}건`);
  console.log(`  users 매칭 실패      : ${userFailed.length}건`);
  console.log(`  contact_codes 매칭 성공 : ${ccMatched.length} / ${ccRows.length}건`);
  console.log(`  contact_codes 매칭 실패 : ${ccFailed.length}건`);
  if (dryRun) {
    console.log();
    console.log("  ** DRY-RUN 모드: 실제 DB 변경 없음 **");
    console.log("  실제 저장하려면 --dry-run 없이 실행하세요.");
  }
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("❌ 스크립트 오류:", e);
  process.exit(1);
});
