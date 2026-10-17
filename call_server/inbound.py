"""Обратное подтверждение адреса: пользователь сам пишет нам письмо.

Зачем: корпоративная почта часто не пропускает входящие письма с незнакомого
домена, и код подтверждения не доходит. Исходящие письма из той же почты
проходят. Поэтому приложение отправляет с ящика пользователя письмо на
одноразовый адрес `verify+<токен>@<домен>`, а сервис принимает его по SMTP.

Доказательство владения адресом — не сам факт письма (адрес отправителя легко
подделать), а проверка домена отправителя, как в DMARC:
- подпись DKIM, домен подписи (d=) совпадает с доменом в From или является
  его родителем; или
- SPF «pass» для IP, с которого пришло письмо, и домен конверта (MAIL FROM)
  совпадает с доменом в From или является его родителем.
Если ни одно не прошло, письмо отклоняется с кодом 550.

Защита приёма:
- принимается только один получатель вида verify+<токен>@<домен> с живым
  токеном — сервис не может работать открытым релеем;
- размер письма ограничен, таймауты соединения, лимит писем с одного IP;
- токен одноразовый, живёт 15 минут, привязан к лицензии/пробному периоду
  того, кто его запросил; адрес в From должен совпасть с подтверждаемым.
"""

from __future__ import annotations

import asyncio
import email.policy
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass
from email import message_from_bytes
from email.headerregistry import Address
from email.utils import getaddresses
from typing import Any, Callable

REVERSE_TTL_SECONDS = 15 * 60
REVERSE_PER_EMAIL_PER_HOUR = 5
REVERSE_PER_SUBJECT_PER_HOUR = 10
TOKEN_RE = re.compile(r"^[a-z2-7]{16}$")
MAX_INBOUND_MESSAGE_BYTES = 512 * 1024
INBOUND_PER_IP_PER_HOUR = 30
SMTP_TIMEOUT_SECONDS = 60
MAX_PENDING = 4096


class ReverseVerificationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PendingReverse:
    email: str
    subject: str
    expires_at: float
    proof: str | None = None


class ReverseVerification:
    """Одноразовые адреса для обратного подтверждения. Логика без сети — тестируется напрямую."""

    def __init__(self, issue_proof: Callable[[str, str], str], domain: str, clock: Callable[[], float] = time.time):
        if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,63}", domain):
            raise ValueError("Некорректный домен для обратного подтверждения")
        self.domain = domain
        self._issue_proof = issue_proof
        self._clock = clock
        self._pending: dict[str, PendingReverse] = {}
        self._requests: dict[str, deque[float]] = {}

    def start(self, email_address: str, subject: str) -> dict[str, Any]:
        current = self._clock()
        self._cleanup(current)
        by_email = self._recent(f"email:{email_address}", current)
        by_subject = self._recent(f"subject:{subject}", current)
        if len(by_email) >= REVERSE_PER_EMAIL_PER_HOUR or len(by_subject) >= REVERSE_PER_SUBJECT_PER_HOUR:
            raise ReverseVerificationError("rate_limited", "Слишком много запросов подтверждения. Попробуйте через час.")
        by_email.append(current)
        by_subject.append(current)
        token = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz234567") for _ in range(16))
        self._pending[token] = PendingReverse(email_address, subject, current + REVERSE_TTL_SECONDS)
        return {
            "token": token,
            "address": f"verify+{token}@{self.domain}",
            "mailSubject": f"Jackdaw Mail: подтверждение адреса {token}",
            "expiresIn": REVERSE_TTL_SECONDS,
        }

    def accepts(self, token: str) -> bool:
        pending = self._pending.get(token)
        return pending is not None and pending.proof is None and pending.expires_at > self._clock()

    def complete(self, token: str, from_email: str) -> PendingReverse:
        """Письмо прошло проверку DKIM/SPF: выдаём доказательство владения адресом."""
        pending = self._pending.get(token)
        if pending is None or pending.expires_at <= self._clock() or pending.proof is not None:
            raise ReverseVerificationError("code_expired", "Адрес для подтверждения устарел.")
        if from_email != pending.email:
            raise ReverseVerificationError("sender_mismatch", "Письмо отправлено не с подтверждаемого адреса.")
        pending.proof = self._issue_proof(pending.email, pending.subject)
        return pending

    def check(self, token: str, subject: str) -> PendingReverse | None:
        """Результат для того, кто запрашивал токен (на случай переподключения)."""
        pending = self._pending.get(token)
        if pending is None or pending.subject != subject:
            return None
        if pending.expires_at <= self._clock() and pending.proof is None:
            return None
        return pending

    def _recent(self, key: str, current: float) -> deque[float]:
        hits = self._requests.setdefault(key, deque())
        while hits and current - hits[0] >= 3600:
            hits.popleft()
        return hits

    def _cleanup(self, current: float) -> None:
        for token in [t for t, p in self._pending.items() if p.expires_at <= current]:
            self._pending.pop(token, None)
        if len(self._pending) >= MAX_PENDING:
            raise ReverseVerificationError("service_unavailable", "Сервис перегружен. Попробуйте позже.")
        if len(self._requests) >= MAX_PENDING:
            for key in [k for k, v in self._requests.items() if not v or current - v[-1] >= 3600]:
                self._requests.pop(key, None)


# ---------------------------------------------------------------------------
# Проверка отправителя


def parse_recipient_token(address: str, domain: str) -> str | None:
    address = address.strip().strip("<>").lower()
    local, _, host = address.rpartition("@")
    if host != domain or not local.startswith("verify+"):
        return None
    token = local[len("verify+"):]
    return token if TOKEN_RE.fullmatch(token) else None


def single_from_address(raw: bytes) -> str | None:
    """Ровно один адрес в одном заголовке From, иначе письмо не принимается."""
    message = message_from_bytes(raw, policy=email.policy.compat32)
    headers = message.get_all("From") or []
    if len(headers) != 1:
        return None
    addresses = [addr for _, addr in getaddresses(headers) if addr]
    if len(addresses) != 1:
        return None
    try:
        parsed = Address(addr_spec=addresses[0])
    except Exception:  # noqa: BLE001 — некорректный адрес просто не проходит
        return None
    return f"{parsed.username}@{parsed.domain}".lower()


def aligned(from_domain: str, auth_domain: str) -> bool:
    """Мягкое выравнивание DMARC: домен подписи/конверта равен домену From или его родитель."""
    from_domain = from_domain.lower().rstrip(".")
    auth_domain = auth_domain.lower().rstrip(".")
    if "." not in auth_domain:
        return False
    return from_domain == auth_domain or from_domain.endswith("." + auth_domain)


DKIM_DOMAIN_RE = re.compile(rb"(?:^|;)\s*d\s*=\s*([A-Za-z0-9.-]+)\s*(?:;|$)")


def dkim_signature_domains(raw: bytes) -> list[str]:
    message = message_from_bytes(raw, policy=email.policy.compat32)
    domains = []
    for header in message.get_all("DKIM-Signature") or []:
        value = re.sub(r"\s+", "", str(header)).encode()
        match = DKIM_DOMAIN_RE.search(value)
        domains.append(match.group(1).decode().lower() if match else "")
    return domains


def default_dkim_verify(raw: bytes, index: int, dnsfunc: Callable[..., Any] | None = None) -> bool:
    import dkim  # dkimpy

    if dnsfunc is None:
        return bool(dkim.DKIM(raw).verify(idx=index))
    return bool(dkim.DKIM(raw).verify(idx=index, dnsfunc=dnsfunc))


def default_spf_check(ip: str, mail_from: str, helo: str) -> str:
    import spf  # pyspf

    result, _explanation = spf.check2(i=ip, s=mail_from, h=helo)
    return result


def authenticate_sender(
    raw: bytes,
    from_email: str,
    peer_ip: str,
    mail_from: str,
    helo: str,
    dkim_verify: Callable[[bytes, int], bool] = default_dkim_verify,
    spf_check: Callable[[str, str, str], str] = default_spf_check,
) -> str | None:
    """Возвращает 'dkim' или 'spf', если домен отправителя подтверждён, иначе None."""
    from_domain = from_email.rpartition("@")[2]
    for index, signing_domain in enumerate(dkim_signature_domains(raw)):
        if signing_domain and aligned(from_domain, signing_domain):
            try:
                if dkim_verify(raw, index):
                    return "dkim"
            except Exception:  # noqa: BLE001 — сломанная подпись = не подтверждено
                continue
    envelope_domain = mail_from.rpartition("@")[2]
    if envelope_domain and aligned(from_domain, envelope_domain):
        try:
            if spf_check(peer_ip, mail_from, helo) == "pass":
                return "spf"
        except Exception:  # noqa: BLE001
            return None
    return None


# ---------------------------------------------------------------------------
# SMTP-приём (aiosmtpd)


class InboundHandler:
    """Обработчик aiosmtpd. `on_verified(token, from_email)` вызывается в цикле событий."""

    def __init__(self, reverse: ReverseVerification, on_verified: Callable[[str, str], bool],
                 authenticate: Callable[..., str | None] = authenticate_sender,
                 log: Callable[[str], None] = lambda line: print(line, flush=True),
                 clock: Callable[[], float] = time.monotonic):
        self.reverse = reverse
        self.on_verified = on_verified
        self.authenticate = authenticate
        self.log = log
        self._clock = clock
        self._per_ip: dict[str, deque[float]] = {}

    def _ip_allowed(self, ip: str) -> bool:
        now = self._clock()
        hits = self._per_ip.setdefault(ip, deque())
        while hits and now - hits[0] >= 3600:
            hits.popleft()
        if len(hits) >= INBOUND_PER_IP_PER_HOUR:
            return False
        hits.append(now)
        if len(self._per_ip) > MAX_PENDING:
            for key in [k for k, v in self._per_ip.items() if not v]:
                self._per_ip.pop(key, None)
        return True

    async def handle_MAIL(self, server: Any, session: Any, envelope: Any, address: str, mail_options: list[str]) -> str:
        ip = session.peer[0] if session.peer else ""
        if not self._ip_allowed(ip):
            return "421 4.7.0 Too many messages, try later"
        envelope.mail_from = address
        envelope.mail_options.extend(mail_options)
        return "250 OK"

    async def handle_RCPT(self, server: Any, session: Any, envelope: Any, address: str, rcpt_options: list[str]) -> str:
        if envelope.rcpt_tos:
            return "452 4.5.3 Only one recipient"
        token = parse_recipient_token(address, self.reverse.domain)
        if token is None or not self.reverse.accepts(token):
            return "550 5.1.1 No such verification address"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server: Any, session: Any, envelope: Any) -> str:
        token = parse_recipient_token(envelope.rcpt_tos[0], self.reverse.domain) if envelope.rcpt_tos else None
        raw = envelope.original_content or envelope.content or b""
        if isinstance(raw, str):
            raw = raw.encode("utf-8", "surrogateescape")
        from_email = single_from_address(raw)
        if token is None or from_email is None:
            return "550 5.7.1 Message rejected"
        ip = session.peer[0] if session.peer else ""
        method = await asyncio.get_running_loop().run_in_executor(
            None, self.authenticate, raw, from_email, ip, envelope.mail_from or "", session.host_name or "")
        domain = from_email.rpartition("@")[2]
        if method is None:
            self.log(f"Reverse verification rejected for *@{domain}: DKIM/SPF not aligned")
            return "550 5.7.1 Sender domain not authenticated (DKIM/SPF)"
        if not self.on_verified(token, from_email):
            self.log(f"Reverse verification for *@{domain} did not match a pending request")
            return "550 5.7.1 Verification address does not match the sender"
        self.log(f"Reverse verification passed for *@{domain} via {method}")
        return "250 OK: address confirmed"


async def start_inbound_server(handler: InboundHandler, host: str, port: int, hostname: str) -> Any:
    from aiosmtpd.smtp import SMTP

    loop = asyncio.get_running_loop()
    return await loop.create_server(
        lambda: SMTP(
            handler,
            hostname=hostname,
            data_size_limit=MAX_INBOUND_MESSAGE_BYTES,
            enable_SMTPUTF8=True,
            decode_data=False,
            timeout=SMTP_TIMEOUT_SECONDS,
        ),
        host=host,
        port=port,
    )
