/**
 * Протокол сигнального сервиса звонков Jackdaw ↔ Jackdaw (call_server/calls.py).
 * Сообщения сервера проверяются здесь, до того как попадут в логику звонка:
 * всё, что пришло по сети, считается недоверенным.
 */
import { gt } from "../../../l10n/l10n";

/** Почему звонок закончился. Совпадает с `reason` в `call-ended` на сервере. */
export type JackdawCallEndReason =
  | "offline"
  | "busy"
  | "declined"
  | "no-answer"
  | "cancelled"
  | "hangup"
  | "answered-elsewhere"
  | "connection-lost"
  | "timeout"
  /** У собеседника включено «Не беспокоить» */
  | "dnd";

const END_REASONS: readonly JackdawCallEndReason[] = [
  "offline", "busy", "declined", "no-answer", "cancelled", "hangup",
  "answered-elsewhere", "connection-lost", "timeout", "dnd",
];

/** Статус пользователя. «Занят» — звонки проходят, «Не беспокоить» — сервер их отклоняет. */
export type JackdawUserStatus = "available" | "busy" | "dnd";
export const USER_STATUSES: readonly JackdawUserStatus[] = ["available", "busy", "dnd"];

/** ICE-кандидат WebRTC в том виде, в каком его пересылает сервер. */
export interface JackdawIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/** STUN/TURN-сервер для `RTCPeerConnection`. Совпадает с `RTCIceServer`. */
export interface JackdawIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Бесплатные публичные STUN-серверы: помогают клиентам узнать свой внешний адрес за NAT.
 * Медиа через них не идёт. Сервис звонков может прислать свой список в `accepted`/`joined`.
 */
export const DEFAULT_ICE_SERVERS: readonly JackdawIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export type JackdawServerMessage =
  | { type: "server-hello"; protocol: number }
  /** `proofs` — адреса, подтверждённые на других устройствах той же лицензии: email → подтверждение */
  | { type: "welcome"; emails: string[]; resumedCalls: string[]; proofs: Record<string, string> }
  | { type: "verify-sent"; email: string }
  /** `requestedEmail` — если почтовый сервер отправил письмо от другого адреса ящика, и подтверждён он */
  | { type: "verified"; email: string; proof: string; requestedEmail?: string }
  /** Обратное подтверждение: письмо нужно отправить с адреса `email` на `address` */
  | { type: "verify-reverse-ready"; email: string; token: string; address: string; mailSubject: string; expiresIn: number }
  | { type: "verify-reverse-pending"; email: string; token: string }
  /** `statuses` — только у собеседников в сети со статусом, отличным от «в сети» */
  | { type: "lookup-result"; requestId: string | null; reachable: Record<string, boolean>; statuses: Record<string, JackdawUserStatus> }
  /** Свой статус, выбранный на этом или другом устройстве. `untilIn` — сколько секунд он ещё действует */
  | { type: "status"; status: JackdawUserStatus; untilIn: number | null }
  | { type: "ringing"; callId: string }
  | { type: "incoming"; callId: string; from: string; fromName: string; to: string; video: boolean }
  /** Звонок принят: медиа идёт напрямую между клиентами (P2P). `iceServers` — null, если сервис их не задаёт. */
  | { type: "accepted" | "joined"; callId: string; iceServers: JackdawIceServer[] | null }
  /** SDP или ICE-кандидат от собеседника, пересланный сервисом */
  | { type: "signal"; callId: string; kind: "offer" | "answer"; sdp: string }
  | { type: "signal"; callId: string; kind: "ice"; candidate: JackdawIceCandidate | null }
  | { type: "call-ended"; callId: string; reason: JackdawCallEndReason }
  | { type: "error"; code: string; message: string; requestType: string | null; callId: string | null; requestId: string | null; email: string | null; messageId: string | null; blobId: string | null }
  | { type: "pong" }
  // Чат: содержимое — шифротекст, разбирается в JackdawChatAccount
  | { type: "chat-registered"; deviceId: string; emails: string[] }
  | { type: "chat-keys-result"; requestId: string | null; devices: Record<string, { deviceId: string; publicKey: string }[]> }
  | { type: "chat-message"; messageId: string; from: string; fromDevice: string; ciphertext: string; key: string; sentAt: number; ephemeral: boolean }
  | { type: "chat-sent"; messageId: string; queued: number; delivered: number }
  | { type: "chat-pending"; count: number; remaining: number }
  | { type: "blob-stored"; blobId: string; index: number; complete: boolean }
  | { type: "blob-data"; blobId: string; index: number; total: number; data: string }
  // Присутствие в общих ящиках (call_server/presence.py): `state: "none"` снимает состояние коллеги
  | ({ type: "presence"; mailbox: string } & JackdawPresenceEntry)
  | { type: "presence-snapshot"; mailboxes: Record<string, JackdawPresenceEntry[]> }
  /** Ответ на `gif-search` (call_server/gifs.py). `results` проверяет и разбирает
   * app/frontend/Chat/Emoji/media.ts (`parseGIFResults`): здесь — только обрезка длины. */
  | { type: "gif-results"; requestId: string | null; provider: string; hasNext: boolean; results: unknown[] };

export type JackdawPresenceState = "viewing" | "replying" | "replied" | "none";

/** Что коллега делает с письмом общего ящика. Письмо — только метка `tag` (см. collisionTag.ts). */
export interface JackdawPresenceEntry {
  tag: string;
  /** Соединение коллеги: у одного письма может быть несколько читающих */
  actor: string;
  state: JackdawPresenceState;
  name: string;
  /** Подтверждённый личный адрес коллеги для чата, "" — неизвестен */
  email: string;
  /** Время по часам сервера, Unix, с */
  at: number;
}

const EMAIL_PATTERN = /^[^@\s]{1,128}@[^@\s]{1,190}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;
const PRESENCE_TAG_PATTERN = /^[0-9a-f]{64}$/;
const PRESENCE_ACTOR_PATTERN = /^[0-9a-f]{16}$/;
const PRESENCE_STATES: readonly JackdawPresenceState[] = ["viewing", "replying", "replied", "none"];
/** Снимок ящика: на сервере до 16 активных состояний на соединение и до 2000 «ответил» */
const MAX_PRESENCE_SNAPSHOT = 5000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_TEXT = 200;
/** Как на сервере (call_server/gifs.py, MAX_RESULTS) */
const MAX_GIF_RESULTS = 50;
const REVERSE_TOKEN_PATTERN = /^[a-z2-7]{16}$/;
/** Как на сервере: подтверждение адреса не длиннее 1024 символов, не больше 20 адресов на соединение */
const MAX_PROOF_LENGTH = 1024;
const MAX_WELCOME_PROOFS = 20;
/** Совпадает с ограничениями сервера (call_server/calls.py) */
const MAX_SDP_LENGTH = 16 * 1024;
const MAX_ICE_CANDIDATE_LENGTH = 1024;
const MAX_ICE_MID_LENGTH = 64;
const MAX_ICE_MLINE_INDEX = 64;
const MAX_ICE_SERVERS = 8;
const ICE_URL_PATTERN = /^(stuns?|turns?):[^\s]{1,300}$/;

/**
 * Адрес для обратного подтверждения допустим только на домене самого сервиса
 * (тот же базовый домен, что у сервиса звонков). Так даже ответ подменённого
 * сервера не заставит приложение отправить письмо пользователя на чужой адрес.
 */
export function isTrustedReverseAddress(address: string, serviceURL: string | null): boolean {
  if (!serviceURL) return false;
  let host: string;
  try {
    host = new URL(serviceURL).hostname.toLowerCase();
  } catch {
    return false;
  }
  let baseDomain = host.split(".").slice(-2).join(".");
  let match = /^verify\+[a-z2-7]{16}@([a-z0-9.-]+)$/.exec(address.toLowerCase());
  if (!match || !baseDomain.includes(".")) return false;
  return match[1] == baseDomain || match[1].endsWith("." + baseDomain);
}

export function normalizeCallEmail(value: unknown): string | null {
  if (typeof value != "string") return null;
  let email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value != "string") return fallback;
  // Управляющие символы не должны попасть в интерфейс.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, MAX_TEXT);
}

function optionalText(value: unknown): string | null {
  return typeof value == "string" ? text(value) : null;
}

function callID(value: unknown): string | null {
  return typeof value == "string" && CALL_ID_PATTERN.test(value) ? value : null;
}

function base64(value: unknown): string | null {
  return typeof value == "string" && value.length % 4 == 0 && BASE64_PATTERN.test(value) ? value : null;
}

function iceServers(value: unknown): JackdawIceServer[] | null {
  if (!Array.isArray(value)) return null;
  let servers: JackdawIceServer[] = [];
  for (let item of value.slice(0, MAX_ICE_SERVERS)) {
    let rawURLs = typeof item?.urls == "string" ? [item.urls] : Array.isArray(item?.urls) ? item.urls : [];
    let urls = rawURLs.filter((url: unknown): url is string => typeof url == "string" && ICE_URL_PATTERN.test(url)).slice(0, MAX_ICE_SERVERS);
    if (!urls.length) continue;
    let server: JackdawIceServer = { urls };
    if (typeof item.username == "string" && typeof item.credential == "string") {
      server.username = item.username.slice(0, MAX_TEXT);
      server.credential = item.credential.slice(0, MAX_TEXT);
    }
    servers.push(server);
  }
  return servers.length ? servers : null;
}

/** SDP разбирает сам WebRTC; здесь — только размер и формат, как на сервере. */
function sdp(value: unknown): string | null {
  return typeof value == "string" && value.length <= MAX_SDP_LENGTH && value.startsWith("v=0") ? value : null;
}

/** @returns undefined — кандидат некорректен; null — кандидаты закончились */
function iceCandidate(value: any): JackdawIceCandidate | null | undefined {
  if (value === null) return null;
  if (!value || typeof value != "object" || typeof value.candidate != "string" || value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) {
    return undefined;
  }
  let sdpMid = typeof value.sdpMid == "string" && value.sdpMid.length <= MAX_ICE_MID_LENGTH ? value.sdpMid : null;
  let index = value.sdpMLineIndex;
  let sdpMLineIndex = Number.isInteger(index) && index >= 0 && index <= MAX_ICE_MLINE_INDEX ? index as number : null;
  if (sdpMid == null && sdpMLineIndex == null) return undefined;
  return { candidate: value.candidate, sdpMid, sdpMLineIndex };
}

function count(value: unknown): number {
  return typeof value == "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function emailList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCallEmail).filter((email): email is string => !!email);
}

/** Подтверждения адресов из `welcome`. Некорректные записи отбрасываются. */
function proofMap(value: unknown): Record<string, string> {
  let result: Record<string, string> = {};
  if (!value || typeof value != "object" || Array.isArray(value)) return result;
  for (let [key, proof] of Object.entries(value).slice(0, MAX_WELCOME_PROOFS)) {
    let email = normalizeCallEmail(key);
    if (email && typeof proof == "string" && proof.length <= MAX_PROOF_LENGTH) {
      result[email] = proof;
    }
  }
  return result;
}

function presenceEntry(value: any): JackdawPresenceEntry | null {
  if (!value || typeof value != "object") return null;
  let { tag, actor, state } = value;
  if (typeof tag != "string" || !PRESENCE_TAG_PATTERN.test(tag)) return null;
  if (typeof actor != "string" || !PRESENCE_ACTOR_PATTERN.test(actor)) return null;
  if (!PRESENCE_STATES.includes(state)) return null;
  return { tag, actor, state, name: text(value.name), email: normalizeCallEmail(value.email) ?? "", at: count(value.at) };
}

/** @returns null, если сообщение не соответствует протоколу. Такие сообщения отбрасываются. */
export function parseServerMessage(raw: unknown): JackdawServerMessage | null {
  let data: any;
  try {
    data = typeof raw == "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!data || typeof data != "object" || typeof data.type != "string") return null;
  switch (data.type) {
    case "server-hello":
      return { type: "server-hello", protocol: typeof data.protocol == "number" ? data.protocol : 0 };
    case "welcome":
      return {
        type: "welcome",
        emails: emailList(data.emails),
        resumedCalls: Array.isArray(data.resumedCalls) ? data.resumedCalls.map(callID).filter(Boolean) : [],
        proofs: proofMap(data.proofs),
      };
    case "verify-sent": {
      let email = normalizeCallEmail(data.email);
      return email ? { type: "verify-sent", email } : null;
    }
    case "verified": {
      let email = normalizeCallEmail(data.email);
      return email && typeof data.proof == "string" && data.proof.length <= MAX_PROOF_LENGTH
        ? { type: "verified", email, proof: data.proof, ...(normalizeCallEmail(data.requestedEmail) ? { requestedEmail: normalizeCallEmail(data.requestedEmail)! } : {}) }
        : null;
    }
    case "verify-reverse-ready": {
      let email = normalizeCallEmail(data.email);
      let token = typeof data.token == "string" && REVERSE_TOKEN_PATTERN.test(data.token) ? data.token : null;
      let address = typeof data.address == "string" ? data.address.toLowerCase() : "";
      let mailSubject = optionalText(data.mailSubject);
      if (!email || !token || !mailSubject || !address.startsWith(`verify+${token}@`)) return null;
      let expiresIn = typeof data.expiresIn == "number" && data.expiresIn > 0 ? Math.min(data.expiresIn, 3600) : 900;
      return { type: "verify-reverse-ready", email, token, address, mailSubject, expiresIn };
    }
    case "verify-reverse-pending": {
      let email = normalizeCallEmail(data.email);
      let token = typeof data.token == "string" && REVERSE_TOKEN_PATTERN.test(data.token) ? data.token : null;
      return email && token ? { type: "verify-reverse-pending", email, token } : null;
    }
    case "lookup-result": {
      let reachable: Record<string, boolean> = {};
      if (data.reachable && typeof data.reachable == "object") {
        for (let [key, value] of Object.entries(data.reachable)) {
          let email = normalizeCallEmail(key);
          if (email) reachable[email] = value === true;
        }
      }
      let statuses: Record<string, JackdawUserStatus> = {};
      if (data.statuses && typeof data.statuses == "object") {
        for (let [key, value] of Object.entries(data.statuses)) {
          let email = normalizeCallEmail(key);
          if (email && USER_STATUSES.includes(value as JackdawUserStatus)) statuses[email] = value as JackdawUserStatus;
        }
      }
      return { type: "lookup-result", requestId: optionalText(data.requestId), reachable, statuses };
    }
    case "status": {
      if (!USER_STATUSES.includes(data.status)) return null;
      let untilIn = typeof data.untilIn == "number" && Number.isFinite(data.untilIn) && data.untilIn >= 0 ? data.untilIn : null;
      return { type: "status", status: data.status as JackdawUserStatus, untilIn };
    }
    case "ringing": {
      let id = callID(data.callId);
      return id ? { type: "ringing", callId: id } : null;
    }
    case "incoming": {
      let id = callID(data.callId);
      let from = normalizeCallEmail(data.from);
      let to = normalizeCallEmail(data.to);
      return id && from && to
        ? { type: "incoming", callId: id, from, to, fromName: text(data.fromName), video: data.video === true }
        : null;
    }
    case "accepted":
    case "joined": {
      let id = callID(data.callId);
      // Токены LiveKit от сервиса в режиме SFU клиент не использует: звонки только P2P.
      return id ? { type: data.type, callId: id, iceServers: iceServers(data.iceServers) } : null;
    }
    case "signal": {
      let id = callID(data.callId);
      if (!id) return null;
      if (data.kind == "offer" || data.kind == "answer") {
        let description = sdp(data.sdp);
        return description ? { type: "signal", callId: id, kind: data.kind, sdp: description } : null;
      }
      if (data.kind == "ice") {
        let candidate = iceCandidate(data.candidate);
        return candidate === undefined ? null : { type: "signal", callId: id, kind: "ice", candidate };
      }
      return null;
    }
    case "call-ended": {
      let id = callID(data.callId);
      let reason = END_REASONS.includes(data.reason) ? data.reason as JackdawCallEndReason : "hangup";
      return id ? { type: "call-ended", callId: id, reason } : null;
    }
    case "error":
      return {
        type: "error",
        code: text(data.code, "unknown"),
        message: text(data.message),
        requestType: optionalText(data.requestType),
        callId: callID(data.callId),
        requestId: optionalText(data.requestId),
        email: normalizeCallEmail(data.email),
        messageId: callID(data.messageId),
        blobId: typeof data.blobId == "string" && BLOB_ID_PATTERN.test(data.blobId) ? data.blobId : null,
      };
    case "pong":
      return { type: "pong" };
    case "chat-registered": {
      let deviceId = callID(data.deviceId);
      return deviceId ? { type: "chat-registered", deviceId, emails: emailList(data.emails) } : null;
    }
    case "chat-keys-result": {
      let devices: Record<string, { deviceId: string; publicKey: string }[]> = {};
      if (data.devices && typeof data.devices == "object") {
        for (let [key, list] of Object.entries(data.devices)) {
          let email = normalizeCallEmail(key);
          if (!email || !Array.isArray(list)) continue;
          devices[email] = list
            .map((d: any) => ({ deviceId: callID(d?.deviceId), publicKey: base64(d?.publicKey) }))
            .filter((d): d is { deviceId: string; publicKey: string } => !!d.deviceId && !!d.publicKey);
        }
      }
      return { type: "chat-keys-result", requestId: optionalText(data.requestId), devices };
    }
    case "chat-message": {
      let messageId = callID(data.messageId);
      let from = normalizeCallEmail(data.from);
      let fromDevice = callID(data.fromDevice);
      let ciphertext = base64(data.ciphertext);
      let key = base64(data.key);
      return messageId && from && fromDevice && ciphertext && key
        ? { type: "chat-message", messageId, from, fromDevice, ciphertext, key, sentAt: count(data.sentAt), ephemeral: data.ephemeral === true }
        : null;
    }
    case "chat-sent": {
      let messageId = callID(data.messageId);
      return messageId ? { type: "chat-sent", messageId, queued: count(data.queued), delivered: count(data.delivered) } : null;
    }
    case "chat-pending":
      return { type: "chat-pending", count: count(data.count), remaining: count(data.remaining) };
    case "blob-stored":
      return typeof data.blobId == "string" && BLOB_ID_PATTERN.test(data.blobId)
        ? { type: "blob-stored", blobId: data.blobId, index: count(data.index), complete: data.complete === true }
        : null;
    case "blob-data": {
      let payload = base64(data.data);
      return typeof data.blobId == "string" && BLOB_ID_PATTERN.test(data.blobId) && payload != null
        ? { type: "blob-data", blobId: data.blobId, index: count(data.index), total: count(data.total), data: payload }
        : null;
    }
    case "presence": {
      let mailbox = normalizeCallEmail(data.mailbox);
      let entry = presenceEntry(data);
      return mailbox && entry ? { type: "presence", mailbox, ...entry } : null;
    }
    case "presence-snapshot": {
      let mailboxes: Record<string, JackdawPresenceEntry[]> = {};
      if (data.mailboxes && typeof data.mailboxes == "object" && !Array.isArray(data.mailboxes)) {
        for (let [key, list] of Object.entries(data.mailboxes)) {
          let mailbox = normalizeCallEmail(key);
          if (!mailbox || !Array.isArray(list)) continue;
          mailboxes[mailbox] = list.slice(0, MAX_PRESENCE_SNAPSHOT).map(presenceEntry).filter((e): e is JackdawPresenceEntry => !!e);
        }
      }
      return { type: "presence-snapshot", mailboxes };
    }
    case "gif-results":
      return {
        type: "gif-results",
        requestId: optionalText(data.requestId),
        provider: text(data.provider),
        hasNext: data.hasNext === true,
        results: Array.isArray(data.results) ? data.results.slice(0, MAX_GIF_RESULTS) : [],
      };
    default:
      return null;
  }
}

/** Текст для пользователя о завершении звонка. null — сообщать не нужно (обычное завершение). */
export function endReasonMessage(reason: JackdawCallEndReason, outgoing: boolean): string | null {
  switch (reason) {
    case "offline":
      return gt`The contact is not online in Jackdaw Mail right now.`;
    case "busy":
      return gt`The contact is busy with another call.`;
    case "dnd":
      return outgoing ? gt`The contact asked not to be disturbed. Write them in the chat instead.` : null;
    case "declined":
      return outgoing ? gt`The contact declined the call.` : null;
    case "no-answer":
      return outgoing ? gt`The contact did not answer.` : gt`You missed a call.`;
    case "cancelled":
      return outgoing ? null : gt`You missed a call.`;
    case "connection-lost":
      return gt`The call ended because the connection was lost.`;
    case "timeout":
      return gt`The call ended because it reached the maximum duration.`;
    case "hangup":
    case "answered-elsewhere":
      return null;
  }
}

/** Текст ошибки сервера. Сервер присылает и свой текст, но на русском; клиент показывает текст на языке интерфейса. */
export function serverErrorMessage(code: string): string {
  switch (code) {
    case "license_inactive":
    case "device_not_activated":
    case "invalid_credential":
      return gt`Calls between Jackdaw Mail users need an active Jackdaw Pro license or trial.`;
    case "not_verified":
      return gt`Confirm your email address in Settings → Jackdaw Pro → Calls and chat to make calls.`;
    case "call_self":
      return gt`You cannot call yourself.`;
    case "verification_unavailable":
      return gt`Email confirmation is not available on the call server yet.`;
    case "mail_failed":
      return gt`Could not send the confirmation email. Try again later.`;
    case "code_invalid":
      return gt`The confirmation code is wrong.`;
    case "code_expired":
      return gt`The confirmation code has expired. Request a new one.`;
    case "sender_not_authenticated":
      return gt`The email arrived, but your mail server did not sign it (DKIM/SPF), so it cannot confirm the address. Use the code from the email instead.`;
    case "rate_limited":
      return gt`Too many requests. Try again later.`;
    case "invalid_email":
      return gt`This is not a valid email address.`;
    case "call_not_found":
      return gt`The call has already ended.`;
    case "service_unavailable":
      return gt`No connection to the Jackdaw server. Check the internet connection and try again.`;
    case "internal_error":
      return gt`The Jackdaw server could not process the request. Try again later.`;
    case "quota_exceeded":
      return gt`The file storage limit is reached. Old files are deleted after 30 days.`;
    case "blob_not_found":
      return gt`The file is no longer available. Files are kept for 30 days.`;
    case "presence_not_member":
      return gt`Confirm the shared mailbox address in Settings → Calls and chat to see colleagues working on its messages.`;
    case "chat_not_registered":
    case "invalid_device":
      return gt`The chat could not be set up on this device. Reconnect and try again.`;
    default:
      return gt`The Jackdaw server rejected the request.`;
  }
}

/** Адрес сигналинга на том же хосте, что и сервис лицензий. */
export function callServiceURL(licenseAPIURL: string | null): string | null {
  if (!licenseAPIURL) return null;
  try {
    let url = new URL(licenseAPIURL);
    if (url.protocol != "https:") return null;
    url.protocol = "wss:";
    url.pathname = "/v1/calls";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Задержки переподключения: быстро после короткого сбоя, редко при долгой недоступности. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1)];
}
