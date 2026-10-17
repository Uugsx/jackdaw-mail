-- Лицензия/пробный период отправителя у хранимых сообщений: квота недоставленных сообщений на отправителя.
-- subject — `license:<id>` или `trial:<хеш устройства>`, как в Credential.subject. У старых сообщений NULL.
ALTER TABLE chat_messages ADD COLUMN sender_subject TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_subject ON chat_messages(sender_subject);
