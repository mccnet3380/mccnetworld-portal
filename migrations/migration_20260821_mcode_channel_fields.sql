BEGIN;

ALTER TABLE dealer_registrations
  ADD COLUMN IF NOT EXISTS m_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS kp_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS region_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS source_dealer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sub_dealer_name VARCHAR(255);

ALTER TABLE contact_codes
  ADD COLUMN IF NOT EXISTS m_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS channel VARCHAR(100),
  ADD COLUMN IF NOT EXISTS kp_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS region_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS alias_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sub_dealer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_dealer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS code_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS dealer_registrations_m_code_idx
  ON dealer_registrations(m_code);

CREATE INDEX IF NOT EXISTS dealer_registrations_kp_number_idx
  ON dealer_registrations(kp_number);

CREATE INDEX IF NOT EXISTS dealer_registrations_m_code_kp_sub_idx
  ON dealer_registrations(m_code, kp_number, sub_dealer_name);

CREATE INDEX IF NOT EXISTS contact_codes_m_code_idx
  ON contact_codes(m_code);

CREATE INDEX IF NOT EXISTS contact_codes_channel_idx
  ON contact_codes(channel);

CREATE INDEX IF NOT EXISTS contact_codes_m_code_channel_idx
  ON contact_codes(m_code, channel);

CREATE INDEX IF NOT EXISTS contact_codes_m_code_code_idx
  ON contact_codes(m_code, code);

COMMIT;
