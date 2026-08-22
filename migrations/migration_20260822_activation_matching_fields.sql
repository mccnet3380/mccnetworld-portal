-- ============================================================
-- migration_20260822_activation_matching_fields.sql
-- MCC_ACTIVATION_UPLOAD_MCODE_MATCHING_ENGINE_1
--
-- activation_records 테이블에 M코드 기반 매칭 필드 추가
--
-- 실행 방법 (로컬):
--   $env:DATABASE_URL = (Select-String -Path ".env" -Pattern "^DATABASE_URL=").Line -replace "^DATABASE_URL=", ""
--   psql "$env:DATABASE_URL" -f ".\migrations\migration_20260822_activation_matching_fields.sql"
--
-- 실행 방법 (운영):
--   psql "$DATABASE_URL" -f migration_20260822_activation_matching_fields.sql
--
-- 주의:
--   - 기존 데이터 삭제 없음
--   - mcc_code 기존 데이터 변경 없음 (신규 업로드부터 정규화 적용)
--   - 모든 컬럼 nullable (기존 행 영향 없음)
-- ============================================================

BEGIN;

-- contact_code_id: 매칭된 contact_codes.id
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS contact_code_id integer;

-- code_name: Excel L열 코드명 (업로드 원본 보존)
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS code_name varchar(200);

-- real_sales_pos: 매칭된 contact_codes.real_sales_pos (실판매점명)
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS real_sales_pos varchar(255);

-- sub_dealer_name: 매칭된 contact_codes.sub_dealer_name (하부점명)
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS sub_dealer_name varchar(255);

-- matching_status: matched / review_required / unmatched
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS matching_status varchar(20);

-- matching_basis: 매칭 근거 레이블
ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS matching_basis varchar(100);

-- 인덱스: matching_status 기준 필터링 성능
CREATE INDEX IF NOT EXISTS activation_records_matching_status_idx
  ON activation_records (matching_status);

COMMIT;
