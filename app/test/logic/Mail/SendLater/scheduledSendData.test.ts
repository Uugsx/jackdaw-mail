// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  createExchangeTaskTable, createScheduledSendTable, rollbackScheduledSendTable,
} from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  claimScheduledSend, deleteScheduledSend, failScheduledSend, finishScheduledSend, getScheduledSend,
  insertScheduledSend, kInterruptedError, listScheduledSends, loadScheduledSendPayload, markScheduledOnServer,
  recoverInterruptedSends, releaseScheduledSend, removeSentServerScheduled, retryScheduledSendLater,
  setScheduledSendStatus, type NewScheduledSend,
} from "../../../../logic/Mail/SendLater/ScheduledSendData";
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

const kPast = new Date(Date.now() - 60_000);
const kFuture = new Date(Date.now() + 3_600_000);

function entry(queueID: string, values: Partial<NewScheduledSend> = {}): NewScheduledSend {
  return {
    queueID, accountID: 1, kind: "later", mode: "local", status: "pending", sendAt: kPast,
    subject: `Тема ${queueID}`, recipients: ["Анна", "bob@example.com"],
    payload: JSON.stringify({ windowID: queueID, subject: `Тема ${queueID}` }),
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
    INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'ews', 'ews'), (2, 'imap', 'imap');
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

  test("база на user_version 11 получает очередь; откат удаляет её; повтор безопасен", async () => {
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 11));
    await legacy.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'a', 'ews');
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
    expect(await legacy.get(sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'scheduledSend'`)).toBeUndefined();
    await legacy.execute(createScheduledSendTable);
    await legacy.execute(createScheduledSendTable);
  });
});

describe("очередь отправки", () => {
  test("запись хранит письмо целиком и поля списка", async () => {
    await insertScheduledSend(entry("a", { kind: "undo", sendAt: kFuture }), db);
    let item = await getScheduledSend("a", db);
    expect(item).toMatchObject({
      queueID: "a", accountID: 1, kind: "undo", mode: "local", status: "pending",
      attempts: 0, lastError: null, subject: "Тема a", recipients: ["Анна", "bob@example.com"],
    });
    expect(item.sendAt.getTime()).toBe(kFuture.getTime());
    expect(JSON.parse(await loadScheduledSendPayload("a", db))).toEqual({ windowID: "a", subject: "Тема a" });
    expect(await loadScheduledSendPayload("missing", db)).toBeNull();
  });

  test("письмо забирает только один отправитель", async () => {
    await insertScheduledSend(entry("a"), db);
    let results = await Promise.all([
      claimScheduledSend("a", "first", {}, db),
      claimScheduledSend("a", "second", {}, db),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // Повторный проход таймера не заберёт письмо, которое уже отправляется
    expect(await claimScheduledSend("a", "third", {}, db)).toBe(false);
    expect(await claimScheduledSend("a", "third", { force: true }, db)).toBe(false);
  });

  test("до срока таймер не забирает; «Отправить сейчас» — забирает", async () => {
    await insertScheduledSend(entry("a", { sendAt: kFuture }), db);
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(false);
    expect(await claimScheduledSend("a", "now", { force: true }, db)).toBe(true);
  });

  test("отправленное убирается; чужая метка ничего не меняет", async () => {
    await insertScheduledSend(entry("a"), db);
    expect(await claimScheduledSend("a", "mine", {}, db)).toBe(true);
    await finishScheduledSend("a", "other", db);
    expect(await getScheduledSend("a", db)).not.toBeNull();
    await finishScheduledSend("a", "mine", db);
    expect(await getScheduledSend("a", db)).toBeNull();
  });

  test("ошибка: ждёт человека, повтор возможен только вручную", async () => {
    await insertScheduledSend(entry("a"), db);
    await claimScheduledSend("a", "c1", {}, db);
    await failScheduledSend("a", "c1", "Ящик переполнен", db);
    expect(await getScheduledSend("a", db)).toMatchObject({ status: "failed", attempts: 1, lastError: "Ящик переполнен" });
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(false);
    expect(await claimScheduledSend("a", "retry", { force: true }, db)).toBe(true);
  });

  test("нет сети: повтор по расписанию", async () => {
    await insertScheduledSend(entry("a"), db);
    await claimScheduledSend("a", "c1", {}, db);
    let retryAt = new Date(Date.now() + 60_000);
    await retryScheduledSendLater("a", "c1", retryAt, "offline", db);
    let item = await getScheduledSend("a", db);
    expect(item).toMatchObject({ status: "pending", attempts: 1, lastError: "offline" });
    expect(item.sendAt.getTime()).toBe(retryAt.getTime());
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(false);
    expect(await claimScheduledSend("a", "timer", { now: new Date(retryAt.getTime() + 1) }, db)).toBe(true);
  });

  test("отменить нельзя, пока письмо отправляется", async () => {
    await insertScheduledSend(entry("a"), db);
    await insertScheduledSend(entry("b"), db);
    await claimScheduledSend("a", "c1", {}, db);
    expect(await deleteScheduledSend("a", db)).toBe(false);
    expect(await setScheduledSendStatus("a", "paused", undefined, db)).toBe(false);
    expect(await deleteScheduledSend("b", db)).toBe(true);
    expect(await deleteScheduledSend("b", db)).toBe(false);
  });

  test("приостановленное не уходит само; возобновлённое — уходит", async () => {
    await insertScheduledSend(entry("a"), db);
    expect(await setScheduledSendStatus("a", "paused", undefined, db)).toBe(true);
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(false);
    expect(await setScheduledSendStatus("a", "pending", kPast, db)).toBe(true);
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(true);
  });

  test("прерванная выходом отправка не повторяется сама", async () => {
    await insertScheduledSend(entry("a"), db);
    await claimScheduledSend("a", "c1", {}, db);
    await recoverInterruptedSends(db);
    expect(await getScheduledSend("a", db)).toMatchObject({ status: "failed", lastError: kInterruptedError });
    expect(await claimScheduledSend("a", "timer", {}, db)).toBe(false);
    // Метка прежнего запуска больше не действует
    await finishScheduledSend("a", "c1", db);
    expect(await getScheduledSend("a", db)).not.toBeNull();
  });

  test("на сервере: таймер не трогает, после срока запись убирается", async () => {
    await insertScheduledSend(entry("a", { sendAt: kFuture }), db);
    await insertScheduledSend(entry("b", { sendAt: kPast }), db);
    for (let id of ["a", "b"]) {
      expect(await claimScheduledSend(id, "s", { force: true }, db)).toBe(true);
      await markScheduledOnServer(id, "s", db);
    }
    expect(await getScheduledSend("a", db)).toMatchObject({ status: "server", mode: "server" });
    expect(await claimScheduledSend("b", "timer", {}, db)).toBe(false);
    await removeSentServerScheduled(new Date(), db);
    expect((await listScheduledSends(db)).map(item => item.queueID)).toEqual(["a"]);
    // Отмена на сервере возвращает письмо приложению
    expect(await setScheduledSendStatus("a", "paused", undefined, db)).toBe(true);
    expect(await getScheduledSend("a", db)).toMatchObject({ status: "paused", mode: "local" });
  });

  test("сервер не принял — письмо в локальной очереди", async () => {
    await insertScheduledSend(entry("a", { sendAt: kFuture }), db);
    await claimScheduledSend("a", "s", { force: true }, db);
    await releaseScheduledSend("a", "s", db);
    expect(await getScheduledSend("a", db)).toMatchObject({ status: "pending", mode: "local" });
  });

  test("удаление ящика удаляет его очередь", async () => {
    await insertScheduledSend(entry("a"), db);
    await insertScheduledSend(entry("b", { accountID: 2 }), db);
    await db.run(sql`DELETE FROM emailAccount WHERE id = 1`);
    expect((await listScheduledSends(db)).map(item => item.queueID)).toEqual(["b"]);
  });
});
