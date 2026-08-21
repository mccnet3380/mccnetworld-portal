-- safe migration: nationality_type columns

ALTER TABLE activation_records
  ADD COLUMN IF NOT EXISTS nationality_type VARCHAR(20);

ALTER TABLE policy_rows
  ADD COLUMN IF NOT EXISTS nationality_type VARCHAR(20);

ALTER TABLE activation_records
  ALTER COLUMN nationality_type SET DEFAULT U&'\B0B4\AD6D\C778';

UPDATE activation_records
SET nationality_type = U&'\B0B4\AD6D\C778'
WHERE nationality_type IS NULL OR TRIM(nationality_type) = '';

CREATE INDEX IF NOT EXISTS activation_records_nationality_type_idx
  ON activation_records(nationality_type);

CREATE INDEX IF NOT EXISTS policy_rows_nationality_type_idx
  ON policy_rows(nationality_type);
