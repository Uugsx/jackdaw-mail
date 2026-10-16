-- Чат Jackdaw ↔ Jackdaw: открытые ключи устройств, зашифрованная очередь доставки, зашифрованные файлы.
CREATE TABLE IF NOT EXISTS chat_devices (
    device_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    public_key BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_device_emails (
    device_id TEXT NOT NULL REFERENCES chat_devices(device_id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    PRIMARY KEY (device_id, email)
);
CREATE INDEX IF NOT EXISTS idx_chat_device_emails_email ON chat_device_emails(email);

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id TEXT PRIMARY KEY,
    sender_email TEXT NOT NULL,
    sender_device TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

CREATE TABLE IF NOT EXISTS chat_deliveries (
    message_id TEXT NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    wrapped_key BLOB NOT NULL,
    PRIMARY KEY (message_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_deliveries_device ON chat_deliveries(device_id);

CREATE TABLE IF NOT EXISTS chat_blobs (
    blob_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    uploader_device TEXT NOT NULL,
    size INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_blobs_subject ON chat_blobs(subject);
CREATE INDEX IF NOT EXISTS idx_chat_blobs_created ON chat_blobs(created_at);
