/**
 * MCC_SETTLEMENT_MATCH_RESULT_AUDIT_1
 *
 * 실행: APP_ENV=production npx tsx scripts/audit-settlement-match.ts
 *   (Replit/Render에서 DATABASE_URL_PROD 환경변수가 설정된 환경에서 실행)
 */

import { Pool } from 'pg';
// dotenv 없이 .env 수동 로드 (dev 환경 대비)
import { readFileSync } from 'fs';
try {
  const env = readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env 없으면 무시 */ }

// ── DB 연결 ──────────────────────────────────────────────────
const raw =
  process.env.APP_ENV === 'production'
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;

if (!raw) {
  console.error('❌ DB URL 없음. APP_ENV=production + DATABASE_URL_PROD 또는 DATABASE_URL_DEV 필요');
  process.exit(1);
}

const connectionString = raw.replace(/^DATABASE_URL=/, '').replace(/^"+|"+$/g, '');
const isLocal = /127\.0\.0\.1|localhost/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

async function q(sql: string): Promise<any[]> {
  const { rows } = await pool.query(sql);
  return rows;
}

async function safeQ(label: string, sql: string): Promise<any[]> {
  try {
    return await q(sql);
  } catch (e: any) {
    console.log(`  ⚠️ [${label}] 쿼리 오류: ${e.message?.split('\n')[0]}`);
    return [];
  }
}

function sep(title: string) {
  console.log('\n' + '═'.repeat(64));
  console.log(`  ${title}`);
  console.log('═'.repeat(64));
}

function tbl(rows: any[]) {
  if (!rows.length) { console.log('  (데이터 없음)'); return; }
  console.table(rows);
}

// normalizeCustomerType SQL 표현식
const normCT = (col: string) => `
  CASE LOWER(TRIM(${col}))
    WHEN '1'       THEN '1'
    WHEN '신규'    THEN '1'
    WHEN '신'      THEN '1'
    WHEN 'new'     THEN '1'
    WHEN '2'       THEN '2'
    WHEN '번이'    THEN '2'
    WHEN '번호이동' THEN '2'
    WHEN 'mnp'     THEN '2'
    WHEN '이동'    THEN '2'
    ELSE COALESCE(TRIM(${col}), '')
  END
`.trim();

async function main() {
  const masked = connectionString.replace(/:([^:@]+)@/, ':****@');
  console.log(`\n🔍 MCC_SETTLEMENT_MATCH_RESULT_AUDIT_1`);
  console.log(`   DB: ${masked}`);
  console.log(`   실행 시각: ${new Date().toISOString()}`);

  // ── [1] settlement_items match_status 분포 ───────────────────
  sep('[1] settlement_items match_status 분포');
  const dist = await q(`
    SELECT
      match_status,
      COUNT(*)::int                                            AS cnt,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
    FROM settlement_items
    GROUP BY match_status
    ORDER BY cnt DESC
  `);
  tbl(dist);
  const total = dist.reduce((s: number, r: any) => s + Number(r.cnt), 0);
  console.log(`  합계: ${total}건`);

  // ── [2] POLICY_NOT_FOUND 원인 분류 ──────────────────────────
  sep('[2] POLICY_NOT_FOUND 원인 분류');

  const pvRows = await q(`
    SELECT id, policy_name, effective_from
    FROM policy_versions
    WHERE is_active = true
    ORDER BY effective_from DESC
    LIMIT 1
  `);
  if (!pvRows.length) {
    console.log('  ⚠️ 활성 policy_version 없음 — funnel 분류 불가');
  } else {
    const pv = pvRows[0];
    console.log(`  활성 정책 차수: id=${pv.id}  name="${pv.policy_name}"  effective_from=${pv.effective_from?.toISOString?.() ?? pv.effective_from}`);

    // [2-A] Funnel: 어느 단계에서 매칭 실패했는지
    const funnel = await q(`
      WITH pnf AS (
        SELECT ar.channel,
               ar.plan_name,
               ar.customer_type,
               ar.nationality_type,
               ar.bundle_type,
               ar.add_service,
               ar.reg_fee_type,
               ar.dealer_registration_id
        FROM settlement_items si
        JOIN activation_records ar ON ar.id = si.activation_id
        WHERE si.match_status = 'POLICY_NOT_FOUND'
      ),
      apr AS (
        SELECT channel, plan_name, customer_type, nationality_type,
               bundle_type, add_service, reg_fee_type
        FROM policy_rows
        WHERE policy_version_id = ${pv.id} AND is_active = true
      )
      SELECT
        COUNT(*) AS total_pnf,

        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM apr WHERE apr.channel = pnf.channel
        )) AS 채널_불일치,

        COUNT(*) FILTER (WHERE
          EXISTS    (SELECT 1 FROM apr WHERE apr.channel = pnf.channel)
          AND NOT EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name)
        ) AS 요금제_불일치,

        COUNT(*) FILTER (WHERE
          EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name)
          AND NOT EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name
            AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
          )
        ) AS 가입유형_불일치,

        COUNT(*) FILTER (WHERE
          EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name
            AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
          )
          AND NOT EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name
            AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
            AND (
              apr.nationality_type IS NULL OR TRIM(apr.nationality_type) = ''
              OR TRIM(apr.nationality_type) = COALESCE(TRIM(pnf.nationality_type), '내국인')
            )
          )
        ) AS 국적_불일치,

        COUNT(*) FILTER (WHERE
          EXISTS (SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name
            AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
            AND (
              apr.nationality_type IS NULL OR TRIM(apr.nationality_type) = ''
              OR TRIM(apr.nationality_type) = COALESCE(TRIM(pnf.nationality_type), '내국인')
            )
          )
        ) AS 국적_통과_후_잔여_pnf

      FROM pnf
    `);
    console.log('\n  [2-A] PNF funnel 분석:');
    tbl(funnel);

    // [2-B] 가입유형 불일치 상세: activation customerType vs policy customerType
    const ctMismatch = await q(`
      WITH pnf AS (
        SELECT ar.channel, ar.plan_name, ar.customer_type
        FROM settlement_items si
        JOIN activation_records ar ON ar.id = si.activation_id
        WHERE si.match_status = 'POLICY_NOT_FOUND'
      ),
      apr AS (
        SELECT channel, plan_name, customer_type
        FROM policy_rows
        WHERE policy_version_id = ${pv.id} AND is_active = true
      ),
      ct_mismatch_base AS (
        SELECT pnf.customer_type AS act_ct_raw,
               (${normCT('pnf.customer_type')}) AS act_ct_normalized
        FROM pnf
        WHERE EXISTS (SELECT 1 FROM apr WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name)
          AND NOT EXISTS (
            SELECT 1 FROM apr
            WHERE apr.channel = pnf.channel AND apr.plan_name = pnf.plan_name
              AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
          )
      )
      SELECT act_ct_normalized, act_ct_raw, COUNT(*)::int AS pnf_cnt
      FROM ct_mismatch_base
      GROUP BY act_ct_normalized, act_ct_raw
      ORDER BY pnf_cnt DESC
      LIMIT 20
    `);
    console.log('\n  [2-B] 가입유형 불일치 상세 (채널+요금제 존재하는데 CT 불일치):');
    tbl(ctMismatch);

    // [2-C] 채널+요금제+CT 모두 일치하는데 PNF인 잔여 건 상세 분석
    const natMismatch = await q(`
      WITH pnf AS (
        SELECT ar.channel, ar.plan_name, ar.customer_type, ar.nationality_type,
               ar.bundle_type, ar.add_service, ar.reg_fee_type
        FROM settlement_items si
        JOIN activation_records ar ON ar.id = si.activation_id
        WHERE si.match_status = 'POLICY_NOT_FOUND'
      ),
      apr AS (
        SELECT channel, plan_name, customer_type, nationality_type
        FROM policy_rows
        WHERE policy_version_id = ${pv.id} AND is_active = true
      )
      SELECT
        COALESCE(TRIM(pnf.nationality_type), '내국인')   AS act_nat,
        STRING_AGG(DISTINCT apr.nationality_type, ', ') AS policy_nats_available,
        COUNT(*)                                          AS cnt
      FROM pnf
      JOIN apr ON apr.channel = pnf.channel
              AND apr.plan_name = pnf.plan_name
              AND (${normCT('apr.customer_type')}) = (${normCT('pnf.customer_type')})
      WHERE apr.nationality_type IS NOT NULL AND TRIM(apr.nationality_type) != ''
        AND TRIM(apr.nationality_type) != COALESCE(TRIM(pnf.nationality_type), '내국인')
      GROUP BY act_nat
      ORDER BY cnt DESC
      LIMIT 10
    `);
    console.log('\n  [2-C] 국적 불일치 상세:');
    tbl(natMismatch);

    // [2-D] 정책 row 자체가 없는 channel+plan 조합
    const noPolicyCombo = await q(`
      SELECT DISTINCT ar.channel, ar.plan_name, COUNT(*) OVER (PARTITION BY ar.channel, ar.plan_name) AS pnf_cnt
      FROM settlement_items si
      JOIN activation_records ar ON ar.id = si.activation_id
      WHERE si.match_status = 'POLICY_NOT_FOUND'
        AND NOT EXISTS (
          SELECT 1 FROM policy_rows pr
          WHERE pr.policy_version_id = ${pv.id}
            AND pr.is_active = true
            AND pr.channel = ar.channel
            AND pr.plan_name = ar.plan_name
        )
      ORDER BY pnf_cnt DESC
      LIMIT 20
    `);
    console.log('\n  [2-D] 정책 row 자체 없는 (channel, plan_name) 조합 (상위 20개):');
    tbl(noPolicyCombo);
  }

  // ── [3] REVIEW_REQUIRED 원인 분류 ────────────────────────
  sep('[3] REVIEW_REQUIRED 원인 분류');

  const rrBreak = await q(`
    SELECT
      CASE
        WHEN si.dealer_registration_id IS NULL AND si.policy_row_id IS NOT NULL
          THEN '판매점_미매칭_강등(dealer_reg_id=null)'
        WHEN si.policy_row_id IS NULL
          THEN '정책행_null(이상케이스)'
        WHEN (si.policy_snapshot_json->>'nationalityType') IS NULL
          OR (si.policy_snapshot_json->>'nationalityType') = ''
          THEN '국적_wildcard(policy_nat_null)'
        ELSE '조건완화_또는_기타'
      END AS reason,
      COUNT(*)::int AS cnt
    FROM settlement_items si
    WHERE si.match_status = 'REVIEW_REQUIRED'
    GROUP BY reason
    ORDER BY cnt DESC
  `);
  tbl(rrBreak);

  // RR 건 - activation matching_status 분포
  const rrActMS = await safeQ('RR×matching_status', `
    SELECT ar.matching_status, COUNT(*)::int AS cnt
    FROM settlement_items si
    JOIN activation_records ar ON ar.id = si.activation_id
    WHERE si.match_status = 'REVIEW_REQUIRED'
    GROUP BY ar.matching_status
    ORDER BY cnt DESC
  `);
  console.log('\n  RR 건의 activation matching_status:');
  tbl(rrActMS);

  // RR 건 - 정산완료 제외 vs 포함 현황
  const rrStatus = await q(`
    SELECT si.status, COUNT(*)::int AS cnt
    FROM settlement_items si
    WHERE si.match_status = 'REVIEW_REQUIRED'
    GROUP BY si.status
    ORDER BY cnt DESC
  `);
  console.log('\n  RR 건의 settlement_items status:');
  tbl(rrStatus);

  // ── [4] activation_records 판매점 매칭 상태 ──────────────
  sep('[4] activation_records 판매점 매칭 상태');

  const actMS = await safeQ('activation_records matching_status', `
    SELECT
      COALESCE(matching_status, 'null') AS matching_status,
      COUNT(*)::int AS cnt,
      ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
    FROM activation_records
    GROUP BY matching_status
    ORDER BY cnt DESC
  `);
  tbl(actMS);

  const actDR = await q(`
    SELECT
      CASE WHEN dealer_registration_id IS NULL THEN 'null' ELSE 'set' END AS dr_id_여부,
      COUNT(*)::int AS cnt
    FROM activation_records
    GROUP BY dr_id_여부
    ORDER BY cnt DESC
  `);
  console.log('\n  dealer_registration_id null 여부:');
  tbl(actDR);

  // ── [5] 정산 필드 활용도 ─────────────────────────────────
  sep('[5] 정산 매칭 필드 활용도');

  const pvRows2 = await q(`SELECT id FROM policy_versions WHERE is_active = true ORDER BY effective_from DESC LIMIT 1`);
  if (pvRows2.length) {
    const pvId2 = pvRows2[0].id;
    const prF = await q(`
      SELECT
        COUNT(*)::int AS total_active_rows,
        COUNT(DISTINCT channel)     AS distinct_channels,
        COUNT(DISTINCT plan_name)   AS distinct_plans,
        COUNT(DISTINCT customer_type) AS distinct_ct,
        COUNT(*) FILTER (WHERE nationality_type IS NOT NULL AND TRIM(nationality_type) != '')::int AS nationality_used,
        COUNT(*) FILTER (WHERE sim_count IS NOT NULL)::int        AS sim_count_used,
        COUNT(*) FILTER (WHERE bundle_type IS NOT NULL AND TRIM(bundle_type) != '')::int  AS bundle_type_used,
        COUNT(*) FILTER (WHERE add_service IS NOT NULL AND TRIM(add_service) != '')::int  AS add_service_used,
        COUNT(*) FILTER (WHERE reg_fee_type IS NOT NULL AND TRIM(reg_fee_type) != '')::int AS reg_fee_type_used
      FROM policy_rows
      WHERE policy_version_id = ${pvId2} AND is_active = true
    `);
    console.log('\n  활성 policy_rows 필드 활용도:');
    tbl(prF);
  }

  const arF = await q(`
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(DISTINCT channel)::int AS distinct_channels,
      COUNT(DISTINCT plan_name)::int AS distinct_plans,
      COUNT(*) FILTER (WHERE nationality_type IS NOT NULL AND TRIM(nationality_type) NOT IN ('', '내국인'))::int AS nationality_non_default,
      COUNT(*) FILTER (WHERE sim_count IS NOT NULL)::int         AS has_sim_count,
      COUNT(*) FILTER (WHERE bundle_type IS NOT NULL AND TRIM(bundle_type) != '')::int   AS has_bundle_type,
      COUNT(*) FILTER (WHERE add_service IS NOT NULL AND TRIM(add_service) != '')::int   AS has_add_service,
      COUNT(*) FILTER (WHERE reg_fee_type IS NOT NULL AND TRIM(reg_fee_type) != '')::int AS has_reg_fee_type,
      COUNT(dealer_registration_id)::int  AS has_dealer_reg_id
    FROM activation_records
  `);
  console.log('\n  activation_records 필드 채워짐 현황:');
  tbl(arF);

  // ── [6] customerType 정규화 확인 ──────────────────────────
  sep('[6] customerType 정규화 확인');

  const allCT = await q(`
    SELECT
      customer_type                        AS raw,
      (${normCT('customer_type')})         AS normalized,
      COUNT(*)::int                        AS cnt
    FROM activation_records
    GROUP BY raw, normalized
    ORDER BY cnt DESC
    LIMIT 30
  `);
  console.log('\n  전체 activation_records customerType 분포:');
  tbl(allCT);

  // 최근 xlsx 업로드 기준
  const latestXlsx = await q(`
    SELECT MAX(created_at) AS latest_upload,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d_count
    FROM activation_records
    WHERE source = 'xlsx업로드'
  `);
  console.log('\n  최근 xlsx 업로드 현황:');
  tbl(latestXlsx);

  const recentCT = await q(`
    SELECT
      customer_type                        AS raw,
      (${normCT('customer_type')})         AS normalized,
      COUNT(*)::int                        AS cnt
    FROM activation_records
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND source = 'xlsx업로드'
    GROUP BY raw, normalized
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('\n  최근 7일 xlsx 업로드 customerType 분포:');
  tbl(recentCT);

  // ── 추가: settlement_items 전체 현황 ─────────────────────
  sep('[추가] settlement_items 전체 현황');

  const siStatus = await q(`
    SELECT status, COUNT(*)::int AS cnt
    FROM settlement_items
    GROUP BY status
    ORDER BY cnt DESC
  `);
  console.log('\n  settlement_items.status 분포:');
  tbl(siStatus);

  const siPV = await q(`
    SELECT pv.policy_name, si.match_status, COUNT(*)::int AS cnt
    FROM settlement_items si
    LEFT JOIN policy_versions pv ON pv.id = si.policy_version_id
    GROUP BY pv.policy_name, si.match_status
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log('\n  정책 차수 × match_status 분포:');
  tbl(siPV);

  await pool.end();
  console.log('\n✅ 감사 완료\n');
}

main().catch((e) => {
  console.error('❌ 오류:', e.message ?? e);
  process.exit(1);
});
