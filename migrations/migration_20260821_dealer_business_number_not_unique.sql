BEGIN;

ALTER TABLE dealer_registrations
  DROP CONSTRAINT IF EXISTS dealer_registrations_business_number_unique;

DROP INDEX IF EXISTS dealer_registrations_business_number_unique;

COMMIT;
