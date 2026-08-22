-- ============================================================
-- diagnose_realpos_shift.sql
-- real_sales_pos 한 줄 밀림 패턴 진단 SQL
-- MCC_LEGACY_CONTACT_CODE_REAL_SALES_POS_AUDIT_1
--
-- 실행 방법:
--   psql $DATABASE_URL_DEV -f scripts/diagnose_realpos_shift.sql 2>&1
--   또는 개별 쿼리를 psql에서 직접 실행
--
-- 검사 대상: m_code IS NULL인 기존 contact_codes만
-- 기준: 현재 행의 real_sales_pos = id 순서 기준 다음 행의 dealer_name
-- 모든 쿼리는 읽기 전용입니다.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 0. 전체 현황 요약
-- ─────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                                           AS 기존데이터_전체,
  COUNT(*) FILTER (WHERE real_sales_pos IS NOT NULL
                     AND real_sales_pos <> '')                       AS real_sales_pos_있음,
  COUNT(*) FILTER (WHERE real_sales_pos IS NULL
                      OR real_sales_pos = '')                        AS real_sales_pos_없음
FROM contact_codes
WHERE m_code IS NULL;


-- ─────────────────────────────────────────────────────────────
-- 1. 핵심 진단: 밀림 의심 행
--    조건: 현재행 real_sales_pos = (id 순서 기준 바로 다음 행)의 dealer_name
-- ─────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT
    id,
    code,
    dealer_name,
    real_sales_pos,
    real_sales_pos_code,
    dealer_registration_id,
    ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM contact_codes
  WHERE m_code IS NULL
),
with_next AS (
  SELECT
    cur.id                  AS cur_id,
    cur.rn                  AS cur_rn,
    cur.code                AS cur_code,
    cur.dealer_name         AS cur_dealer_name,
    cur.real_sales_pos      AS cur_real_sales_pos,
    cur.real_sales_pos_code AS cur_real_sales_pos_code,
    nxt.id                  AS next_id,
    nxt.code                AS next_code,
    nxt.dealer_name         AS next_dealer_name,
    -- 밀림 판정: 현재 real_sales_pos = 다음 행의 dealer_name
    (
      cur.real_sales_pos IS NOT NULL
      AND cur.real_sales_pos <> ''
      AND cur.real_sales_pos = nxt.dealer_name
    )                       AS is_shifted
  FROM ordered cur
  LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
)
SELECT
  cur_id,
  cur_code          AS 접점코드,
  cur_dealer_name   AS 정산지급처명,
  cur_real_sales_pos AS real_sales_pos_의심값,
  next_id           AS 다음행_id,
  next_code         AS 다음행_접점코드,
  next_dealer_name  AS 다음행_dealer_name,
  '← 이 값이 위 real_sales_pos와 일치' AS 비고
FROM with_next
WHERE is_shifted = true
ORDER BY cur_id;


-- ─────────────────────────────────────────────────────────────
-- 2. 전체 의심 건수 + 비율
-- ─────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT
    id,
    dealer_name,
    real_sales_pos,
    ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM contact_codes
  WHERE m_code IS NULL
),
shifted AS (
  SELECT
    COUNT(*) FILTER (
      WHERE cur.real_sales_pos IS NOT NULL
        AND cur.real_sales_pos <> ''
        AND cur.real_sales_pos = nxt.dealer_name
    ) AS shifted_cnt,
    COUNT(*) FILTER (
      WHERE cur.real_sales_pos IS NOT NULL
        AND cur.real_sales_pos <> ''
    ) AS total_with_pos
  FROM ordered cur
  LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
)
SELECT
  shifted_cnt                                AS 밀림의심_건수,
  total_with_pos                             AS real_sales_pos_있는_전체,
  ROUND(shifted_cnt::numeric / NULLIF(total_with_pos, 0) * 100, 1) AS 밀림비율_퍼센트
FROM shifted;


-- ─────────────────────────────────────────────────────────────
-- 3. 연속 구간 탐지 (Islands-and-Gaps)
--    → 밀림이 몇 개의 연속 구간으로 이루어져 있는지
-- ─────────────────────────────────────────────────────────────
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
    -- 연속 여부 판단: rn - ROW_NUMBER()는 연속된 그룹에서 동일한 값
    cur_rn - ROW_NUMBER() OVER (ORDER BY cur_rn) AS grp
  FROM shifted_flag
  WHERE is_shifted = 1
)
SELECT
  MIN(cur_id)   AS 구간시작_id,
  MAX(cur_id)   AS 구간종료_id,
  COUNT(*)      AS 연속_행수
FROM only_shifted
GROUP BY grp
ORDER BY 구간시작_id;


-- ─────────────────────────────────────────────────────────────
-- 4. 구간별 샘플 (구간 시작·끝 각 3행 표시)
--    → 어떤 데이터가 연속 밀림 구간에 속하는지 확인
-- ─────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT
    id, code, dealer_name, real_sales_pos,
    ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM contact_codes
  WHERE m_code IS NULL
),
shifted_flag AS (
  SELECT
    cur.id   AS cur_id,
    cur.rn   AS cur_rn,
    cur.code,
    cur.dealer_name,
    cur.real_sales_pos,
    nxt.dealer_name AS next_dealer_name,
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
    cur_id, cur_rn, code, dealer_name, real_sales_pos, next_dealer_name,
    cur_rn - ROW_NUMBER() OVER (ORDER BY cur_rn) AS grp
  FROM shifted_flag
  WHERE is_shifted = 1
),
with_grp_info AS (
  SELECT
    cur_id, cur_rn, code, dealer_name, real_sales_pos, next_dealer_name,
    grp,
    ROW_NUMBER() OVER (PARTITION BY grp ORDER BY cur_rn)      AS rn_in_grp,
    COUNT(*) OVER (PARTITION BY grp)                          AS grp_size
  FROM only_shifted
)
SELECT
  cur_id,
  code       AS 접점코드,
  dealer_name AS 정산지급처명,
  real_sales_pos AS 현재_real_sales_pos,
  next_dealer_name AS 다음행_dealer_name,
  grp_size   AS 구간크기
FROM with_grp_info
WHERE rn_in_grp <= 3 OR rn_in_grp >= grp_size - 2
ORDER BY grp, cur_rn;


-- ─────────────────────────────────────────────────────────────
-- 5. 정상 하부점 vs 밀림 의심 분류 (m_code IS NULL 전체)
-- ─────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT
    id, code, dealer_name, real_sales_pos,
    ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM contact_codes
  WHERE m_code IS NULL
)
SELECT
  CASE
    WHEN cur.real_sales_pos IS NULL OR cur.real_sales_pos = ''
      THEN 'A: real_sales_pos 없음 (정상)'
    WHEN cur.real_sales_pos = nxt.dealer_name
      THEN 'B: 밀림 의심 (= 다음 행 dealer_name)'
    WHEN EXISTS (
      SELECT 1 FROM dealer_registrations dr
      WHERE dr.business_name = cur.real_sales_pos
    )
      THEN 'C: DR 원장 일치 (정상 하부점 가능)'
    ELSE
      'D: real_sales_pos 있으나 DR 원장 불일치 (직접 입력 또는 기타)'
  END AS 분류,
  COUNT(*)                         AS 건수,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS 비율_퍼센트
FROM ordered cur
LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────
-- 6. 실제 수정 대상 ID 목록 (cleanup 스크립트 확인용)
-- ─────────────────────────────────────────────────────────────
WITH ordered AS (
  SELECT id, dealer_name, real_sales_pos,
         ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM contact_codes WHERE m_code IS NULL
),
with_next AS (
  SELECT cur.id,
         (cur.real_sales_pos IS NOT NULL AND cur.real_sales_pos <> ''
          AND cur.real_sales_pos = nxt.dealer_name) AS is_shifted
  FROM ordered cur
  LEFT JOIN ordered nxt ON nxt.rn = cur.rn + 1
)
SELECT array_agg(id ORDER BY id) AS 수정대상_id_목록,
       COUNT(*)                  AS 총건수
FROM with_next
WHERE is_shifted = true;
