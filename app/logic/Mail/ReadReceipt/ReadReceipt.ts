import { SpecialFolder } from "../Folder";
import type { EMail } from "../EMail";
import type { MailAccount } from "../MailAccount";
import { PersonUID } from "../../Abstract/PersonUID";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { gt } from "../../../l10n/l10n";

/** Ответ на чужой запрос о прочтении (Outlook: «Всегда / Никогда / Спрашивать») */
export type ReadReceiptPolicy = "ask" | "always" | "never";
export const kReadReceiptPolicyKey = "mail.readReceipt.respond";
export const kDefaultReadReceiptPolicy: ReadReceiptPolicy = "ask";

export function readReceiptPolicySetting() {
  return getLocalStorage<ReadReceiptPolicy>(kReadReceiptPolicyKey, kDefaultReadReceiptPolicy);
}

export function normalizeReadReceiptPolicy(value: unknown): ReadReceiptPolicy {
  return value === "always" ? "always" : value === "never" ? "never" : "ask";
}

export interface ReadReceiptRequest {
  /** Куда отправить уведомление (`Disposition-Notification-To`) */
  to: PersonUID;
  /** RFC 8098 §2.1: адрес не совпадает с отправителем (From).
   * Автоматически не отправляем — только спросить. */
  suspicious: boolean;
}

/** Папки, где запрос не показываем: свои письма, нежелательные и черновики */
const kSkipFolders = [SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Outbox, SpecialFolder.Spam];

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() == b.trim().toLowerCase();
}

/**
 * Запрос о прочтении или null, если отвечать не нужно.
 * Адрес берётся из `Disposition-Notification-To` при разборе MIME (`EMail.readReceiptTo`);
 * EWS и OWA тоже скачивают MIME, а Exchange пишет туда этот заголовок для `IsReadReceiptRequested`.
 */
export function getReadReceiptRequest(email: EMail): ReadReceiptRequest | null {
  let account = email.folder?.account;
  let to = email.readReceiptTo;
  if (!account?.canSendReadReceipt || !to?.emailAddress) {
    return null;
  }
  if (email.outgoing || email.isDraft || email.isSpam || email.readReceiptHandled) {
    return null;
  }
  if (kSkipFolders.includes(email.folder.specialFolder)) {
    return null;
  }
  if (account.isMyEMailAddress(to.emailAddress) || isReadReceiptHandledLocally(email)) {
    return null;
  }
  return {
    to,
    suspicious: !sameAddress(to.emailAddress, email.from?.emailAddress),
  };
}

/* Обработанные запросы: на сервере (IMAP `$MDNSent`, EWS `SuppressReadReceipt`)
 * и локально — в MIME запрос остаётся, а повторно спрашивать нельзя */

const kHandledKey = "mail.readReceipt.handled";
const kMaxHandled = 2000;

function handledKey(email: EMail): string | null {
  let id = email.id || (email.pID != null ? String(email.pID) : null);
  return id ? `${email.folder?.account?.id ?? ""}:${id}` : null;
}

export function isReadReceiptHandledLocally(email: EMail): boolean {
  let key = handledKey(email);
  if (!key) {
    return false;
  }
  try {
    return getLocalStorage<string[]>(kHandledKey, []).value.includes(key);
  } catch (ex) {
    return false;
  }
}

export function rememberReadReceiptHandled(email: EMail) {
  email.readReceiptHandled = true;
  let key = handledKey(email);
  if (!key) {
    return;
  }
  let setting = getLocalStorage<string[]>(kHandledKey, []);
  let list = Array.isArray(setting.value) ? setting.value.filter(k => k != key) : [];
  list.push(key);
  setting.value = list.slice(-kMaxHandled);
}

/* RFC 8098 MDN */

export type MDNSendingMode = "manual" | "automatic";

function encodeHeaderWord(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(text)) {
    return text;
  }
  return `=?UTF-8?B?${utf8ToBase64(text)}?=`;
}

function utf8ToBase64(text: string): string {
  let bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatAddress(person: PersonUID): string {
  let name = person.name && person.name != person.emailAddress
    ? encodeHeaderWord(person.name.replace(/["\\]/g, ""))
    : "";
  if (!name) {
    return `<${person.emailAddress}>`;
  }
  return name.startsWith("=?") ? `${name} <${person.emailAddress}>` : `"${name}" <${person.emailAddress}>`;
}

function formatRFC2822Date(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let pad = (n: number) => String(n).padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function wrapBase64(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}

function angleID(id: string | null | undefined): string | null {
  let bare = id?.trim().replace(/^<|>$/g, "");
  return bare && /^[^\s<>]+$/.test(bare) ? `<${bare}>` : null;
}

export interface MDNOptions {
  original: EMail;
  from: PersonUID;
  to: PersonUID;
  mode: MDNSendingMode;
  /** Для тестов */
  now?: Date;
  boundary?: string;
  messageID?: string;
}

/** Подпись темы уведомления, как у Outlook: «Прочитано: …» */
export function readReceiptSubject(subject: string): string {
  return gt`Read: ${subject}`;
}

/** Собирает уведомление `multipart/report; report-type=disposition-notification` только из ASCII:
 * EWS и OWA отправляют его как `MimeContent` через `btoa()` */
export function buildReadReceiptMIME(options: MDNOptions): string {
  let { original, from, to, mode } = options;
  let now = options.now ?? new Date();
  let boundary = options.boundary ?? `----=_MDN_${crypto.randomUUID()}`;
  let domain = from.emailAddress.split("@")[1] || "jackdaw.invalid";
  let messageID = options.messageID ?? `<${crypto.randomUUID()}@${domain}>`;
  let originalID = angleID(original.id);
  let subject = readReceiptSubject(original.subject ?? "");
  let sent = original.sent ? original.sent.toLocaleString() : "";
  let human = [
    gt`Your message`,
    "",
    `${gt`To`}: ${from.emailAddress}`,
    `${gt`Subject`}: ${original.subject ?? ""}`,
    sent ? `${gt`Sent`}: ${sent}` : null,
    "",
    gt`was read on ${now.toLocaleString()}.`,
    "",
  ].filter(line => line != null).join("\r\n");
  let disposition = mode == "automatic"
    ? "automatic-action/MDN-sent-automatically; displayed"
    : "manual-action/MDN-sent-manually; displayed";
  let report = [
    "Reporting-UA: Jackdaw Mail",
    `Final-Recipient: rfc822;${from.emailAddress}`,
    originalID ? `Original-Message-ID: ${originalID}` : null,
    `Disposition: ${disposition}`,
    "",
  ].filter(line => line != null).join("\r\n");
  let lines = [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(to)}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${formatRFC2822Date(now)}`,
    `Message-ID: ${messageID}`,
    originalID ? `References: ${originalID}` : null,
    "MIME-Version: 1.0",
    // RFC 3834: автоматический ответ не должен вызывать автоответы
    mode == "automatic" ? "Auto-Submitted: auto-replied" : null,
    `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8ToBase64(human)),
    "",
    `--${boundary}`,
    "Content-Type: message/disposition-notification",
    "",
    report,
    `--${boundary}--`,
    "",
  ];
  return lines.filter(line => line != null).join("\r\n");
}

/** Отправитель уведомления: адрес аккаунта, на который пришло письмо */
export function readReceiptSender(email: EMail, account: MailAccount): PersonUID {
  for (let recipient of [...email.to.contents, ...email.cc.contents, ...email.bcc.contents]) {
    let identity = account.findIdentityForEMailAddress(recipient.emailAddress);
    if (identity && !identity.isCatchAll) {
      return identity.asPersonUID();
    }
  }
  let identity = account.identities.find(id => !id.isCatchAll && !id.isDelegate);
  return identity?.asPersonUID() ?? new PersonUID(account.emailAddress, account.realname);
}

/** Отправить уведомление о прочтении */
export async function sendReadReceipt(email: EMail, request: ReadReceiptRequest, mode: MDNSendingMode): Promise<void> {
  let account = email.folder.account;
  let mdn = account.newEMailFrom();
  mdn.from = readReceiptSender(email, account);
  mdn.to.replaceAll([request.to]);
  mdn.subject = readReceiptSubject(email.subject ?? "");
  mdn.sendRawMIME = buildReadReceiptMIME({ original: email, from: mdn.from, to: request.to, mode });
  await account.sendReadReceipt(email, mdn);
  rememberReadReceiptHandled(email);
}

/** «Не отправлять»: отметить запрос обработанным, чтобы не спрашивали и другие программы */
export async function declineReadReceipt(email: EMail): Promise<void> {
  rememberReadReceiptHandled(email);
  await email.folder.account.suppressReadReceipt(email);
}
