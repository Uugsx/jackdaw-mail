// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  dedupeEMailPersons,
  rollbackDedupeEMailPersons,
  rollbackEMailFolderIDPIDIndex,
} from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import { InProcessSQLiteHost } from "../../util/hostedSQLite";
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";

let tempDir: string;
let sqlite: InProcessSQLiteHost;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "mail-migrate-test-"));
  sqlite = new InProcessSQLiteHost();
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

/** mail.db в состоянии до миграций BUG-202/203, с накопленными дублями. */
async function openLegacyDatabase() {
  let db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  let legacyCount = mailDatabaseMigrations.indexOf(dedupeEMailPersons);
  await db.migrate(...mailDatabaseMigrations.slice(0, legacyCount));
  await db.execute(sql`
    INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'acc', 'imap');
    INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'Drafts', 'Drafts'), (2, 1, 'INBOX', 'INBOX');

    -- Один адрес без имени сохранён трижды (NULL), плюс '' и именованный
    INSERT INTO emailPerson (id, emailAddress, name, personID) VALUES
      (1, 'bob@example.com', NULL, NULL),
      (2, 'bob@example.com', NULL, 7),
      (3, 'bob@example.com', NULL, NULL),
      (4, 'bob@example.com', 'Bob', NULL),
      (5, NULL, NULL, NULL),
      (6, NULL, NULL, NULL);

    -- Черновик без pID вставлен трижды; третья копия полностью загружена
    INSERT INTO email (id, folderID, pID, messageID, dateSent, dateReceived, subject, downloadComplete) VALUES
      (10, 1, NULL, 'draft@example.com', 1, 1, 'Draft', 0),
      (11, 1, NULL, 'draft@example.com', 1, 1, 'Draft', 1),
      (12, 1, NULL, 'draft@example.com', 1, 1, 'Draft', 0),
      -- Тот же Message-ID в другой папке и с pID — не дубли
      (13, 2, NULL, 'draft@example.com', 1, 1, 'Draft', 0),
      (14, 1, 'server-1', 'draft@example.com', 1, 1, 'Draft', 0),
      -- Без Message-ID сопоставить нельзя
      (15, 1, NULL, NULL, 1, 1, 'No ID', 0),
      (16, 1, NULL, NULL, 1, 1, 'No ID', 0),
      (17, 1, NULL, '', 1, 1, 'Empty ID', 0),
      (18, 1, NULL, '', 1, 1, 'Empty ID', 0);

    INSERT INTO emailPersonRel (emailID, emailPersonID, recipientType) VALUES
      (10, 1, 2), (11, 2, 2), (12, 3, 2), (13, 3, 2), (14, 4, 1), (15, 5, 2);
    INSERT INTO emailTag (emailID, tagName) VALUES (10, 'old'), (11, 'kept');
    INSERT INTO emailAttachment (emailID, filename, mimeType) VALUES (12, 'a.pdf', 'application/pdf');
  `);
  return db;
}

test("BUG-202: дубли emailPerson объединены, ссылки и personID сохранены, NULL → ''", async () => {
  let db = await openLegacyDatabase();
  await db.migrate(...mailDatabaseMigrations);
  expect(await db.pragma("user_version", { simple: true })).toBe(mailDatabaseMigrations.length);

  let persons = await db.all(sql`SELECT id, emailAddress, name, personID FROM emailPerson ORDER BY id`);
  expect(persons).toEqual([
    { id: 1, emailAddress: "bob@example.com", name: "", personID: 7 },
    { id: 4, emailAddress: "bob@example.com", name: "Bob", personID: null },
    { id: 5, emailAddress: null, name: "", personID: null },
    { id: 6, emailAddress: null, name: "", personID: null },
  ]);
  let rels = await db.all(sql`SELECT emailID, emailPersonID FROM emailPersonRel ORDER BY emailID`);
  expect(rels).toEqual([
    { emailID: 11, emailPersonID: 1 },
    { emailID: 13, emailPersonID: 1 },
    { emailID: 14, emailPersonID: 4 },
    { emailID: 15, emailPersonID: 5 },
  ]);
  let orphans = await db.get(sql`
    SELECT COUNT(*) AS n FROM emailPersonRel
    WHERE emailPersonID NOT IN (SELECT id FROM emailPerson)`);
  expect(orphans).toEqual({ n: 0 });
});

test("BUG-203: копии письма без pID удалены вместе с получателями, метками и вложениями", async () => {
  let db = await openLegacyDatabase();
  await db.migrate(...mailDatabaseMigrations);

  let emails = await db.all(sql`SELECT id FROM email ORDER BY id`) as any[];
  // Остаётся полностью загруженная копия 11; другие папки, pID и письма без ID не тронуты
  expect(emails.map(row => row.id)).toEqual([11, 13, 14, 15, 16, 17, 18]);
  expect(await db.all(sql`SELECT emailID, tagName FROM emailTag`)).toEqual([{ emailID: 11, tagName: "kept" }]);
  expect(await db.all(sql`SELECT emailID FROM emailAttachment`)).toEqual([]);
  let index = await db.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'index_email_folderID_pID'`);
  expect(index).toEqual({ name: "index_email_folderID_pID" });
});

test("откаты: пустое имя снова NULL, индекс удалён", async () => {
  let db = await openLegacyDatabase();
  await db.migrate(...mailDatabaseMigrations);
  await db.execute(rollbackDedupeEMailPersons);
  await db.execute(rollbackEMailFolderIDPIDIndex);
  let names = await db.all(sql`SELECT DISTINCT name FROM emailPerson ORDER BY name`) as any[];
  expect(names.map(row => row.name)).toEqual([null, "Bob"]);
  let index = await db.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'index_email_folderID_pID'`);
  expect(index).toBeUndefined();
});

test("свежая база проходит все миграции", async () => {
  let db = await sqlite.host.openDatabase(path.join(tempDir, "fresh.db"), {});
  await db.migrate(...mailDatabaseMigrations);
  expect(await db.pragma("user_version", { simple: true })).toBe(mailDatabaseMigrations.length);
  expect(await db.all(sql`SELECT * FROM emailPerson`)).toEqual([]);
});
