// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import { createExchangeTaskTable, createFollowUpReminderTable, rollbackExchangeTaskTable } from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  deleteExchangeTaskLocally, loadExchangeTasks, loadFlaggedEMails, replaceExchangeTasks, saveExchangeTask,
} from "../../../../logic/Mail/Tasks/ExchangeTaskData";
import type { ExchangeTask } from "../../../../logic/Mail/Tasks/ExchangeTask";
import { EMail } from "../../../../logic/Mail/EMail";
import { Folder } from "../../../../logic/Mail/Folder";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { JSONEMail } from "../../../../logic/Mail/JSON/JSONEMail";
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

function task(itemID: string, values: Partial<ExchangeTask> = {}): ExchangeTask {
  return {
    itemID, changeKey: "ck", subject: `Задача ${itemID}`, notes: "", startDay: null, dueDay: "2026-10-30",
    completedAt: null, importance: "Normal", status: "NotStarted", lastModified: new Date("2026-10-22T10:00:00Z"),
    ...values,
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "exchange-task-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
  await db.pragma("foreign_keys = true");
  await db.execute(sql`
    INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'ews', 'ews'), (2, 'owa', 'owa');
    INSERT INTO folder (id, accountID, name, path, specialUse) VALUES
      (11, 1, 'Inbox', 'inbox', 'inbox'),
      (12, 1, 'Trash', 'trash', 'trash'),
      (21, 2, 'Inbox', 'inbox', 'inbox');
  `);
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("миграция", () => {
  test("одиннадцатая — в конце, выпущенные не сдвинуты", () => {
    expect(mailDatabaseMigrations.indexOf(createFollowUpReminderTable)).toBe(9);
    expect(mailDatabaseMigrations.indexOf(createExchangeTaskTable)).toBe(10);
    expect(mailDatabaseMigrations.at(-1)).toBe(createExchangeTaskTable);
  });

  test("база на user_version 10 получает таблицу, письма не трогаются; откат удаляет её", async () => {
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 10));
    await legacy.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'a', 'ews');
      INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'Inbox', 'inbox');
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (1, 1, '<m>', 1, 1, 'Hi');
    `);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(10);
    await legacy.migrate(...mailDatabaseMigrations);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(11);
    expect(await legacy.all(sql`SELECT id, subject FROM email`)).toEqual([{ id: 1, subject: "Hi" }]);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'exchangeTask'`))
      .toEqual({ name: "exchangeTask" });
    await legacy.execute(rollbackExchangeTaskTable);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'exchangeTask'`)).toBeUndefined();
    // Повторный запуск безопасен: IF NOT EXISTS
    await legacy.execute(createExchangeTaskTable);
    await legacy.execute(createExchangeTaskTable);
  });
});

describe("задачи в базе", () => {
  test("замена списка ящика не трогает другой ящик; поля сохраняются как есть", async () => {
    await replaceExchangeTasks(2, [task("owa1")], db);
    await replaceExchangeTasks(1, [task("a"), task("b")], db);
    await replaceExchangeTasks(1, [task("b", {
      subject: "Отчёт", notes: "Цифры", startDay: "2026-10-23", importance: "High",
      status: "Completed", completedAt: new Date("2026-10-21T08:30:00Z"),
    })], db);
    let tasks = await loadExchangeTasks(1, db);
    expect(tasks).toEqual([task("b", {
      subject: "Отчёт", notes: "Цифры", startDay: "2026-10-23", importance: "High",
      status: "Completed", completedAt: new Date("2026-10-21T08:30:00Z"),
    })]);
    expect((await loadExchangeTasks(2, db)).map(item => item.itemID)).toEqual(["owa1"]);
  });

  test("сохранение одной задачи обновляет её, удаление убирает", async () => {
    await saveExchangeTask(1, task("a"), db);
    await saveExchangeTask(1, task("a", { subject: "Новая тема", dueDay: null }), db);
    expect(await loadExchangeTasks(1, db)).toEqual([task("a", { subject: "Новая тема", dueDay: null })]);
    await deleteExchangeTaskLocally(1, "a", db);
    expect(await loadExchangeTasks(1, db)).toEqual([]);
  });

  test("удаление ящика удаляет его задачи", async () => {
    await saveExchangeTask(1, task("a"), db);
    await db.run(sql`DELETE FROM emailAccount WHERE id = 1`);
    expect(await loadExchangeTasks(1, db)).toEqual([]);
  });
});

describe("письма с флажком", () => {
  test("только с флажком, без корзины, со сроком из JSON, новые сверху", async () => {
    let flag = JSON.stringify({ flag: { startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null } });
    await db.execute(sql`
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject, contactName, contactEmail, isStarred, json) VALUES
        (1, 11, '<a>', 100, 100, 'Со сроком', 'Анна', 'anna@example.com', 1, ${flag}),
        (2, 11, '<b>', 200, 200, 'Без срока', null, 'bob@example.com', 1, null),
        (3, 11, '<c>', 300, 300, 'Без флажка', null, null, 0, null),
        (4, 12, '<d>', 400, 400, 'В корзине', null, null, 1, null),
        (5, 21, '<e>', 500, 500, 'OWA', null, null, 1, 'not json');
    `);
    let rows = await loadFlaggedEMails(db);
    expect(rows.map(row => row.subject)).toEqual(["OWA", "Без срока", "Со сроком"]);
    expect(rows[2]).toMatchObject({
      emailId: 1, folderId: 11, accountId: 1, contactName: "Анна", contactEmail: "anna@example.com",
      startDay: "2026-10-23", dueDay: "2026-10-26",
    });
    expect(rows[2].received.getTime()).toBe(100_000);
    expect(rows[0]).toMatchObject({ accountId: 2, dueDay: null });
  });
});

describe("флажок письма", () => {
  function newEMail(): EMail {
    return new EMail(new Folder(new MailAccount()));
  }

  test("срок сохраняется в JSON письма и читается обратно", () => {
    let email = newEMail();
    email.applyFlagState({ flagged: true, startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null });
    let json: any = {};
    JSONEMail.saveExtraData(email, json);
    expect(json.flag).toEqual({ startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null });
    let copy = newEMail();
    copy.isStarred = true;
    JSONEMail.readFlag(copy, json);
    expect(copy.flagState).toEqual(email.flagState);
  });

  test("без срока ключа нет; чтение без ключа снимает старый срок", () => {
    let email = newEMail();
    email.isStarred = true;
    let json: any = {};
    JSONEMail.saveExtraData(email, json);
    expect(json.flag).toBeUndefined();
    email.flagDueDay = "2026-10-26";
    JSONEMail.readFlag(email, {});
    expect(email.flagDueDay).toBeNull();
  });

  test("простой флажок (markStarred) снимает срок и отметку о выполнении", async () => {
    let email = newEMail();
    email.applyFlagState({ flagged: true, startDay: "2026-10-23", dueDay: "2026-10-26", completedAt: null });
    await email.markStarred(false);
    expect(email.flagState).toEqual({ flagged: false, startDay: null, dueDay: null, completedAt: null });
  });

  test("ошибка сервера возвращает прежний флажок", async () => {
    class FailingEMail extends EMail {
      protected async pushFlagState() {
        throw new Error("offline");
      }
    }
    let email = new FailingEMail(new Folder(new MailAccount()));
    email.applyFlagState({ flagged: true, startDay: null, dueDay: null, completedAt: null });
    await expect(email.setFlagDue("tomorrow")).rejects.toThrow("offline");
    expect(email.flagState).toEqual({ flagged: true, startDay: null, dueDay: null, completedAt: null });
  });

  test("установка, выполнение и снятие: протокол получает состояние, письмо его хранит", async () => {
    let pushed: any[] = [];
    class RecordingEMail extends EMail {
      protected async pushFlagState(flag) {
        pushed.push(flag);
      }
    }
    let email = new RecordingEMail(new Folder(new MailAccount()));
    let now = new Date(2026, 9, 23, 12, 0);
    await email.setFlagDue("next-week", now);
    expect(email.flagState).toEqual({ flagged: true, startDay: "2026-10-26", dueDay: "2026-10-30", completedAt: null });
    await email.markFlagComplete(now);
    expect(email.isStarred).toBe(false);
    expect(email.flagCompletedAt).toEqual(now);
    await email.clearFlag();
    expect(email.flagState).toEqual({ flagged: false, startDay: null, dueDay: null, completedAt: null });
    expect(pushed.map(flag => flag.flagged)).toEqual([true, false, false]);
  });
});
