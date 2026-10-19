DROP TABLE IF EXISTS paddle_key_deliveries;
DROP INDEX IF EXISTS idx_paddle_subscriptions_license;
DROP TABLE IF EXISTS paddle_subscriptions;
DELETE FROM schema_migrations WHERE version = 3;
