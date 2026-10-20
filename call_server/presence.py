"""Присутствие в общих ящиках: кто из коллег сейчас читает письмо или отвечает на него.

Защита от двух ответов клиенту из одного общего ящика (например, support@company.com).
Сервер видит только:
- адрес общего ящика — его член подтвердил так же, как адрес для звонков (код или письмо с ящика);
- метку письма: HMAC-SHA256 от Message-ID, ключ выводится из адреса ящика на клиенте
  (app/logic/Mail/Collision/collisionTag.ts). Темы, отправителя и текста письма на сервере нет;
- имя коллеги, его подтверждённый адрес для чата и что он делает: читает, отвечает, ответил.

Состояния живут только в памяти. «Читает» и «отвечает» снимаются по запросу клиента, по TTL без
продления и при разрыве соединения. «Ответил» переживает разрыв, но не дольше `REPLIED_TTL_SECONDS`.
Раздаётся всё только соединениям, которые сами подтвердили тот же адрес ящика.
"""

from __future__ import annotations

import contextlib
import hashlib
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

from calls import CallError, MAX_EMAILS_PER_CONNECTION, Peer, Scheduler, normalize_email


PRESENCE_TAG_RE = re.compile(r"^[0-9a-f]{64}$")
ACTIVE_STATES = frozenset({"viewing", "replying"})
REPLIED_STATE = "replied"
CLEAR_STATE = "none"
# Клиент продлевает «читает» и «отвечает» каждую минуту; без продления состояние снимается.
ACTIVE_TTL_SECONDS = 150
SWEEP_INTERVAL_SECONDS = 30
# «Ответил» нужно, пока письмо ещё могут открыть коллеги; дальше видно по папке «Отправленные».
REPLIED_TTL_SECONDS = 24 * 60 * 60
# Одно соединение открывает письмо и пишет несколько ответов; больше — ошибка клиента, вытесняем старое.
MAX_ACTIVE_PER_PEER = 16
# «Ответил» по одному ящику: без лимита память сервера растёт вместе с потоком писем.
MAX_REPLIED_PER_MAILBOX = 2000


@dataclass
class PresenceEntry:
    mailbox: str
    tag: str
    state: str
    # Отличает соединения коллег друг от друга, не раскрывая служебный идентификатор соединения
    actor: str
    name: str
    email: str
    # Время по часам сервера (Unix, с), для «Ответил: Имя, 12:34»
    at: int
    expires: float
    device_hash: str
    peer: Peer | None = None

    def public(self) -> dict[str, Any]:
        return {"tag": self.tag, "actor": self.actor, "state": self.state, "name": self.name, "email": self.email, "at": self.at}


class PresenceService:
    """Обработчики присутствия. Подключается к CallHub, как ChatService."""

    def __init__(
        self,
        scheduler: Scheduler | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ):
        self.scheduler = scheduler or Scheduler()
        self._clock = clock
        self._wall_clock = wall_clock
        # Ящики, которые соединение смотрит: только из его подтверждённых адресов
        self.watching: dict[Peer, set[str]] = {}
        self.watchers: dict[str, set[Peer]] = {}
        # ящик → метка → actor → «читает»/«отвечает»
        self.active: dict[str, dict[str, dict[str, PresenceEntry]]] = {}
        # ящик → метка → последний «ответил»
        self.replied: dict[str, dict[str, PresenceEntry]] = {}
        self._sweep_handle: Any = None

    def handlers(self) -> dict[str, Callable[[Peer, dict[str, Any]], None]]:
        return {
            "presence-watch": self._watch,
            "presence-set": self._set,
        }

    # --- соединения ---------------------------------------------------

    def disconnected(self, peer: Peer) -> None:
        self._stop_watching(peer, set(self.watching.get(peer, ())))
        self.watching.pop(peer, None)

    def credential_lost(self, peer: Peer) -> None:
        self.disconnected(peer)

    @staticmethod
    def _actor(peer: Peer) -> str:
        return hashlib.sha256(f"presence:{peer.peer_id}".encode("ascii")).hexdigest()[:16]

    def _member_mailbox(self, peer: Peer, value: Any) -> str:
        """Ящик, который соединение смотрит и подтвердило. Чужой и несуществующий ящики неотличимы."""
        try:
            mailbox = normalize_email(value)
        except CallError:
            mailbox = ""
        if not mailbox or mailbox not in peer.emails or mailbox not in self.watching.get(peer, ()):
            raise CallError("presence_not_member", "Этот адрес не подтверждён на устройстве для общего ящика.")
        return mailbox

    # --- запросы ------------------------------------------------------

    def _watch(self, peer: Peer, message: dict[str, Any]) -> None:
        values = message.get("mailboxes")
        if not isinstance(values, list) or len(values) > MAX_EMAILS_PER_CONNECTION:
            raise CallError("invalid_presence", f"Нужен список не более чем из {MAX_EMAILS_PER_CONNECTION} адресов.")
        wanted: set[str] = set()
        for value in values:
            with contextlib.suppress(CallError):
                email = normalize_email(value)
                if email in peer.emails:
                    wanted.add(email)
        previous = self.watching.get(peer, set())
        self._stop_watching(peer, previous - wanted)
        if wanted:
            self.watching[peer] = wanted
            for mailbox in wanted:
                self.watchers.setdefault(mailbox, set()).add(peer)
        else:
            self.watching.pop(peer, None)
        self._expire()
        snapshot = {mailbox: self._snapshot(mailbox, peer) for mailbox in sorted(wanted)}
        peer.send({"type": "presence-snapshot", "mailboxes": snapshot})

    def _set(self, peer: Peer, message: dict[str, Any]) -> None:
        assert peer.credential is not None
        mailbox = self._member_mailbox(peer, message.get("mailbox"))
        tag = message.get("tag")
        if not isinstance(tag, str) or not PRESENCE_TAG_RE.match(tag):
            raise CallError("invalid_presence", "Некорректная метка письма.")
        state = message.get("state")
        if state not in ACTIVE_STATES and state not in (REPLIED_STATE, CLEAR_STATE):
            raise CallError("invalid_presence", "Некорректное состояние.")
        self._expire()
        actor = self._actor(peer)
        if state == CLEAR_STATE:
            self._remove_active(mailbox, tag, actor)
            return
        entry = PresenceEntry(
            mailbox=mailbox, tag=tag, state=state, actor=actor, name=peer.display_name,
            email=self._reply_address(peer, mailbox, message.get("from")),
            at=int(self._wall_clock()), expires=0.0, device_hash=peer.credential.device_hash, peer=peer,
        )
        if state == REPLIED_STATE:
            self._remove_active(mailbox, tag, actor)
            entry.expires = self._clock() + REPLIED_TTL_SECONDS
            entry.peer = None
            replied = self.replied.setdefault(mailbox, {})
            replied.pop(tag, None)
            replied[tag] = entry
            while len(replied) > MAX_REPLIED_PER_MAILBOX:
                # Словарь хранит порядок вставки: первым идёт самый старый «ответил».
                replied.pop(next(iter(replied)))
            self._broadcast(entry)
            return
        entry.expires = self._clock() + ACTIVE_TTL_SECONDS
        by_tag = self.active.setdefault(mailbox, {}).setdefault(tag, {})
        current = by_tag.get(actor)
        by_tag[actor] = entry
        if current is not None and current.state == entry.state and current.name == entry.name and current.email == entry.email:
            # Продление: коллеги уже видят это состояние, рассылать нечего.
            entry.at = current.at
            return
        self._limit_peer(peer, mailbox, tag)
        self._broadcast(entry)
        self._schedule_sweep()

    @staticmethod
    def _reply_address(peer: Peer, mailbox: str, value: Any) -> str:
        """Свой адрес для чата с коллегой: только подтверждённый этим соединением и не сам общий ящик."""
        try:
            email = normalize_email(value)
        except CallError:
            return ""
        return email if email in peer.emails and email != mailbox else ""

    # --- состояние ------------------------------------------------------

    def _entries_of(self, peer: Peer) -> list[PresenceEntry]:
        return [entry for by_tag in self.active.values() for by_actor in by_tag.values()
                for entry in by_actor.values() if entry.peer is peer]

    def _limit_peer(self, peer: Peer, mailbox: str, tag: str) -> None:
        entries = sorted(self._entries_of(peer), key=lambda e: e.expires)
        for entry in entries[:max(0, len(entries) - MAX_ACTIVE_PER_PEER)]:
            if entry.mailbox != mailbox or entry.tag != tag:
                self._remove_active(entry.mailbox, entry.tag, entry.actor)

    def _remove_active(self, mailbox: str, tag: str, actor: str) -> None:
        by_tag = self.active.get(mailbox)
        by_actor = by_tag.get(tag) if by_tag else None
        entry = by_actor.pop(actor, None) if by_actor else None
        if entry is None:
            return
        if not by_actor:
            by_tag.pop(tag, None)
            if not by_tag:
                self.active.pop(mailbox, None)
        self._broadcast(PresenceEntry(mailbox, tag, CLEAR_STATE, actor, "", "", entry.at, 0.0, entry.device_hash))

    def _stop_watching(self, peer: Peer, mailboxes: set[str]) -> None:
        for mailbox in mailboxes:
            watchers = self.watchers.get(mailbox)
            if watchers is not None:
                watchers.discard(peer)
                if not watchers:
                    self.watchers.pop(mailbox, None)
        for entry in self._entries_of(peer):
            if entry.mailbox in mailboxes:
                self._remove_active(entry.mailbox, entry.tag, entry.actor)

    def _snapshot(self, mailbox: str, peer: Peer) -> list[dict[str, Any]]:
        device_hash = peer.credential.device_hash if peer.credential else ""
        entries = [entry for by_actor in self.active.get(mailbox, {}).values() for entry in by_actor.values()]
        entries.extend(self.replied.get(mailbox, {}).values())
        return [entry.public() for entry in entries if entry.device_hash != device_hash]

    def _broadcast(self, entry: PresenceEntry) -> None:
        message = {"type": "presence", "mailbox": entry.mailbox, **entry.public()}
        for watcher in list(self.watchers.get(entry.mailbox, ())):
            # Своё же устройство о себе не узнаёт; адрес мог пропасть при смене лицензии.
            if watcher.credential is None or watcher.credential.device_hash == entry.device_hash:
                continue
            if entry.mailbox in watcher.emails:
                watcher.send(message)

    def _expire(self) -> None:
        current = self._clock()
        for mailbox, by_tag in list(self.active.items()):
            for tag, by_actor in list(by_tag.items()):
                for actor, entry in list(by_actor.items()):
                    if entry.expires <= current:
                        self._remove_active(mailbox, tag, actor)
        for mailbox, replied in list(self.replied.items()):
            for tag, entry in list(replied.items()):
                if entry.expires <= current:
                    replied.pop(tag, None)
            if not replied:
                self.replied.pop(mailbox, None)

    def _schedule_sweep(self) -> None:
        if self._sweep_handle is not None:
            return
        try:
            self._sweep_handle = self.scheduler.call_later(SWEEP_INTERVAL_SECONDS, self._sweep)
        except RuntimeError:
            # Вне цикла событий (вызов из синхронного кода): истёкшее снимет следующий запрос.
            self._sweep_handle = None

    def _sweep(self) -> None:
        self._sweep_handle = None
        self._expire()
        if self.active:
            self._schedule_sweep()
