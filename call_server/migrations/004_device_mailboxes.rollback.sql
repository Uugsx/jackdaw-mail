-- Откат 004_device_mailboxes.sql. Чужие адреса снова принимаются по сохранённым подтверждениям.
DROP TABLE IF EXISTS device_mailboxes;
DELETE FROM schema_migrations WHERE version = 4;
