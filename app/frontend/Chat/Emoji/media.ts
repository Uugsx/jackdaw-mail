import { appGlobal } from "../../../logic/app";
import { getUILocale } from "../../../l10n/l10n";

export interface GraphicSelection {
  emoji?: string | null;
  file?: File;
  /** Preferred display width for an inserted media item, in CSS pixels. */
  width?: number;
}

/** GIF из каталога провайдера (KLIPY через сервер Jackdaw, call_server/gifs.py). */
export interface PickerGIF {
  id: string;
  title: string;
  /** GIF для отправки */
  url: string;
  /** Маленькое анимированное превью для сетки */
  thumbnail: string;
  width: number | null;
  height: number | null;
  filesize: number | null;
}

/** Прежнее имя типа: его импортирует код, написанный под Openverse. */
export type OpenverseGIF = PickerGIF;

/**
 * Почему GIF не загрузились. По причине выбор показывает разное состояние:
 * - `server-unconfigured` — на сервере Jackdaw не задан ключ провайдера (`gifs_unavailable`);
 * - `server-outdated` — сервер не знает `gif-search` (`unknown_type`);
 * - `no-license` — нет Pro или пробного периода: соединения с сервером нет и не будет;
 * - `offline` — нет связи с сервером Jackdaw, появится сама;
 * - `rate-limited` — слишком много запросов, повторить через минуту;
 * - `failed` — сбой провайдера, нет ответа вовремя или непонятный ответ: можно повторить.
 */
export type GIFSearchErrorKind = "server-unconfigured" | "server-outdated" | "no-license" | "offline" | "rate-limited" | "failed";

export class GIFSearchError extends Error {
  constructor(readonly kind: GIFSearchErrorKind, readonly code: string | null = null) {
    super(`GIF search failed: ${kind}${code ? ` (${code})` : ""}`);
    this.name = "GIFSearchError";
  }

  /** Повтор имеет смысл: связь или провайдер могут вернуться */
  get isRetryable(): boolean {
    return this.kind == "offline" || this.kind == "rate-limited" || this.kind == "failed";
  }
}

/** Часть клиента сервиса Jackdaw, нужная поиску (`JackdawCallClient.searchGIFs`). */
export interface GIFSearchClient {
  searchGIFs(query: string, locale: string, page?: number): Promise<{ type: string; results: unknown[] }>;
}

export interface GIFSearchOptions {
  client?: GIFSearchClient;
  /** Язык поиска; по умолчанию — язык интерфейса */
  locale?: string;
  page?: number;
}

export const kGIFDisplayWidth = 256;
const kRequestTimeoutMS = 15000;
const kMaxGIFSizeBytes = 15 * 1024 * 1024;
const kMaxQueryLength = 100;
const kMaxTitleLength = 120;
const kMaxDimension = 4096;
const kGIFIDPattern = /^[A-Za-z0-9_-]{1,64}$/;
/** CDN KLIPY (docs.klipy.com/network-requirements). Совпадает с MEDIA_HOST_RE в call_server/gifs.py. */
const kGIFMediaHostPattern = /^static\d{0,2}\.klipy\.com$/;
/** Название провайдера для подписи «Powered by». */
export const kGIFProviderName = "KLIPY";

/** Ищет GIF через сервер Jackdaw. Пустой запрос — популярное. @throws GIFSearchError */
export async function searchGIFs(query: string | null, options: GIFSearchOptions = {}): Promise<PickerGIF[]> {
  let client = options.client ?? await defaultClient();
  let normalized = (query ?? "").trim().replace(/\s+/g, " ").substring(0, kMaxQueryLength);
  let reply: { results: unknown[] };
  try {
    reply = await client.searchGIFs(normalized, options.locale ?? getUILocale(), options.page ?? 1);
  } catch (ex) {
    throw toGIFSearchError(ex);
  }
  return parseGIFResults(reply);
}

async function defaultClient(): Promise<GIFSearchClient> {
  // Лениво: клиент звонков тянет за собой биллинг и чат, а выбор GIF открывают не всегда.
  let { getJackdawCallClient } = await import("../../../logic/Meet/Jackdaw/JackdawCalls");
  return getJackdawCallClient();
}

/** Ошибка клиента сервиса (`JackdawCallServiceError.code`) → причина для интерфейса. */
export function toGIFSearchError(ex: unknown): GIFSearchError {
  if (ex instanceof GIFSearchError) {
    return ex;
  }
  let code = ex && typeof ex == "object" && typeof (ex as { code?: unknown }).code == "string"
    ? (ex as { code: string }).code
    : null;
  switch (code) {
    case "gifs_unavailable":
      return new GIFSearchError("server-unconfigured", code);
    case "unknown_type":
      return new GIFSearchError("server-outdated", code);
    case "gifs_no_license":
    case "not_authenticated":
    case "license_inactive":
    case "device_not_activated":
    case "invalid_credential":
      return new GIFSearchError("no-license", code);
    case "not_connected":
      return new GIFSearchError("offline", code);
    case "rate_limited":
      return new GIFSearchError("rate-limited", code);
    default:
      return new GIFSearchError("failed", code);
  }
}

/** Проверяет ответ сервера `gif-results`: только https с CDN провайдера, GIF не больше предела. */
export function parseGIFResults(payload: unknown): PickerGIF[] {
  let results = Array.isArray(payload) ? payload
    : payload && typeof payload == "object" && Array.isArray((payload as any).results) ? (payload as any).results
    : [];
  let seen = new Set<string>();
  return results.flatMap((entry: any): PickerGIF[] => {
    if (!entry || typeof entry != "object") {
      return [];
    }
    let id = typeof entry.id == "string" && kGIFIDPattern.test(entry.id) ? entry.id : null;
    let url = gifMediaURL(entry.url);
    let filesize = positiveNumber(entry.size);
    if (!id || !url || seen.has(id) || filesize && filesize > kMaxGIFSizeBytes) {
      return [];
    }
    seen.add(id);
    let title = typeof entry.title == "string"
      ? entry.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().substring(0, kMaxTitleLength)
      : "";
    return [{
      id,
      title: title || "GIF",
      url,
      // Без превью показываем саму GIF: она тоже с CDN провайдера.
      thumbnail: gifMediaURL(entry.previewUrl) ?? url,
      width: dimension(entry.width),
      height: dimension(entry.height),
      filesize,
    }];
  });
}

/** Returns the preview URL, optionally bypassing a failed catalog thumbnail. */
export function getGIFThumbnailURL(gif: PickerGIF, useSource = false): string {
  return useSource ? gif.url : gif.thumbnail;
}

/** Downloads the selected GIF so chat and mail can send it as a real attachment. */
export async function downloadGIF(gif: PickerGIF): Promise<File> {
  let url = gifMediaURL(gif.url);
  if (!url) {
    throw new Error("The GIF URL is not from the GIF provider");
  }
  let data = await request(url);
  let bytes = toUint8Array(data);
  if (!bytes.byteLength) {
    throw new Error("The GIF is empty");
  }
  if (bytes.byteLength > kMaxGIFSizeBytes) {
    throw new Error("The GIF is too large");
  }
  if (bytes.byteLength < 4 || bytes[0] != 0x47 || bytes[1] != 0x49 || bytes[2] != 0x46 || bytes[3] != 0x38) {
    throw new Error("The downloaded file is not a GIF");
  }
  let safeID = gif.id.replace(/[^a-z0-9_-]/gi, "-").substring(0, 64) || "selected";
  return new File([bytes as unknown as BlobPart], `gif-${safeID}.gif`, { type: "image/gif" });
}

/** https-адрес с CDN провайдера, без логина и нестандартного порта; иначе null. */
export function gifMediaURL(value: unknown): string | null {
  if (typeof value != "string" || value.length > 2048) {
    return null;
  }
  try {
    let url = new URL(value);
    if (url.protocol != "https:" || url.username || url.password || url.port && url.port != "443") {
      return null;
    }
    return kGIFMediaHostPattern.test(url.hostname) ? url.toString() : null;
  } catch (ex) {
    return null;
  }
}

function positiveNumber(value: unknown): number | null {
  return typeof value == "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function dimension(value: unknown): number | null {
  let number = positiveNumber(value);
  return number && number <= kMaxDimension ? Math.round(number) : null;
}

async function request(url: string): Promise<ArrayBuffer | Uint8Array> {
  let kyCreate = appGlobal.remoteApp?.kyCreate;
  if (typeof kyCreate == "function") {
    let ky = await kyCreate({ timeout: kRequestTimeoutMS });
    return await ky.get(url, { result: "arrayBuffer" });
  }
  let response = await fetch(url, { signal: AbortSignal.timeout(kRequestTimeoutMS) });
  if (!response.ok) {
    throw new Error(`Media request failed: HTTP ${response.status}`);
  }
  return await response.arrayBuffer();
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
