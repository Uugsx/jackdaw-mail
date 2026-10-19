import { gt } from "../../l10n/l10n";

/** Длиннее заголовок всё равно обрезает сама ОС, причём посреди слова. */
const kMaxTitleLength = 80;
const kMaxBodyLength = 240;
const kMaxSubjectInListLength = 48;
/** Сколько тем писем перечислять в одном уведомлении. */
const kMaxSubjectsInList = 3;
const kAppName = "Jackdaw Mail";

/** Схлопывает пробелы и переводы строк, обрезает по границе слова. */
export function tidyNotificationText(text: string | null | undefined, maxLength: number): string {
  let tidy = (text ?? "").replace(/\s+/g, " ").trim();
  if (tidy.length <= maxLength) {
    return tidy;
  }
  let cut = tidy.slice(0, maxLength - 1);
  let lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.6) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.replace(/[\s,.;:–—-]+$/, "") + "…";
}

/** Заголовок системного уведомления: без лишних пробелов, не пустой. */
export function notificationTitle(title: string | null | undefined): string {
  return tidyNotificationText(title, kMaxTitleLength) || kAppName;
}

/** Текст системного уведомления: одной аккуратной строкой. */
export function notificationBody(body: string | null | undefined): string {
  return tidyNotificationText(body, kMaxBodyLength);
}

/** Тема письма для уведомления; пустая — «(без темы)». */
export function notificationSubject(subject: string | null | undefined): string {
  return tidyNotificationText(subject, kMaxTitleLength) || gt`(no subject)`;
}

export interface NewMailForNotification {
  subject?: string | null;
  text?: string | null;
}

/**
 * Заголовок и текст уведомления о новой почте.
 * Одно письмо — тема и начало текста. Несколько — «Новых писем: N»
 * и темы первых писем, а не склейка обрывков.
 */
export function newMailNotificationText(messages: NewMailForNotification[], count = messages.length): { title: string; body: string } {
  if (messages.length == 1 && count <= 1) {
    let message = messages[0];
    return {
      title: notificationSubject(message.subject),
      body: notificationBody(message.text),
    };
  }
  let total = Math.max(count, messages.length);
  let subjects = messages
    .slice(0, kMaxSubjectsInList)
    .map(message => tidyNotificationText(message.subject, kMaxSubjectInListLength) || gt`(no subject)`);
  let rest = total - subjects.length;
  let body = subjects.join(" · ");
  if (rest > 0) {
    body += " · " + gt`and ${rest} more`;
  }
  return {
    title: gt`New messages: ${total}`,
    body: notificationBody(body),
  };
}
