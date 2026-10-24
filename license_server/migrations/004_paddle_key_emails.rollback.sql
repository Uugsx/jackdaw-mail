DROP INDEX IF EXISTS idx_paddle_key_emails_due;
DROP TABLE IF EXISTS paddle_key_emails;
DELETE FROM schema_migrations WHERE version = 4;
