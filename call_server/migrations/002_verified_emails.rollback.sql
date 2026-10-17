-- Откат 002_verified_emails.sql. Подтверждения на устройствах остаются действительными.
DROP TABLE IF EXISTS verified_emails;
DELETE FROM schema_migrations WHERE version = 2;
