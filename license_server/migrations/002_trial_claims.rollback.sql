DROP INDEX IF EXISTS idx_trial_claims_status_expires;
DROP TABLE IF EXISTS trial_claims;
DELETE FROM schema_migrations WHERE version = 2;
