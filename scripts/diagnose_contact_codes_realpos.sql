-- ============================================================
-- contact_codes 실제판매점명 이상 데이터 진단 SQL
-- MCC_DEALER_MCODE_MASTER_UPLOAD_IMPORT_1
--
-- 실행 방법:
--   psql $DATABASE_URL_DEV -f scripts/diagnose_contact_codes_realpos.sql
--   또는 psql -c "..." 직접 실행
--
-- 주의: 읽기 전용 쿼리입니다. 데이터 변경 없음.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. M코드 유무별 전체 현황 요약
-- ─────────────────────────────────────────────────────────────
SELECT
  CASE WHEN m_code IS NULL THEN '기존 데이터 (m_code 없음)' ELSE 'M코드 업로드 데이터' END AS 구분,
  COUNT(*)                                                                           AS 전체건수,
  COUNT(*) FILTER (WHERE is_active = true)                                           AS 활성,
  COUNT(*) FILTER (WHERE real_sales_pos IS NOT NULL AND real_sales_pos <> '')        AS 실판매점명있음,
  COUNT(*) FILTER (
    WHERE real_sales_pos IS NOT NULL
      AND real_sales_pos <> ''
      AND dealer_name IS DISTINCT FROM real_sales_pos
  )                                                                                  AS dealer명≠실판매점명,
  COUNT(*) FILTER (WHERE dealer_registration_id IS NULL)                             AS 정산지급처미연결
FROM contact_codes
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────
-- 2. 기존 데이터(m_code IS NULL)에서 dealer_name ≠ real_sales_pos 전체 목록
--    → 정상 하부점 구조 OR 입력 오류 후보
-- ─────────────────────────────────────────────────────────────
SELECT
  cc.id,
  cc.code                   AS 접점코드,
  cc.dealer_name            AS 정산지급처명_저장,
  dr.dealer_code            AS 정산지급처코드,
  dr.business_name          AS 정산지급처명_원장,
  cc.real_sales_pos         AS 실제판매점명,
  -- 실판매점명이 dealer_registrations에 존재하는지 확인
  CASE
    WHEN EXISTS (SELECT 1 FROM dealer_registrations dr2 WHERE dr2.business_name = cc.real_sales_pos)
    THEN '원장에 있음(정상 하부점 가능)'
    ELSE '원장에 없음(직접입력 또는 오류)'
  END                       AS 실판매점명_원장확인,
  cc.carrier,
  cc.channel,
  cc.is_active              AS 활성,
  cc.created_at             AS 생성일시
FROM contact_codes cc
LEFT JOIN dealer_registrations dr ON dr.id = cc.dealer_registration_id
WHERE cc.m_code IS NULL
  AND cc.real_sales_pos IS NOT NULL
  AND cc.real_sales_pos <> ''
  AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
ORDER BY dr.dealer_code NULLS LAST, cc.code;


-- ─────────────────────────────────────────────────────────────
-- 3. Row-shift 의심 후보
--    기준: real_sales_pos가 동일 dealer_code 그룹 내 다른 행의 code값과 유사하거나,
--    dealer_name(정산지급처명)이 실제 DR 원장과 불일치하는 케이스
-- ─────────────────────────────────────────────────────────────

-- 3-1. dealer_name이 DR 원장 business_name과 다른 케이스 (저장 당시 오류 가능)
SELECT
  cc.id,
  cc.code                       AS 접점코드,
  cc.dealer_name                AS dealer_name_저장,
  dr.business_name              AS dr_business_name_현재,
  cc.real_sales_pos             AS real_sales_pos,
  cc.carrier,
  cc.created_at
FROM contact_codes cc
JOIN dealer_registrations dr ON dr.id = cc.dealer_registration_id
WHERE cc.m_code IS NULL
  AND cc.dealer_name IS DISTINCT FROM dr.business_name
ORDER BY dr.dealer_code, cc.code;


-- 3-2. 정산지급처 연결 없는(dealer_registration_id IS NULL) 기존 데이터
SELECT
  cc.id,
  cc.code        AS 접점코드,
  cc.dealer_name AS 저장된판매점명,
  cc.real_sales_pos,
  cc.carrier,
  cc.is_active   AS 활성,
  cc.created_at
FROM contact_codes cc
WHERE cc.m_code IS NULL
  AND cc.dealer_registration_id IS NULL
ORDER BY cc.dealer_name, cc.code;


-- ─────────────────────────────────────────────────────────────
-- 4. 정상 하부점 구조 확인
--    real_sales_pos가 dealer_registrations에 실제로 존재하는 케이스
-- ─────────────────────────────────────────────────────────────
SELECT
  cc.code                       AS 접점코드,
  dr_parent.dealer_code         AS 정산지급처코드,
  dr_parent.business_name       AS 정산지급처명,
  cc.real_sales_pos             AS 실제판매점명,
  dr_sub.dealer_code            AS 실제판매점_DR코드,
  cc.channel,
  cc.created_at
FROM contact_codes cc
JOIN dealer_registrations dr_parent ON dr_parent.id = cc.dealer_registration_id
JOIN dealer_registrations dr_sub    ON dr_sub.business_name = cc.real_sales_pos
WHERE cc.m_code IS NULL
ORDER BY dr_parent.dealer_code, cc.code;


-- ─────────────────────────────────────────────────────────────
-- 5. 판매점 그룹별 하부점 현황 요약
--    (정산지급처 기준으로 grouping, 하부점 포함 접점코드 수 집계)
-- ─────────────────────────────────────────────────────────────
SELECT
  dr.dealer_code                                                           AS 정산지급처코드,
  dr.business_name                                                         AS 정산지급처명,
  COUNT(cc.id)                                                             AS 전체접점코드수,
  COUNT(cc.id) FILTER (WHERE cc.real_sales_pos IS NOT NULL
                          AND cc.real_sales_pos <> ''
                          AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
                          AND cc.m_code IS NULL)                          AS 기존하부점코드수,
  COUNT(cc.id) FILTER (WHERE cc.m_code IS NOT NULL)                       AS M코드업로드코드수,
  COUNT(DISTINCT cc.real_sales_pos) FILTER (
    WHERE cc.real_sales_pos IS NOT NULL AND cc.real_sales_pos <> ''
      AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
  )                                                                        AS 고유실판매점수
FROM dealer_registrations dr
JOIN contact_codes cc ON cc.dealer_registration_id = dr.id
WHERE cc.is_active = true
GROUP BY dr.id, dr.dealer_code, dr.business_name
HAVING COUNT(cc.id) FILTER (
  WHERE cc.real_sales_pos IS NOT NULL AND cc.real_sales_pos <> ''
    AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
) > 0
ORDER BY 기존하부점코드수 DESC, dr.dealer_code;


-- ─────────────────────────────────────────────────────────────
-- 6. K엠62722 구체 사례 확인 (단일 코드 점검)
-- ─────────────────────────────────────────────────────────────
SELECT
  cc.id,
  cc.code,
  cc.dealer_name,
  cc.real_sales_pos,
  cc.real_sales_pos_code,
  cc.carrier,
  cc.channel,
  cc.m_code,
  cc.dealer_registration_id,
  dr.dealer_code,
  dr.business_name    AS dr_business_name,
  dr.m_code           AS dr_m_code,
  cc.is_active,
  cc.created_at,
  cc.updated_at
FROM contact_codes cc
LEFT JOIN dealer_registrations dr ON dr.id = cc.dealer_registration_id
WHERE cc.code = 'K엠62722';


-- ─────────────────────────────────────────────────────────────
-- 7. 수정 후보 요약: 실제 문제로 보이는 케이스 분류
-- ─────────────────────────────────────────────────────────────
SELECT
  category                      AS 분류,
  COUNT(*)                      AS 건수,
  string_agg(code, ', ' ORDER BY code) FILTER (WHERE rn <= 5) AS 예시코드_최대5개
FROM (
  SELECT
    cc.code,
    ROW_NUMBER() OVER (PARTITION BY
      CASE
        WHEN cc.dealer_registration_id IS NULL THEN 'A'
        WHEN cc.dealer_name IS DISTINCT FROM dr.business_name THEN 'B'
        WHEN cc.real_sales_pos IS NOT NULL
          AND cc.real_sales_pos <> ''
          AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
          AND EXISTS (SELECT 1 FROM dealer_registrations dr2 WHERE dr2.business_name = cc.real_sales_pos)
        THEN 'C'
        WHEN cc.real_sales_pos IS NOT NULL
          AND cc.real_sales_pos <> ''
          AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
          AND NOT EXISTS (SELECT 1 FROM dealer_registrations dr2 WHERE dr2.business_name = cc.real_sales_pos)
        THEN 'D'
        ELSE 'E'
      END
    ) AS rn,
    CASE
      WHEN cc.dealer_registration_id IS NULL
        THEN 'A: 정산지급처 미연결 (수동 확인 필요)'
      WHEN cc.dealer_name IS DISTINCT FROM dr.business_name
        THEN 'B: dealer_name ≠ DR.business_name (저장 당시 명칭 불일치)'
      WHEN cc.real_sales_pos IS NOT NULL
        AND cc.real_sales_pos <> ''
        AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
        AND EXISTS (SELECT 1 FROM dealer_registrations dr2 WHERE dr2.business_name = cc.real_sales_pos)
        THEN 'C: 정상 하부점 구조 (real_sales_pos가 DR 원장에 있음) — 수정 불필요'
      WHEN cc.real_sales_pos IS NOT NULL
        AND cc.real_sales_pos <> ''
        AND cc.dealer_name IS DISTINCT FROM cc.real_sales_pos
        AND NOT EXISTS (SELECT 1 FROM dealer_registrations dr2 WHERE dr2.business_name = cc.real_sales_pos)
        THEN 'D: real_sales_pos 원장 미등록 (직접 입력 또는 오류 후보)'
      ELSE 'E: 정상 (dealer_name = real_sales_pos 또는 real_sales_pos 없음)'
    END AS category
  FROM contact_codes cc
  LEFT JOIN dealer_registrations dr ON dr.id = cc.dealer_registration_id
  WHERE cc.m_code IS NULL
) sub
GROUP BY category
ORDER BY category;
