BEGIN;

ALTER TABLE dealer_registrations
  ALTER COLUMN contact_email DROP NOT NULL;

COMMIT;
