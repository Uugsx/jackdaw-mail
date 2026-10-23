"""Поиск GIF для чата Jackdaw через сервер: ключ провайдера не попадает в клиент.

Провайдер — KLIPY (https://docs.klipy.com): бесплатный ключ, поиск на любом языке, параметр
`locale`, публичная раздача медиа с CDN `static*.klipy.com`. Tenor API закрыт Google 30.06.2026,
бесплатный ключ GIPHY ограничен 100 запросами в час, а продакшен-ключ — по договорённости.

Клиент: `{"type": "gif-search", "requestId": "...", "query": "кошки", "locale": "ru-RU", "page": 1}`.
Пустой `query` — популярное (тренды). Ответ: `{"type": "gif-results", "requestId": ..., "results": [...]}`.
Без ключа — ошибка `gifs_unavailable`, сбой провайдера — `gifs_failed`.

Ни ключ, ни тексты запросов, ни ответы провайдера в журнал не пишутся.
"""

from __future__ import annotations

import collections
import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from calls import Blocking, CallError, Peer, Steps, read_secret


PROVIDER = "klipy"
KLIPY_API_BASE = "https://api.klipy.com/api/v1"
# Медиа KLIPY раздаётся только с этих хостов (docs.klipy.com/network-requirements).
MEDIA_HOST_RE = re.compile(r"^static\d{0,2}\.klipy\.com$")
REQUEST_TIMEOUT_SECONDS = 8
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_QUERY_CHARS = 100
MAX_PAGE = 20
PAGE_SIZE = 24
MAX_RESULTS = 50
MAX_TITLE_CHARS = 120
MAX_REQUEST_ID_CHARS = 64
# Совпадает с пределом клиента (app/frontend/Chat/Emoji/media.ts): больше чат всё равно не отправит.
MAX_GIF_BYTES = 15 * 1024 * 1024
MAX_DIMENSION = 4096
# Почтовое приложение для работы: умеренный фильтр, как PG-13 у Tenor.
CONTENT_FILTER = "medium"
CACHE_TTL_SECONDS = 10 * 60
CACHE_MAX_ENTRIES = 512
# Устройство: 20 запросов к провайдеру подряд, дальше 1 запрос в 3 секунды. Ответы из кеша бесплатны.
DEVICE_BURST = 20
DEVICE_REFILL_PER_SECOND = 1 / 3
MAX_TRACKED_DEVICES = 10000
# Сервер целиком: не выбрать квоту ключа у провайдера.
GLOBAL_BURST = 120
GLOBAL_REFILL_PER_SECOND = 5.0
GIF_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$")
REGION_RE = re.compile(r"^[A-Za-z]{2}$")
# KLIPY ждёт код страны ISO 3166-1 alpha-2. Язык интерфейса без региона — в страну, где он основной.
LANGUAGE_COUNTRIES = {
    "ar": "sa", "az": "az", "bg": "bg", "bn": "bd", "cs": "cz", "da": "dk", "de": "de", "el": "gr",
    "en": "us", "es": "es", "et": "ee", "fa": "ir", "fi": "fi", "fr": "fr", "ga": "ie", "he": "il",
    "hi": "in", "hu": "hu", "id": "id", "it": "it", "ja": "jp", "ko": "kr", "lt": "lt", "lv": "lv",
    "nb": "no", "nl": "nl", "no": "no", "pa": "in", "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru",
    "sk": "sk", "sl": "si", "sv": "se", "ta": "in", "th": "th", "tr": "tr", "uk": "ua", "ur": "pk",
    "vi": "vn", "zh": "cn",
}
# Подтеги письменности, по которым видна страна (zh-Hant — Тайвань, pa-Arab — Пакистан).
SCRIPT_COUNTRIES = {("zh", "hant"): "tw", ("pa", "arab"): "pk"}
# Порядок выбора: отправляемая GIF — средняя (обычно до 1–2 МБ), превью — маленькое анимированное.
SEND_SIZES = ("md", "sm", "hd")
PREVIEW_SIZES = ("sm", "xs", "md")
PREVIEW_FORMATS = ("webp", "gif")

Fetch = Callable[[str], Any]


class TokenBucket:
    def __init__(self, capacity: float, refill_per_second: float, now: float):
        self.capacity = capacity
        self.refill = refill_per_second
        self.tokens = capacity
        self.updated = now

    def take(self, now: float) -> bool:
        self.tokens = min(self.capacity, self.tokens + max(0.0, now - self.updated) * self.refill)
        self.updated = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


def normalize_query(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise CallError("invalid_query", "Некорректный поисковый запрос.")
    # Управляющие и невидимые символы не нужны поиску и не должны попасть в URL провайдера.
    cleaned = "".join(" " if unicodedata.category(char)[0] in ("C", "Z") else char for char in value)
    cleaned = " ".join(cleaned.split())
    if len(cleaned) > MAX_QUERY_CHARS:
        raise CallError("invalid_query", f"Запрос длиннее {MAX_QUERY_CHARS} символов.")
    return cleaned


def country_for_locale(value: Any) -> str | None:
    """Язык интерфейса (`ru`, `pt-BR`, `zh-Hant`) → код страны для KLIPY. Неизвестный — None."""
    if not isinstance(value, str) or not LOCALE_RE.fullmatch(value):
        return None
    parts = value.replace("_", "-").lower().split("-")
    language = parts[0]
    for part in parts[1:]:
        if REGION_RE.fullmatch(part):
            return part
        if (language, part) in SCRIPT_COUNTRIES:
            return SCRIPT_COUNTRIES[(language, part)]
    return LANGUAGE_COUNTRIES.get(language)


def normalize_page(value: Any) -> int:
    if value is None:
        return 1
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= MAX_PAGE:
        raise CallError("invalid_query", f"Номер страницы — от 1 до {MAX_PAGE}.")
    return value


def media_url(value: Any) -> str | None:
    """Только https с CDN провайдера, без логина и нестандартного порта."""
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        return None
    if not parsed.hostname or not MEDIA_HOST_RE.fullmatch(parsed.hostname):
        return None
    return value


def dimension(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if 0 < number <= MAX_DIMENSION else None


def file_size(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if number > 0 else None


def media_variant(files: dict[str, Any], size: str, fmt: str) -> dict[str, Any] | None:
    entry = files.get(size)
    variant = entry.get(fmt) if isinstance(entry, dict) else None
    if not isinstance(variant, dict):
        return None
    url = media_url(variant.get("url"))
    if url is None:
        return None
    return {"url": url, "width": dimension(variant.get("width")), "height": dimension(variant.get("height")),
            "size": file_size(variant.get("size"))}


def clean_title(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = "".join(" " if unicodedata.category(char)[0] == "C" else char for char in value)
    return " ".join(cleaned.split())[:MAX_TITLE_CHARS]


def normalize_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    # В выдаче KLIPY бывает реклама (`type: "ad"`) — её в чат не берём.
    if item.get("type") not in (None, "gif"):
        return None
    raw_id = item.get("id")
    if isinstance(raw_id, bool):
        return None
    gif_id = str(raw_id) if isinstance(raw_id, (int, str)) else ""
    if not GIF_ID_RE.fullmatch(gif_id):
        return None
    files = item.get("file")
    if not isinstance(files, dict):
        return None
    send = None
    for size in SEND_SIZES:
        candidate = media_variant(files, size, "gif")
        if candidate and (candidate["size"] is None or candidate["size"] <= MAX_GIF_BYTES):
            send = candidate
            break
    if send is None:
        return None
    preview = next((variant for size in PREVIEW_SIZES for fmt in PREVIEW_FORMATS
                    if (variant := media_variant(files, size, fmt)) is not None), send)
    return {
        "id": gif_id,
        "title": clean_title(item.get("title")),
        "url": send["url"],
        "width": send["width"],
        "height": send["height"],
        "size": send["size"],
        "previewUrl": preview["url"],
        "previewWidth": preview["width"],
        "previewHeight": preview["height"],
    }


def normalize_response(payload: Any) -> tuple[list[dict[str, Any]], bool]:
    """Ответ KLIPY → список GIF и признак следующей страницы. Непонятный ответ — сбой провайдера."""
    if not isinstance(payload, dict) or payload.get("result") is False:
        raise CallError("gifs_failed", "Сервис GIF вернул ошибку.")
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise CallError("gifs_failed", "Сервис GIF вернул непонятный ответ.")
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in data["data"]:
        normalized = normalize_item(item)
        if normalized is not None and normalized["id"] not in seen:
            seen.add(normalized["id"])
            results.append(normalized)
            if len(results) >= MAX_RESULTS:
                break
    return results, data.get("has_next") is True


def http_fetch_json(url: str) -> Any:
    """GET с таймаутом и пределом размера. В URL ключ — поэтому ни URL, ни ответ не попадают в исключения."""
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "JackdawCalls/1"})
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310 — https-адрес из константы
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise ProviderError(f"HTTP {status}") from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise ProviderError(type(error).__name__) from None
    if len(body) > MAX_RESPONSE_BYTES:
        raise ProviderError("response too large")
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ProviderError("invalid JSON") from None


class ProviderError(Exception):
    """Сбой обращения к провайдеру. Текст — без URL, ключа и тела ответа: его можно писать в журнал."""


class GifService:
    """Обработчик `gif-search`. Подключается к CallHub так же, как ChatService."""

    def __init__(self, api_key: str, fetch: Fetch = http_fetch_json, clock: Callable[[], float] = time.monotonic,
                 log: Callable[[str], None] | None = None):
        self._api_key = api_key.strip()
        self._fetch = fetch
        self._clock = clock
        self._log = log or (lambda text: print(text, flush=True))
        self._cache: collections.OrderedDict[tuple[str, str, int], tuple[float, dict[str, Any]]] = collections.OrderedDict()
        self._device_buckets: collections.OrderedDict[str, TokenBucket] = collections.OrderedDict()
        self._global_bucket = TokenBucket(GLOBAL_BURST, GLOBAL_REFILL_PER_SECOND, clock())
        # Обработчик идёт в цикле событий, сетевой шаг — в пуле; кеш и лимиты трогаются только под замком.
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    def handlers(self) -> dict[str, Callable[[Peer, dict[str, Any]], Steps | None]]:
        return {"gif-search": self._search}

    def build_url(self, query: str, country: str | None, page: int) -> str:
        params: dict[str, str] = {"page": str(page), "per_page": str(PAGE_SIZE), "content_filter": CONTENT_FILTER,
                                  "format_filter": "gif,webp"}
        if query:
            params["q"] = query
        if country:
            params["locale"] = country
        endpoint = "search" if query else "trending"
        key = urllib.parse.quote(self._api_key, safe="")
        return f"{KLIPY_API_BASE}/{key}/gifs/{endpoint}?{urllib.parse.urlencode(params)}"

    def _cached(self, key: tuple[str, str, int]) -> dict[str, Any] | None:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if self._clock() - entry[0] >= CACHE_TTL_SECONDS:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return entry[1]

    def _store(self, key: tuple[str, str, int], value: dict[str, Any]) -> None:
        with self._lock:
            self._cache[key] = (self._clock(), value)
            self._cache.move_to_end(key)
            while len(self._cache) > CACHE_MAX_ENTRIES:
                self._cache.popitem(last=False)

    def _allow(self, device_key: str) -> bool:
        with self._lock:
            now = self._clock()
            bucket = self._device_buckets.get(device_key)
            if bucket is None:
                bucket = TokenBucket(DEVICE_BURST, DEVICE_REFILL_PER_SECOND, now)
                self._device_buckets[device_key] = bucket
            self._device_buckets.move_to_end(device_key)
            while len(self._device_buckets) > MAX_TRACKED_DEVICES:
                self._device_buckets.popitem(last=False)
            # Сначала устройство: его отказ не тратит общий запас сервера.
            return bucket.take(now) and self._global_bucket.take(now)

    def _search(self, peer: Peer, message: dict[str, Any]) -> Steps:
        if not self.available:
            raise CallError("gifs_unavailable", "Поиск GIF на этом сервере не настроен.")
        credential = peer.credential
        if credential is None:
            raise CallError("not_authenticated", "Сначала нужна проверка лицензии.")
        query = normalize_query(message.get("query"))
        country = country_for_locale(message.get("locale"))
        page = normalize_page(message.get("page"))
        # Регистр не влияет на поиск провайдера: «Кот» и «кот» — одна запись кеша.
        cache_key = (query.casefold(), country or "", page)
        cached = self._cached(cache_key)
        if cached is None:
            if not self._allow(f"{credential.subject}|{credential.device_hash}"):
                raise CallError("rate_limited", "Слишком много запросов GIF. Попробуйте позже.")
            url = self.build_url(query, country, page)

            def fetch() -> dict[str, Any]:
                try:
                    payload = self._fetch(url)
                except ProviderError as error:
                    self._log(f"GIF provider request failed: {error}")
                    raise CallError("gifs_failed", "Сервис GIF сейчас недоступен.") from None
                results, has_next = normalize_response(payload)
                return {"results": results, "hasNext": has_next}

            cached = yield Blocking(fetch)
            self._store(cache_key, cached)
        reply: dict[str, Any] = {"type": "gif-results", "provider": PROVIDER, "query": query, "page": page,
                                 "hasNext": cached["hasNext"], "results": cached["results"]}
        request_id = message.get("requestId")
        if isinstance(request_id, str):
            reply["requestId"] = request_id[:MAX_REQUEST_ID_CHARS]
        peer.send(reply)


def build_gifs_from_environment() -> GifService:
    """Ключ KLIPY из `JACKDAW_CALLS_GIF_API_KEY` или файла `JACKDAW_CALLS_GIF_API_KEY_FILE`. Без ключа поиск выключен."""
    return GifService(read_secret("JACKDAW_CALLS_GIF_API_KEY"))
