CREATE TABLE IF NOT EXISTS paddle_key_emails (
    transaction_id TEXT PRIMARY KEY,
    license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    customer_id TEXT,
    sealed_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_paddle_key_emails_due
    ON paddle_key_emails(status, next_attempt_at);
