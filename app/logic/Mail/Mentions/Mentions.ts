/**
 * @упоминания, как в Outlook: «@Имя» в тексте письма — ссылка mailto: на человека,
 * а сам человек добавляется в «Кому». У получателя такие письма видны фильтром «Упоминания меня».
 *
 * Разметка совместима с Outlook и OWA: `<a href="mailto:…">@Имя</a>`.
 */
import type { EMail } from "../EMail";
import type { PersonUID } from "../../Abstract/PersonUID";
import { escapeAttr, escapeHTML } from "../../Files/FileType/htmlHelper";

export const kMentionClass = "jackdaw-mention";
/** Длина запроса после «@», дальше подсказки не ищем */
export const kMaxMentionQueryLength = 40;

/** Запрос «@ива» прямо перед курсором; `null` — курсор не в упоминании */
export function mentionQueryBeforeCursor(textBefore: string): { query: string, length: number } | null {
  let match = /(?:^|[\s(\[«"'])@([^\s@<>()]{0,40})$/u.exec(textBefore);
  if (!match || match[1].length > kMaxMentionQueryLength) {
    return null;
  }
  return { query: match[1], length: match[1].length + 1 };
}

export function mentionHTML(person: Pick<PersonUID, "name" | "emailAddress">): string {
  let label = "@" + (person.name?.trim() || person.emailAddress);
  return `<a href="mailto:${escapeAttr(person.emailAddress)}" class="${kMentionClass}">${escapeHTML(label)}</a>`;
}

/** Адреса упомянутых в HTML: ссылки mailto:, текст которых начинается с «@» */
export function mentionedAddresses(html: string | null | undefined): string[] {
  if (!html || !html.includes("mailto:")) {
    return [];
  }
  let doc = new DOMParser().parseFromString(html, "text/html");
  let result = new Set<string>();
  for (let link of Array.from(doc.querySelectorAll("a[href]"))) {
    let href = link.getAttribute("href") ?? "";
    if (!/^mailto:/i.test(href) || !link.textContent?.trim().startsWith("@")) {
      continue;
    }
    let address = decodeURIComponent(href.slice("mailto:".length).split("?")[0]).trim().toLowerCase();
    if (address) {
      result.add(address);
    }
  }
  return [...result];
}

/** Результат по письму: разбор HTML дорогой, а фильтр списка спрашивает часто */
const mentionCache = new WeakMap<EMail, { html: string, result: boolean }>();

/** Упомянут ли владелец ящика. Тело должно быть загружено; иначе — нет. */
export function mentionsMe(email: EMail): boolean {
  if (email.outgoing) {
    return false;
  }
  let html = email.rawHTMLDangerous;
  // Быстрый отсев: без ссылки mailto: с текстом «@…» упоминаний нет
  if (!html || !html.includes("mailto:") || !html.includes("@")) {
    return false;
  }
  let cached = mentionCache.get(email);
  if (cached?.html == html) {
    return cached.result;
  }
  let result = htmlMentionsAccount(html, email.folder?.account);
  mentionCache.set(email, { html, result });
  return result;
}

/** Упомянут ли в HTML владелец ящика `account` */
export function htmlMentionsAccount(html: string | null | undefined, account: { isMyEMailAddress?(address: string): boolean } | null | undefined): boolean {
  if (!html || !html.includes("mailto:") || !account) {
    return false;
  }
  return mentionedAddresses(html).some(address => account.isMyEMailAddress?.(address) ?? false);
}

/** Добавляет упомянутого в «Кому», если его ещё нет среди получателей */
export function addMentionedRecipient(email: EMail, person: PersonUID): boolean {
  let address = person.emailAddress?.toLowerCase();
  if (!address) {
    return false;
  }
  let present = [email.to, email.cc, email.bcc].some(list =>
    list.contents.some(other => other.emailAddress?.toLowerCase() == address));
  if (present) {
    return false;
  }
  email.to.add(person);
  return true;
}
