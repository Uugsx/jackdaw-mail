"""Сквозь-зашифрованный чат Jackdaw Mail ↔ Jackdaw Mail поверх соединения сигналинга.

Сервер видит только:
- открытые ключи устройств (X25519) и к каким подтверждённым адресам они привязаны;
- от кого и каким устройствам адресовано сообщение;
- шифротекст, который хранится до доставки, но не дольше 30 дней;
- зашифрованные файлы (blob) без имени и типа, не дольше 30 дней.

Шифрование и проверка ключей — на клиенте (app/logic/Chat/Jackdaw/JackdawChatCrypto.ts).
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import functools
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from calls import Blocking, CallError, Peer, Steps, normalize_email


CHAT_DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
MESSAGE_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
BLOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
X25519_KEY_BYTES = 32
MAX_CIPHERTEXT_BYTES = 96 * 1024
MAX_WRAPPED_KEY_BYTES = 128
MAX_RECIPIENTS = 100
MAX_TARGET_DEVICES = 500
MAX_DEVICES_PER_EMAIL = 10
MAX_KEY_FETCH_EMAILS = 100
PENDING_BATCH = 200
MAX_PENDING_PER_DEVICE = 5000
# Недоставленные сообщения одной лицензии/пробного периода: без лимита отправитель заполнит диск сервера.
MAX_STORED_MESSAGES_PER_SUBJECT = 20000
MESSAGE_TTL_SECONDS = 30 * 24 * 60 * 60
DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60
BLOB_TTL_SECONDS = 30 * 24 * 60 * 60
BLOB_CHUNK_BYTES = 64 * 1024
MAX_BLOB_BYTES = 25 * 1024 * 1024
MAX_BLOB_CHUNKS = MAX_BLOB_BYTES // BLOB_CHUNK_BYTES + 1
BLOB_QUOTA_BYTES = 1024 * 1024 * 1024
CLEANUP_INTERVAL_SECONDS = 60 * 60
# Незавершённая загрузка файла держит резерв квоты; брошенная загрузка удаляется через час.
INCOMPLETE_BLOB_TTL_SECONDS = 60 * 60
MIGRATIONS = ((1, "001_chat.sql"), (2, "002_verified_emails.sql"), (3, "003_message_sender_subject.sql"))


def decode_b64(value: Any, max_bytes: int, code: str = "invalid_payload") -> bytes:
    if not isinstance(value, str) or len(value) > (max_bytes * 4) // 3 + 8:
        raise CallError(code, "Некорректные данные сообщения.")
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CallError(code, "Некорректные данные сообщения.") from exc
    if len(data) > max_bytes:
        raise CallError(code, "Сообщение слишком большое.")
    return data


def encode_b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def validate_chat_device_id(value: Any) -> str:
    if not isinstance(value, str) or not CHAT_DEVICE_ID_RE.fullmatch(value):
        raise CallError("invalid_device", "Некорректный идентификатор устройства чата.")
    return value


class ChatStore:
    """Собственная база сервиса чата. Схема меняется только миграциями из migrations/."""

    def __init__(self, database_path: Path, blob_dir: Path, clock: Callable[[], float] = time.time):
        self.database_path = database_path
        self.blob_dir = blob_dir
        self._clock = clock
        self._lock = threading.Lock()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.blob_dir.mkdir(parents=True, exist_ok=True)
        self._last_cleanup = 0.0
        self._migrate()

    def now(self) -> float:
        return self._clock()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @contextlib.contextmanager
    def _transaction(self) -> Iterable[sqlite3.Connection]:
        with self._lock, contextlib.closing(self._connect()) as connection:
            with connection:
                yield connection

    def _migrate(self) -> None:
        with self._transaction() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
            applied = {row["version"] for row in connection.execute("SELECT version FROM schema_migrations")}
            for version, filename in MIGRATIONS:
                if version in applied:
                    continue
                path = Path(__file__).with_name("migrations") / filename
                try:
                    sql = path.read_text(encoding="utf-8")
                except OSError as exc:
                    raise RuntimeError(f"Миграция базы чата недоступна: {path}") from exc
                connection.executescript(sql)
                connection.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", (version, int(self._clock())))

    # --- устройства ---------------------------------------------------------

    def register_device(self, device_id: str, subject: str, device_hash: str, public_key: bytes, emails: Iterable[str]) -> None:
        now = int(self._clock())
        emails = sorted(set(emails))
        with self._transaction() as connection:
            existing = connection.execute("SELECT subject, device_hash, public_key FROM chat_devices WHERE device_id = ?", (device_id,)).fetchone()
            if existing is not None and (existing["subject"] != subject or existing["device_hash"] != device_hash):
                # Идентификатор чужого устройства нельзя занять: иначе можно перехватить его очередь.
                raise CallError("invalid_device", "Это устройство чата принадлежит другой лицензии.")
            if existing is not None and bytes(existing["public_key"]) != public_key:
                # Смена ключа = новое устройство; старая очередь зашифрована старым ключом и бесполезна.
                connection.execute("DELETE FROM chat_deliveries WHERE device_id = ?", (device_id,))
            for email in emails:
                count = connection.execute(
                    "SELECT COUNT(*) AS count FROM chat_device_emails WHERE email = ? AND device_id != ?",
                    (email, device_id),
                ).fetchone()["count"]
                if count >= MAX_DEVICES_PER_EMAIL:
                    self._evict_oldest_device(connection, email)
            connection.execute(
                """
                INSERT INTO chat_devices (device_id, subject, device_hash, public_key, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET public_key = excluded.public_key, last_seen_at = excluded.last_seen_at
                """,
                (device_id, subject, device_hash, public_key, now, now),
            )
            connection.execute("DELETE FROM chat_device_emails WHERE device_id = ?", (device_id,))
            connection.executemany(
                "INSERT INTO chat_device_emails (device_id, email) VALUES (?, ?)",
                [(device_id, email) for email in emails],
            )

    @staticmethod
    def _evict_oldest_device(connection: sqlite3.Connection, email: str) -> None:
        row = connection.execute(
            """
            SELECT d.device_id FROM chat_devices d JOIN chat_device_emails e ON e.device_id = d.device_id
            WHERE e.email = ? ORDER BY d.last_seen_at ASC LIMIT 1
            """,
            (email,),
        ).fetchone()
        if row is not None:
            connection.execute("DELETE FROM chat_device_emails WHERE device_id = ? AND email = ?", (row["device_id"], email))

    def devices_for(self, emails: Iterable[str]) -> dict[str, list[dict[str, str]]]:
        emails = list(dict.fromkeys(emails))
        result: dict[str, list[dict[str, str]]] = {email: [] for email in emails}
        if not emails:
            return result
        since = int(self._clock()) - DEVICE_TTL_SECONDS
        placeholders = ",".join("?" for _ in emails)
        with contextlib.closing(self._connect()) as connection:
            rows = connection.execute(
                f"""
                SELECT e.email, d.device_id, d.public_key FROM chat_device_emails e
                JOIN chat_devices d ON d.device_id = e.device_id
                WHERE e.email IN ({placeholders}) AND d.last_seen_at >= ?
                ORDER BY d.created_at
                """,
                (*emails, since),
            ).fetchall()
        for row in rows:
            result[row["email"]].append({"deviceId": row["device_id"], "publicKey": encode_b64(bytes(row["public_key"]))})
        return result

    def device_emails(self, device_ids: Iterable[str]) -> dict[str, set[str]]:
        device_ids = list(dict.fromkeys(device_ids))
        result: dict[str, set[str]] = {}
        if not device_ids:
            return result
        placeholders = ",".join("?" for _ in device_ids)
        with contextlib.closing(self._connect()) as connection:
            for row in connection.execute(
                f"SELECT device_id, email FROM chat_device_emails WHERE device_id IN ({placeholders})", device_ids,
            ):
                result.setdefault(row["device_id"], set()).add(row["email"])
        return result

    # --- сообщения ------------------------------------------------------------

    def store_message(self, message_id: str, sender_email: str, sender_device: str, ciphertext: bytes, keys: dict[str, bytes],
                      sender_subject: str | None = None) -> bool:
        """@returns False, если сообщение с этим id уже было (повторная отправка после обрыва).

        `sender_subject` — лицензия отправителя: по ней считается квота недоставленных сообщений.
        """
        now = int(self._clock())
        with self._transaction() as connection:
            if connection.execute("SELECT 1 FROM chat_messages WHERE message_id = ?", (message_id,)).fetchone():
                return False
            if sender_subject is not None:
                stored = connection.execute(
                    "SELECT COUNT(*) AS count FROM chat_messages WHERE sender_subject = ?", (sender_subject,),
                ).fetchone()["count"]
                if stored >= MAX_STORED_MESSAGES_PER_SUBJECT:
                    raise CallError("quota_exceeded", "Слишком много недоставленных сообщений. "
                                                      "Они удаляются после доставки или через 30 дней.")
            connection.execute(
                "INSERT INTO chat_messages (message_id, sender_email, sender_device, ciphertext, created_at, sender_subject) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (message_id, sender_email, sender_device, ciphertext, now, sender_subject),
            )
            for device_id, wrapped in keys.items():
                pending = connection.execute("SELECT COUNT(*) AS count FROM chat_deliveries WHERE device_id = ?", (device_id,)).fetchone()["count"]
                if pending >= MAX_PENDING_PER_DEVICE:
                    continue
                connection.execute(
                    "INSERT INTO chat_deliveries (message_id, device_id, wrapped_key) VALUES (?, ?, ?)",
                    (message_id, device_id, wrapped),
                )
        return True

    def pending_for(self, device_id: str, limit: int = PENDING_BATCH) -> tuple[list[dict[str, Any]], int]:
        with contextlib.closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT m.message_id, m.sender_email, m.sender_device, m.ciphertext, m.created_at, d.wrapped_key
                FROM chat_deliveries d JOIN chat_messages m ON m.message_id = d.message_id
                WHERE d.device_id = ? ORDER BY m.created_at, m.message_id LIMIT ?
                """,
                (device_id, limit),
            ).fetchall()
            total = connection.execute("SELECT COUNT(*) AS count FROM chat_deliveries WHERE device_id = ?", (device_id,)).fetchone()["count"]
        return [self.envelope(row) for row in rows], max(0, total - len(rows))

    @staticmethod
    def envelope(row: Any) -> dict[str, Any]:
        return {
            "type": "chat-message",
            "messageId": row["message_id"],
            "from": row["sender_email"],
            "fromDevice": row["sender_device"],
            "ciphertext": encode_b64(bytes(row["ciphertext"])),
            "key": encode_b64(bytes(row["wrapped_key"])),
            "sentAt": int(row["created_at"]) * 1000,
        }

    def acknowledge(self, device_id: str, message_ids: Iterable[str]) -> None:
        message_ids = list(message_ids)
        if not message_ids:
            return
        placeholders = ",".join("?" for _ in message_ids)
        with self._transaction() as connection:
            connection.execute(
                f"DELETE FROM chat_deliveries WHERE device_id = ? AND message_id IN ({placeholders})",
                (device_id, *message_ids),
            )
            connection.execute(
                f"""
                DELETE FROM chat_messages WHERE message_id IN ({placeholders})
                AND NOT EXISTS (SELECT 1 FROM chat_deliveries d WHERE d.message_id = chat_messages.message_id)
                """,
                message_ids,
            )

    # --- файлы ---------------------------------------------------------------

    def _blob_path(self, blob_id: str, partial: bool = False) -> Path:
        return self.blob_dir / (f"{blob_id}.part" if partial else blob_id)

    def put_blob_chunk(self, blob_id: str, subject: str, device_id: str, index: int, total: int, data: bytes) -> bool:
        """Принимает части строго по порядку. @returns True, когда файл собран."""
        if total < 1 or total > MAX_BLOB_CHUNKS or index < 0 or index >= total:
            raise CallError("invalid_blob", "Некорректная часть файла.")
        if index < total - 1 and len(data) != BLOB_CHUNK_BYTES or not data:
            raise CallError("invalid_blob", "Некорректная часть файла.")
        with self._transaction() as connection:
            row = connection.execute("SELECT uploader_device, size, complete, chunks FROM chat_blobs WHERE blob_id = ?", (blob_id,)).fetchone()
            if index == 0:
                if row is not None:
                    raise CallError("invalid_blob", "Файл с таким идентификатором уже есть.")
                # Незавершённая загрузка занимает квоту полным заявленным размером с первой части:
                # иначе параллельные загрузки обходят квоту, пока ни одна не закончена.
                used = connection.execute(
                    """SELECT COALESCE(SUM(CASE WHEN complete THEN size ELSE MIN(chunks * ?, ?) END), 0) AS used
                       FROM chat_blobs WHERE subject = ?""",
                    (BLOB_CHUNK_BYTES, MAX_BLOB_BYTES, subject),
                ).fetchone()["used"]
                if used + min(total * BLOB_CHUNK_BYTES, MAX_BLOB_BYTES) > BLOB_QUOTA_BYTES:
                    raise CallError("quota_exceeded", "Превышен объём файлов. Старые файлы удаляются через 30 дней.")
                connection.execute(
                    "INSERT INTO chat_blobs (blob_id, subject, uploader_device, size, chunks, complete, created_at) VALUES (?, ?, ?, 0, ?, 0, ?)",
                    (blob_id, subject, device_id, total, int(self._clock())),
                )
                self._blob_path(blob_id, partial=True).write_bytes(b"")
            elif row is None or row["uploader_device"] != device_id or row["complete"] or row["chunks"] != total \
                    or row["size"] != index * BLOB_CHUNK_BYTES:
                raise CallError("invalid_blob", "Части файла пришли не по порядку.")
            with self._blob_path(blob_id, partial=True).open("ab") as file:
                file.write(data)
            size = index * BLOB_CHUNK_BYTES + len(data)
            complete = index == total - 1
            connection.execute("UPDATE chat_blobs SET size = ?, complete = ? WHERE blob_id = ?", (size, 1 if complete else 0, blob_id))
            if complete:
                os.replace(self._blob_path(blob_id, partial=True), self._blob_path(blob_id))
        return complete

    def get_blob_chunk(self, blob_id: str, index: int) -> tuple[bytes, int]:
        with contextlib.closing(self._connect()) as connection:
            row = connection.execute("SELECT size, chunks, complete FROM chat_blobs WHERE blob_id = ?", (blob_id,)).fetchone()
        if row is None or not row["complete"] or index < 0 or index >= row["chunks"]:
            raise CallError("blob_not_found", "Файл не найден или срок его хранения истёк.")
        with self._blob_path(blob_id).open("rb") as file:
            file.seek(index * BLOB_CHUNK_BYTES)
            return file.read(BLOB_CHUNK_BYTES), int(row["chunks"])

    # --- подтверждённые адреса лицензии ------------------------------------------

    def remember_verified_email(self, subject: str, email: str, expires_at: int) -> None:
        """Запоминает подтверждение, чтобы другие устройства той же лицензии получили его при входе."""
        with self._transaction() as connection:
            connection.execute(
                """INSERT INTO verified_emails (subject, email, expires_at, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(subject, email) DO UPDATE SET
                     expires_at = MAX(expires_at, excluded.expires_at), updated_at = excluded.updated_at""",
                (subject, email, int(expires_at), int(self._clock())),
            )

    def verified_emails(self, subject: str) -> list[tuple[str, int]]:
        """Действующие подтверждения лицензии: (email, срок действия)."""
        with contextlib.closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT email, expires_at FROM verified_emails WHERE subject = ? AND expires_at > ? ORDER BY email",
                (subject, int(self._clock())),
            ).fetchall()
        return [(row["email"], int(row["expires_at"])) for row in rows]

    # --- очистка --------------------------------------------------------------

    def cleanup(self, force: bool = False) -> None:
        now = self._clock()
        if not force and now - self._last_cleanup < CLEANUP_INTERVAL_SECONDS:
            return
        self._last_cleanup = now
        with self._transaction() as connection:
            connection.execute("DELETE FROM chat_messages WHERE created_at < ?", (int(now) - MESSAGE_TTL_SECONDS,))
            connection.execute("DELETE FROM chat_devices WHERE last_seen_at < ?", (int(now) - DEVICE_TTL_SECONDS,))
            connection.execute("DELETE FROM verified_emails WHERE expires_at <= ?", (int(now),))
            expired = [row["blob_id"] for row in connection.execute(
                "SELECT blob_id FROM chat_blobs WHERE created_at < ? OR (complete = 0 AND created_at < ?)",
                (int(now) - BLOB_TTL_SECONDS, int(now) - INCOMPLETE_BLOB_TTL_SECONDS),
            )]
            connection.executemany("DELETE FROM chat_blobs WHERE blob_id = ?", [(blob_id,) for blob_id in expired])
        for blob_id in expired:
            for partial in (False, True):
                with contextlib.suppress(FileNotFoundError):
                    self._blob_path(blob_id, partial).unlink()


class ChatService:
    """Обработчики сообщений чата. Подключается к CallHub и использует его присутствие."""

    def __init__(self, store: ChatStore):
        self.store = store
        self.peers_by_device: dict[str, set[Peer]] = {}

    def handlers(self) -> dict[str, Callable[[Peer, dict[str, Any]], Steps | None]]:
        """Обработчики с базой и файлами — генераторы шагов `Blocking` (см. CallHub.handle_async)."""
        return {
            "chat-register": self._register,
            "chat-keys": self._keys,
            "chat-send": self._send,
            "chat-ack": self._ack,
            "chat-pull": self._pull,
            "blob-put": self._blob_put,
            "blob-get": self._blob_get,
        }

    def disconnected(self, peer: Peer) -> None:
        device_id = getattr(peer, "chat_device_id", None)
        if device_id:
            peers = self.peers_by_device.get(device_id)
            if peers is not None:
                peers.discard(peer)
                if not peers:
                    self.peers_by_device.pop(device_id, None)

    def credential_lost(self, peer: Peer) -> None:
        self.disconnected(peer)
        peer.chat_device_id = None

    def _require_device(self, peer: Peer) -> str:
        device_id = getattr(peer, "chat_device_id", None)
        if not device_id:
            raise CallError("chat_not_registered", "Сначала зарегистрируйте устройство чата.")
        return device_id

    def _register(self, peer: Peer, message: dict[str, Any]) -> Steps:
        if not peer.emails:
            raise CallError("not_verified", "Подтвердите свой адрес, чтобы пользоваться чатом.")
        assert peer.credential is not None
        device_id = validate_chat_device_id(message.get("deviceId"))
        public_key = decode_b64(message.get("publicKey"), X25519_KEY_BYTES, "invalid_device")
        if len(public_key) != X25519_KEY_BYTES:
            raise CallError("invalid_device", "Некорректный ключ устройства.")
        # Снимок адресов: пока идёт запись, другое устройство лицензии может добавить соединению адрес,
        # а в ответе должны быть ровно те адреса, что записаны в базу.
        emails = sorted(peer.emails)
        credential = peer.credential

        def register() -> None:
            self.store.cleanup()
            self.store.register_device(device_id, credential.subject, credential.device_hash, public_key, emails)

        yield Blocking(register)
        self.disconnected(peer)
        peer.chat_device_id = device_id
        self.peers_by_device.setdefault(device_id, set()).add(peer)
        peer.send({"type": "chat-registered", "deviceId": device_id, "emails": emails})
        yield from self._pull(peer, {})

    def _keys(self, peer: Peer, message: dict[str, Any]) -> Steps:
        self._require_device(peer)
        emails = message.get("emails")
        if not isinstance(emails, list) or len(emails) > MAX_KEY_FETCH_EMAILS:
            raise CallError("invalid_lookup", f"Нужен список не более чем из {MAX_KEY_FETCH_EMAILS} адресов.")
        normalized: list[str] = []
        for value in emails:
            try:
                normalized.append(normalize_email(value))
            except CallError:
                continue
        devices = yield Blocking(functools.partial(self.store.devices_for, normalized))
        reply: dict[str, Any] = {"type": "chat-keys-result", "devices": devices}
        if isinstance(message.get("requestId"), str):
            reply["requestId"] = message["requestId"][:64]
        peer.send(reply)

    def _send(self, peer: Peer, message: dict[str, Any]) -> Steps:
        device_id = self._require_device(peer)
        message_id = message.get("messageId")
        if not isinstance(message_id, str) or not MESSAGE_ID_RE.fullmatch(message_id):
            raise CallError("invalid_payload", "Некорректный идентификатор сообщения.")
        requested_from = message.get("from")
        sender_email = normalize_email(requested_from) if requested_from else peer.identity_email
        if sender_email not in peer.emails:
            raise CallError("not_verified", "Этот адрес не подтверждён.")
        recipients = message.get("recipients")
        if not isinstance(recipients, list) or not recipients or len(recipients) > MAX_RECIPIENTS:
            raise CallError("invalid_payload", "Некорректный список получателей.")
        allowed_emails = {normalize_email(email) for email in recipients} | set(peer.emails)
        ciphertext = decode_b64(message.get("ciphertext"), MAX_CIPHERTEXT_BYTES)
        raw_keys = message.get("keys")
        if not isinstance(raw_keys, dict) or not raw_keys or len(raw_keys) > MAX_TARGET_DEVICES:
            raise CallError("invalid_payload", "Некорректный список устройств.")
        keys: dict[str, bytes] = {}
        for target, wrapped in raw_keys.items():
            target = validate_chat_device_id(target)
            if target != device_id:
                keys[target] = decode_b64(wrapped, MAX_WRAPPED_KEY_BYTES)
        # Отправлять можно только устройствам получателей и своим другим устройствам.
        owners = yield Blocking(functools.partial(self.store.device_emails, list(keys)))
        keys = {target: wrapped for target, wrapped in keys.items() if owners.get(target, set()) & allowed_emails}
        if not keys:
            # Сообщение без ключей никто не прочитает: не храним его и сообщаем отправителю.
            raise CallError("no_recipients", "У получателя нет устройств с чатом Jackdaw.")
        ephemeral = message.get("ephemeral") is True
        delivered = 0
        if ephemeral:
            sent_at = int(self.store.now() * 1000)
            for target, wrapped in keys.items():
                for target_peer in list(self.peers_by_device.get(target, ())):
                    target_peer.send({
                        "type": "chat-message", "messageId": message_id, "from": sender_email, "fromDevice": device_id,
                        "ciphertext": encode_b64(ciphertext), "key": encode_b64(wrapped), "sentAt": sent_at, "ephemeral": True,
                    })
                    delivered += 1
            peer.send({"type": "chat-sent", "messageId": message_id, "queued": 0, "delivered": delivered})
            return
        assert peer.credential is not None
        stored = yield Blocking(functools.partial(
            self.store.store_message, message_id, sender_email, device_id, ciphertext, keys, peer.credential.subject),
            detached=True)
        if stored:
            created = {"message_id": message_id, "sender_email": sender_email, "sender_device": device_id,
                       "ciphertext": ciphertext, "created_at": int(self.store.now())}
            for target, wrapped in keys.items():
                for target_peer in list(self.peers_by_device.get(target, ())):
                    target_peer.send(ChatStore.envelope({**created, "wrapped_key": wrapped}))
                    delivered += 1
        peer.send({"type": "chat-sent", "messageId": message_id, "queued": len(keys), "delivered": delivered})

    def _ack(self, peer: Peer, message: dict[str, Any]) -> Steps:
        device_id = self._require_device(peer)
        ids = message.get("messageIds")
        if not isinstance(ids, list) or len(ids) > PENDING_BATCH:
            raise CallError("invalid_payload", "Некорректный список сообщений.")
        yield Blocking(functools.partial(
            self.store.acknowledge, device_id, [value for value in ids if isinstance(value, str) and MESSAGE_ID_RE.fullmatch(value)]))

    def _pull(self, peer: Peer, message: dict[str, Any]) -> Steps:
        device_id = self._require_device(peer)
        envelopes, remaining = yield Blocking(functools.partial(self.store.pending_for, device_id))
        for envelope in envelopes:
            peer.send(envelope)
        peer.send({"type": "chat-pending", "count": len(envelopes), "remaining": remaining})

    def _blob_put(self, peer: Peer, message: dict[str, Any]) -> Steps:
        device_id = self._require_device(peer)
        assert peer.credential is not None
        blob_id = message.get("blobId")
        if not isinstance(blob_id, str) or not BLOB_ID_RE.fullmatch(blob_id):
            raise CallError("invalid_blob", "Некорректный идентификатор файла.")
        index, total = message.get("index"), message.get("total")
        if not isinstance(index, int) or not isinstance(total, int):
            raise CallError("invalid_blob", "Некорректная часть файла.")
        data = decode_b64(message.get("data"), BLOB_CHUNK_BYTES, "invalid_blob")
        subject = peer.credential.subject

        def put() -> bool:
            if index == 0:
                # Брошенные загрузки освобождают резерв квоты и на долгом соединении (не чаще раза в час).
                self.store.cleanup()
            return self.store.put_blob_chunk(blob_id, subject, device_id, index, total, data)

        complete = yield Blocking(put)
        peer.send({"type": "blob-stored", "blobId": blob_id, "index": index, "complete": complete})

    def _blob_get(self, peer: Peer, message: dict[str, Any]) -> Steps:
        self._require_device(peer)
        blob_id = message.get("blobId")
        index = message.get("index")
        if not isinstance(blob_id, str) or not BLOB_ID_RE.fullmatch(blob_id) or not isinstance(index, int):
            raise CallError("invalid_blob", "Некорректный запрос файла.")
        data, total = yield Blocking(functools.partial(self.store.get_blob_chunk, blob_id, index))
        peer.send({"type": "blob-data", "blobId": blob_id, "index": index, "total": total, "data": encode_b64(data)})
