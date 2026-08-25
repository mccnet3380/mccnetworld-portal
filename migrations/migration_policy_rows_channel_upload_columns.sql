-- MCC_POLICY_CHANNEL_REUPLOAD_IMPLEMENT_1
-- policy_rows 채널별 재업로드 추적 컬럼 추가
-- 운영 DB 반영 시: psql 또는 DB 클라이언트에서 직접 실행
-- npm run db:push 금지

ALTER TABLE policy_rows
  ADD COLUMN IF NOT EXISTS policy_term        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS effective_basis    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS source_sheet_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS source_file_name   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_revision        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS uploaded_batch_id  VARCHAR(50);

CREATE INDEX IF NOT EXISTS policy_rows_version_channel_term_idx
  ON policy_rows (policy_version_id, channel, policy_term);
