/**
 * «Очистка» беседы или папки, как в Outlook: письмо лишнее, если его текст целиком
 * процитирован в более позднем письме той же беседы. Лишние уходят в «Удалённые».
 *
 * Как и Outlook по умолчанию, не трогаем непрочитанные, помеченные флажком,
 * важные и с категориями: их пользователь мог оставить нарочно.
 */
import type { EMail } from "../EMail";
import { normalizeRelatedSubject } from "../RelatedEMail";

/** Слишком короткий текст («Спасибо!») встречается где угодно — такие письма не удаляем */
export const kMinCleanupTextLength = 24;
/** Сколько последних писем папки проверяет «Очистка папки» */
export const kMaxFolderCleanupMessages = 500;

export interface CleanupCandidate {
  email: EMail;
  /** Более позднее письмо, в котором процитирован весь текст */
  coveredBy: EMail;
}

/** Текст для сравнения: без маркеров цитаты `>`, строк-заголовков цитаты и лишних пробелов */
export function normalizeForCleanup(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKC")
    .split(/\r?\n/)
    .map(line => line.replace(/^(\s*>)+\s?/, ""))
    .join(" ")
    .replace(/[ \s]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

/** Ключ беседы: ID нити, иначе тема без Re:/Fwd: */
export function conversationKey(email: EMail): string {
  return email.threadID || "subject:" + normalizeRelatedSubject(email.subject);
}

export function isKeptByCleanup(email: EMail): boolean {
  return !email.isRead || email.isStarred || email.isImportant || email.tags?.hasItems;
}

function sentTime(email: EMail): number {
  return (email.sent ?? email.received)?.getTime() ?? 0;
}

/**
 * Лишние письма среди `messages`.
 * @param getText текст письма; тело должно быть уже загружено
 */
export function findRedundantMessages(messages: readonly EMail[], getText: (email: EMail) => string = email => email.text): CleanupCandidate[] {
  let groups = new Map<string, EMail[]>();
  for (let email of messages) {
    let key = conversationKey(email);
    let group = groups.get(key);
    if (group) {
      group.push(email);
    } else {
      groups.set(key, [email]);
    }
  }
  let result: CleanupCandidate[] = [];
  for (let group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    let texts = new Map(group.map(email => [email, normalizeForCleanup(getText(email))]));
    let sorted = [...group].sort((a, b) => sentTime(a) - sentTime(b));
    for (let [index, email] of sorted.entries()) {
      let text = texts.get(email);
      if (isKeptByCleanup(email) || text.length < kMinCleanupTextLength) {
        continue;
      }
      let coveredBy = sorted.slice(index + 1).find(later =>
        sentTime(later) > sentTime(email) && texts.get(later).includes(text));
      if (coveredBy) {
        result.push({ email, coveredBy });
      }
    }
  }
  return result;
}

/** Загружает тела писем, по несколько сразу. Ошибка одного письма — письмо пропускаем. */
export async function loadBodiesForCleanup(messages: readonly EMail[], concurrency = 4): Promise<EMail[]> {
  let loaded: EMail[] = [];
  let queue = [...messages];
  let worker = async () => {
    for (let email = queue.shift(); email; email = queue.shift()) {
      try {
        await email.loadBody();
        loaded.push(email);
      } catch (ex) {
        console.error(ex);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return loaded;
}

/** Письма беседы `email` в той же папке */
export function conversationOf(email: EMail): EMail[] {
  let key = conversationKey(email);
  return email.folder.messages.contents.filter(other => conversationKey(other) == key);
}

/** Последние `kMaxFolderCleanupMessages` писем папки */
export function folderMessagesForCleanup(messages: readonly EMail[]): EMail[] {
  return [...messages].sort((a, b) => sentTime(b) - sentTime(a)).slice(0, kMaxFolderCleanupMessages);
}
