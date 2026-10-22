-- Почтовые ящики, подключённые на устройствах лицензии (клиент сообщает их при входе).
-- Одну лицензию компании ставят разные сотрудники: подтверждение адреса, чей ящик подключён
-- на другом устройстве, этому устройству не засчитывается, даже если оно хранит старое подтверждение.
CREATE TABLE IF NOT EXISTS device_mailboxes (
    subject TEXT NOT NULL,
    device_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (subject, device_hash, email)
);
CREATE INDEX IF NOT EXISTS idx_device_mailboxes_subject_email ON device_mailboxes(subject, email);
