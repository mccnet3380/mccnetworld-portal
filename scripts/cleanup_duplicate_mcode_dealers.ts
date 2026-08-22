#!/usr/bin/env tsx
/**
 * cleanup_duplicate_mcode_dealers.ts
 *
 * M코드 원장 업로드로 중복 생성된 dealer_registrations를 정리합니다.
 *
 * 실행 방법:
 *   npx tsx --env-file=.env scripts/cleanup_duplicate_mcode_dealers.ts --dry-run
 *   npx tsx --env-file=.env scripts/cleanup_duplicate_mcode_dealers.ts
 *
 * 운영 DB:
 *   APP_ENV=production npx tsx --env-file=.env scripts/cleanup_duplicate_mcode_dealers.ts --dry-run
 *
 * 처리 순서:
 *   1. 동일 m_code + 정규화 판매점명 기준 중복 후보 조회
 *   2. 각 그룹에서 master 결정 (KP 있는 행 > CC 연결 수 > created_at 빠른 > dealer_code 낮은)
 *   3. contact_codes.dealer_registration_id → master id로 재연결
 *   4. duplicate row → is_active=false, is_hidden_pos=true 처리 (삭제 금지)
 *   5. 결과 보고
 */

import { Pool, PoolClient } from "pg";

const isDryRun = process.argv.includes("--dry-run");

// ── 환경 설정 ──────────────────────────────────────────────────────────────────

function getDbUrl(): string {
  const isProd = process.env.APP_ENV === "production";
  if (isProd) {
    const url = process.env.DATABASE_URL_PROD;
    if (!url) throw new Error("APP_ENV=production 이지만 DATABASE_URL_PROD 가 없습니다.");
    console.log("[DB] 운영 DB 사용");
    return url;
  }
  const url = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_DEV 또는 DATABASE_URL 환경변수가 필요합니다.");
  console.log("[DB] 개발 DB 사용");
  return url;
}

// ── 이름 정규화 (storage.ts 의 normalizeDealerName 와 동일 로직) ───────────────

function normalizeName(name: string): string {
  if (!name) return "";
  return name.trim()
    .replace(/^[가-힣]{1,3}[)）]\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// ── 중복 그룹 탐지 ──────────────────────────────────────────────────────────────

interface DealerRow {
  id: number;
  dealer_code: string;
  business_name: string;
  m_code: string;
  kp_number: string | null;
  region_name: string | null;
  source_dealer_name: string | null;
  sub_dealer_name: string | null;
  is_active: boolean;
  is_hidden_pos: boolean;
  created_at: Date;
  cc_count: number;  // contact_codes 연결 수
}

async function loadDealers(client: PoolClient): Promise<DealerRow[]> {
  const { rows } = await client.query(`
    SELECT
      dr.id, dr.dealer_code, dr.business_name, dr.m_code,
      dr.kp_number, dr.region_name, dr.source_dealer_name, dr.sub_dealer_name,
      dr.is_active, dr.is_hidden_pos, dr.created_at,
      COALESCE(cc.cnt, 0)::int AS cc_count
    FROM dealer_registrations dr
    LEFT JOIN (
      SELECT dealer_registration_id, COUNT(*) AS cnt
      FROM contact_codes
      WHERE dealer_registration_id IS NOT NULL
      GROUP BY dealer_registration_id
    ) cc ON cc.dealer_registration_id = dr.id
    WHERE dr.m_code IS NOT NULL
      AND dr.is_active = true
    ORDER BY dr.m_code, dr.dealer_code
  `);
  return rows;
}

interface DuplicateGroup {
  mCode: string;
  normKey: string;
  members: DealerRow[];
  master: DealerRow;
  duplicates: DealerRow[];
}

function findDuplicateGroups(dealers: DealerRow[]): DuplicateGroup[] {
  // m_code + normalized(business_name) 기준으로 그룹화 (upsert 0순위 기준과 동일)
  const groupMap = new Map<string, DealerRow[]>();

  for (const dr of dealers) {
    const normBiz = normalizeName(dr.business_name ?? "");
    const nameKey = normBiz || "(unnamed)";
    const key = `${dr.m_code}|||${nameKey}`;

    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(dr);
  }

  const groups: DuplicateGroup[] = [];

  for (const [key, members] of groupMap.entries()) {
    if (members.length < 2) continue;  // 중복 없으면 스킵

    // master 결정: KP 있음 > CC 많음 > created_at 빠름 > dealer_code 낮음
    const sorted = [...members].sort((a, b) => {
      // 1. KP번호 있는 쪽 우선
      const aHasKp = a.kp_number ? 1 : 0;
      const bHasKp = b.kp_number ? 1 : 0;
      if (bHasKp !== aHasKp) return bHasKp - aHasKp;
      // 2. contact_codes 연결 수 많은 쪽 우선
      if (b.cc_count !== a.cc_count) return b.cc_count - a.cc_count;
      // 3. created_at 빠른 쪽 우선
      if (a.created_at < b.created_at) return -1;
      if (a.created_at > b.created_at) return 1;
      // 4. dealer_code 낮은 쪽 우선 (MCC0070 < MCC0094)
      return a.dealer_code.localeCompare(b.dealer_code);
    });

    const [mCode, normKey] = key.split("|||");
    groups.push({
      mCode,
      normKey,
      members,
      master: sorted[0],
      duplicates: sorted.slice(1),
    });
  }

  return groups;
}

// ── 실제 정리 실행 ─────────────────────────────────────────────────────────────

async function run(client: PoolClient) {
  console.log("\n[1] dealer_registrations 로드 중...");
  const dealers = await loadDealers(client);
  console.log(`    총 settlement_only 판매점 원장: ${dealers.length}건`);

  console.log("\n[2] 중복 그룹 탐지 중...");
  const groups = findDuplicateGroups(dealers);
  console.log(`    중복 그룹 수: ${groups.length}개`);

  if (groups.length === 0) {
    console.log("\n✅ 중복 없음 — 정리 불필요");
    return;
  }

  let totalDuplicates = 0;
  let ccRelinked = 0;
  let deactivated = 0;

  for (const g of groups) {
    totalDuplicates += g.duplicates.length;
    console.log(`\n  [그룹] M코드: ${g.mCode} | 정규화명: "${g.normKey}"`);
    console.log(`    ★ MASTER: ${g.master.dealer_code} / ${g.master.business_name} / KP:${g.master.kp_number ?? "없음"} / CC:${g.master.cc_count}건`);

    for (const dup of g.duplicates) {
      console.log(`    ✗ DUPLICATE: ${dup.dealer_code} / ${dup.business_name} / KP:${dup.kp_number ?? "없음"} / CC:${dup.cc_count}건`);

      if (!isDryRun) {
        // contact_codes.dealer_registration_id → master id 재연결
        if (dup.cc_count > 0) {
          const { rowCount } = await client.query(
            `UPDATE contact_codes
             SET dealer_registration_id = $1, updated_at = NOW()
             WHERE dealer_registration_id = $2`,
            [g.master.id, dup.id]
          );
          ccRelinked += rowCount ?? 0;
          console.log(`      → contact_codes ${rowCount}건을 master(${g.master.dealer_code})로 재연결`);
        }

        // duplicate → inactive + hidden 처리 (삭제 금지)
        await client.query(
          `UPDATE dealer_registrations
           SET is_active = false, is_hidden_pos = true, updated_at = NOW()
           WHERE id = $1`,
          [dup.id]
        );
        deactivated++;
        console.log(`      → ${dup.dealer_code} 비활성화 완료`);
      } else {
        console.log(`      [DRY-RUN] CC ${dup.cc_count}건 재연결 예정 → master ${g.master.dealer_code}`);
        console.log(`      [DRY-RUN] ${dup.dealer_code} 비활성화 예정`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(" 완료 요약");
  console.log("=".repeat(60));
  console.log(`  중복 그룹:       ${groups.length}개`);
  console.log(`  duplicate 레코드: ${totalDuplicates}건`);
  if (!isDryRun) {
    console.log(`  CC 재연결:        ${ccRelinked}건`);
    console.log(`  비활성화:         ${deactivated}건`);
    console.log(`\n  ※ 비활성화된 레코드는 삭제되지 않았습니다.`);
    console.log(`  ※ 안전 확인 후 수동 삭제 가능:`);
    console.log(`     DELETE FROM dealer_registrations`);
    console.log(`     WHERE is_active = false AND settlement_only = true`);
    console.log(`       AND id NOT IN (SELECT dealer_registration_id FROM contact_codes WHERE dealer_registration_id IS NOT NULL);`);
  } else {
    console.log(`\n  [DRY-RUN] 실제 변경 없음. --dry-run 제거 후 재실행하면 적용됩니다.`);
  }
}

// ── 중복 확인용 SQL 출력 ───────────────────────────────────────────────────────

function printCheckSql() {
  console.log("\n" + "=".repeat(60));
  console.log(" 중복 후보 확인 SQL (psql에서 직접 실행)");
  console.log("=".repeat(60));
  console.log(`
-- 1. 정리 전 중복 현황 (m_code + business_name 기준, 활성 레코드만)
SELECT m_code, business_name, COUNT(*) AS cnt,
       array_agg(dealer_code ORDER BY dealer_code) AS codes
FROM dealer_registrations
WHERE m_code IS NOT NULL AND settlement_only = true AND is_active = true
GROUP BY m_code, business_name
HAVING COUNT(*) > 1
ORDER BY cnt DESC, m_code;

-- 2. 비활성화된 duplicate 목록 (정리 후 확인)
SELECT dealer_code, business_name, m_code, kp_number,
       is_active, is_hidden_pos, created_at
FROM dealer_registrations
WHERE is_active = false AND settlement_only = true
ORDER BY m_code;

-- 3. 안전 삭제 후보 (CC 연결 없는 비활성 레코드)
SELECT dr.dealer_code, dr.business_name, dr.m_code
FROM dealer_registrations dr
WHERE dr.is_active = false AND dr.settlement_only = true
  AND dr.id NOT IN (
    SELECT dealer_registration_id FROM contact_codes
    WHERE dealer_registration_id IS NOT NULL
  );

-- 4. 정리 후 contact_codes 재연결 확인
SELECT dr.dealer_code, dr.business_name, dr.m_code, COUNT(cc.id) AS cc_count
FROM dealer_registrations dr
LEFT JOIN contact_codes cc ON cc.dealer_registration_id = dr.id
WHERE dr.m_code IS NOT NULL AND dr.is_active = true
GROUP BY dr.id, dr.dealer_code, dr.business_name, dr.m_code
ORDER BY dr.m_code;
`);
}

// ── 진입점 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log(" M코드 중복 판매점 원장 정리 스크립트");
  console.log(`  모드: ${isDryRun ? "DRY-RUN (실제 변경 없음)" : "실제 적용"}`);
  console.log("=".repeat(60));

  printCheckSql();

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
      await run(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("\n[ERROR]", err.message);
  process.exit(1);
});
