#!/usr/bin/env tsx
/**
 * cleanup_realpos_shift.ts
 *
 * 기존 contact_codes(m_code IS NULL) 중 real_sales_pos가
 * id 순서 기준 다음 행의 dealer_name과 일치하는 "한 줄 밀림" 데이터를 진단·정리합니다.
 *
 * 실행 방법:
 *   npx tsx --env-file=.env scripts/cleanup_realpos_shift.ts --dry-run
 *   npx tsx --env-file=.env scripts/cleanup_realpos_shift.ts
 *
 * 운영 DB 대상:
 *   APP_ENV=production npx tsx --env-file=.env scripts/cleanup_realpos_shift.ts --dry-run
 *
 * 처리 내용:
 *   1. m_code IS NULL 행들을 id 순으로 정렬
 *   2. 현재 행 real_sales_pos = 다음 행 dealer_name 인 행 탐지
 *   3. [dry-run] 의심 행 목록 + 연속 구간 + 적용 예정 SQL 출력
 *   4. [실제 적용] 의심 행의 real_sales_pos, real_sales_pos_code → NULL
 *
 * 주의:
 *   - 삭제 없음. NULL 업데이트만 수행.
 *   - M코드 업로드 데이터(m_code IS NOT NULL)는 절대 건드리지 않음.
 *   - 반드시 --dry-run 먼저 실행 후 결과 확인 후 적용.
 */

import { Pool, PoolClient } from "pg";

const isDryRun = process.argv.includes("--dry-run");

// ── DB 연결 ──────────────────────────────────────────────────────────────────

function getDbUrl(): string {
  const isProd = process.env.APP_ENV === "production";
  if (isProd) {
    const url = process.env.DATABASE_URL_PROD;
    if (!url) throw new Error("APP_ENV=production이지만 DATABASE_URL_PROD가 없습니다.");
    console.log("[DB] 운영 DB 사용");
    return url;
  }
  const url = process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_DEV 또는 DATABASE_URL 환경변수가 필요합니다.");
  console.log("[DB] 개발 DB 사용");
  return url;
}

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface ShiftedRow {
  cur_id: number;
  cur_code: string;
  cur_dealer_name: string;
  cur_real_sales_pos: string;
  cur_real_sales_pos_code: string | null;
  next_id: number | null;
  next_code: string | null;
  next_dealer_name: string | null;
}

interface Span {
  start_id: number;
  end_id: number;
  count: number;
}

// ── 패턴 탐지 쿼리 ────────────────────────────────────────────────────────────

async function detectShiftedRows(client: PoolClient): Promise<ShiftedRow[]> {
  const { rows } = await client.query<ShiftedRow>(`
    WITH ordered AS (
      SELECT
        id,
        code,
        dealer_name,
        real_sales_pos,
        real_sales_pos_code,
        ROW_NUMBER() OVER (ORDER BY id) AS rn
      FROM contact_codes
      WHERE m_code IS NULL
    )
    SELECT
      cur.id                  AS cur_id,
      cur.code                AS cur_code,
      cur.dealer_name         AS cur_dealer_name,
      cur.real_sales_pos      AS cur_real_sales_pos,
      cur.real_sales_pos_code AS cur_real_sales_pos_code,
      nxt.id                  AS next_id,
      nxt.code                AS next_code,
      nxt.dealer_name         AS next_dealer_name
    FROM ordered cur
    LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
    WHERE cur.real_sales_pos IS NOT NULL
      AND cur.real_sales_pos <> ''
      AND cur.real_sales_pos = nxt.dealer_name
    ORDER BY cur.id
  `);
  return rows;
}

async function detectSpans(client: PoolClient): Promise<Span[]> {
  const { rows } = await client.query<Span>(`
    WITH ordered AS (
      SELECT
        id,
        dealer_name,
        real_sales_pos,
        ROW_NUMBER() OVER (ORDER BY id) AS rn
      FROM contact_codes
      WHERE m_code IS NULL
    ),
    shifted_flag AS (
      SELECT
        cur.id   AS cur_id,
        cur.rn   AS cur_rn,
        CASE
          WHEN cur.real_sales_pos IS NOT NULL
            AND cur.real_sales_pos <> ''
            AND cur.real_sales_pos = nxt.dealer_name
          THEN 1 ELSE 0
        END AS is_shifted
      FROM ordered cur
      LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
    ),
    only_shifted AS (
      SELECT
        cur_id,
        cur_rn,
        cur_rn - ROW_NUMBER() OVER (ORDER BY cur_rn) AS grp
      FROM shifted_flag
      WHERE is_shifted = 1
    )
    SELECT
      MIN(cur_id) AS start_id,
      MAX(cur_id) AS end_id,
      COUNT(*)::int AS count
    FROM only_shifted
    GROUP BY grp
    ORDER BY start_id
  `);
  return rows;
}

// ── 전체 현황 ─────────────────────────────────────────────────────────────────

async function loadSummary(client: PoolClient) {
  const { rows } = await client.query(`
    SELECT
      COUNT(*)::int                                                        AS total_legacy,
      COUNT(*) FILTER (WHERE real_sales_pos IS NOT NULL
                         AND real_sales_pos <> '')::int                   AS with_pos,
      COUNT(*) FILTER (WHERE m_code IS NOT NULL)::int                     AS mcode_data
    FROM contact_codes
  `);
  return rows[0];
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function pad(s: string | null | undefined, n: number): string {
  const str = String(s ?? "").slice(0, n);
  return str.padEnd(n, " ");
}

function hr(char = "─", n = 80) {
  return char.repeat(n);
}

// ── 진단 출력 ─────────────────────────────────────────────────────────────────

function printDiagnosis(rows: ShiftedRow[], spans: Span[]) {
  console.log(`\n${hr()}`);
  console.log(" [진단] 밀림 의심 행 목록");
  console.log(hr());
  console.log(
    `  ${"ID".padEnd(6)} | ${"접점코드".padEnd(18)} | ${"정산지급처명(cur)".padEnd(24)} | ${"real_sales_pos(의심)".padEnd(24)} | ${"다음행 dealer_name".padEnd(24)}`
  );
  console.log(`  ${hr("-", 108)}`);

  for (const r of rows) {
    console.log(
      `  ${pad(String(r.cur_id), 6)} | ${pad(r.cur_code, 18)} | ${pad(r.cur_dealer_name, 24)} | ${pad(r.cur_real_sales_pos, 24)} | ${pad(r.next_dealer_name, 24)}`
    );
  }

  console.log(`\n${hr()}`);
  console.log(" [연속 구간]");
  console.log(hr());

  if (spans.length === 0) {
    console.log("  연속 구간 없음");
  } else {
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      console.log(`  구간 ${i + 1}: id ${s.start_id} ~ ${s.end_id}  (${s.count}행 연속)`);
    }
  }
}

function printDryRunResult(rows: ShiftedRow[]) {
  if (rows.length === 0) {
    console.log("\n✅ 밀림 패턴 없음 — 정리 불필요");
    return;
  }

  const ids = rows.map((r) => r.cur_id);
  const hasPosCodes = rows.some((r) => r.cur_real_sales_pos_code != null);

  console.log(`\n${hr()}`);
  console.log(" [DRY-RUN] 적용 예정 SQL");
  console.log(hr());
  console.log(`  -- ${rows.length}건 실행 예정`);
  console.log(`  UPDATE contact_codes`);
  console.log(`  SET`);
  console.log(`    real_sales_pos      = NULL,`);
  console.log(`    real_sales_pos_code = NULL,   -- ${hasPosCodes ? "연관 SP코드도 함께 초기화" : "대부분 NULL이지만 함께 초기화"}`);
  console.log(`    updated_at          = NOW()`);
  console.log(`  WHERE id IN (`);

  // ID를 10개씩 줄 바꿈
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  chunks.forEach((chunk, i) => {
    const suffix = i < chunks.length - 1 ? "," : "";
    console.log(`    ${chunk.join(", ")}${suffix}`);
  });
  console.log(`  );`);

  console.log(`\n  -- 적용 후 검증 쿼리:`);
  console.log(`  SELECT id, code, dealer_name, real_sales_pos`);
  console.log(`  FROM contact_codes`);
  console.log(`  WHERE id IN (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""})`);
  console.log(`  ORDER BY id;`);

  console.log(`\n  ⚠️  --dry-run 제거 후 재실행하면 실제로 적용됩니다.`);
}

// ── 실제 업데이트 ─────────────────────────────────────────────────────────────

async function applyCleanup(client: PoolClient, rows: ShiftedRow[]) {
  const ids = rows.map((r) => r.cur_id);

  console.log(`\n${hr()}`);
  console.log(` [실제 적용] ${ids.length}건 UPDATE`);
  console.log(hr());

  const { rowCount } = await client.query(
    `UPDATE contact_codes
     SET
       real_sales_pos      = NULL,
       real_sales_pos_code = NULL,
       updated_at          = NOW()
     WHERE id = ANY($1::int[])`,
    [ids]
  );

  console.log(`✅ ${rowCount}건 업데이트 완료`);
  console.log(`\n  검증 쿼리:`);
  console.log(`  SELECT id, code, dealer_name, real_sales_pos, real_sales_pos_code`);
  console.log(`  FROM contact_codes`);
  console.log(`  WHERE id IN (${ids.slice(0, 10).join(", ")}${ids.length > 10 ? ", ..." : ""})`);
  console.log(`  ORDER BY id;`);
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(80));
  console.log("  real_sales_pos 한 줄 밀림 정리 스크립트");
  console.log(`  모드: ${isDryRun ? "DRY-RUN (실제 변경 없음)" : "실제 적용"}`);
  console.log("=".repeat(80));

  if (!isDryRun) {
    console.log("\n⚠️  실제 모드입니다.");
    console.log("   반드시 --dry-run을 먼저 실행하여 결과를 확인한 뒤 진행하세요.\n");
  }

  const dbUrl = getDbUrl();
  const isLocal =
    /127\.0\.0\.1|localhost/.test(dbUrl) || /sslmode=disable/.test(dbUrl);

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
    max: 3,
  });

  try {
    const client = await pool.connect();
    try {
      // 전체 현황
      const summary = await loadSummary(client);
      console.log(`\n[전체 현황]`);
      console.log(`  기존 데이터(m_code IS NULL): ${summary.total_legacy}건`);
      console.log(`  real_sales_pos 있는 행:      ${summary.with_pos}건`);
      console.log(`  M코드 업로드 데이터:         ${summary.mcode_data}건 (대상 제외)`);

      // 밀림 탐지
      console.log("\n[밀림 패턴 탐지 중...]");
      const [shiftedRows, spans] = await Promise.all([
        detectShiftedRows(client),
        detectSpans(client),
      ]);

      console.log(`  → 밀림 의심 행: ${shiftedRows.length}건`);
      console.log(`  → 연속 구간:    ${spans.length}개`);

      // 출력
      printDiagnosis(shiftedRows, spans);

      if (shiftedRows.length === 0) {
        console.log("\n✅ 밀림 패턴 없음 — 정리 불필요");
        return;
      }

      if (isDryRun) {
        printDryRunResult(shiftedRows);
      } else {
        await applyCleanup(client, shiftedRows);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log("\n" + "=".repeat(80));
}

main().catch((err) => {
  console.error("\n[ERROR]", err.message);
  process.exit(1);
});
