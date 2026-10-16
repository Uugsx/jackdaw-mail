-- Откат 001_chat.sql. Файлы в каталоге blob удаляются отдельно: rm -rf /var/lib/jackdaw-calls/blobs
DROP TABLE IF EXISTS chat_blobs;
DROP TABLE IF EXISTS chat_deliveries;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_device_emails;
DROP TABLE IF EXISTS chat_devices;
DELETE FROM schema_migrations WHERE version = 1;
