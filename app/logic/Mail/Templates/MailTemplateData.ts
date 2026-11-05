import sql, { type Database } from "../../../../lib/rs-sqlite";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";
import type { ComposeWindowAttachment } from "../Composer/ComposeWindowProtocol";
import {
  kMaxTemplateBytes, normalizeTemplateName, sortTemplates, templateByteSize,
  type MailTemplate, type MailTemplateSummary,
} from "./MailTemplate";

/** Таблица `mailTemplate` в mail.db (миграция 13) */

export interface MailTemplateContent {
  name: string;
  subject: string;
  html: string;
  attachments: ComposeWindowAttachment[];
}

export class MailTemplateTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Mail template is too large: ${bytes} bytes`);
  }
}

async function database(db?: Database): Promise<Database> {
  return db ?? await getMailDatabase();
}

function checkSize(content: MailTemplateContent) {
  let bytes = templateByteSize(content);
  if (bytes > kMaxTemplateBytes) {
    throw new MailTemplateTooLargeError(bytes);
  }
}

function toDate(value: unknown): Date | null {
  return typeof value == "number" ? new Date(value) : null;
}

function parseAttachments(json: unknown): ComposeWindowAttachment[] {
  if (typeof json != "string") {
    return [];
  }
  try {
    let value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch (ex) {
    return [];
  }
}

/** Все шаблоны без тела и вложений, по названию */
export async function listMailTemplates(db?: Database): Promise<MailTemplateSummary[]> {
  let rows = await (await database(db)).all(sql`
    SELECT id, name, subject, json_array_length(attachments) AS attachmentCount, updatedAt, lastUsedAt
    FROM mailTemplate
  `) as any[];
  return sortTemplates(rows.map(row => ({
    id: row.id,
    name: row.name,
    subject: row.subject,
    attachmentCount: row.attachmentCount ?? 0,
    updatedAt: toDate(row.updatedAt),
    lastUsedAt: toDate(row.lastUsedAt),
  })));
}

export async function getMailTemplate(id: number, db?: Database): Promise<MailTemplate | null> {
  let row = await (await database(db)).get(sql`
    SELECT id, name, subject, html, attachments, createdAt, updatedAt, lastUsedAt
    FROM mailTemplate
    WHERE id = ${id}
  `) as any;
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    attachments: parseAttachments(row.attachments),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    lastUsedAt: toDate(row.lastUsedAt),
  };
}

/** @returns id нового шаблона */
export async function insertMailTemplate(content: MailTemplateContent, db?: Database): Promise<number> {
  checkSize(content);
  let now = Date.now();
  let result = await (await database(db)).run(sql`
    INSERT INTO mailTemplate (name, subject, html, attachments, createdAt, updatedAt, lastUsedAt)
    VALUES (
      ${normalizeTemplateName(content.name)}, ${content.subject}, ${content.html},
      ${JSON.stringify(content.attachments)}, ${now}, ${now}, null
    )
  `);
  return Number(result.lastInsertRowid);
}

/** @returns false — шаблона уже нет (удалён в другом окне) */
export async function updateMailTemplate(id: number, content: MailTemplateContent, db?: Database): Promise<boolean> {
  checkSize(content);
  let result = await (await database(db)).run(sql`
    UPDATE mailTemplate SET
      name = ${normalizeTemplateName(content.name)},
      subject = ${content.subject},
      html = ${content.html},
      attachments = ${JSON.stringify(content.attachments)},
      updatedAt = ${Date.now()}
    WHERE id = ${id}
  `);
  return result.changes > 0;
}

export async function renameMailTemplate(id: number, name: string, db?: Database): Promise<boolean> {
  let result = await (await database(db)).run(sql`
    UPDATE mailTemplate SET name = ${normalizeTemplateName(name)}, updatedAt = ${Date.now()}
    WHERE id = ${id}
  `);
  return result.changes > 0;
}

export async function markMailTemplateUsed(id: number, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE mailTemplate SET lastUsedAt = ${Date.now()} WHERE id = ${id}
  `);
}

export async function deleteMailTemplate(id: number, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    DELETE FROM mailTemplate WHERE id = ${id}
  `);
}
