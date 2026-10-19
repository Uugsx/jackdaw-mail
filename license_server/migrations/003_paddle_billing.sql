CREATE TABLE IF NOT EXISTS paddle_subscriptions (
    subscription_id TEXT PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE SET NULL,
    plan TEXT NOT NULL,
    price_id TEXT NOT NULL,
    status TEXT NOT NULL,
    paid_through TEXT,
    canceled_at TEXT,
    paused_at TEXT,
    past_due_since TEXT,
    last_event_at TEXT,
    first_transaction_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paddle_subscriptions_license
    ON paddle_subscriptions(license_id);

CREATE TABLE IF NOT EXISTS paddle_key_deliveries (
    transaction_id TEXT PRIMARY KEY,
    license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    claim_hash TEXT NOT NULL,
    sealed_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT
);
