// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import { createMailTemplateTable, createMessageNoteTable, rollbackMessageNoteTable } from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  deleteMessageNote, getMessageNote, listNotedMessageKeys, messageNoteKey, saveMessageNote, searchMessageNotes,
} from "../../../../logic/Mail/MessageNotes/MessageNoteData";
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

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "message-note-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("миграция", () => {
  test("четырнадцатая, выпущенные не сдвинуты; откат и повтор безопасны", async () => {
    expect(mailDatabaseMigrations.indexOf(createMailTemplateTable)).toBe(12);
    expect(mailDatabaseMigrations.indexOf(createMessageNoteTable)).toBe(13);
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 13));
    expect(await legacy.pragma("user_version", { simple: true })).toBe(13);
    await legacy.migrate(...mailDatabaseMigrations);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(mailDatabaseMigrations.length);
    await saveMessageNote("acc", "<m1>", "заметка", legacy);
    await legacy.execute(rollbackMessageNoteTable);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'messageNote'`)).toBeUndefined();
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'mailTemplate'`))
      .toEqual({ name: "mailTemplate" });
    await legacy.execute(createMessageNoteTable);
    await legacy.execute(createMessageNoteTable);
  });
});

describe("заметки", () => {
  test("ключ письма: Message-ID, иначе pid", () => {
    expect(messageNoteKey("<m>", 5)).toBe("<m>");
    expect(messageNoteKey("", 5)).toBe("pid:5");
    expect(messageNoteKey(null, null)).toBeNull();
  });

  test("сохраняет, обновляет и сохраняет дату создания", async () => {
    let first = await saveMessageNote("acc", "<m1>", "  Запрос в Jira, PROJ-123 ", db);
    expect(first?.text).toBe("Запрос в Jira, PROJ-123");
    await new Promise(resolve => setTimeout(resolve, 5));
    let second = await saveMessageNote("acc", "<m1>", "Обновлено", db);
    expect(second?.text).toBe("Обновлено");
    expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
    expect((await db.all(sql`SELECT * FROM messageNote`)).length).toBe(1);
  });

  test("пустой текст удаляет заметку", async () => {
    await saveMessageNote("acc", "<m1>", "x", db);
    expect(await saveMessageNote("acc", "<m1>", "   ", db)).toBeNull();
    expect(await getMessageNote("acc", "<m1>", db)).toBeNull();
  });

  test("ящики и письма изолированы; удаление точечное", async () => {
    await saveMessageNote("a", "<m>", "для a", db);
    await saveMessageNote("b", "<m>", "для b", db);
    await deleteMessageNote("a", "<m>", db);
    expect(await getMessageNote("a", "<m>", db)).toBeNull();
    expect((await getMessageNote("b", "<m>", db))?.text).toBe("для b");
    expect([...(await listNotedMessageKeys("b", db)).keys()]).toEqual(["<m>"]);
  });

  test("переживает удаление и повторную вставку письма", async () => {
    await db.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'acc', 'ews');
      INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'Inbox', 'inbox');
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (1, 1, '<m1>', 1, 1, 'Hi');
    `);
    await saveMessageNote("acc", "<m1>", "держим", db);
    await db.run(sql`DELETE FROM email WHERE id = 1`);
    await db.run(sql`INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (2, 1, '<m1>', 1, 1, 'Hi')`);
    expect((await getMessageNote("acc", "<m1>", db))?.text).toBe("держим");
  });

  test("поиск без учёта регистра, в том числе кириллицы", async () => {
    await saveMessageNote("acc", "<m1>", "Отправил ЗАПРОС в Jira", db);
    await saveMessageNote("acc", "<m2>", "другое", db);
    expect([...await searchMessageNotes("acc", "запрос", db)]).toEqual(["<m1>"]);
    expect([...await searchMessageNotes("acc", "jira", db)]).toEqual(["<m1>"]);
    expect((await searchMessageNotes("acc", "  ", db)).size).toBe(0);
  });
});
