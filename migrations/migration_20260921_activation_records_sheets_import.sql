-- ============================================================
-- migration_20260921_activation_records_sheets_import.sql
-- MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
--
-- activation_records에 Google Sheets(개통처리부) import 전용 필드 추가.
--
-- 실행 방법 (로컬):
--   $env:DATABASE_URL = (Select-String -Path ".env" -Pattern "^DATABASE_URL=").Line -replace "^DATABASE_URL=", ""
--   psql "$env:DATABASE_URL" -f ".\migrations\migration_20260921_activation_records_sheets_import.sql"
--
-- 실행 방법 (운영):
--   psql "$DATABASE_URL" -f migration_20260921_activation_records_sheets_import.sql
--
-- 주의:
--   - 전부 nullable 컬럼 추가(ADD COLUMN IF NOT EXISTS) — 기존 630건 등 기존 행 영향 없음
--   - dedupe_key는 nullable이라 unique index가 있어도 기존 NULL 행끼리는 충돌하지 않음
--     (Postgres unique index는 NULL을 서로 다른 값으로 취급)
--   - 재실행해도 안전(idempotent), destructive 요소 없음
-- ============================================================

BEGIN;

ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS source_spreadsheet_id varchar(100);

ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS source_sheet_name varchar(100);

ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS source_month varchar(7);

ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS dedupe_key varchar(300);

CREATE UNIQUE INDEX IF NOT EXISTS activation_records_dedupe_key_uidx
  ON activation_records (dedupe_key);

COMMIT;
