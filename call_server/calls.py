#!/usr/bin/env python3
"""Сигнальный сервис звонков Jackdaw Mail ↔ Jackdaw Mail.

Сервис не передаёт медиа. Он:
- проверяет лицензию или пробный период клиента по базе сервиса лицензий (только чтение);
- подтверждает владение email кодом из письма и выдаёт подписанное подтверждение;
- держит в памяти, какие подтверждённые адреса сейчас в сети;
- передаёт приглашение, ответ, отказ и завершение звонка;
- выдаёт короткоживущие токены LiveKit на одну комнату для двух участников.

Медиа идёт через LiveKit SFU со встроенным TURN. Контент звонка через этот сервис не проходит.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable, Iterable


PROTOCOL_VERSION = 1
EMAIL_RE = re.compile(r"^[^@\s]{1,128}@[^@\s]{1,190}$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
CALL_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
LICENSE_KEY_RE = re.compile(r"^JACKDAW-PRO-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$")
PROVIDER_LICENSE_KEY_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.IGNORECASE)
ACTIVE_LICENSE_STATUSES = frozenset({"active", "trial", "past_due"})

MAX_MESSAGE_BYTES = 16 * 1024
MAX_DISPLAY_NAME_LENGTH = 80
MAX_LOOKUP_EMAILS = 50
MAX_EMAILS_PER_CONNECTION = 20
RING_TIMEOUT_SECONDS = 45
# Короткий обрыв WebSocket не должен завершать идущий разговор: медиа идёт через LiveKit отдельно.
RECONNECT_GRACE_SECONDS = 30
MAX_CALL_DURATION_SECONDS = 4 * 60 * 60
CREDENTIAL_RECHECK_SECONDS = 15 * 60
VERIFICATION_CODE_TTL_SECONDS = 10 * 60
VERIFICATION_MAX_ATTEMPTS = 5
EMAIL_PROOF_TTL_SECONDS = 90 * 24 * 60 * 60
LIVEKIT_TOKEN_TTL_SECONDS = 15 * 60
RATE_WINDOW_SECONDS = 60
RATE_LIMITS = {
    "hello": 10,
    "lookup": 12,
    "invite": 10,
    "verify-start": 3,
    "verify-finish": 10,
    "default": 120,
}
# Отправка кода на один адрес ограничена отдельно от соединения: иначе можно засыпать чужой ящик письмами.
VERIFY_EMAIL_PER_HOUR = 3
# И на одну лицензию: иначе её владелец мог бы рассылать письма с кодом на произвольные адреса.
VERIFY_SUBJECT_PER_HOUR = 10


class CallError(Exception):
    """Ошибка, которую можно показать клиенту. `code` стабилен и переводится на клиенте."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_email(value: Any) -> str:
    if not isinstance(value, str):
        raise CallError("invalid_email", "Некорректный email.")
    email = value.strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise CallError("invalid_email", "Некорректный email.")
    return email


def normalize_display_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    # Управляющие символы из имени не должны попадать в интерфейс собеседника.
    cleaned = "".join(char for char in value if char.isprintable())
    return " ".join(cleaned.split())[:MAX_DISPLAY_NAME_LENGTH]


def normalize_license_key(value: Any) -> str:
    """Совпадает с license_server/app.py: хеш ключа должен получиться тем же."""
    if not isinstance(value, str):
        raise CallError("invalid_credential", "Некорректный лицензионный ключ.")
    provider_key = value.strip().lower()
    if PROVIDER_LICENSE_KEY_RE.fullmatch(provider_key):
        return provider_key
    compact = re.sub(r"[^A-Za-z0-9]", "", value).upper()
    if not compact.startswith("JACKDAWPRO") or len(compact) != 26:
        raise CallError("invalid_credential", "Некорректный лицензионный ключ.")
    formatted = "JACKDAW-PRO-" + "-".join(compact[index : index + 4] for index in range(10, 26, 4))
    if not LICENSE_KEY_RE.fullmatch(formatted):
        raise CallError("invalid_credential", "Некорректный лицензионный ключ.")
    return formatted


def validate_device_id(value: Any) -> str:
    if not isinstance(value, str) or not DEVICE_ID_RE.fullmatch(value):
        raise CallError("invalid_credential", "Некорректный идентификатор устройства.")
    return value


def validate_call_id(value: Any) -> str:
    if not isinstance(value, str) or not CALL_ID_RE.fullmatch(value):
        raise CallError("invalid_call_id", "Некорректный идентификатор звонка.")
    return value


# ---------------------------------------------------------------------------
# Проверка лицензии


@dataclass(frozen=True)
class Credential:
    """Проверенные учётные данные соединения.

    `subject` — к чему привязано подтверждение email: к лицензии целиком
    (любое её активированное устройство) или к устройству пробного периода.
    """

    subject: str
    device_hash: str
    kind: str


class CredentialVerifier:
    """Читает базу сервиса лицензий. Никогда в неё не пишет."""

    def __init__(self, database_path: Path):
        self.database_path = database_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA query_only = ON")
        return connection

    @staticmethod
    def _license_status(row: sqlite3.Row, current_time: datetime) -> str:
        """Повторяет LicenseStore._effective_status из license_server/app.py."""
        if row["status"] == "revoked":
            return "revoked"
        expires_at = parse_iso_datetime(row["expires_at"])
        if expires_at and current_time >= expires_at:
            return "expired"
        if row["status"] == "past_due":
            grace_until = parse_iso_datetime(row["grace_until"])
            if grace_until and current_time < grace_until:
                return "past_due"
            return "expired"
        return row["status"]

    def verify(self, payload: Any) -> Credential:
        if not isinstance(payload, dict):
            raise CallError("invalid_credential", "Нужна лицензия Jackdaw Pro или пробный период.")
        kind = payload.get("kind")
        device_id = validate_device_id(payload.get("deviceId"))
        device_hash = sha256_hex(device_id)
        current_time = now_utc()
        try:
            with contextlib.closing(self._connect()) as connection:
                if kind == "license":
                    key_hash = sha256_hex(normalize_license_key(payload.get("licenseKey")))
                    row = connection.execute("SELECT * FROM licenses WHERE key_hash = ?", (key_hash,)).fetchone()
                    if row is None or self._license_status(row, current_time) not in ACTIVE_LICENSE_STATUSES:
                        raise CallError("license_inactive", "Лицензия неактивна или срок её действия закончился.")
                    activation = connection.execute(
                        "SELECT 1 FROM activations WHERE license_id = ? AND device_hash = ? AND deactivated_at IS NULL",
                        (row["id"], device_hash),
                    ).fetchone()
                    if activation is None:
                        raise CallError("device_not_activated", "Это устройство не активировано лицензией.")
                    return Credential(subject=f"license:{row['id']}", device_hash=device_hash, kind="license")
                if kind == "trial":
                    row = connection.execute("SELECT * FROM trial_claims WHERE device_hash = ?", (device_hash,)).fetchone()
                    expires_at = parse_iso_datetime(row["expires_at"]) if row is not None else None
                    if row is None or row["status"] == "revoked" or not expires_at or current_time >= expires_at:
                        raise CallError("license_inactive", "Пробный период закончился или не запускался.")
                    return Credential(subject=f"trial:{device_hash}", device_hash=device_hash, kind="trial")
        except sqlite3.Error as exc:
            raise CallError("service_unavailable", "Сервис лицензий временно недоступен.") from exc
        raise CallError("invalid_credential", "Нужна лицензия Jackdaw Pro или пробный период.")


# ---------------------------------------------------------------------------
# Подписи: подтверждение email и токены LiveKit


class EmailProofSigner:
    """Подтверждение владения email без хранения состояния на сервере.

    Подтверждение привязано к `Credential.subject`: украденный токен без ключа
    лицензии этой же лицензии бесполезен.
    """

    PREFIX = "v1"

    def __init__(self, secret: bytes):
        if len(secret) < 32:
            raise RuntimeError("Секрет подтверждений email должен быть не короче 32 байт")
        self._secret = secret

    def _sign(self, body: str) -> str:
        return base64url_encode(hmac.new(self._secret, f"{self.PREFIX}.{body}".encode("ascii"), hashlib.sha256).digest())

    def issue(self, email: str, subject: str, now: float | None = None) -> str:
        issued = int(now if now is not None else time.time())
        body = base64url_encode(json.dumps(
            {"email": email, "sub": subject, "exp": issued + EMAIL_PROOF_TTL_SECONDS},
            separators=(",", ":"), sort_keys=True,
        ).encode("utf-8"))
        return f"{self.PREFIX}.{body}.{self._sign(body)}"

    def verify(self, token: Any, subject: str, now: float | None = None) -> str | None:
        """Возвращает email или None, если подтверждение подделано, просрочено или чужое."""
        if not isinstance(token, str) or len(token) > 1024:
            return None
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != self.PREFIX:
            return None
        if not hmac.compare_digest(self._sign(parts[1]), parts[2]):
            return None
        try:
            data = json.loads(base64url_decode(parts[1]))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict) or data.get("sub") != subject:
            return None
        expires = data.get("exp")
        if not isinstance(expires, int) or expires <= (now if now is not None else time.time()):
            return None
        try:
            return normalize_email(data.get("email"))
        except CallError:
            return None


class LiveKitTokenIssuer:
    """JWT HS256 по формату LiveKit Access Token. Права — только на одну комнату."""

    def __init__(self, url: str, api_key: str, api_secret: str):
        if not url.startswith("wss://"):
            raise RuntimeError("JACKDAW_LIVEKIT_URL должен начинаться с wss://")
        if not api_key or len(api_secret) < 32:
            raise RuntimeError("Ключ API LiveKit не задан или секрет короче 32 символов")
        self.url = url
        self._api_key = api_key
        self._api_secret = api_secret.encode("utf-8")

    def issue(self, room: str, identity: str, name: str, now: float | None = None) -> str:
        issued = int(now if now is not None else time.time())
        header = {"alg": "HS256", "typ": "JWT"}
        claims = {
            "iss": self._api_key,
            "sub": identity,
            "name": name,
            "nbf": issued - 10,
            "exp": issued + LIVEKIT_TOKEN_TTL_SECONDS,
            "video": {
                "room": room,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        }
        signing_input = ".".join(
            base64url_encode(json.dumps(part, separators=(",", ":")).encode("utf-8")) for part in (header, claims)
        )
        signature = hmac.new(self._api_secret, signing_input.encode("ascii"), hashlib.sha256).digest()
        return f"{signing_input}.{base64url_encode(signature)}"


# ---------------------------------------------------------------------------
# Отправка кода подтверждения


class Mailer:
    """Отправляет код подтверждения через SMTP. Без настроек подтверждение честно недоступно."""

    def __init__(self, host: str, port: int, username: str, password: str, sender: str):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.sender = sender

    @property
    def configured(self) -> bool:
        return bool(self.host and self.sender)

    def send_code(self, email: str, code: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = email
        message["Subject"] = f"Код подтверждения звонков Jackdaw Mail: {code}"
        message.set_content(
            "Кто-то указал этот адрес для звонков в Jackdaw Mail.\n\n"
            f"Код подтверждения: {code}\n\n"
            f"Код действует {VERIFICATION_CODE_TTL_SECONDS // 60} минут. "
            "Если это были не вы, просто удалите письмо: без кода адрес не подключится.\n"
        )
        with smtplib.SMTP(self.host, self.port, timeout=15) as smtp:
            smtp.starttls()
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(message)


@dataclass
class PendingVerification:
    code_hash: str
    subject: str
    expires_at: float
    attempts: int = 0


class EmailVerification:
    def __init__(self, signer: EmailProofSigner, clock: Callable[[], float] = time.time):
        self.signer = signer
        self._clock = clock
        self._pending: dict[str, PendingVerification] = {}
        self._sent: dict[str, deque[float]] = {}

    def start(self, email: str, subject: str) -> str:
        """Возвращает код для отправки. Повторный запрос заменяет прежний код."""
        current = self._clock()
        by_email = self._recent(f"email:{email}", current)
        by_subject = self._recent(f"subject:{subject}", current)
        if len(by_email) >= VERIFY_EMAIL_PER_HOUR or len(by_subject) >= VERIFY_SUBJECT_PER_HOUR:
            raise CallError("rate_limited", "Слишком много запросов кода. Попробуйте через час.")
        by_email.append(current)
        by_subject.append(current)
        code = f"{secrets.randbelow(1_000_000):06d}"
        self._pending[email] = PendingVerification(
            code_hash=sha256_hex(f"{email}:{code}"),
            subject=subject,
            expires_at=current + VERIFICATION_CODE_TTL_SECONDS,
        )
        self._cleanup(current)
        return code

    def _recent(self, key: str, current: float) -> deque[float]:
        sent = self._sent.setdefault(key, deque())
        while sent and current - sent[0] >= 3600:
            sent.popleft()
        return sent

    def finish(self, email: str, code: Any, subject: str) -> str:
        pending = self._pending.get(email)
        current = self._clock()
        if pending is None or pending.subject != subject or pending.expires_at <= current:
            raise CallError("code_expired", "Код устарел. Запросите новый.")
        pending.attempts += 1
        if not isinstance(code, str) or not hmac.compare_digest(pending.code_hash, sha256_hex(f"{email}:{code.strip()}")):
            if pending.attempts >= VERIFICATION_MAX_ATTEMPTS:
                self._pending.pop(email, None)
                raise CallError("code_expired", "Слишком много неверных попыток. Запросите новый код.")
            raise CallError("code_invalid", "Неверный код.")
        self._pending.pop(email, None)
        return self.signer.issue(email, subject)

    def _cleanup(self, current: float) -> None:
        if len(self._pending) >= 4096:
            for email in [key for key, value in self._pending.items() if value.expires_at <= current]:
                self._pending.pop(email, None)
        if len(self._sent) >= 4096:
            for key in [key for key, value in self._sent.items() if not value or current - value[-1] >= 3600]:
                self._sent.pop(key, None)


# ---------------------------------------------------------------------------
# Состояние звонков


class Peer:
    """Одно соединение клиента. `send` кладёт сообщение в очередь отправки и не блокирует."""

    def __init__(self, send: Callable[[dict[str, Any]], None], close: Callable[[], None] | None = None):
        self.peer_id = uuid.uuid4().hex
        self.send = send
        self.close = close or (lambda: None)
        self.credential: Credential | None = None
        self.credential_payload: Any = None
        self.credential_checked_at = 0.0
        self.emails: set[str] = set()
        self.display_name = ""
        self.rate: dict[str, deque[float]] = {}

    @property
    def identity_email(self) -> str | None:
        return min(self.emails) if self.emails else None


class CallState:
    RINGING = "ringing"
    ACTIVE = "active"


@dataclass
class Call:
    call_id: str
    room: str
    caller: Peer
    caller_email: str
    callee_email: str
    video: bool
    state: str = CallState.RINGING
    callee: Peer | None = None
    created_at: float = 0.0
    timers: list[Any] = field(default_factory=list)
    # peer_id → момент обрыва соединения участника идущего звонка
    disconnected: dict[str, float] = field(default_factory=dict)


class Scheduler:
    """Обёртка над loop.call_later, чтобы тесты могли управлять временем."""

    def call_later(self, delay: float, callback: Callable[[], None]) -> Any:
        return asyncio.get_running_loop().call_later(delay, callback)

    @staticmethod
    def cancel(handle: Any) -> None:
        handle.cancel()


class CallHub:
    """Вся логика сигналинга. Не зависит от транспорта, поэтому тестируется без сети."""

    def __init__(
        self,
        verifier: CredentialVerifier,
        verification: EmailVerification,
        livekit: LiveKitTokenIssuer,
        mailer: Mailer | None,
        scheduler: Scheduler | None = None,
        clock: Callable[[], float] = time.monotonic,
        send_mail: Callable[[str, str, Callable[[BaseException | None], None]], None] | None = None,
    ):
        self.verifier = verifier
        self.verification = verification
        self.livekit = livekit
        self.mailer = mailer
        self.scheduler = scheduler or Scheduler()
        self._clock = clock
        self._send_mail = send_mail
        self.peers_by_email: dict[str, set[Peer]] = {}
        self.calls: dict[str, Call] = {}

    # --- соединения ---------------------------------------------------

    def connected(self, peer: Peer) -> None:
        peer.send({"type": "server-hello", "protocol": PROTOCOL_VERSION})

    def disconnected(self, peer: Peer) -> None:
        for email in list(peer.emails):
            self._unregister(peer, email)
        for call in list(self.calls.values()):
            if call.state == CallState.RINGING:
                if call.caller is peer:
                    self._end(call, "cancelled", notify_caller=False)
                elif not self._online(call.callee_email):
                    # Пропали все устройства вызываемого: дальше звонить некуда.
                    self._end(call, "offline")
            elif call.caller is peer or call.callee is peer:
                call.disconnected[peer.peer_id] = self._clock()
                handle = self.scheduler.call_later(RECONNECT_GRACE_SECONDS, lambda c=call, p=peer: self._grace_expired(c, p))
                call.timers.append(handle)

    def handle(self, peer: Peer, message: Any) -> None:
        request_type = message.get("type") if isinstance(message, dict) else None
        if not isinstance(request_type, str):
            peer.send({"type": "error", "code": "invalid_message", "message": "Некорректное сообщение."})
            return
        try:
            self._check_rate(peer, request_type)
            if request_type == "ping":
                peer.send({"type": "pong"})
                return
            if request_type == "hello":
                self._hello(peer, message)
                return
            if peer.credential is None:
                raise CallError("not_authenticated", "Сначала нужна проверка лицензии.")
            self._recheck_credential(peer)
            handler = {
                "verify-start": self._verify_start,
                "verify-finish": self._verify_finish,
                "lookup": self._lookup,
                "invite": self._invite,
                "accept": self._accept,
                "reject": self._reject,
                "cancel": self._cancel,
                "hangup": self._hangup,
            }.get(request_type)
            if handler is None:
                raise CallError("unknown_type", "Неизвестный тип сообщения.")
            handler(peer, message)
        except CallError as error:
            reply: dict[str, Any] = {"type": "error", "code": error.code, "message": error.message, "requestType": request_type}
            if isinstance(message, dict):
                for key in ("callId", "requestId", "email"):
                    if isinstance(message.get(key), str) and len(message[key]) <= 256:
                        reply[key] = message[key]
            peer.send(reply)

    def _check_rate(self, peer: Peer, request_type: str) -> None:
        limit = RATE_LIMITS.get(request_type, RATE_LIMITS["default"])
        bucket = peer.rate.setdefault(request_type if request_type in RATE_LIMITS else "default", deque())
        current = self._clock()
        while bucket and current - bucket[0] >= RATE_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= limit:
            raise CallError("rate_limited", "Слишком много запросов. Попробуйте позже.")
        bucket.append(current)

    def _recheck_credential(self, peer: Peer) -> None:
        """Отозванная лицензия отключает звонки и у уже подключённых клиентов."""
        if self._clock() - peer.credential_checked_at < CREDENTIAL_RECHECK_SECONDS:
            return
        try:
            credential = self.verifier.verify(peer.credential_payload)
        except CallError as error:
            if error.code == "service_unavailable":
                return
            for email in list(peer.emails):
                self._unregister(peer, email)
            peer.credential = None
            peer.send({"type": "error", "code": error.code, "message": error.message, "requestType": "hello"})
            peer.close()
            raise
        peer.credential = credential
        peer.credential_checked_at = self._clock()

    # --- вход и подтверждение email -----------------------------------

    def _hello(self, peer: Peer, message: dict[str, Any]) -> None:
        credential = self.verifier.verify(message.get("credential"))
        for email in list(peer.emails):
            self._unregister(peer, email)
        peer.credential = credential
        peer.credential_payload = message.get("credential")
        peer.credential_checked_at = self._clock()
        peer.display_name = normalize_display_name(message.get("name"))
        proofs = message.get("emailProofs")
        accepted: list[str] = []
        if isinstance(proofs, list):
            for proof in proofs[:MAX_EMAILS_PER_CONNECTION]:
                email = self.verification.signer.verify(proof, credential.subject)
                if email and email not in accepted:
                    accepted.append(email)
        for email in accepted:
            self._register(peer, email)
        resumed = self._resume_calls(peer, message.get("activeCalls"))
        peer.send({"type": "welcome", "emails": sorted(accepted), "resumedCalls": resumed})

    def _resume_calls(self, peer: Peer, call_ids: Any) -> list[str]:
        """После переподключения возвращаем соединению его идущие звонки."""
        resumed: list[str] = []
        if not isinstance(call_ids, list):
            return resumed
        for call_id in call_ids[:4]:
            call = self.calls.get(call_id) if isinstance(call_id, str) else None
            if call is None or call.state != CallState.ACTIVE:
                continue
            if call.caller_email in peer.emails and call.caller.credential and call.caller.credential.device_hash == peer.credential.device_hash:
                call.disconnected.pop(call.caller.peer_id, None)
                call.caller = peer
            elif call.callee_email in peer.emails and call.callee and call.callee.credential and call.callee.credential.device_hash == peer.credential.device_hash:
                call.disconnected.pop(call.callee.peer_id, None)
                call.callee = peer
            else:
                continue
            resumed.append(call.call_id)
        return resumed

    def _verify_start(self, peer: Peer, message: dict[str, Any]) -> None:
        email = normalize_email(message.get("email"))
        if self.mailer is None or not self.mailer.configured or self._send_mail is None:
            raise CallError("verification_unavailable", "Подтверждение адресов на сервере не настроено.")
        assert peer.credential is not None
        code = self.verification.start(email, peer.credential.subject)

        def sent(error: BaseException | None) -> None:
            if error is None:
                peer.send({"type": "verify-sent", "email": email})
            else:
                peer.send({"type": "error", "code": "mail_failed", "message": "Не удалось отправить письмо с кодом.",
                           "requestType": "verify-start", "email": email})

        self._send_mail(email, code, sent)

    def _verify_finish(self, peer: Peer, message: dict[str, Any]) -> None:
        email = normalize_email(message.get("email"))
        assert peer.credential is not None
        proof = self.verification.finish(email, message.get("code"), peer.credential.subject)
        if len(peer.emails) < MAX_EMAILS_PER_CONNECTION:
            self._register(peer, email)
        peer.send({"type": "verified", "email": email, "proof": proof})

    def _register(self, peer: Peer, email: str) -> None:
        peer.emails.add(email)
        self.peers_by_email.setdefault(email, set()).add(peer)

    def _unregister(self, peer: Peer, email: str) -> None:
        peer.emails.discard(email)
        peers = self.peers_by_email.get(email)
        if peers is not None:
            peers.discard(peer)
            if not peers:
                self.peers_by_email.pop(email, None)

    def _online(self, email: str) -> bool:
        return bool(self.peers_by_email.get(email))

    # --- справочник -----------------------------------------------------

    def _lookup(self, peer: Peer, message: dict[str, Any]) -> None:
        emails = message.get("emails")
        if not isinstance(emails, list) or len(emails) > MAX_LOOKUP_EMAILS:
            raise CallError("invalid_lookup", f"Нужен список не более чем из {MAX_LOOKUP_EMAILS} адресов.")
        reachable: dict[str, bool] = {}
        for value in emails:
            try:
                email = normalize_email(value)
            except CallError:
                continue
            reachable[email] = self._online(email) and email not in peer.emails
        reply: dict[str, Any] = {"type": "lookup-result", "reachable": reachable}
        if isinstance(message.get("requestId"), str):
            reply["requestId"] = message["requestId"][:64]
        peer.send(reply)

    # --- звонки -----------------------------------------------------------

    def _busy(self, email: str) -> bool:
        return any(call.caller_email == email or call.callee_email == email for call in self.calls.values())

    def _invite(self, peer: Peer, message: dict[str, Any]) -> None:
        call_id = validate_call_id(message.get("callId"))
        if call_id in self.calls:
            raise CallError("invalid_call_id", "Звонок с таким идентификатором уже есть.")
        if not peer.emails:
            raise CallError("not_verified", "Подтвердите свой адрес, чтобы звонить.")
        callee_email = normalize_email(message.get("to"))
        requested_from = message.get("from")
        caller_email = normalize_email(requested_from) if requested_from else peer.identity_email
        if caller_email not in peer.emails:
            raise CallError("not_verified", "Этот адрес не подтверждён.")
        if callee_email in peer.emails:
            raise CallError("call_self", "Нельзя позвонить самому себе.")
        video = message.get("video") is True
        if not self._online(callee_email):
            peer.send({"type": "call-ended", "callId": call_id, "reason": "offline"})
            return
        if self._busy(callee_email):
            peer.send({"type": "call-ended", "callId": call_id, "reason": "busy"})
            return
        call = Call(
            call_id=call_id,
            room=f"call-{uuid.uuid4().hex}",
            caller=peer,
            caller_email=caller_email,
            callee_email=callee_email,
            video=video,
            created_at=self._clock(),
        )
        self.calls[call_id] = call
        call.timers.append(self.scheduler.call_later(RING_TIMEOUT_SECONDS, lambda: self._ring_timeout(call)))
        incoming = {
            "type": "incoming",
            "callId": call_id,
            "from": caller_email,
            "fromName": peer.display_name,
            "to": callee_email,
            "video": video,
        }
        for callee_peer in list(self.peers_by_email.get(callee_email, ())):
            callee_peer.send(incoming)
        peer.send({"type": "ringing", "callId": call_id})

    def _call_for(self, message: dict[str, Any]) -> Call:
        call = self.calls.get(validate_call_id(message.get("callId")))
        if call is None:
            raise CallError("call_not_found", "Звонок уже завершён.")
        return call

    def _accept(self, peer: Peer, message: dict[str, Any]) -> None:
        call = self._call_for(message)
        if call.state != CallState.RINGING or call.callee_email not in peer.emails:
            raise CallError("call_not_found", "Звонок уже завершён.")
        call.state = CallState.ACTIVE
        call.callee = peer
        self._cancel_timers(call)
        call.timers.append(self.scheduler.call_later(MAX_CALL_DURATION_SECONDS, lambda: self._end(call, "timeout")))
        caller_name = call.caller.display_name or call.caller_email
        callee_name = peer.display_name or call.callee_email
        call.caller.send({
            "type": "accepted",
            "callId": call.call_id,
            "livekitURL": self.livekit.url,
            "token": self.livekit.issue(call.room, f"{call.caller_email}#{secrets.token_hex(4)}", caller_name),
        })
        peer.send({
            "type": "joined",
            "callId": call.call_id,
            "livekitURL": self.livekit.url,
            "token": self.livekit.issue(call.room, f"{call.callee_email}#{secrets.token_hex(4)}", callee_name),
        })
        for other in list(self.peers_by_email.get(call.callee_email, ())):
            if other is not peer:
                other.send({"type": "call-ended", "callId": call.call_id, "reason": "answered-elsewhere"})

    def _reject(self, peer: Peer, message: dict[str, Any]) -> None:
        call = self._call_for(message)
        if call.state != CallState.RINGING or call.callee_email not in peer.emails:
            raise CallError("call_not_found", "Звонок уже завершён.")
        # «Занято» отвечает клиент, у которого уже идёт другая встреча.
        self._end(call, "busy" if message.get("reason") == "busy" else "declined", skip=peer)

    def _cancel(self, peer: Peer, message: dict[str, Any]) -> None:
        call = self._call_for(message)
        if call.caller is not peer:
            raise CallError("call_not_found", "Звонок уже завершён.")
        self._end(call, "cancelled", skip=peer)

    def _hangup(self, peer: Peer, message: dict[str, Any]) -> None:
        call = self._call_for(message)
        if peer is not call.caller and peer is not call.callee:
            raise CallError("call_not_found", "Звонок уже завершён.")
        self._end(call, "hangup" if call.state == CallState.ACTIVE else "cancelled", skip=peer)

    def _ring_timeout(self, call: Call) -> None:
        if self.calls.get(call.call_id) is call and call.state == CallState.RINGING:
            self._end(call, "no-answer")

    def _grace_expired(self, call: Call, peer: Peer) -> None:
        if self.calls.get(call.call_id) is call and peer.peer_id in call.disconnected:
            self._end(call, "connection-lost", skip=peer)

    def _cancel_timers(self, call: Call) -> None:
        for handle in call.timers:
            self.scheduler.cancel(handle)
        call.timers.clear()

    def _end(self, call: Call, reason: str, skip: Peer | None = None, notify_caller: bool = True) -> None:
        if self.calls.pop(call.call_id, None) is None:
            return
        self._cancel_timers(call)
        ended = {"type": "call-ended", "callId": call.call_id, "reason": reason}
        recipients: list[Peer] = []
        if notify_caller:
            recipients.append(call.caller)
        if call.state == CallState.ACTIVE:
            if call.callee is not None:
                recipients.append(call.callee)
        else:
            recipients.extend(self.peers_by_email.get(call.callee_email, ()))
        for recipient in recipients:
            if recipient is not skip:
                recipient.send(ended)


# ---------------------------------------------------------------------------
# Конфигурация и запуск


def read_secret(env_name: str) -> str:
    """Секреты читаются из файла, путь которого задан в переменной `<NAME>_FILE`."""
    path = os.getenv(f"{env_name}_FILE", "").strip()
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError(f"Не удалось прочитать {env_name}_FILE: {path}") from exc
    return os.getenv(env_name, "").strip()


def build_hub_from_environment() -> tuple[CallHub, str, int]:
    database_path = Path(os.getenv("JACKDAW_LICENSE_DB", "/var/lib/jackdaw-license/license.sqlite3"))
    host = os.getenv("JACKDAW_CALLS_HOST", "127.0.0.1")
    port = int(os.getenv("JACKDAW_CALLS_PORT", "8091"))
    proof_secret = read_secret("JACKDAW_CALLS_PROOF_SECRET")
    livekit = LiveKitTokenIssuer(
        os.getenv("JACKDAW_LIVEKIT_URL", "").strip(),
        os.getenv("JACKDAW_LIVEKIT_API_KEY", "").strip(),
        read_secret("JACKDAW_LIVEKIT_API_SECRET"),
    )
    mailer = Mailer(
        os.getenv("JACKDAW_CALLS_SMTP_HOST", "").strip(),
        int(os.getenv("JACKDAW_CALLS_SMTP_PORT", "587")),
        os.getenv("JACKDAW_CALLS_SMTP_USER", "").strip(),
        read_secret("JACKDAW_CALLS_SMTP_PASSWORD"),
        os.getenv("JACKDAW_CALLS_MAIL_FROM", "").strip(),
    )
    verification = EmailVerification(EmailProofSigner(proof_secret.encode("utf-8")))

    def send_mail(email: str, code: str, done: Callable[[BaseException | None], None]) -> None:
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(None, mailer.send_code, email, code)

        def finished(result: "asyncio.Future[None]") -> None:
            error = result.exception()
            if error is not None:
                print(f"SMTP error for verification mail: {type(error).__name__}", flush=True)
            done(error)

        future.add_done_callback(finished)

    hub = CallHub(CredentialVerifier(database_path), verification, livekit, mailer, send_mail=send_mail)
    return hub, host, port


async def serve(hub: CallHub, host: str, port: int) -> None:
    from websockets.asyncio.server import serve as websocket_serve
    from websockets.exceptions import ConnectionClosed

    async def connection_handler(websocket: Any) -> None:
        if websocket.request.path.split("?")[0] != "/v1/calls":
            await websocket.close(code=1008, reason="not found")
            return
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(maxsize=256)

        def send(message: dict[str, Any]) -> None:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Клиент не читает сообщения: закрываем, а не копим память.
                close()

        def close() -> None:
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                asyncio.get_running_loop().create_task(websocket.close(code=1008, reason="slow consumer"))

        peer = Peer(send, close)

        async def writer() -> None:
            try:
                while True:
                    message = await queue.get()
                    if message is None:
                        await websocket.close(code=1008, reason="closed by server")
                        return
                    await websocket.send(json.dumps(message, ensure_ascii=False, separators=(",", ":")))
            except ConnectionClosed:
                return

        writer_task = asyncio.create_task(writer())
        hub.connected(peer)
        try:
            async for raw in websocket:
                if not isinstance(raw, str) or len(raw) > MAX_MESSAGE_BYTES:
                    peer.send({"type": "error", "code": "invalid_message", "message": "Некорректное сообщение."})
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    peer.send({"type": "error", "code": "invalid_message", "message": "Некорректное сообщение."})
                    continue
                hub.handle(peer, message)
        except ConnectionClosed:
            pass
        finally:
            hub.disconnected(peer)
            writer_task.cancel()

    async with websocket_serve(
        connection_handler,
        host,
        port,
        max_size=MAX_MESSAGE_BYTES,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=5,
    ) as server:
        print(f"Jackdaw call signaling listening on {host}:{port}", flush=True)
        await server.serve_forever()


def main() -> None:
    hub, host, port = build_hub_from_environment()
    asyncio.run(serve(hub, host, port))


if __name__ == "__main__":
    main()
