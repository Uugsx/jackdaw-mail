/**
 * Чистая логика личных заметок к письмам: нормализация, разбор ссылок и ключей трекера.
 * Без доступа к БД и UI, чтобы покрывать тестами.
 */

export const kMaxNoteLength = 4000;

/** Ключ трекера вида ABC-123 */
const kIssueKeyPattern = /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g;
const kUrlPattern = /https?:\/\/[^\s<>"']+/g;

export type NoteTokenKind = "text" | "url" | "issue";

export interface NoteToken {
  kind: NoteTokenKind;
  text: string;
  /** Для url и issue — куда вести; для text — null */
  href: string | null;
}

/** Обрезает пробелы по краям и длину; пустая заметка → "" */
export function normalizeNoteText(text: string | null | undefined): string {
  return (text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, kMaxNoteLength).trim();
}

/** Шаблон трекера должен содержать `{key}` и быть http(s)-адресом */
export function isValidTrackerTemplate(template: string | null | undefined): boolean {
  let value = (template ?? "").trim();
  return /^https?:\/\//i.test(value) && value.includes("{key}");
}

/** Подставляет ключ в шаблон; null, если шаблон не задан или некорректен */
export function issueLink(key: string, template: string | null | undefined): string | null {
  if (!isValidTrackerTemplate(template)) {
    return null;
  }
  return template!.trim().split("{key}").join(encodeURIComponent(key));
}

/** Знаки, которые чаще относятся к тексту вокруг адреса, а не к самому адресу */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && /[.,;:!?)\]»]/.test(url[end - 1])) {
    end--;
  }
  return url.slice(0, end);
}

/**
 * Разбирает заметку на куски: обычный текст, URL и ключи трекера.
 * Ключи внутри URL остаются частью URL. Без шаблона трекера ключ остаётся текстом.
 */
export function tokenizeNote(text: string, trackerTemplate?: string | null): NoteToken[] {
  let tokens: NoteToken[] = [];
  let push = (kind: NoteTokenKind, value: string, href: string | null = null) => {
    if (!value) {
      return;
    }
    let last = tokens.at(-1);
    if (kind == "text" && last?.kind == "text") {
      last.text += value;
    } else {
      tokens.push({ kind, text: value, href });
    }
  };
  let pushWithIssues = (chunk: string) => {
    let position = 0;
    for (let match of chunk.matchAll(kIssueKeyPattern)) {
      let href = issueLink(match[0], trackerTemplate);
      if (!href) {
        continue;
      }
      push("text", chunk.slice(position, match.index));
      push("issue", match[0], href);
      position = match.index + match[0].length;
    }
    push("text", chunk.slice(position));
  };

  let position = 0;
  for (let match of text.matchAll(kUrlPattern)) {
    let url = trimUrl(match[0]);
    pushWithIssues(text.slice(position, match.index));
    push("url", url, url);
    position = match.index + url.length;
  }
  pushWithIssues(text.slice(position));
  return tokens;
}

/** Первая строка для всплывающей подсказки в списке */
export function noteTooltip(text: string, maxLength = 200): string {
  let value = text.trim();
  return value.length > maxLength ? value.slice(0, maxLength - 1) + "…" : value;
}
