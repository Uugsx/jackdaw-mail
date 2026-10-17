-- Подтверждённые адреса лицензии: подтверждение на одном устройстве действует на всех её устройствах.
-- subject — `license:<id>` или `trial:<хеш устройства>`, как в Credential.subject.
CREATE TABLE IF NOT EXISTS verified_emails (
    subject TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (subject, email)
);
CREATE INDEX IF NOT EXISTS idx_verified_emails_expires ON verified_emails(expires_at);
