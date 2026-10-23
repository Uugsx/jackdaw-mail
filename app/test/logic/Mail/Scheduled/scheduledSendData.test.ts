// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  createExchangeTaskTable, createScheduledSendTable, rollbackScheduledSendTable,
} from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  cancelPendingScheduledSend, claimScheduledSend, deleteScheduledSend, failInterruptedSends, insertScheduledSend,
  loadScheduledPayload, loadScheduledSends, updateScheduledStatus, type ScheduledSendInput,
} from "../../../../logic/Mail/Scheduled/ScheduledSendData";
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

function input(scheduleID: string, values: Partial<ScheduledSendInput> = {}): ScheduledSendInput {
  return {
    accountID: 1,
    scheduleID,
    mode: "local",
    sendAt: new Date("2026-10-26T05:00:00Z"),
    subject: `Письмо ${scheduleID}`,
    recipients: "Шеф",
    payload: JSON.stringify({ subject: scheduleID }),
    ...values,
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "scheduled-send-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
  await db.pragma("foreign_keys = true");
  await db.execute(sql`
    INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'imap', 'imap'), (2, 'ews', 'ews');
  `);
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("миграция", () => {
  test("двенадцатая — в конце, выпущенные не сдвинуты", () => {
    expect(mailDatabaseMigrations.indexOf(createExchangeTaskTable)).toBe(10);
    expect(mailDatabaseMigrations.indexOf(createScheduledSendTable)).toBe(11);
    expect(mailDatabaseMigrations.at(-1)).toBe(createScheduledSendTable);
  });

  test("база на user_version 11 получает таблицу, письма не трогаются; откат удаляет её", async () => {
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 11));
    await legacy.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'a', 'imap');
      INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'Inbox', 'inbox');
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (1, 1, '<m>', 1, 1, 'Hi');
    `);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(11);
    await legacy.migrate(...mailDatabaseMigrations);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(12);
    expect(await legacy.all(sql`SELECT id, subject FROM email`)).toEqual([{ id: 1, subject: "Hi" }]);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'scheduledSend'`))
      .toEqual({ name: "scheduledSend" });
    await legacy.execute(rollbackScheduledSendTable);
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE name = 'scheduledSend'`)).toBeUndefined();
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE name = 'index_scheduledSend_sendAt'`)).toBeUndefined();
    // Повторный запуск безопасен: IF NOT EXISTS
    await legacy.execute(createScheduledSendTable);
    await legacy.execute(createScheduledSendTable);
  });
});

describe("очередь в базе", () => {
  test("список по времени отправки, без тела; тело читается отдельно", async () => {
    let later = await insertScheduledSend(input("b", { sendAt: new Date("2026-10-27T05:00:00Z") }), db);
    let first = await insertScheduledSend(input("a", { mode: "server", accountID: 2 }), db);
    let rows = await loadScheduledSends(db);
    expect(rows.map(row => [row.id, row.scheduleID, row.mode, row.status, row.attempts])).toEqual([
      [first, "a", "server", "pending", 0],
      [later, "b", "local", "pending", 0],
    ]);
    expect(rows[0].sendAt).toEqual(new Date("2026-10-26T05:00:00Z"));
    expect(rows[0]).not.toHaveProperty("payload");
    expect(JSON.parse(await loadScheduledPayload(later, db) ?? "")).toEqual({ subject: "b" });
  });

  test("одно письмо берётся в отправку один раз", async () => {
    let id = await insertScheduledSend(input("a"), db);
    expect(await claimScheduledSend(id, db)).toBe(true);
    expect(await claimScheduledSend(id, db)).toBe(false);
    // Отправляющееся письмо отменить уже нельзя
    expect(await cancelPendingScheduledSend(id, db)).toBe(false);
    expect((await loadScheduledSends(db))[0].status).toBe("sending");
  });

  test("отмена до отправки удаляет письмо, после неё отправка не начнётся", async () => {
    let id = await insertScheduledSend(input("a"), db);
    expect(await cancelPendingScheduledSend(id, db)).toBe(true);
    expect(await claimScheduledSend(id, db)).toBe(false);
    expect(await loadScheduledSends(db)).toEqual([]);
  });

  test("прерванная перезапуском отправка — ошибка, а не повтор", async () => {
    let sending = await insertScheduledSend(input("a"), db);
    await insertScheduledSend(input("b"), db);
    await claimScheduledSend(sending, db);
    expect(await failInterruptedSends("Прервано", db)).toBe(1);
    let rows = await loadScheduledSends(db);
    expect(rows.map(row => [row.scheduleID, row.status, row.error])).toEqual([
      ["a", "failed", "Прервано"],
      ["b", "pending", null],
    ]);
    // Неудачное можно удалить или отправить заново
    expect(await cancelPendingScheduledSend(sending, db)).toBe(true);
  });

  test("повтор после ошибки: попытки, текст ошибки и новое время", async () => {
    let id = await insertScheduledSend(input("a"), db);
    await updateScheduledStatus(id, { status: "pending", attempts: 1, error: "Нет сети", sendAt: new Date("2026-10-26T05:02:00Z") }, db);
    let row = (await loadScheduledSends(db))[0];
    expect([row.status, row.attempts, row.error, row.sendAt]).toEqual(["pending", 1, "Нет сети", new Date("2026-10-26T05:02:00Z")]);
    // Без новых значений остальное не меняется
    await updateScheduledStatus(id, { status: "failed" }, db);
    row = (await loadScheduledSends(db))[0];
    expect([row.status, row.attempts, row.error, row.sendAt]).toEqual(["failed", 1, "Нет сети", new Date("2026-10-26T05:02:00Z")]);
    await updateScheduledStatus(id, { status: "pending", attempts: 0, error: null }, db);
    row = (await loadScheduledSends(db))[0];
    expect([row.status, row.attempts, row.error]).toEqual(["pending", 0, null]);
  });

  test("метка письма уникальна; удаление ящика удаляет его письма", async () => {
    await insertScheduledSend(input("a"), db);
    await expect(insertScheduledSend(input("a"), db)).rejects.toThrow();
    let other = await insertScheduledSend(input("b", { accountID: 2 }), db);
    await db.run(sql`DELETE FROM emailAccount WHERE id = 1`);
    expect((await loadScheduledSends(db)).map(row => row.id)).toEqual([other]);
    await deleteScheduledSend(other, db);
    expect(await loadScheduledSends(db)).toEqual([]);
  });
});
