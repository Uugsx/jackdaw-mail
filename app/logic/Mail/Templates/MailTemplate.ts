import type { ComposeWindowAttachment } from "../Composer/ComposeWindowProtocol";

/**
 * Шаблон письма, как «Мои шаблоны» в Outlook: тема, тело HTML и, по желанию,
 * вложения. Шаблоны локальные и общие для всех ящиков.
 */
export interface MailTemplate {
  id: number;
  name: string;
  subject: string;
  html: string;
  /** Обычные вложения; встроенные картинки живут в `html` как data URL */
  attachments: ComposeWindowAttachment[];
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

/** Шаблон без содержимого вложений — для меню и списка */
export interface MailTemplateSummary {
  id: number;
  name: string;
  subject: string;
  attachmentCount: number;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

export const kMaxTemplateNameLength = 120;
/** Шаблон с вложениями хранится в mail.db целиком: не раздуваем базу */
export const kMaxTemplateBytes = 10_000_000;

export type TemplateNameProblem = "empty" | "too-long" | "duplicate";

/** Название из темы письма: «Без темы» подставляет интерфейс */
export function templateNameFromSubject(subject: string | null | undefined): string {
  let name = (subject ?? "").replace(/\s+/g, " ").trim();
  return name.length > kMaxTemplateNameLength
    ? name.slice(0, kMaxTemplateNameLength).trimEnd()
    : name;
}

export function normalizeTemplateName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Проверка названия. Совпадение без учёта регистра считается повтором:
 * в меню два одинаковых пункта не различить.
 * @param exceptID шаблон, который переименовывают
 */
export function checkTemplateName(name: string, existing: Pick<MailTemplateSummary, "id" | "name">[], exceptID: number | null = null): TemplateNameProblem | null {
  let normalized = normalizeTemplateName(name);
  if (!normalized) {
    return "empty";
  }
  if (normalized.length > kMaxTemplateNameLength) {
    return "too-long";
  }
  let lower = normalized.toLocaleLowerCase();
  if (existing.some(template => template.id !== exceptID && normalizeTemplateName(template.name).toLocaleLowerCase() == lower)) {
    return "duplicate";
  }
  return null;
}

/**
 * Тело шаблона из редактора: без подписи (`<footer>` верхнего уровня),
 * чтобы при вставке не появлялась вторая подпись, и без пустых абзацев в конце.
 * Цитату исходного письма редактор держит отдельно, сюда она не попадает.
 */
export function templateBodyFromEditor(html: string | null | undefined): string {
  let body = (html ?? "").replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "");
  body = body.replace(/(?:<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/i, "");
  return body.trim();
}

/** В шаблоне нет ни текста, ни картинок, ни вложений */
export function isTemplateEmpty(template: Pick<MailTemplate, "subject" | "html" | "attachments">): boolean {
  let text = template.html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return !template.subject.trim() && !text && !/<img\b/i.test(template.html) && !template.attachments.length;
}

/** Примерный размер шаблона в базе */
export function templateByteSize(template: Pick<MailTemplate, "subject" | "html" | "attachments">): number {
  return template.subject.length + template.html.length + JSON.stringify(template.attachments).length;
}

/** Тема при вставке: свою тему пользователя не затираем */
export function subjectAfterTemplate(currentSubject: string | null | undefined, templateSubject: string): string {
  return currentSubject?.trim() ? currentSubject : templateSubject;
}

/** Вложения шаблона, которых ещё нет в письме (повторная вставка не дублирует их) */
export function newTemplateAttachments(
  templateAttachments: ComposeWindowAttachment[],
  current: { filename?: string | null; size?: number | null }[],
): ComposeWindowAttachment[] {
  let present = new Set(current.map(attachment => `${attachment.filename ?? ""}\u0000${attachment.size ?? ""}`));
  return templateAttachments.filter(attachment =>
    !present.has(`${attachment.filename}\u0000${attachment.size ?? ""}`));
}

/** Встроенные картинки тела: им нужны вложения в письме, иначе при отправке они пропадут */
export function inlineImageDataURLs(html: string): string[] {
  let urls = new Set<string>();
  for (let match of html.matchAll(/<img\b[^>]*\bsrc=(["'])(data:image\/[^"']+)\1/gi)) {
    urls.add(match[2]);
  }
  return [...urls];
}

/** По названию, «Шаблон 2» раньше «Шаблон 10»: порядок в меню не прыгает после вставки */
export function sortTemplates<T extends Pick<MailTemplateSummary, "name">>(templates: T[]): T[] {
  return [...templates].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
