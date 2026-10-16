#!/usr/bin/env python3
"""Минимальный production-сервис лицензий Jackdaw Mail.

Сервис намеренно не знает пароли, письма или данные почтовых аккаунтов.
Он хранит только хеши лицензионных ключей, хеши идентификаторов устройств,
срок действия entitlement и технический журнал webhook-событий.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import traceback
from collections import deque
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


PRODUCT = "jackdaw-mail"
PRO_FEATURES = (
    "reports",
    "live-sla",
    "working-hours",
    "reminders",
    "html-export",
    "signatures",
    "multiple-accounts",
)
PLANS = {"monthly", "yearly", "trial", "admin"}
LICENSE_KEY_RE = re.compile(r"^JACKDAW-PRO-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$")
PROVIDER_LICENSE_KEY_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.IGNORECASE)
CHECKOUT_PATH_RE = re.compile(r"^/checkout/buy/[^/]+/?$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,128}@[^@\s]{1,190}$")
PUBLIC_RATE_LIMIT = 60
TRIAL_RATE_LIMIT = 12
ADMIN_RATE_LIMIT = 120
RATE_WINDOW_SECONDS = 60
MAX_BODY_BYTES = 32 * 1024
DEFAULT_TRIAL_DAYS = 7
MIGRATION_VERSION_BASELINE = 1
MIGRATION_VERSION_TRIAL_CLAIMS = 2
# Медленный клиент не должен удерживать поток обработчика бесконечно.
REQUEST_SOCKET_TIMEOUT_SECONDS = 15
MAX_CONCURRENT_REQUESTS = 64
# X-Forwarded-For учитывается только от локального reverse proxy и только при явном включении.
TRUSTED_PROXY_PEERS = frozenset({"127.0.0.1", "::1"})
LOG_CONTROL_CHARS = {code: f"\\x{code:02x}" for code in (*range(0x20), *range(0x7F, 0xA0))}
PROVIDER_REVOKED_KEY_STATUSES = {"disabled", "expired"}
PROVIDER_PAST_DUE_SUBSCRIPTION_STATUSES = {"past_due", "unpaid", "paused"}


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def normalize_license_key(value: Any) -> str:
    if not isinstance(value, str):
        raise ServiceError(400, "invalid_license_key", "Введите ключ JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX или ключ из письма после покупки.")
    provider_key = value.strip().lower()
    if PROVIDER_LICENSE_KEY_RE.fullmatch(provider_key):
        return provider_key
    compact = re.sub(r"[^A-Za-z0-9]", "", value).upper()
    if not compact.startswith("JACKDAWPRO") or len(compact) != 26:
        raise ServiceError(400, "invalid_license_key", "Введите ключ JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX или ключ из письма после покупки.")
    formatted = "JACKDAW-PRO-" + "-".join(compact[index : index + 4] for index in range(10, 26, 4))
    if not LICENSE_KEY_RE.fullmatch(formatted):
        raise ServiceError(400, "invalid_license_key", "Введите ключ JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX или ключ из письма после покупки.")
    return formatted


def license_key_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def device_id_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


DEVICE_PREVIEW_LENGTH = 8


def device_preview(device_id: str) -> str:
    """Хвост идентификатора: у всех ID общий префикс «device-», по нему устройства неразличимы."""
    return device_id[-DEVICE_PREVIEW_LENGTH:]


# Порядок важен: Android и iOS-подстроки встречаются внутри строк Linux/macOS.
DEVICE_OS_MARKERS = (
    ("Android", "Android"),
    ("iPhone", "iOS"),
    ("iPad", "iPadOS"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Macintosh", "macOS"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
)
APP_VERSION_RE = re.compile(r"(?:JackdawMail|Jackdaw Mail|jackdaw)[/ ]([0-9][0-9A-Za-z.\-]*)", re.IGNORECASE)


def describe_device(device_name: str | None) -> str:
    """Человекочитаемая подпись устройства для админки из User-Agent или имени, присланного клиентом."""
    if not device_name:
        return "Устройство"
    if "Mozilla/" not in device_name:
        return device_name
    os_name = next((label for marker, label in DEVICE_OS_MARKERS if marker in device_name), "Неизвестная ОС")
    version = APP_VERSION_RE.search(device_name)
    return f"{os_name} · Jackdaw Mail {version.group(1)}" if version else os_name


def generate_license_key() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
    return "JACKDAW-PRO-" + "-".join(groups)


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


class Configuration:
    def __init__(self) -> None:
        self.host = os.getenv("JACKDAW_LICENSE_HOST", "127.0.0.1")
        self.port = int(os.getenv("JACKDAW_LICENSE_PORT", "8090"))
        self.database_path = Path(os.getenv("JACKDAW_LICENSE_DB", "/var/lib/jackdaw-license/license.sqlite3"))
        self.private_key_path = Path(os.getenv("JACKDAW_LICENSE_PRIVATE_KEY", "/etc/jackdaw-license/ed25519-private.pem"))
        self.admin_token_sha256 = os.getenv("JACKDAW_ADMIN_TOKEN_SHA256", "").strip().lower()
        self.webhook_secret = os.getenv("LEMON_SQUEEZY_WEBHOOK_SECRET", "")
        self.store_id = os.getenv("LEMON_SQUEEZY_STORE_ID", "").strip()
        self.monthly_checkout_url = self._read_checkout_url("LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL")
        self.yearly_checkout_url = self._read_checkout_url("LEMON_SQUEEZY_YEARLY_CHECKOUT_URL")
        self.grace_days = max(0, int(os.getenv("JACKDAW_LICENSE_GRACE_DAYS", "7")))
        self.trial_days = DEFAULT_TRIAL_DAYS
        self.trust_forwarded_for = os.getenv("JACKDAW_TRUST_X_FORWARDED_FOR", "").strip() == "1"
        self.reject_test_webhooks = os.getenv("LEMON_SQUEEZY_REJECT_TEST_MODE", "").strip() == "1"
        self.product_ids = {value.strip() for value in os.getenv("LEMON_SQUEEZY_PRODUCT_IDS", "").split(",") if value.strip()}
        default_origins = {
            "https://jackdaw-mail.pro",
            "https://www.jackdaw-mail.pro",
            "https://license.jackdaw-mail.pro",
        }
        configured_origins = {origin.strip().rstrip("/") for origin in os.getenv("JACKDAW_LICENSE_ORIGINS", "").split(",") if origin.strip()}
        self.allowed_origins = default_origins | configured_origins

    @staticmethod
    def _read_checkout_url(name: str) -> str | None:
        value = os.getenv(name, "").strip()
        if not value:
            return None
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".lemonsqueezy.com"):
            raise RuntimeError(f"{name} must be a Lemon Squeezy HTTPS checkout URL")
        if not CHECKOUT_PATH_RE.fullmatch(parsed.path):
            raise RuntimeError(f"{name} must use /checkout/buy/<variant> path")
        return value

    @property
    def store_configured(self) -> bool:
        return bool(self.monthly_checkout_url and self.yearly_checkout_url and self.webhook_secret and self.store_id)


class EntitlementSigner:
    def __init__(self, private_key_path: Path):
        try:
            private_key_bytes = private_key_path.read_bytes()
        except OSError as exc:
            raise RuntimeError(f"Entitlement private key is unavailable: {private_key_path}") from exc
        key = serialization.load_pem_private_key(private_key_bytes, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise RuntimeError("Entitlement private key must be Ed25519")
        self._key = key

    def sign(self, payload: dict[str, Any]) -> str:
        return base64url_encode(self._key.sign(canonical_json(payload)))


class LicenseStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    def _initialize(self) -> None:
        with self._write_lock, self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS licenses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_hash TEXT NOT NULL UNIQUE,
                    key_prefix TEXT NOT NULL,
                    key_last4 TEXT NOT NULL,
                    plan TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    email TEXT,
                    note TEXT,
                    source TEXT NOT NULL DEFAULT 'admin',
                    provider_license_id TEXT UNIQUE,
                    provider_order_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT,
                    grace_until TEXT,
                    max_activations INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS activations (
                    license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
                    device_hash TEXT NOT NULL,
                    device_prefix TEXT NOT NULL,
                    device_name TEXT NOT NULL,
                    activated_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    deactivated_at TEXT,
                    PRIMARY KEY (license_id, device_hash)
                );
                CREATE TABLE IF NOT EXISTS webhook_events (
                    event_id TEXT PRIMARY KEY,
                    event_name TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    payload_hash TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_licenses_provider_license_id ON licenses(provider_license_id);
                CREATE INDEX IF NOT EXISTS idx_activations_license_active ON activations(license_id, deactivated_at);
                """
            )
            self._apply_migrations(connection)

    def _apply_migrations(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        applied_versions = {
            int(row["version"])
            for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
        }
        if not applied_versions:
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (MIGRATION_VERSION_BASELINE, iso_datetime(now_utc())),
            )
            applied_versions.add(MIGRATION_VERSION_BASELINE)

        migrations = (
            (MIGRATION_VERSION_TRIAL_CLAIMS, "002_trial_claims.sql"),
        )
        for version, filename in migrations:
            if version in applied_versions:
                continue
            migration_path = Path(__file__).with_name("migrations") / filename
            try:
                migration_sql = migration_path.read_text(encoding="utf-8")
            except OSError as exc:
                raise RuntimeError(f"License database migration is unavailable: {migration_path}") from exc
            connection.executescript(migration_sql)
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (version, iso_datetime(now_utc())),
            )
            applied_versions.add(version)

    @staticmethod
    def _effective_status(row: sqlite3.Row, current_time: datetime | None = None) -> str:
        if row["status"] == "revoked":
            return "revoked"
        current_time = current_time or now_utc()
        expires_at = parse_iso_datetime(row["expires_at"])
        if expires_at and current_time >= expires_at:
            return "expired"
        if row["status"] == "past_due":
            grace_until = parse_iso_datetime(row["grace_until"])
            if grace_until and current_time < grace_until:
                return "past_due"
            return "expired"
        return row["status"]

    def find_by_key(self, normalized_key: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute("SELECT * FROM licenses WHERE key_hash = ?", (license_key_hash(normalized_key),)).fetchone()

    def find_by_id(self, license_id: int) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute("SELECT * FROM licenses WHERE id = ?", (license_id,)).fetchone()

    def create_license(
        self,
        normalized_key: str,
        plan: str,
        expires_at: str | None,
        max_activations: int,
        email: str | None,
        note: str | None,
        source: str,
        provider_license_id: str | None = None,
        provider_order_id: str | None = None,
    ) -> int:
        timestamp = iso_datetime(now_utc())
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO licenses (
                    key_hash, key_prefix, key_last4, plan, status, email, note, source,
                    provider_license_id, provider_order_id, created_at, updated_at,
                    expires_at, grace_until, max_activations
                ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    license_key_hash(normalized_key),
                    normalized_key[:10],
                    normalized_key[-4:],
                    plan,
                    email,
                    note,
                    source,
                    provider_license_id,
                    provider_order_id,
                    timestamp,
                    timestamp,
                    expires_at,
                    max_activations,
                ),
            )
            return int(cursor.lastrowid)

    def upsert_provider_license(
        self,
        normalized_key: str,
        plan: str,
        expires_at: str | None,
        status: str,
        provider_license_id: str | None,
        provider_order_id: str | None,
        email: str | None,
    ) -> int:
        timestamp = iso_datetime(now_utc())
        with self._write_lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT id FROM licenses WHERE key_hash = ? OR (? IS NOT NULL AND provider_license_id = ?)",
                (license_key_hash(normalized_key), provider_license_id, provider_license_id),
            ).fetchone()
            if existing:
                # Отзыв не снимается событием провайдера: вернуть лицензию может только администратор.
                connection.execute(
                    """
                    UPDATE licenses
                    SET plan = ?, status = CASE WHEN status = 'revoked' THEN status ELSE ? END,
                        email = COALESCE(?, email),
                        provider_license_id = COALESCE(?, provider_license_id),
                        provider_order_id = COALESCE(?, provider_order_id),
                        expires_at = COALESCE(?, expires_at), grace_until = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (plan, status, email, provider_license_id, provider_order_id, expires_at, timestamp, existing["id"]),
                )
                return int(existing["id"])
            cursor = connection.execute(
                """
                INSERT INTO licenses (
                    key_hash, key_prefix, key_last4, plan, status, email, source,
                    provider_license_id, provider_order_id, created_at, updated_at,
                    expires_at, grace_until, max_activations
                ) VALUES (?, ?, ?, ?, ?, ?, 'lemon-squeezy', ?, ?, ?, ?, ?, NULL, 3)
                """,
                (
                    license_key_hash(normalized_key),
                    normalized_key[:10],
                    normalized_key[-4:],
                    plan,
                    status,
                    email,
                    provider_license_id,
                    provider_order_id,
                    timestamp,
                    timestamp,
                    expires_at,
                ),
            )
            return int(cursor.lastrowid)

    def update_provider_status(self, provider_license_id: str, status: str, expires_at: str | None, grace_until: str | None) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE licenses SET status = ?, expires_at = COALESCE(?, expires_at), grace_until = ?, updated_at = ? WHERE provider_license_id = ? AND status != 'revoked'",
                (status, expires_at, grace_until, iso_datetime(now_utc()), provider_license_id),
            )
            return cursor.rowcount > 0

    def update_provider_status_by_order(self, provider_order_id: str, status: str, expires_at: str | None, grace_until: str | None) -> bool:
        """События подписки и заказа несут id заказа, а не id ключа, поэтому лицензия ищется по заказу."""
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE licenses
                SET status = ?, expires_at = COALESCE(?, expires_at), grace_until = ?, updated_at = ?
                WHERE provider_order_id = ? AND source = 'lemon-squeezy' AND status != 'revoked'
                """,
                (status, expires_at, grace_until, iso_datetime(now_utc()), provider_order_id),
            )
            return cursor.rowcount > 0

    def activate(self, license_id: int, device_id: str, device_name: str, max_activations: int) -> None:
        hashed_device = device_id_hash(device_id)
        timestamp = iso_datetime(now_utc())
        with self._write_lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT deactivated_at FROM activations WHERE license_id = ? AND device_hash = ?",
                (license_id, hashed_device),
            ).fetchone()
            # Устройство с deactivated_at снова занимает место, поэтому лимит проверяется и для него.
            if (existing is None or existing["deactivated_at"] is not None) and max_activations > 0:
                count = connection.execute(
                    "SELECT COUNT(*) AS count FROM activations WHERE license_id = ? AND deactivated_at IS NULL",
                    (license_id,),
                ).fetchone()["count"]
                if count >= max_activations:
                    raise ServiceError(409, "activation_limit_reached", "Лимит активаций этой лицензии исчерпан.")
            connection.execute(
                """
                INSERT INTO activations (license_id, device_hash, device_prefix, device_name, activated_at, last_seen_at, deactivated_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(license_id, device_hash) DO UPDATE SET
                    device_name = excluded.device_name,
                    last_seen_at = excluded.last_seen_at,
                    deactivated_at = NULL
                """,
                (license_id, hashed_device, device_preview(device_id), device_name, timestamp, timestamp),
            )

    def touch_activation(self, license_id: int, device_id: str) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE activations SET last_seen_at = ? WHERE license_id = ? AND device_hash = ? AND deactivated_at IS NULL",
                (iso_datetime(now_utc()), license_id, device_id_hash(device_id)),
            )
            return cursor.rowcount > 0

    def deactivate(self, license_id: int, device_id: str) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE activations SET deactivated_at = ?, last_seen_at = ? WHERE license_id = ? AND device_hash = ? AND deactivated_at IS NULL",
                (iso_datetime(now_utc()), iso_datetime(now_utc()), license_id, device_id_hash(device_id)),
            )
            return cursor.rowcount > 0

    def deactivate_by_hash(self, license_id: int, device_hash: str) -> bool:
        with self._write_lock, self._connect() as connection:
            timestamp = iso_datetime(now_utc())
            cursor = connection.execute(
                "UPDATE activations SET deactivated_at = ? WHERE license_id = ? AND device_hash = ? AND deactivated_at IS NULL",
                (timestamp, license_id, device_hash),
            )
            return cursor.rowcount > 0

    def set_max_activations(self, license_id: int, max_activations: int) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE licenses SET max_activations = ?, updated_at = ? WHERE id = ?",
                (max_activations, iso_datetime(now_utc()), license_id),
            )
            return cursor.rowcount > 0

    def activation_exists(self, license_id: int, device_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM activations WHERE license_id = ? AND device_hash = ? AND deactivated_at IS NULL",
                (license_id, device_id_hash(device_id)),
            ).fetchone()
            return row is not None

    @staticmethod
    def _effective_trial_status(row: sqlite3.Row, current_time: datetime | None = None) -> str:
        if row["status"] == "revoked":
            return "revoked"
        current_time = current_time or now_utc()
        expires_at = parse_iso_datetime(row["expires_at"])
        if expires_at and current_time >= expires_at:
            return "expired"
        return "trial"

    def find_trial_by_device(self, device_id: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM trial_claims WHERE device_hash = ?",
                (device_id_hash(device_id),),
            ).fetchone()

    def claim_trial(self, device_id: str, device_name: str, duration_days: int) -> tuple[sqlite3.Row, bool]:
        hashed_device = device_id_hash(device_id)
        current_time = now_utc()
        timestamp = iso_datetime(current_time)
        expires_at = iso_datetime(current_time + timedelta(days=duration_days))
        with self._write_lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM trial_claims WHERE device_hash = ?",
                (hashed_device,),
            ).fetchone()
            if existing is not None:
                connection.execute(
                    "UPDATE trial_claims SET device_name = ?, updated_at = ?, last_seen_at = ? WHERE id = ?",
                    (device_name, timestamp, timestamp, existing["id"]),
                )
                row = connection.execute("SELECT * FROM trial_claims WHERE id = ?", (existing["id"],)).fetchone()
                if row is None:
                    raise ServiceError(500, "trial_read_failed", "Не удалось прочитать пробный доступ.")
                return row, False
            cursor = connection.execute(
                """
                INSERT INTO trial_claims (
                    device_hash, device_prefix, device_name, status,
                    started_at, updated_at, last_seen_at, expires_at
                ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
                """,
                (hashed_device, device_preview(device_id), device_name, timestamp, timestamp, timestamp, expires_at),
            )
            row = connection.execute("SELECT * FROM trial_claims WHERE id = ?", (cursor.lastrowid,)).fetchone()
            if row is None:
                raise ServiceError(500, "trial_read_failed", "Не удалось прочитать пробный доступ.")
            return row, True

    def revoke_trial(self, trial_id: int) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE trial_claims SET status = 'revoked', updated_at = ? WHERE id = ? AND status != 'revoked'",
                (iso_datetime(now_utc()), trial_id),
            )
            return cursor.rowcount > 0

    def list_trials(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM trial_claims ORDER BY id DESC LIMIT ?",
                (min(max(limit, 1), 100),),
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "devicePreview": f"{row['device_prefix']}…",
                    "deviceName": row["device_name"],
                    "deviceLabel": describe_device(row["device_name"]),
                    "status": self._effective_trial_status(row),
                    "startedAt": row["started_at"],
                    "lastSeenAt": row["last_seen_at"],
                    "expiresAt": row["expires_at"],
                }
                for row in rows
            ]

    def revoke(self, license_id: int, status: str = "revoked") -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?",
                (status, iso_datetime(now_utc()), license_id),
            )
            return cursor.rowcount > 0

    def restore(self, license_id: int) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE licenses SET status = 'active', grace_until = NULL, updated_at = ? WHERE id = ? AND status = 'revoked'",
                (iso_datetime(now_utc()), license_id),
            )
            return cursor.rowcount > 0

    def list_licenses(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM licenses ORDER BY id DESC LIMIT ?",
                (min(max(limit, 1), 100),),
            ).fetchall()
            devices_by_license: dict[int, list[dict[str, Any]]] = {row["id"]: [] for row in rows}
            if rows:
                placeholders = ",".join("?" for _ in rows)
                activation_rows = connection.execute(
                    f"""
                    SELECT license_id, device_hash, device_prefix, device_name, activated_at, last_seen_at, deactivated_at
                    FROM activations WHERE license_id IN ({placeholders})
                    ORDER BY deactivated_at IS NOT NULL, last_seen_at DESC
                    """,
                    [row["id"] for row in rows],
                ).fetchall()
                for activation in activation_rows:
                    devices_by_license[activation["license_id"]].append(
                        {
                            "deviceHash": activation["device_hash"],
                            "devicePreview": activation["device_prefix"],
                            "deviceName": activation["device_name"],
                            "deviceLabel": describe_device(activation["device_name"]),
                            "activatedAt": activation["activated_at"],
                            "lastSeenAt": activation["last_seen_at"],
                            "deactivatedAt": activation["deactivated_at"],
                            "active": activation["deactivated_at"] is None,
                        }
                    )
            result: list[dict[str, Any]] = []
            for row in rows:
                devices = devices_by_license[row["id"]]
                result.append(
                    {
                        "id": row["id"],
                        "keyPreview": f"{row['key_prefix']}-****-****-****-{row['key_last4']}",
                        "plan": row["plan"],
                        "status": self._effective_status(row),
                        "email": row["email"],
                        "note": row["note"],
                        "source": row["source"],
                        "createdAt": row["created_at"],
                        "updatedAt": row["updated_at"],
                        "expiresAt": row["expires_at"],
                        "maxActivations": row["max_activations"],
                        "activeActivations": sum(1 for device in devices if device["active"]),
                        "devices": devices,
                    }
                )
            return result

    def record_webhook(self, event_id: str, event_name: str, payload_hash: str) -> bool:
        with self._write_lock, self._connect() as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO webhook_events (event_id, event_name, received_at, payload_hash) VALUES (?, ?, ?, ?)",
                (event_id, event_name, iso_datetime(now_utc()), payload_hash),
            )
            return cursor.rowcount > 0

    def forget_webhook(self, event_id: str) -> None:
        with self._write_lock, self._connect() as connection:
            connection.execute("DELETE FROM webhook_events WHERE event_id = ?", (event_id,))


class RateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int) -> bool:
        current = time.monotonic()
        with self._lock:
            bucket = self._buckets.setdefault(key, deque())
            while bucket and current - bucket[0] >= RATE_WINDOW_SECONDS:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(current)
            if len(self._buckets) > 4096:
                stale_keys = [name for name, values in self._buckets.items() if not values or current - values[-1] >= RATE_WINDOW_SECONDS]
                for stale_key in stale_keys[:2048]:
                    self._buckets.pop(stale_key, None)
            return True


def features_for_plan(plan: str) -> list[str]:
    return list(PRO_FEATURES) if plan in PLANS else []


MAX_ACTIVATIONS_LIMIT = 100
DEVICE_HASH_RE = re.compile(r"[0-9a-f]{64}")


def parse_license_id(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ServiceError(400, "invalid_license_id", "Идентификатор лицензии некорректен.") from exc


def validate_device_id(value: Any) -> str:
    if not isinstance(value, str) or not DEVICE_ID_RE.fullmatch(value):
        raise ServiceError(400, "invalid_device_id", "Идентификатор устройства некорректен.")
    return value


def validate_device_name(value: Any) -> str:
    if not isinstance(value, str):
        return "Устройство"
    normalized = " ".join(value.split())
    return normalized[:120] or "Устройство"


def validate_email(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not EMAIL_RE.fullmatch(value.strip()):
        raise ServiceError(400, "invalid_email", "Email для заметки администратора некорректен.")
    return value.strip().lower()


def extract_provider_data(payload: dict[str, Any]) -> tuple[str | None, str | None, str | None, str | None, str, str | None]:
    event_name = str(payload.get("meta", {}).get("event_name", "")).lower()
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    attributes = data.get("attributes") if isinstance(data.get("attributes"), dict) else {}
    key = attributes.get("key") or attributes.get("license_key") or attributes.get("license_key_value")
    # data.id — id объекта своего типа: ключа, заказа или подписки. Id разных типов пересекаются,
    # поэтому как id ключа используется только id объекта license-keys.
    data_type = str(data.get("type", "")).lower()
    provider_license_id = attributes.get("license_key_id") or (data.get("id") if data_type in {"", "license-keys"} else None)
    provider_order_id = attributes.get("order_id") or attributes.get("order_item_id") or (data.get("id") if data_type == "orders" else None)
    variant_name = " ".join(
        str(attributes.get(name, ""))
        for name in ("variant_name", "product_name", "product_title")
    ).lower()
    plan = "yearly" if "year" in variant_name or "annual" in variant_name else "monthly"
    if "trial" in variant_name:
        plan = "trial"
    expires_at = attributes.get("expires_at") or attributes.get("renews_at") or attributes.get("ends_at")
    if not isinstance(expires_at, str):
        expires_at = None
    return event_name, str(key) if key else None, str(provider_license_id) if provider_license_id else None, str(provider_order_id) if provider_order_id else None, plan, expires_at


ADMIN_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jackdaw Mail · лицензии</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f6f5f1; color: #1a1d21; }
    body { margin: 0; padding: 32px; line-height: 1.5; }
    main { max-width: 980px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; }
    h2 { margin: 0 0 14px; font-size: 18px; font-weight: 650; }
    p { color: #4d525a; }
    section { border-top: 1px solid #1a1d21; padding-top: 20px; margin-top: 32px; }
    label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; color: #1a1d21; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #7d828a; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #1a1d21; }
    textarea { min-height: 80px; resize: vertical; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .wide { grid-column: 1 / -1; }
    button { border: 1px solid #1a1d21; border-radius: 3px; padding: 9px 16px; font: inherit; font-weight: 600; color: #fff; background: #1a1d21; cursor: pointer; }
    button:hover { background: #343a42; }
    button:active { transform: translateY(1px); }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #9a5a0e; outline-offset: 2px; }
    button.secondary { background: transparent; color: #1a1d21; }
    button.secondary:hover { background: #ecebe6; }
    button.danger { background: #a3261f; border-color: #a3261f; padding: 5px 10px; }
    button.danger:hover { background: #82201a; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
    .status { min-height: 1.5em; color: #4d525a; }
    .error { color: #a3261f; }
    .success { color: #1f6b4a; }
    .key { display: block; padding: 12px; background: #ecebe6; color: #1a1d21; font: 600 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 700px; }
    th, td { text-align: left; padding: 10px 8px 10px 0; border-bottom: 1px solid #d9d6cf; vertical-align: top; font-size: 14px; }
    th { color: #686d75; font-size: 13px; font-weight: 600; border-bottom-color: #1a1d21; }
    .muted { color: #686d75; font-size: 13px; }
    .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
    button.link { background: transparent; color: #1a1d21; border-color: transparent; padding: 2px 4px; font-variant-numeric: tabular-nums; text-decoration: underline; text-underline-offset: 3px; }
    button.link:hover { background: #ecebe6; }
    tr.devices > td { background: #ecebe6; padding: 12px; }
    table.nested { min-width: 0; margin-top: 10px; }
    table.nested th, table.nested td { border-bottom-color: #cfccc4; font-size: 13px; }
    label.inline { display: flex; align-items: center; gap: 10px; font-weight: 500; }
    label.inline input { width: 90px; }
    @media (max-width: 680px) { body { padding: 16px; } .grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
    @media (prefers-reduced-motion: reduce) { button:active { transform: none; } }
  </style>
</head>
<body>
<main>
  <h1>Jackdaw Mail · лицензии</h1>
  <p>Выпуск, просмотр и отзыв Pro-доступов. Платёжные данные и приватный ключ entitlement в этом интерфейсе не отображаются.</p>
  <section>
    <div class="grid">
      <label class="wide">Административный токен<input id="token" type="password" autocomplete="off" placeholder="Введите токен из защищённого файла на сервере"></label>
    </div>
    <div class="actions" style="margin-top:14px"><button id="load" class="secondary" type="button">Загрузить лицензии</button><span id="auth-status" class="status" role="status"></span></div>
  </section>
  <section>
    <h2>Выдать ключ</h2>
    <div class="grid">
      <label>План<select id="plan"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="trial">Trial</option><option value="admin">Admin</option></select></label>
      <label>Срок, дней<input id="duration" type="number" min="0" max="3650" value="365"></label>
      <label>Максимум устройств<input id="activations" type="number" min="0" max="100" value="3"></label>
      <label>Email клиента<input id="email" type="email" autocomplete="off"></label>
      <label class="wide">Заметка<textarea id="note" maxlength="500"></textarea></label>
    </div>
    <div class="actions" style="margin-top:14px"><button id="issue" type="button">Выпустить ключ</button><span id="issue-status" class="status" role="status"></span></div>
    <p id="issued-key" class="key" hidden></p>
    <p class="muted">Ключ показывается только один раз в этом окне. В базе хранится только его хеш.</p>
  </section>
  <section>
    <h2>Активные ключи</h2>
    <div id="licenses" class="table-wrap"><p class="muted">Введите токен и нажмите «Загрузить лицензии».</p></div>
  </section>
  <section>
    <h2>Пробные периоды</h2>
    <div id="trials" class="table-wrap"><p class="muted">Пробные периоды ещё не загружены.</p></div>
  </section>
</main>
<script>
  const token = document.getElementById('token');
  const authStatus = document.getElementById('auth-status');
  const issueStatus = document.getElementById('issue-status');
  const issuedKey = document.getElementById('issued-key');
  const licenses = document.getElementById('licenses');
  const trials = document.getElementById('trials');
  const headers = () => ({'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token.value.trim()});
  function showStatus(target, message, ok) { target.textContent = message; target.className = 'status ' + (ok ? 'success' : 'error'); }
  async function request(path, options) {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Сервер вернул ошибку.');
    return body;
  }
  function cell(row, value) { const td = document.createElement('td'); td.textContent = value == null ? '—' : String(value); row.appendChild(td); return td; }
  const expanded = new Set();
  function formatDate(value) { if (!value) return '—'; const date = new Date(value); return isNaN(date) ? value : date.toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'}); }
  function limitLabel(value) { return value === 0 ? '∞' : String(value); }
  async function adminPost(path, payload) { try { await request(path, {method: 'POST', headers: headers(), body: JSON.stringify(payload)}); await loadLicenses(); } catch (error) { showStatus(authStatus, error.message, false); } }
  function actionButton(label, className, onClick) { const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label; button.addEventListener('click', onClick); return button; }
  function renderDevices(item, columns) {
    const row = document.createElement('tr'); row.className = 'devices';
    const td = document.createElement('td'); td.colSpan = columns; row.appendChild(td);
    const limit = document.createElement('div'); limit.className = 'actions';
    const label = document.createElement('label'); label.className = 'inline'; label.textContent = 'Лимит устройств (0 — без ограничения)';
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.value = String(item.maxActivations); label.appendChild(input);
    limit.appendChild(label);
    limit.appendChild(actionButton('Сохранить лимит', 'secondary', () => adminPost('/v1/admin/licenses/limit', {licenseId: item.id, maxActivations: Number(input.value)})));
    td.appendChild(limit);
    const devices = item.devices || [];
    if (!devices.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Ключ ещё ни на одном устройстве не активирован.'; td.appendChild(empty); return row; }
    const table = document.createElement('table'); table.className = 'nested';
    const head = document.createElement('tr');
    ['Устройство', 'ID', 'Активирован', 'Последняя проверка', 'Статус', ''].forEach(value => { const th = document.createElement('th'); th.textContent = value; head.appendChild(th); });
    const thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const body = document.createElement('tbody');
    for (const device of devices) {
      const deviceRow = document.createElement('tr');
      const name = cell(deviceRow, device.deviceLabel); name.title = device.deviceName || '';
      cell(deviceRow, '…' + device.devicePreview).className = 'mono';
      cell(deviceRow, formatDate(device.activatedAt)); cell(deviceRow, formatDate(device.lastSeenAt));
      cell(deviceRow, device.active ? 'активно' : 'отключено ' + formatDate(device.deactivatedAt));
      const action = document.createElement('td');
      if (device.active) action.appendChild(actionButton('Отключить', 'danger', () => { if (confirm('Отключить это устройство? Pro на нём перестанет работать при следующей проверке.')) adminPost('/v1/admin/licenses/devices/deactivate', {licenseId: item.id, deviceHash: device.deviceHash}); }));
      deviceRow.appendChild(action); body.appendChild(deviceRow);
    }
    table.appendChild(body); td.appendChild(table);
    return row;
  }
  function renderRows(items) {
    licenses.textContent = '';
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Лицензий пока нет.'; licenses.appendChild(empty); return; }
    const columnsList = ['Ключ', 'План', 'Статус', 'Устройства', 'Истекает', 'Действие'];
    const table = document.createElement('table');
    const head = document.createElement('tr');
    columnsList.forEach(value => { const th = document.createElement('th'); th.textContent = value; head.appendChild(th); });
    const thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const body = document.createElement('tbody');
    for (const item of items) {
      const row = document.createElement('tr'); cell(row, item.keyPreview); cell(row, item.plan); cell(row, item.status);
      const devicesCell = document.createElement('td');
      const toggle = actionButton((expanded.has(item.id) ? '▾ ' : '▸ ') + item.activeActivations + ' / ' + limitLabel(item.maxActivations), 'link', () => { if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id); renderRows(items); });
      toggle.setAttribute('aria-expanded', expanded.has(item.id) ? 'true' : 'false');
      toggle.title = 'Показать устройства';
      devicesCell.appendChild(toggle); row.appendChild(devicesCell);
      cell(row, item.expiresAt ? formatDate(item.expiresAt) : null);
      const action = document.createElement('td');
      if (item.status !== 'revoked') action.appendChild(actionButton('Отозвать', 'danger', () => { if (confirm('Отозвать этот ключ?')) adminPost('/v1/admin/licenses/revoke', {licenseId: item.id}); }));
      else action.appendChild(actionButton('Восстановить', 'secondary', () => { if (confirm('Восстановить этот ключ?')) adminPost('/v1/admin/licenses/restore', {licenseId: item.id}); }));
      row.appendChild(action); body.appendChild(row);
      if (expanded.has(item.id)) body.appendChild(renderDevices(item, columnsList.length));
    }
    table.appendChild(body); licenses.appendChild(table);
  }
  function renderTrials(items) {
    trials.textContent = '';
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Пробных периодов пока нет.'; trials.appendChild(empty); return; }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    ['Устройство', 'Имя', 'Статус', 'Начат', 'Последняя проверка', 'Истекает', 'Действие'].forEach(value => { const th = document.createElement('th'); th.textContent = value; head.appendChild(th); });
    const thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const body = document.createElement('tbody');
    for (const item of items) {
      const row = document.createElement('tr'); cell(row, item.devicePreview); cell(row, item.deviceLabel || item.deviceName); cell(row, item.status); cell(row, item.startedAt); cell(row, item.lastSeenAt); cell(row, item.expiresAt);
      const action = document.createElement('td');
      if (item.status === 'trial') { const button = document.createElement('button'); button.type = 'button'; button.className = 'danger'; button.textContent = 'Отключить'; button.addEventListener('click', async () => { if (!confirm('Отключить этот пробный период?')) return; try { await request('/v1/admin/trials/revoke', {method: 'POST', headers: headers(), body: JSON.stringify({trialId: item.id})}); await loadTrials(); } catch (error) { showStatus(authStatus, error.message, false); } }); action.appendChild(button); } else { action.textContent = '—'; }
      row.appendChild(action); body.appendChild(row);
    }
    table.appendChild(body); trials.appendChild(table);
  }
  async function loadLicenses() { try { const body = await request('/v1/admin/licenses', {headers: headers()}); renderRows(body.licenses || []); showStatus(authStatus, 'Подключено.', true); } catch (error) { showStatus(authStatus, error.message, false); } }
  async function loadTrials() { try { const body = await request('/v1/admin/trials', {headers: headers()}); renderTrials(body.trials || []); } catch (error) { showStatus(authStatus, error.message, false); } }
  const AUTO_REFRESH_MS = 30000;
  let autoRefresh = null;
  document.getElementById('load').addEventListener('click', async () => {
    await Promise.all([loadLicenses(), loadTrials()]);
    if (autoRefresh === null) autoRefresh = setInterval(() => { if (document.visibilityState === 'visible' && token.value.trim()) { loadLicenses(); loadTrials(); } }, AUTO_REFRESH_MS);
  });
  document.getElementById('plan').addEventListener('change', event => { if (event.target.value === 'admin') document.getElementById('duration').value = '0'; });
  document.getElementById('issue').addEventListener('click', async () => {
    issuedKey.hidden = true;
    try {
      const body = await request('/v1/admin/licenses', {method: 'POST', headers: headers(), body: JSON.stringify({plan: document.getElementById('plan').value, durationDays: Number(document.getElementById('duration').value), maxActivations: Number(document.getElementById('activations').value), email: document.getElementById('email').value, note: document.getElementById('note').value})});
      issuedKey.textContent = body.licenseKey;
      issuedKey.hidden = false;
      showStatus(issueStatus, 'Ключ выпущен. Скопируйте его сейчас.', true);
      await loadLicenses();
      await loadTrials();
    } catch (error) { showStatus(issueStatus, error.message, false); }
  });
</script>
</body>
</html>"""


class LicenseRequestHandler(BaseHTTPRequestHandler):
    server_version = "JackdawLicense/1.0"
    protocol_version = "HTTP/1.1"
    timeout = REQUEST_SOCKET_TIMEOUT_SECONDS

    @property
    def service(self) -> "LicenseHTTPService":
        return self.server.service  # type: ignore[attr-defined]

    def version_string(self) -> str:
        # Заголовок Server не раскрывает версию Python.
        return self.server_version

    def parse_request(self) -> bool:
        self._body_consumed = False
        return super().parse_request()

    def _request_body_pending(self) -> bool:
        headers = getattr(self, "headers", None)
        if headers is None or getattr(self, "_body_consumed", False):
            return False
        content_length = headers.get("Content-Length")
        return "Transfer-Encoding" in headers or (content_length is not None and content_length.strip() != "0")

    def end_headers(self) -> None:
        # Непрочитанное тело на keep-alive соединении было бы разобрано как следующий запрос (CL.0 desync).
        if self._request_body_pending():
            self.send_header("Connection", "close")
        super().end_headers()

    def _client_ip(self) -> str:
        peer = self.client_address[0]
        headers = getattr(self, "headers", None)
        if headers is None or peer not in TRUSTED_PROXY_PEERS or not getattr(self.service.config, "trust_forwarded_for", False):
            return peer
        # Правое значение добавляет сам reverse proxy, левые присылает клиент.
        forwarded = headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            return peer

    def address_string(self) -> str:
        return self._client_ip()

    def log_message(self, format: str, *args: Any) -> None:
        message = (format % args).translate(LOG_CONTROL_CHARS)
        if "licenseKey" not in message and "Authorization" not in message:
            print(f"license-server: {self.address_string()} {message}", flush=True)

    def _send_internal_error(self) -> None:
        self.log_error("unhandled error: %s", traceback.format_exc())
        self._send_error(ServiceError(500, "internal_error", "Внутренняя ошибка сервиса лицензий."))

    def _origin_headers(self) -> None:
        origin = self.headers.get("Origin", "").rstrip("/")
        if origin and origin in self.service.config.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "false")
            self.send_header("Vary", "Origin")

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Strict-Transport-Security", "max-age=31536000")

    def _send_json(self, status: int, payload: dict[str, Any], head_only: bool = False) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._security_headers()
        self._origin_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if not head_only:
            self.wfile.write(encoded)

    def _send_html(self, status: int, html: str, content_security_policy: str) -> None:
        encoded = html.encode("utf-8")
        self.send_response(status)
        self._security_headers()
        self.send_header("Content-Security-Policy", content_security_policy)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(self, error: ServiceError) -> None:
        self._send_json(error.status, {"error": error.code, "message": error.message})

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ServiceError(400, "invalid_content_length", "Некорректный размер запроса.") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ServiceError(413, "request_too_large", "Запрос слишком большой.")
        body = self.rfile.read(length)
        self._body_consumed = len(body) == length
        return body

    def _read_json(self) -> dict[str, Any]:
        try:
            payload = json.loads(self._read_body().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError(400, "invalid_json", "Тело запроса должно быть корректным JSON.") from exc
        if not isinstance(payload, dict):
            raise ServiceError(400, "invalid_json", "Тело запроса должно быть JSON-объектом.")
        return payload

    def _check_rate(self, bucket: str, limit: int) -> None:
        if not self.service.rate_limiter.allow(f"{bucket}:{self._client_ip()}", limit):
            raise ServiceError(429, "rate_limited", "Слишком много запросов. Повторите позже.")

    def _require_admin(self) -> None:
        self._check_rate("admin", ADMIN_RATE_LIMIT)
        expected_hash = self.service.config.admin_token_sha256
        authorization = self.headers.get("Authorization", "")
        token = authorization[7:].strip() if authorization.startswith("Bearer ") else ""
        actual_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        if not expected_hash or not token or not hmac.compare_digest(actual_hash, expected_hash):
            raise ServiceError(401, "admin_unauthorized", "Требуется действительный административный токен.")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._security_headers()
        self._origin_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/healthz":
                self._send_json(
                    200,
                    {"status": "ok", "product": PRODUCT, "storeConfigured": self.service.config.store_configured},
                    head_only=True,
                )
                return
            self._send_json(404, {"error": "not_found", "message": "Ресурс не найден."}, head_only=True)
        except ServiceError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()

    def do_GET(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/healthz":
                self._send_json(200, {"status": "ok", "product": PRODUCT, "storeConfigured": self.service.config.store_configured})
                return
            if path == "/v1/public-config":
                self._send_json(
                    200,
                    {
                        "product": PRODUCT,
                        "features": list(PRO_FEATURES),
                        "activation": {"method": "license-key", "emailRequired": False},
                        "checkout": {
                            "monthly": {"configured": self.service.config.monthly_checkout_url is not None},
                            "yearly": {"configured": self.service.config.yearly_checkout_url is not None},
                        },
                        "trial": {
                            "configured": True,
                            "durationDays": self.service.config.trial_days,
                            "onlineRequired": True,
                        },
                    },
                )
                return
            if path == "/v1/admin/licenses":
                self._require_admin()
                self._send_json(200, {"licenses": self.service.store.list_licenses()})
                return
            if path == "/v1/admin/trials":
                self._require_admin()
                self._send_json(200, {"trials": self.service.store.list_trials()})
                return
            if path in {"/admin", "/admin/"}:
                self._send_html(200, ADMIN_HTML, "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
                return
            match = re.fullmatch(r"/buy/(monthly|yearly)/?", path)
            if match:
                self._handle_checkout(match.group(1))
                return
            self._send_json(404, {"error": "not_found", "message": "Ресурс не найден."})
        except ServiceError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()

    def _handle_checkout(self, plan: str) -> None:
        checkout_url = self.service.config.monthly_checkout_url if plan == "monthly" else self.service.config.yearly_checkout_url
        if not checkout_url:
            self._send_html(
                503,
                """<!doctype html><meta charset='utf-8'><title>Jackdaw Pro</title><style>body{font:16px/1.5 system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#1a1d21;background:#f6f5f1}main{border-top:1px solid #1a1d21;padding-top:20px}p{color:#4d525a}a{color:#9a5a0e}</style><main><h1>Покупка Jackdaw Pro</h1><p>Платёжный магазин ещё не подключён. Сервис лицензий уже готов принимать ключи и выдавать доступ после активации магазина.</p><p><a href='https://jackdaw-mail.pro/#plans'>Вернуться к тарифам</a></p></main>""",
                "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            )
            return
        self.send_response(302)
        self._security_headers()
        self.send_header("Location", checkout_url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/v1/webhooks/lemon-squeezy":
                # Лимит применяется только к запросам с неверной подписью, чтобы мусорный трафик
                # не вытеснял настоящие доставки Lemon Squeezy.
                self._handle_webhook()
                return
            if path in {"/v1/trial/start", "/v1/trial/refresh"}:
                self._check_rate("trial", TRIAL_RATE_LIMIT)
                payload = self._read_json()
                self._handle_trial(payload, path == "/v1/trial/refresh")
                return
            if path in {"/v1/license/activate", "/v1/license/refresh", "/v1/entitlement", "/v1/license/deactivate"}:
                self._check_rate("public", PUBLIC_RATE_LIMIT)
                payload = self._read_json()
                if path == "/v1/license/deactivate":
                    self._handle_deactivate(payload)
                else:
                    self._handle_activation(payload, path == "/v1/license/refresh" or path == "/v1/entitlement")
                return
            if path == "/v1/admin/licenses":
                self._require_admin()
                self._handle_admin_create(self._read_json())
                return
            if path == "/v1/admin/licenses/revoke":
                self._require_admin()
                self._handle_admin_status(self._read_json(), "revoke")
                return
            if path == "/v1/admin/licenses/restore":
                self._require_admin()
                self._handle_admin_status(self._read_json(), "restore")
                return
            if path == "/v1/admin/licenses/limit":
                self._require_admin()
                self._handle_admin_limit(self._read_json())
                return
            if path == "/v1/admin/licenses/devices/deactivate":
                self._require_admin()
                self._handle_admin_device_deactivate(self._read_json())
                return
            if path == "/v1/admin/trials/revoke":
                self._require_admin()
                self._handle_admin_trial_revoke(self._read_json())
                return
            self._send_json(404, {"error": "not_found", "message": "Ресурс не найден."})
        except ServiceError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()

    def _handle_activation(self, payload: dict[str, Any], refresh_only: bool) -> None:
        normalized_key = normalize_license_key(payload.get("licenseKey"))
        device_id = validate_device_id(payload.get("deviceId"))
        device_name = validate_device_name(payload.get("deviceName"))
        row = self.service.store.find_by_key(normalized_key)
        if row is None:
            raise ServiceError(404, "license_not_found", "Лицензионный ключ не найден.")
        status = self.service.store._effective_status(row)
        if status not in {"active", "trial", "past_due"}:
            raise ServiceError(403, "license_inactive", "Лицензия неактивна или срок её действия закончился.")
        if refresh_only and not self.service.store.activation_exists(row["id"], device_id):
            raise ServiceError(403, "device_not_activated", "Это устройство ещё не активировано этой лицензией.")
        self.service.store.activate(row["id"], device_id, device_name, int(row["max_activations"]))
        latest = self.service.store.find_by_id(row["id"])
        if latest is None:
            raise ServiceError(500, "license_read_failed", "Не удалось прочитать лицензию после активации.")
        effective_status = self.service.store._effective_status(latest)
        server_now = now_utc()
        payload_data = {
            "product": PRODUCT,
            "plan": latest["plan"],
            "features": features_for_plan(latest["plan"]),
            "status": effective_status,
            "validUntil": latest["expires_at"],
            "issuedAt": iso_datetime(server_now),
            "serverNow": iso_datetime(server_now),
        }
        self._send_json(
            200,
            {
                "entitlement": {"payload": payload_data, "signature": self.service.signer.sign(payload_data)},
                "license": {
                    "plan": latest["plan"],
                    "status": effective_status,
                    "validUntil": latest["expires_at"],
                    "keyLast4": latest["key_last4"],
                },
            },
        )

    def _handle_trial(self, payload: dict[str, Any], refresh_only: bool) -> None:
        device_id = validate_device_id(payload.get("deviceId"))
        device_name = validate_device_name(payload.get("deviceName"))
        trial = self.service.store.find_trial_by_device(device_id)
        created = False
        if trial is None:
            if refresh_only:
                raise ServiceError(404, "trial_not_started", "На этом устройстве пробный период ещё не запускался.")
            trial, created = self.service.store.claim_trial(device_id, device_name, self.service.config.trial_days)
        else:
            trial, _ = self.service.store.claim_trial(device_id, device_name, self.service.config.trial_days)
        effective_status = self.service.store._effective_trial_status(trial)
        if effective_status == "expired":
            raise ServiceError(403, "trial_expired", "Пробный период закончился. Для продолжения активируйте Pro-лицензию.")
        if effective_status == "revoked":
            raise ServiceError(403, "trial_revoked", "Пробный период отключён администратором.")
        server_now = now_utc()
        payload_data = {
            "product": PRODUCT,
            "plan": "trial",
            "features": features_for_plan("trial"),
            "status": "trial",
            "validUntil": trial["expires_at"],
            "issuedAt": iso_datetime(server_now),
            "serverNow": iso_datetime(server_now),
            "trialStartedAt": trial["started_at"],
        }
        self._send_json(
            200,
            {
                "entitlement": {"payload": payload_data, "signature": self.service.signer.sign(payload_data)},
                "trial": {
                    "startedAt": trial["started_at"],
                    "validUntil": trial["expires_at"],
                    "alreadyStarted": not created,
                    "durationDays": self.service.config.trial_days,
                    "onlineRequired": True,
                },
            },
        )

    def _handle_deactivate(self, payload: dict[str, Any]) -> None:
        normalized_key = normalize_license_key(payload.get("licenseKey"))
        device_id = validate_device_id(payload.get("deviceId"))
        row = self.service.store.find_by_key(normalized_key)
        if row is None:
            raise ServiceError(404, "license_not_found", "Лицензионный ключ не найден.")
        self.service.store.deactivate(row["id"], device_id)
        self._send_json(200, {"ok": True})

    def _handle_webhook(self) -> None:
        raw_body = self._read_body()
        secret = self.service.config.webhook_secret
        supplied = self.headers.get("X-Signature", "").strip().lower()
        expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest() if secret else ""
        if not secret or not self.service.config.store_id or not supplied or not hmac.compare_digest(supplied.removeprefix("sha256=").encode("utf-8"), expected.encode("utf-8")):
            self._check_rate("webhook-invalid", ADMIN_RATE_LIMIT)
            raise ServiceError(401, "invalid_webhook_signature", "Подпись webhook недействительна.")
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError(400, "invalid_webhook_json", "Webhook содержит некорректный JSON.") from exc
        if not isinstance(payload, dict):
            raise ServiceError(400, "invalid_webhook_json", "Webhook должен быть JSON-объектом.")
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        event_name, raw_key, provider_license_id, provider_order_id, plan, expires_at = extract_provider_data(payload)
        event_header = self.headers.get("X-Event-Name", "").strip().lower()
        if event_header and event_header != event_name:
            raise ServiceError(400, "invalid_webhook_event", "Имя события webhook не совпадает с телом запроса.")
        attributes = data.get("attributes") if isinstance(data.get("attributes"), dict) else {}
        if str(attributes.get("store_id", "")) != self.service.config.store_id:
            raise ServiceError(403, "invalid_webhook_store", "Webhook относится к другому магазину.")
        if meta.get("test_mode") is True and getattr(self.service.config, "reject_test_webhooks", False):
            self._send_json(200, {"ok": True, "ignored": "test_mode"})
            return
        allowed_products = getattr(self.service.config, "product_ids", set())
        first_item = attributes.get("first_order_item") if isinstance(attributes.get("first_order_item"), dict) else {}
        product_id = attributes.get("product_id") or first_item.get("product_id")
        if allowed_products and str(product_id) not in allowed_products:
            self._send_json(200, {"ok": True, "ignored": "product"})
            return
        # Идентификатор события строится только из подписанного тела: неподписанный заголовок
        # позволил бы повторно применить перехваченное событие.
        event_id = str(meta.get("event_id") or f"{event_name}:{data.get('id', '')}:{hashlib.sha256(raw_body).hexdigest()[:16]}")
        if not event_id or len(event_id) > 200:
            raise ServiceError(400, "invalid_webhook_event", "Webhook не содержит корректный идентификатор события.")
        if not self.service.store.record_webhook(event_id, event_name or "unknown", hashlib.sha256(raw_body).hexdigest()):
            self._send_json(200, {"ok": True, "duplicate": True})
            return
        try:
            event_status = "active"
            if event_name in {"subscription_payment_failed"}:
                event_status = "past_due"
                expires_at = iso_datetime(now_utc() + timedelta(days=self.service.config.grace_days))
            elif event_name in {"subscription_expired", "order_refunded"}:
                event_status = "revoked"
            elif event_name == "subscription_cancelled":
                event_status = "active" if expires_at else "revoked"
            elif event_name == "subscription_paused":
                event_status = "past_due"
                expires_at = iso_datetime(now_utc() + timedelta(days=self.service.config.grace_days))
            # Статус объекта важнее имени события: license_key_updated и subscription_updated
            # приходят и при отключении ключа, и при просрочке оплаты.
            data_type = str(data.get("type", "")).lower()
            provider_status = str(attributes.get("status", "")).lower()
            if data_type == "license-keys" and (attributes.get("disabled") is True or provider_status in PROVIDER_REVOKED_KEY_STATUSES):
                event_status = "revoked"
            elif data_type == "subscriptions" and provider_status == "expired":
                event_status = "revoked"
            elif data_type == "subscriptions" and event_status == "active" and provider_status in PROVIDER_PAST_DUE_SUBSCRIPTION_STATUSES:
                event_status = "past_due"
                expires_at = iso_datetime(now_utc() + timedelta(days=self.service.config.grace_days))
            elif data_type == "subscriptions" and event_status == "active" and provider_status in {"active", "on_trial"}:
                # Запас на задержку webhook о продлении: подписка не гаснет в момент renews_at.
                renews_at = parse_iso_datetime(attributes.get("renews_at") if isinstance(attributes.get("renews_at"), str) else None)
                if renews_at:
                    expires_at = iso_datetime(renews_at + timedelta(days=self.service.config.grace_days))
            grace_until = iso_datetime(now_utc() + timedelta(days=self.service.config.grace_days)) if event_status == "past_due" else None
            if raw_key:
                normalized_key = normalize_license_key(raw_key)
                email = None
                user_data = meta.get("custom_data") if isinstance(meta.get("custom_data"), dict) else {}
                raw_email = user_data.get("email") or attributes.get("user_email")
                if isinstance(raw_email, str):
                    try:
                        email = validate_email(raw_email)
                    except ServiceError:
                        # Email — необязательная метка; из-за неё webhook не должен уходить в бесконечные повторы.
                        email = None
                self.service.store.upsert_provider_license(normalized_key, plan, expires_at, event_status, provider_license_id, provider_order_id, email)
            elif provider_license_id:
                self.service.store.update_provider_status(provider_license_id, event_status, expires_at, grace_until)
            elif provider_order_id:
                self.service.store.update_provider_status_by_order(provider_order_id, event_status, expires_at, grace_until)
        except Exception:
            self.service.store.forget_webhook(event_id)
            raise
        self._send_json(200, {"ok": True})

    def _handle_admin_create(self, payload: dict[str, Any]) -> None:
        plan = payload.get("plan", "monthly")
        if plan not in PLANS:
            raise ServiceError(400, "invalid_plan", "План лицензии некорректен.")
        try:
            duration_days = int(payload.get("durationDays", 365))
            max_activations = int(payload.get("maxActivations", 3))
        except (TypeError, ValueError, OverflowError) as exc:
            raise ServiceError(400, "invalid_license_limits", "Срок и лимит устройств должны быть целыми числами.") from exc
        if duration_days < 0 or duration_days > 3650 or max_activations < 0 or max_activations > 100:
            raise ServiceError(400, "invalid_license_limits", "Срок должен быть от 0 до 3650 дней, лимит устройств — от 0 до 100.")
        email = validate_email(payload.get("email"))
        note = payload.get("note")
        if note is not None and not isinstance(note, str):
            raise ServiceError(400, "invalid_note", "Заметка должна быть текстом.")
        note = " ".join(note.split())[:500] if note else None
        # Админский ключ бессрочный, но лимит устройств задаётся явно (0 — без ограничения):
        # раньше лимит принудительно обнулялся, и один ключ активировался на любом числе машин.
        if plan == "admin":
            duration_days = 0
        expires_at = iso_datetime(now_utc() + timedelta(days=duration_days)) if duration_days else None
        for _ in range(8):
            normalized_key = generate_license_key()
            try:
                license_id = self.service.store.create_license(normalized_key, plan, expires_at, max_activations, email, note, "admin")
                self._send_json(
                    201,
                    {
                        "licenseKey": normalized_key,
                        "license": {"id": license_id, "plan": plan, "status": "active", "validUntil": expires_at, "maxActivations": max_activations},
                    },
                )
                return
            except sqlite3.IntegrityError:
                continue
        raise ServiceError(500, "license_generation_failed", "Не удалось сгенерировать уникальный ключ.")

    def _handle_admin_status(self, payload: dict[str, Any], action: str) -> None:
        try:
            license_id = int(payload.get("licenseId"))
        except (TypeError, ValueError) as exc:
            raise ServiceError(400, "invalid_license_id", "Идентификатор лицензии некорректен.") from exc
        changed = self.service.store.revoke(license_id) if action == "revoke" else self.service.store.restore(license_id)
        if not changed:
            raise ServiceError(404, "license_not_found", "Лицензия не найдена или уже имеет нужный статус.")
        self._send_json(200, {"ok": True})

    def _handle_admin_limit(self, payload: dict[str, Any]) -> None:
        license_id = parse_license_id(payload.get("licenseId"))
        try:
            max_activations = int(payload.get("maxActivations"))
        except (TypeError, ValueError, OverflowError) as exc:
            raise ServiceError(400, "invalid_license_limits", "Лимит устройств должен быть целым числом.") from exc
        if max_activations < 0 or max_activations > MAX_ACTIVATIONS_LIMIT:
            raise ServiceError(400, "invalid_license_limits", f"Лимит устройств должен быть от 0 до {MAX_ACTIVATIONS_LIMIT}.")
        if not self.service.store.set_max_activations(license_id, max_activations):
            raise ServiceError(404, "license_not_found", "Лицензия не найдена.")
        self._send_json(200, {"ok": True})

    def _handle_admin_device_deactivate(self, payload: dict[str, Any]) -> None:
        license_id = parse_license_id(payload.get("licenseId"))
        device_hash = payload.get("deviceHash")
        if not isinstance(device_hash, str) or not DEVICE_HASH_RE.fullmatch(device_hash):
            raise ServiceError(400, "invalid_device_hash", "Идентификатор устройства некорректен.")
        if not self.service.store.deactivate_by_hash(license_id, device_hash):
            raise ServiceError(404, "activation_not_found", "Активное устройство не найдено.")
        self._send_json(200, {"ok": True})

    def _handle_admin_trial_revoke(self, payload: dict[str, Any]) -> None:
        try:
            trial_id = int(payload.get("trialId"))
        except (TypeError, ValueError) as exc:
            raise ServiceError(400, "invalid_trial_id", "Идентификатор триала некорректен.") from exc
        if not self.service.store.revoke_trial(trial_id):
            raise ServiceError(404, "trial_not_found", "Триал не найден или уже отключён.")
        self._send_json(200, {"ok": True})


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Ограничивает число одновременных соединений, чтобы медленные клиенты не исчерпали потоки."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._request_slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self._request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


class LicenseHTTPService:
    def __init__(self, config: Configuration, store: LicenseStore, signer: EntitlementSigner):
        self.config = config
        self.store = store
        self.signer = signer
        self.rate_limiter = RateLimiter()

    def serve_forever(self) -> None:
        server = BoundedThreadingHTTPServer((self.config.host, self.config.port), LicenseRequestHandler)
        server.service = self  # type: ignore[attr-defined]
        print(
            f"Jackdaw license server listening on {self.config.host}:{self.config.port}; "
            f"store_configured={self.config.store_configured}",
            flush=True,
        )
        try:
            server.serve_forever()
        finally:
            server.server_close()


def main() -> None:
    config = Configuration()
    if not re.fullmatch(r"[0-9a-f]{64}", config.admin_token_sha256):
        raise RuntimeError("JACKDAW_ADMIN_TOKEN_SHA256 must be a 64-character SHA-256 digest")
    store = LicenseStore(config.database_path)
    signer = EntitlementSigner(config.private_key_path)
    LicenseHTTPService(config, store, signer).serve_forever()


if __name__ == "__main__":
    main()
