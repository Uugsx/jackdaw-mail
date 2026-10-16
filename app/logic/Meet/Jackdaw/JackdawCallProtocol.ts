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
  | "timeout";

const END_REASONS: readonly JackdawCallEndReason[] = [
  "offline", "busy", "declined", "no-answer", "cancelled", "hangup",
  "answered-elsewhere", "connection-lost", "timeout",
];

export type JackdawServerMessage =
  | { type: "server-hello"; protocol: number }
  | { type: "welcome"; emails: string[]; resumedCalls: string[] }
  | { type: "verify-sent"; email: string }
  | { type: "verified"; email: string; proof: string }
  | { type: "lookup-result"; requestId: string | null; reachable: Record<string, boolean> }
  | { type: "ringing"; callId: string }
  | { type: "incoming"; callId: string; from: string; fromName: string; to: string; video: boolean }
  | { type: "accepted" | "joined"; callId: string; livekitURL: string; token: string }
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
  | { type: "blob-data"; blobId: string; index: number; total: number; data: string };

const EMAIL_PATTERN = /^[^@\s]{1,128}@[^@\s]{1,190}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_TEXT = 200;

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

function count(value: unknown): number {
  return typeof value == "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function emailList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCallEmail).filter((email): email is string => !!email);
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
      };
    case "verify-sent": {
      let email = normalizeCallEmail(data.email);
      return email ? { type: "verify-sent", email } : null;
    }
    case "verified": {
      let email = normalizeCallEmail(data.email);
      return email && typeof data.proof == "string" && data.proof.length <= 1024
        ? { type: "verified", email, proof: data.proof }
        : null;
    }
    case "lookup-result": {
      let reachable: Record<string, boolean> = {};
      if (data.reachable && typeof data.reachable == "object") {
        for (let [key, value] of Object.entries(data.reachable)) {
          let email = normalizeCallEmail(key);
          if (email) reachable[email] = value === true;
        }
      }
      return { type: "lookup-result", requestId: optionalText(data.requestId), reachable };
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
      let url = typeof data.livekitURL == "string" ? data.livekitURL : "";
      // Медиа только по TLS: токен комнаты нельзя отправлять по открытому каналу.
      if (!id || !url.startsWith("wss://") || typeof data.token != "string" || !data.token) return null;
      return { type: data.type, callId: id, livekitURL: url, token: data.token };
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
    case "rate_limited":
      return gt`Too many requests. Try again later.`;
    case "invalid_email":
      return gt`This is not a valid email address.`;
    case "call_not_found":
      return gt`The call has already ended.`;
    case "service_unavailable":
      return gt`The call service is temporarily unavailable. Try again later.`;
    case "quota_exceeded":
      return gt`The file storage limit is reached. Old files are deleted after 30 days.`;
    case "blob_not_found":
      return gt`The file is no longer available. Files are kept for 30 days.`;
    case "chat_not_registered":
    case "invalid_device":
      return gt`The chat could not be set up on this device. Reconnect and try again.`;
    default:
      return gt`The call service rejected the request.`;
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
