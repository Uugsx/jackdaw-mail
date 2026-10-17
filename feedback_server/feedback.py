"""Сервис обратной связи Jackdaw Mail.

Принимает POST /v1/feedback из приложения и рассылает отзыв владельцу:
письмом (SMTP), в Telegram (бот) и — для ошибок — issue в GitHub.

Безопасность:
- Токены Telegram/GitHub и пароль SMTP живут только на сервере, в файлах 0440.
  В приложении никаких секретов нет: оно знает лишь адрес /v1/feedback.
- Тело запроса ограничено по размеру, поля проверяются по белому списку,
  управляющие символы вырезаются. Неизвестные поля отклоняются.
- Ограничение частоты по IP и по устройству (окно 10 минут и сутки), общий
  суточный лимит, отдельные суточные квоты на issue в GitHub и на письма
  (квота Resend общая с кодами подтверждения звонков — её нельзя выжечь спамом).
  Повторы одного и того же текста отбрасываются, поле-ловушка для ботов.
- Устройство передаётся только хешем SHA-256 от ID устройства: сам ID участвует
  в проверке лицензии и сюда не попадает.
- В issue на GitHub не попадают адрес для ответа и IP: только тип, текст,
  версия и ОС. Текст ставится в блок кода — упоминания @ и ссылки не срабатывают.
- Telegram получает простой текст без разметки (parse_mode не задаётся).
- В журнал пишутся только идентификатор отзыва, тип и результат доставки.
- Доставка идёт в фоновом потоке с таймаутами; очередь ограничена.

Только стандартная библиотека Python 3.11+.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import secrets
import smtplib
import ssl
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

FEEDBACK_PATH = "/v1/feedback"
MAX_BODY_BYTES = 32 * 1024
MIN_MESSAGE_CHARS = 5
MAX_MESSAGE_CHARS = 5000
MAX_EMAIL_CHARS = 254
KINDS = {"bug": "Ошибка", "idea": "Предложение", "other": "Другое"}
ALLOWED_FIELDS = {"kind", "message", "contactEmail", "diagnostics", "website", "device"}
DEVICE_RE = re.compile(r"^[0-9a-f]{64}$")
DIAGNOSTIC_FIELDS = {
    "appVersion": re.compile(r"^[0-9A-Za-z.+_-]{1,64}$"),
    "platform": re.compile(r"^[0-9A-Za-z ._()-]{1,40}$"),
    "osVersion": re.compile(r"^[0-9A-Za-z ._()/-]{1,64}$"),
    "locale": re.compile(r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$"),
}
EMAIL_RE = re.compile(r"^[^@\s<>\"',;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$")

PER_IP_WINDOW_SECONDS = 10 * 60
PER_IP_WINDOW_LIMIT = 3
PER_IP_DAY_LIMIT = 10
PER_DEVICE_WINDOW_LIMIT = 3
PER_DEVICE_DAY_LIMIT = 10
GLOBAL_DAY_LIMIT = 50
GITHUB_DAY_LIMIT = 20
EMAIL_DAY_LIMIT = 20
DUPLICATE_WINDOW_SECONDS = 60 * 60
DAY_SECONDS = 24 * 60 * 60
QUEUE_SIZE = 100
NETWORK_TIMEOUT_SECONDS = 15
TELEGRAM_TEXT_LIMIT = 3500
GITHUB_TITLE_CHARS = 80


class FeedbackError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Feedback:
    id: str
    kind: str
    message: str
    contact_email: str | None
    diagnostics: dict[str, str] = field(default_factory=dict)
    device: str = ""


# ───────────── Проверка входных данных ─────────────

def clean_text(value: str) -> str:
    """Нормализует Unicode и убирает управляющие символы, кроме перевода строки и табуляции."""
    value = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    return "".join(ch for ch in value if ch in "\n\t" or unicodedata.category(ch)[0] != "C").strip()


def parse_feedback(raw: Any) -> Feedback | None:
    """Проверяет тело запроса. None — сработала ловушка для ботов (тихо отбрасываем)."""
    if not isinstance(raw, dict):
        raise FeedbackError(400, "invalid_body", "Ожидается JSON-объект.")
    unknown = set(raw) - ALLOWED_FIELDS
    if unknown:
        raise FeedbackError(400, "unknown_fields", "Неизвестные поля в запросе.")
    if raw.get("website"):
        return None

    device = raw.get("device")
    if not isinstance(device, str) or not DEVICE_RE.match(device):
        raise FeedbackError(400, "invalid_device", "Отзыв можно отправить только из приложения Jackdaw Mail.")

    kind = raw.get("kind")
    if kind not in KINDS:
        raise FeedbackError(400, "invalid_kind", "Неизвестный тип отзыва.")

    message = raw.get("message")
    if not isinstance(message, str):
        raise FeedbackError(400, "invalid_message", "Нужен текст отзыва.")
    message = clean_text(message)
    if len(message) < MIN_MESSAGE_CHARS:
        raise FeedbackError(400, "message_too_short", "Текст отзыва слишком короткий.")
    if len(message) > MAX_MESSAGE_CHARS:
        raise FeedbackError(400, "message_too_long", "Текст отзыва слишком длинный.")

    contact = raw.get("contactEmail")
    contact_email = None
    if contact not in (None, ""):
        if not isinstance(contact, str):
            raise FeedbackError(400, "invalid_email", "Неверный адрес для ответа.")
        contact = contact.strip()
        if len(contact) > MAX_EMAIL_CHARS or not EMAIL_RE.match(contact):
            raise FeedbackError(400, "invalid_email", "Неверный адрес для ответа.")
        contact_email = contact

    diagnostics: dict[str, str] = {}
    raw_diagnostics = raw.get("diagnostics")
    if raw_diagnostics not in (None, {}):
        if not isinstance(raw_diagnostics, dict) or set(raw_diagnostics) - set(DIAGNOSTIC_FIELDS):
            raise FeedbackError(400, "invalid_diagnostics", "Неверные сведения о системе.")
        for name, value in raw_diagnostics.items():
            if value in (None, ""):
                continue
            if not isinstance(value, str) or not DIAGNOSTIC_FIELDS[name].match(value):
                raise FeedbackError(400, "invalid_diagnostics", "Неверные сведения о системе.")
            diagnostics[name] = value

    return Feedback(secrets.token_hex(4), kind, message, contact_email, diagnostics, device)


# ───────────── Ограничение частоты ─────────────

class AbuseGuard:
    """Лимиты по IP и устройству, общий суточный лимит и отсев повторов. Всё в памяти процесса."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, global_day_limit: int = GLOBAL_DAY_LIMIT):
        self._clock = clock
        self._global_day_limit = global_day_limit
        self._lock = threading.Lock()
        self._per_ip: dict[str, deque[float]] = {}
        self._per_device: dict[str, deque[float]] = {}
        self._global: deque[float] = deque()
        self._recent: dict[str, float] = {}

    @staticmethod
    def _over(hits: deque[float], now: float, window_limit: int, day_limit: int) -> bool:
        in_window = sum(1 for at in hits if now - at < PER_IP_WINDOW_SECONDS)
        return in_window >= window_limit or len(hits) >= day_limit

    def check(self, ip: str, fingerprint: str, device: str = "") -> bool:
        """True — отзыв нужно доставить; False — повтор, тихо отбрасываем. Превышение лимита — исключение."""
        now = self._clock()
        with self._lock:
            self._expire(now)
            ip_hits = self._per_ip.setdefault(ip, deque())
            device_hits = self._per_device.setdefault(device, deque()) if device else None
            if (self._over(ip_hits, now, PER_IP_WINDOW_LIMIT, PER_IP_DAY_LIMIT)
                    or device_hits is not None and self._over(device_hits, now, PER_DEVICE_WINDOW_LIMIT, PER_DEVICE_DAY_LIMIT)
                    or len(self._global) >= self._global_day_limit):
                raise FeedbackError(429, "rate_limited", "Слишком много отзывов. Попробуйте позже.")
            ip_hits.append(now)
            if device_hits is not None:
                device_hits.append(now)
            self._global.append(now)
            if fingerprint in self._recent:
                return False
            self._recent[fingerprint] = now
            return True

    def _expire(self, now: float) -> None:
        for buckets in (self._per_ip, self._per_device):
            for key in list(buckets):
                hits = buckets[key]
                while hits and now - hits[0] >= DAY_SECONDS:
                    hits.popleft()
                if not hits:
                    del buckets[key]
        while self._global and now - self._global[0] >= DAY_SECONDS:
            self._global.popleft()
        for key, at in list(self._recent.items()):
            if now - at >= DUPLICATE_WINDOW_SECONDS:
                del self._recent[key]


class DailyQuota:
    """Скользящая суточная квота одного канала доставки."""

    def __init__(self, limit: int, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: deque[float] = deque()

    def take(self) -> bool:
        now = self._clock()
        with self._lock:
            while self._hits and now - self._hits[0] >= DAY_SECONDS:
                self._hits.popleft()
            if len(self._hits) >= self.limit:
                return False
            self._hits.append(now)
            return True


def fingerprint(feedback: Feedback) -> str:
    normalized = re.sub(r"\s+", " ", feedback.message.casefold())
    return hashlib.sha256(f"{feedback.kind}\n{normalized}".encode()).hexdigest()


# ───────────── Оформление сообщений ─────────────

def diagnostics_lines(feedback: Feedback) -> list[str]:
    labels = {"appVersion": "Версия", "platform": "Платформа", "osVersion": "ОС", "locale": "Язык"}
    return [f"{labels[name]}: {value}" for name, value in feedback.diagnostics.items()]


def first_line(text: str, limit: int) -> str:
    line = text.strip().split("\n", 1)[0].strip()
    return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"


def email_subject(feedback: Feedback) -> str:
    return f"[Jackdaw · {KINDS[feedback.kind]}] {first_line(feedback.message, 70)}"


def email_body(feedback: Feedback, issue_url: str | None) -> str:
    parts = [f"Тип: {KINDS[feedback.kind]}", f"ID: {feedback.id}"]
    parts.append(f"Ответить: {feedback.contact_email}" if feedback.contact_email else "Ответить: адрес не указан")
    parts += diagnostics_lines(feedback)
    if issue_url:
        parts.append(f"Issue: {issue_url}")
    return "\n".join(parts) + "\n\n" + feedback.message + "\n"


def telegram_text(feedback: Feedback, issue_url: str | None, notes: list[str] | None = None) -> str:
    header = [f"{KINDS[feedback.kind]} · #{feedback.id}"]
    if feedback.contact_email:
        header.append(f"Ответить: {feedback.contact_email}")
    header += diagnostics_lines(feedback)
    if issue_url:
        header.append(f"Issue: {issue_url}")
    header += notes or []
    text = "\n".join(header) + "\n\n" + feedback.message
    return text if len(text) <= TELEGRAM_TEXT_LIMIT else text[: TELEGRAM_TEXT_LIMIT - 1] + "…"


def neutralize_mentions(text: str) -> str:
    """В заголовке issue @ не должен никого упоминать."""
    return text.replace("@", "@​")


def code_fence(text: str) -> str:
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}text\n{text}\n{fence}"


def github_issue(feedback: Feedback) -> dict[str, Any]:
    """Issue без адреса для ответа и IP: только суть ошибки и сведения о системе."""
    title = neutralize_mentions(f"[Отзыв] {first_line(feedback.message, GITHUB_TITLE_CHARS)}")
    meta = [f"- ID отзыва: `{feedback.id}`"] + [f"- {line}" for line in diagnostics_lines(feedback)]
    body = (
        "Создано автоматически из формы обратной связи в приложении.\n\n"
        + "\n".join(meta)
        + "\n\n**Описание пользователя:**\n\n"
        + code_fence(feedback.message)
        + "\n"
    )
    return {"title": title, "body": body}


# ───────────── Каналы доставки ─────────────

def read_secret(path: str | None) -> str | None:
    if not path:
        return None
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Не удалось прочитать секрет {path}") from exc
    return value or None


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8092
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    mail_from: str | None = None
    mail_to: str | None = None
    telegram_token: str | None = None
    telegram_chat_id: str | None = None
    telegram_thread_id: int | None = None
    github_token: str | None = None
    github_repo: str | None = None
    github_labels: list[str] = field(default_factory=lambda: ["bug", "feedback"])
    daily_limit: int = GLOBAL_DAY_LIMIT
    github_daily_limit: int = GITHUB_DAY_LIMIT
    email_daily_limit: int = EMAIL_DAY_LIMIT

    @classmethod
    def from_environment(cls) -> "Settings":
        env = os.environ.get
        settings = cls(
            host=env("JACKDAW_FEEDBACK_HOST", "127.0.0.1"),
            port=int(env("JACKDAW_FEEDBACK_PORT", "8092")),
            smtp_host=env("JACKDAW_FEEDBACK_SMTP_HOST") or None,
            smtp_port=int(env("JACKDAW_FEEDBACK_SMTP_PORT", "587")),
            smtp_user=env("JACKDAW_FEEDBACK_SMTP_USER") or None,
            smtp_password=read_secret(env("JACKDAW_FEEDBACK_SMTP_PASSWORD_FILE")),
            mail_from=env("JACKDAW_FEEDBACK_MAIL_FROM") or None,
            mail_to=env("JACKDAW_FEEDBACK_MAIL_TO") or None,
            telegram_token=read_secret(env("JACKDAW_FEEDBACK_TELEGRAM_TOKEN_FILE")),
            telegram_chat_id=env("JACKDAW_FEEDBACK_TELEGRAM_CHAT_ID") or None,
            telegram_thread_id=int(env("JACKDAW_FEEDBACK_TELEGRAM_THREAD_ID")) if env("JACKDAW_FEEDBACK_TELEGRAM_THREAD_ID") else None,
            github_token=read_secret(env("JACKDAW_FEEDBACK_GITHUB_TOKEN_FILE")),
            github_repo=env("JACKDAW_FEEDBACK_GITHUB_REPO") or None,
            daily_limit=int(env("JACKDAW_FEEDBACK_DAILY_LIMIT") or GLOBAL_DAY_LIMIT),
            github_daily_limit=int(env("JACKDAW_FEEDBACK_GITHUB_DAILY_LIMIT") or GITHUB_DAY_LIMIT),
            email_daily_limit=int(env("JACKDAW_FEEDBACK_EMAIL_DAILY_LIMIT") or EMAIL_DAY_LIMIT),
        )
        labels = env("JACKDAW_FEEDBACK_GITHUB_LABELS")
        if labels is not None:
            settings.github_labels = [label.strip() for label in labels.split(",") if label.strip()]
        if settings.github_repo and not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", settings.github_repo):
            raise RuntimeError("JACKDAW_FEEDBACK_GITHUB_REPO должен иметь вид owner/name")
        return settings

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_password and self.mail_from and self.mail_to)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_token and self.telegram_chat_id)

    @property
    def github_enabled(self) -> bool:
        return bool(self.github_token and self.github_repo)


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "jackdaw-feedback", **headers},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT_SECONDS, context=ssl.create_default_context()) as response:
        return json.loads(response.read(1024 * 1024) or b"{}")


class Deliverer:
    def __init__(self, settings: Settings, post: Callable[..., dict[str, Any]] = post_json,
                 smtp_factory: Callable[..., Any] = smtplib.SMTP, clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self._post = post
        self._smtp_factory = smtp_factory
        self.github_quota = DailyQuota(settings.github_daily_limit, clock)
        self.email_quota = DailyQuota(settings.email_daily_limit, clock)

    def deliver(self, feedback: Feedback) -> dict[str, str]:
        """Доставляет по всем настроенным каналам; ошибка одного канала не мешает другим."""
        results: dict[str, str] = {}
        notes: list[str] = []
        issue_url = None
        if feedback.kind == "bug" and self.settings.github_enabled:
            if not self.github_quota.take():
                results["github"] = "skipped:quota"
                notes.append("Issue не создан: суточный лимит issue исчерпан.")
            else:
                try:
                    issue_url = self.create_issue(feedback)
                    results["github"] = "ok"
                except Exception as exc:  # noqa: BLE001 — канал не должен ронять остальные
                    results["github"] = f"error:{type(exc).__name__}"
        send_email = self.settings.email_enabled and self.email_quota.take()
        if self.settings.email_enabled and not send_email:
            results["email"] = "skipped:quota"
            notes.append("Письмо не отправлено: суточный лимит писем исчерпан.")
        if self.settings.telegram_enabled:
            try:
                self.send_telegram(feedback, issue_url, notes)
                results["telegram"] = "ok"
            except Exception as exc:  # noqa: BLE001
                results["telegram"] = f"error:{type(exc).__name__}"
        if send_email:
            try:
                self.send_email(feedback, issue_url)
                results["email"] = "ok"
            except Exception as exc:  # noqa: BLE001
                results["email"] = f"error:{type(exc).__name__}"
        return results

    def create_issue(self, feedback: Feedback) -> str | None:
        payload = github_issue(feedback)
        if self.settings.github_labels:
            payload["labels"] = self.settings.github_labels
        response = self._post(
            f"https://api.github.com/repos/{self.settings.github_repo}/issues",
            payload,
            {
                "Authorization": f"Bearer {self.settings.github_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        url = response.get("html_url")
        return url if isinstance(url, str) and url.startswith("https://github.com/") else None

    def send_telegram(self, feedback: Feedback, issue_url: str | None, notes: list[str] | None = None) -> None:
        payload: dict[str, Any] = {
            "chat_id": self.settings.telegram_chat_id,
            "text": telegram_text(feedback, issue_url, notes),
            "disable_web_page_preview": True,
        }
        if self.settings.telegram_thread_id is not None:
            payload["message_thread_id"] = self.settings.telegram_thread_id
        response = self._post(f"https://api.telegram.org/bot{self.settings.telegram_token}/sendMessage", payload, {})
        if not response.get("ok"):
            raise RuntimeError("Telegram отклонил сообщение")

    def send_email(self, feedback: Feedback, issue_url: str | None) -> None:
        message = EmailMessage()
        message["From"] = self.settings.mail_from
        message["To"] = self.settings.mail_to
        message["Subject"] = email_subject(feedback)
        if feedback.contact_email:
            message["Reply-To"] = formataddr(("", parseaddr(feedback.contact_email)[1]))
        message.set_content(email_body(feedback, issue_url))
        with self._smtp_factory(self.settings.smtp_host, self.settings.smtp_port, timeout=NETWORK_TIMEOUT_SECONDS) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if self.settings.smtp_user:
                smtp.login(self.settings.smtp_user, self.settings.smtp_password)
            smtp.send_message(message)


# ───────────── HTTP ─────────────

class FeedbackService:
    def __init__(self, deliverer: Deliverer, guard: AbuseGuard | None = None, log: Callable[[str], None] | None = None):
        self.deliverer = deliverer
        self.guard = guard or AbuseGuard()
        self.log = log or (lambda line: print(line, file=sys.stderr, flush=True))
        self.queue: queue.Queue[Feedback] = queue.Queue(QUEUE_SIZE)

    def submit(self, raw: Any, ip: str) -> str:
        feedback = parse_feedback(raw)
        if feedback is None:
            return secrets.token_hex(4)
        if not self.guard.check(ip, fingerprint(feedback), feedback.device):
            return feedback.id
        try:
            self.queue.put_nowait(feedback)
        except queue.Full as exc:
            raise FeedbackError(503, "busy", "Сервис перегружен. Попробуйте позже.") from exc
        return feedback.id

    def run_worker(self) -> None:
        while True:
            feedback = self.queue.get()
            results = self.deliverer.deliver(feedback)
            summary = ", ".join(f"{name}={state}" for name, state in results.items()) or "нет настроенных каналов"
            self.log(f"feedback {feedback.id} kind={feedback.kind}: {summary}")
            self.queue.task_done()


def make_handler(service: FeedbackService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "jackdaw-feedback"
        sys_version = ""

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            # Не пишем в журнал ни тело, ни адреса клиентов.
            return

        def _client_ip(self) -> str:
            # Сервис слушает только 127.0.0.1 за Caddy: доверяем X-Forwarded-For
            # лишь от локального прокси, иначе — адрес соединения.
            peer = self.client_address[0]
            forwarded = self.headers.get("X-Forwarded-For", "")
            if peer in ("127.0.0.1", "::1") and forwarded:
                return forwarded.split(",")[-1].strip()[:64] or peer
            return peer

        def _send(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _error(self, error: FeedbackError) -> None:
            self._send(error.status, {"ok": False, "error": error.code, "message": error.message})

        def do_POST(self) -> None:  # noqa: N802
            if self.path.split("?", 1)[0] != FEEDBACK_PATH:
                return self._error(FeedbackError(404, "not_found", "Не найдено."))
            try:
                if self.headers.get_content_type() != "application/json":
                    raise FeedbackError(415, "unsupported_media_type", "Ожидается application/json.")
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY_BYTES:
                    raise FeedbackError(413, "too_large", "Слишком большой запрос.")
                try:
                    raw = json.loads(self.rfile.read(length).decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise FeedbackError(400, "invalid_json", "Неверный JSON.") from exc
                feedback_id = service.submit(raw, self._client_ip())
                self._send(202, {"ok": True, "id": feedback_id})
            except FeedbackError as error:
                self._error(error)
            except ValueError:
                self._error(FeedbackError(400, "invalid_request", "Неверный запрос."))

        def do_GET(self) -> None:  # noqa: N802
            self._error(FeedbackError(405, "method_not_allowed", "Только POST."))

    return Handler


def main() -> None:
    settings = Settings.from_environment()
    service = FeedbackService(Deliverer(settings), AbuseGuard(global_day_limit=settings.daily_limit))
    channels = [name for name, on in (("email", settings.email_enabled), ("telegram", settings.telegram_enabled),
                                      ("github", settings.github_enabled)) if on]
    print(f"Jackdaw feedback channels: {', '.join(channels) or 'нет'}; limits: {settings.daily_limit}/day, "
          f"github {settings.github_daily_limit}/day, email {settings.email_daily_limit}/day", flush=True)
    threading.Thread(target=service.run_worker, name="feedback-worker", daemon=True).start()
    server = ThreadingHTTPServer((settings.host, settings.port), make_handler(service))
    server.daemon_threads = True
    print(f"Jackdaw feedback listening on {settings.host}:{settings.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
