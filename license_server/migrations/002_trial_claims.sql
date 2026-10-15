CREATE TABLE IF NOT EXISTS trial_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_hash TEXT NOT NULL UNIQUE,
    device_prefix TEXT NOT NULL,
    device_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_claims_status_expires
    ON trial_claims(status, expires_at);
