// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  createScheduledSendTable, createMailTemplateTable, rollbackMailTemplateTable,
} from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  deleteMailTemplate, getMailTemplate, insertMailTemplate, listMailTemplates, markMailTemplateUsed,
  MailTemplateTooLargeError, renameMailTemplate, updateMailTemplate, type MailTemplateContent,
} from "../../../../logic/Mail/Templates/MailTemplateData";
import { kMaxTemplateBytes } from "../../../../logic/Mail/Templates/MailTemplate";
import type { ComposeWindowAttachment } from "../../../../logic/Mail/Composer/ComposeWindowProtocol";
import { InProcessSQLiteHost } from "../../util/hostedSQLite";
import type { Database } from "../../../../../lib/rs-sqlite";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir: string;
let sqlite: InProcessSQLiteHost;
let db: Database;

const kAttachment: ComposeWindowAttachment = {
  filename: "Прайс.pdf", filepathLocal: null, mimeType: "application/pdf", size: 3,
  disposition: "attachment", related: false, contentID: null, contentBase64: "YWJj",
};

function content(name: string, values: Partial<MailTemplateContent> = {}): MailTemplateContent {
  return { name, subject: `Тема ${name}`, html: `<p>Текст ${name}</p>`, attachments: [], ...values };
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "mail-template-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("миграция", () => {
  test("тринадцатая — в конце, выпущенные не сдвинуты", () => {
    expect(mailDatabaseMigrations.indexOf(createScheduledSendTable)).toBe(11);
    expect(mailDatabaseMigrations.indexOf(createMailTemplateTable)).toBe(12);
    expect(mailDatabaseMigrations.at(-1)).toBe(createMailTemplateTable);
  });

  test("база на user_version 12 получает шаблоны; откат удаляет их; повтор безопасен", async () => {
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 12));
    await legacy.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'a', 'ews');
      INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'Inbox', 'inbox');
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (1, 1, '<m>', 1, 1, 'Hi');
    `);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(12);
    await legacy.migrate(...mailDatabaseMigrations);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(13);
    expect(await legacy.all(sql`SELECT id, subject FROM email`)).toEqual([{ id: 1, subject: "Hi" }]);
    await insertMailTemplate(content("Старый ящик"), legacy);
    expect((await listMailTemplates(legacy)).map(template => template.name)).toEqual(["Старый ящик"]);
    await legacy.execute(rollbackMailTemplateTable);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'mailTemplate'`)).toBeUndefined();
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'scheduledSend'`))
      .toEqual({ name: "scheduledSend" });
    await legacy.execute(createMailTemplateTable);
    await legacy.execute(createMailTemplateTable);
  });
});

describe("шаблоны", () => {
  test("сохраняет тему, тело и вложения целиком", async () => {
    let id = await insertMailTemplate(content("  Счёт   клиенту ", {
      subject: "Счёт №1", html: "<p>Здравствуйте</p>", attachments: [kAttachment],
    }), db);
    let template = await getMailTemplate(id, db);
    expect(template).toMatchObject({
      id, name: "Счёт клиенту", subject: "Счёт №1", html: "<p>Здравствуйте</p>",
      attachments: [kAttachment], lastUsedAt: null,
    });
    expect(template.createdAt).toBeInstanceOf(Date);
    let [summary] = await listMailTemplates(db);
    expect(summary).toMatchObject({ id, name: "Счёт клиенту", attachmentCount: 1 });
    expect(summary).not.toHaveProperty("html");
  });

  test("список по названию с числами по порядку", async () => {
    for (let name of ["Шаблон 10", "акт", "Шаблон 2", "Б"]) {
      await insertMailTemplate(content(name), db);
    }
    expect((await listMailTemplates(db)).map(template => template.name))
      .toEqual(["акт", "Б", "Шаблон 2", "Шаблон 10"]);
  });

  test("правка, переименование, отметка использования и удаление", async () => {
    let id = await insertMailTemplate(content("A"), db);
    expect(await updateMailTemplate(id, content("A", { subject: "Новая", html: "<p>2</p>", attachments: [kAttachment] }), db)).toBe(true);
    expect(await renameMailTemplate(id, "  Б  ", db)).toBe(true);
    await markMailTemplateUsed(id, db);
    let template = await getMailTemplate(id, db);
    expect(template).toMatchObject({ name: "Б", subject: "Новая", html: "<p>2</p>", attachments: [kAttachment] });
    expect(template.lastUsedAt).toBeInstanceOf(Date);
    await deleteMailTemplate(id, db);
    expect(await getMailTemplate(id, db)).toBeNull();
    expect(await updateMailTemplate(id, content("A"), db)).toBe(false);
    expect(await renameMailTemplate(id, "В", db)).toBe(false);
    expect(await listMailTemplates(db)).toEqual([]);
  });

  test("слишком большой шаблон не сохраняется", async () => {
    let huge = content("Большой", { html: "x".repeat(kMaxTemplateBytes + 1) });
    await expect(insertMailTemplate(huge, db)).rejects.toBeInstanceOf(MailTemplateTooLargeError);
    let id = await insertMailTemplate(content("Малый"), db);
    await expect(updateMailTemplate(id, huge, db)).rejects.toBeInstanceOf(MailTemplateTooLargeError);
    expect((await getMailTemplate(id, db)).html).toBe("<p>Текст Малый</p>");
  });

  test("испорченный JSON вложений не ломает чтение", async () => {
    let id = await insertMailTemplate(content("A"), db);
    await db.run(sql`UPDATE mailTemplate SET attachments = 'not json' WHERE id = ${id}`);
    expect((await getMailTemplate(id, db)).attachments).toEqual([]);
  });
});
