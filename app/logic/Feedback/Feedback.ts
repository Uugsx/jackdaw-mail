/**
 * Отправка отзыва пользователя на сервис обратной связи Jackdaw.
 *
 * В приложении нет никаких секретов: сервер сам пересылает отзыв на почту,
 * в Telegram и (для ошибок) в GitHub. Сюда уходит только то, что пользователь
 * видит в форме, и — по его согласию — версия приложения, платформа и язык.
 */
import { BILLING_LICENSE_API_URL } from "../Billing/Billing";
import { getDeviceID } from "../Billing/ProEntitlement";
import { appVersion } from "../build";
import { getUILocale, gt } from "../../l10n/l10n";

export type FeedbackKind = "bug" | "idea" | "other";

export interface FeedbackDiagnostics {
  appVersion?: string;
  platform?: string;
  locale?: string;
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  contactEmail?: string;
  includeDiagnostics: boolean;
  /** Поле-ловушка для ботов: у человека всегда пустое */
  website?: string;
}

export const kFeedbackMinChars = 5;
export const kFeedbackMaxChars = 5000;
const kFeedbackTimeoutMS = 15_000;

export class FeedbackError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** Адрес сервиса строится от сервиса лицензий: только HTTPS, только путь /v1/feedback. */
export function feedbackServiceURL(licenseAPIURL: string | null = BILLING_LICENSE_API_URL): string | null {
  if (!licenseAPIURL) return null;
  try {
    let url = new URL(licenseAPIURL);
    if (url.protocol != "https:") return null;
    return `${url.origin}/v1/feedback`;
  } catch {
    return null;
  }
}

export function detectPlatform(userAgent = globalThis.navigator?.userAgent ?? ""): string | undefined {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iOS/i.test(userAgent)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Linux/i.test(userAgent)) return "Linux";
  return undefined;
}

export function collectDiagnostics(version = appVersion): FeedbackDiagnostics {
  let diagnostics: FeedbackDiagnostics = {};
  if (/^[0-9A-Za-z.+_-]{1,64}$/.test(version)) diagnostics.appVersion = version;
  let platform = detectPlatform();
  if (platform) diagnostics.platform = platform;
  let locale = getUILocale();
  if (/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(locale)) diagnostics.locale = locale;
  return diagnostics;
}

export function isValidContactEmail(value: string): boolean {
  return value.length <= 254 && /^[^@\s<>"',;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/.test(value);
}

/**
 * Обезличенный отпечаток устройства для лимитов на сервере: SHA-256 от ID
 * устройства. Сам ID участвует в проверке лицензии и сервису отзывов не нужен.
 */
export async function deviceFingerprint(deviceID: string = getDeviceID()): Promise<string> {
  let digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jackdaw-feedback:${deviceID}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Сообщение об ошибке по коду сервера — без технических подробностей. */
function messageForError(code: string): string {
  switch (code) {
    case "rate_limited": return gt`You have sent several messages in a short time. Please try again later.`;
    case "message_too_short": return gt`Please describe it in a few more words.`;
    case "message_too_long": return gt`The message is too long.`;
    case "invalid_email": return gt`Please check the email address for the reply.`;
    case "busy": return gt`The feedback service is busy. Please try again later.`;
    default: return gt`The message could not be sent. Please try again later.`;
  }
}

/** Отправляет отзыв. Возвращает короткий номер отзыва для пользователя. */
export async function sendFeedback(draft: FeedbackDraft, version?: string): Promise<string> {
  let url = feedbackServiceURL();
  if (!url) {
    throw new FeedbackError(gt`Feedback is not available in this app build.`, "not_configured");
  }
  let message = draft.message.trim();
  if (message.length < kFeedbackMinChars) {
    throw new FeedbackError(messageForError("message_too_short"), "message_too_short");
  }
  if (message.length > kFeedbackMaxChars) {
    throw new FeedbackError(messageForError("message_too_long"), "message_too_long");
  }
  let contactEmail = draft.contactEmail?.trim() || undefined;
  if (contactEmail && !isValidContactEmail(contactEmail)) {
    throw new FeedbackError(messageForError("invalid_email"), "invalid_email");
  }

  let body = {
    kind: draft.kind,
    message,
    device: await deviceFingerprint(),
    ...(contactEmail ? { contactEmail } : {}),
    ...(draft.includeDiagnostics ? { diagnostics: collectDiagnostics(version) } : {}),
    ...(draft.website ? { website: draft.website } : {}),
  };

  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), kFeedbackTimeoutMS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new FeedbackError(gt`No connection to the feedback service. Check your internet connection and try again.`, "network");
  } finally {
    clearTimeout(timeout);
  }

  let result: any = null;
  try {
    result = await response.json();
  } catch {
    // Пустой или не-JSON ответ обрабатывается ниже по статусу.
  }
  if (!response.ok || !result?.ok) {
    let code = typeof result?.error == "string" ? result.error : `http_${response.status}`;
    throw new FeedbackError(messageForError(code), code);
  }
  return typeof result.id == "string" && /^[0-9a-f]{8}$/.test(result.id) ? result.id : "";
}
