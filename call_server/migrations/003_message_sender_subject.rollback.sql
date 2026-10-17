-- Откат 003_message_sender_subject.sql. Нужен SQLite 3.35+ (DROP COLUMN). Сообщения в очереди сохраняются.
DROP INDEX IF EXISTS idx_chat_messages_sender_subject;
ALTER TABLE chat_messages DROP COLUMN sender_subject;
DELETE FROM schema_migrations WHERE version = 3;
