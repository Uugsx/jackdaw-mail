// @vitest-environment happy-dom

import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database } from "../../../../../lib/rs-sqlite";
import sql from "../../../../../lib/rs-sqlite";

const mocks = vi.hoisted(() => ({
  db: null as any,
  accounts: null as any,
  openComposer: vi.fn(),
  restored: [] as any[],
  cancelEWSDeferred: vi.fn(async () => true),
  findEWSDeferred: vi.fn(async () => [] as string[]),
}));

vi.mock("../../../../logic/Mail/SQL/SQLDatabase", async importOriginal => ({
  ...await importOriginal<any>(),
  getDatabase: async () => mocks.db,
}));
vi.mock("../../../../logic/app", () => ({
  appGlobal: { remoteApp: {}, get emailAccounts() { return mocks.accounts; } },
}));
vi.mock("../../../../frontend/Mail/open", () => ({
  openComposer: mocks.openComposer,
}));
vi.mock("../../../../frontend/Util/error", () => ({
  backgroundError: vi.fn(),
  catchErrors: async (func: Function) => await func(),
}));
vi.mock("../../../../frontend/Mail/Composer/composeWindow", () => ({
  serializeComposeMail: async (mail: any, windowID: string) => ({
    windowID, accountID: mail.identity.account.id, subject: mail.subject,
  }),
  deserializeComposeMail: (payload: any, account: any) => {
    let mail = fakeMail(account, payload.subject);
    mail.composeSource = { light: true };
    mocks.restored.push(mail);
    return mail;
  },
}));
vi.mock("../../../../logic/Mail/SendLater/EWSDeferredSend", () => ({
  cancelEWSDeferred: mocks.cancelEWSDeferred,
  findEWSDeferred: mocks.findEWSDeferred,
}));

import { InProcessSQLiteHost } from "../../../logic/util/hostedSQLite";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  editScheduledSend, processDue, queueSend, scheduledSends, sendToast, startSendQueue, stopSendQueue,
  undoSend, undoSendDelaySetting,
} from "../../../../frontend/Mail/SendLater/sendQueue";
import {
  claimScheduledSend, getScheduledSend, insertScheduledSend, listScheduledSends,
} from "../../../../logic/Mail/SendLater/ScheduledSendData";
import { UserError } from "../../../../logic/util/util";

function fakeAccount(values: Record<string, any> = {}) {
  return { id: "acc1", dbID: 1, name: "Работа", canDeferSendOnServer: false, callEWS: vi.fn(), ...values };
}

function fakeMail(account: any, subject = "Отчёт"): any {
  return {
    subject,
    to: new ArrayColl([{ name: "Анна", emailAddress: "anna@example.com" }]),
    cc: new ArrayColl(),
    bcc: new ArrayColl(),
    identity: { account },
    folder: null,
    composeSource: null,
    compose: { send: vi.fn(async () => undefined) },
  };
}

let tempDir: string;
let sqlite: InProcessSQLiteHost;
let db: Database;
let account: ReturnType<typeof fakeAccount>;

function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

// Node подставляет свой localStorage без файла: он не сохраняет значения
const storedSettings = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storedSettings.get(key) ?? null,
  setItem: (key: string, value: string) => storedSettings.set(key, value),
  removeItem: (key: string) => storedSettings.delete(key),
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  tempDir = mkdtempSync(path.join(tmpdir(), "send-queue-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
  await db.execute(sql`INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'acc1', 'ews')`);
  mocks.db = db;
  account = fakeAccount();
  mocks.accounts = new ArrayColl([account]);
  mocks.restored = [];
  mocks.openComposer.mockClear();
  mocks.cancelEWSDeferred.mockClear();
  mocks.findEWSDeferred.mockReset();
  mocks.findEWSDeferred.mockResolvedValue([]);
  undoSendDelaySetting.value = 5;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(async () => {
  stopSendQueue();
  await processDue();
  vi.useRealTimers();
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("отмена отправки", () => {
  test("задержка 0 — отправка сразу, без очереди", async () => {
    undoSendDelaySetting.value = 0;
    let mail = fakeMail(account);
    await queueSend(mail);
    expect(mail.compose.send).toHaveBeenCalledTimes(1);
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("письмо ждёт; «Отменить» возвращает тот же объект в редактор", async () => {
    let mail = fakeMail(account);
    await queueSend(mail);
    expect(mail.compose.send).not.toHaveBeenCalled();
    let [item] = await listScheduledSends(db);
    expect(item).toMatchObject({ kind: "undo", status: "pending", subject: "Отчёт", recipients: ["Анна"] });
    expect(item.sendAt.getTime() - Date.now()).toBe(5000);
    expect(get(sendToast)).toMatchObject({ type: "undo", queueID: item.queueID });

    await undoSend(item.queueID);
    expect(mocks.openComposer).toHaveBeenCalledWith(mail);
    expect(await listScheduledSends(db)).toEqual([]);
    expect(get(sendToast)).toBeNull();
    // Позже таймер ничего не отправит
    advance(10_000);
    await processDue();
    expect(mail.compose.send).not.toHaveBeenCalled();
  });

  test("по истечении задержки уходит ровно один раз", async () => {
    let mail = fakeMail(account);
    await queueSend(mail);
    advance(4_000);
    await processDue();
    expect(mail.compose.send).not.toHaveBeenCalled();
    advance(1_500);
    await Promise.all([processDue(), processDue(), processDue()]);
    expect(mail.compose.send).toHaveBeenCalledTimes(1);
    expect(await listScheduledSends(db)).toEqual([]);
    expect(get(sendToast)).toMatchObject({ type: "sent", subject: "Отчёт" });
  });

  test("после отправки отменить нельзя — понятная ошибка", async () => {
    let mail = fakeMail(account);
    await queueSend(mail);
    let [item] = await listScheduledSends(db);
    advance(6_000);
    await processDue();
    await expect(undoSend(item.queueID)).rejects.toBeInstanceOf(UserError);
    expect(mocks.openComposer).not.toHaveBeenCalled();
  });

  test("выход во время задержки: после запуска письмо уходит из базы, один раз", async () => {
    await insertScheduledSend({
      queueID: "from-last-run", accountID: 1, kind: "undo", mode: "local", status: "pending",
      sendAt: new Date(Date.now() - 1_000), subject: "Вчерашнее", recipients: [],
      payload: JSON.stringify({ windowID: "from-last-run", accountID: "acc1", subject: "Вчерашнее" }),
    }, db);
    await startSendQueue();
    await processDue();
    expect(mocks.restored).toHaveLength(1);
    expect(mocks.restored[0].compose.send).toHaveBeenCalledTimes(1);
    // Облегчённая копия исходного письма не используется для пометок
    expect(mocks.restored[0].composeSource).toBeNull();
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("отправка, прерванная выходом, не повторяется сама", async () => {
    await insertScheduledSend({
      queueID: "half-sent", accountID: 1, kind: "undo", mode: "local", status: "pending",
      sendAt: new Date(Date.now() - 1_000), subject: "Тема", recipients: [],
      payload: JSON.stringify({ windowID: "half-sent", accountID: "acc1", subject: "Тема" }),
    }, db);
    expect(await claimScheduledSend("half-sent", "previous-run", {}, db)).toBe(true);
    await startSendQueue();
    await processDue();
    expect(mocks.restored).toHaveLength(0);
    expect(await getScheduledSend("half-sent", db)).toMatchObject({ status: "failed", lastError: "interrupted" });
  });
});

describe("ошибки отправки", () => {
  test("нет сети — повтор по расписанию, без двойной отправки", async () => {
    let mail = fakeMail(account);
    mail.compose.send.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND mail.example.com")));
    await queueSend(mail);
    advance(6_000);
    await processDue();
    let [item] = await listScheduledSends(db);
    expect(item).toMatchObject({ status: "pending", attempts: 1 });
    expect(item.sendAt.getTime() - Date.now()).toBe(60_000);
    expect(get(sendToast)).toMatchObject({ type: "retry" });
    // Повтор идёт из базы: исходный объект уже мог измениться при подготовке
    advance(61_000);
    await processDue();
    expect(mocks.restored).toHaveLength(1);
    expect(mocks.restored[0].compose.send).toHaveBeenCalledTimes(1);
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("ошибка сервера — письмо ждёт человека и само не уходит", async () => {
    let mail = fakeMail(account);
    mail.compose.send.mockRejectedValueOnce(new Error("Mailbox quota exceeded"));
    await queueSend(mail);
    advance(6_000);
    await processDue();
    let [item] = await listScheduledSends(db);
    expect(item).toMatchObject({ status: "failed", lastError: "Mailbox quota exceeded" });
    expect(get(sendToast)).toMatchObject({ type: "failed", error: "Mailbox quota exceeded" });
    advance(3_600_000);
    await processDue();
    expect(mail.compose.send).toHaveBeenCalledTimes(1);
    expect(get(scheduledSends).items).toHaveLength(1);
  });
});

describe("отправить позже", () => {
  test("прошедшее время — понятная ошибка, письмо не теряется", async () => {
    let mail = fakeMail(account);
    await expect(queueSend(mail, { sendAt: new Date(Date.now() - 1) })).rejects.toBeInstanceOf(UserError);
    expect(mail.compose.send).not.toHaveBeenCalled();
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("локальная очередь: уходит в назначенное время", async () => {
    let mail = fakeMail(account);
    let sendAt = new Date(Date.now() + 3_600_000);
    await queueSend(mail, { sendAt });
    expect(await getScheduledSend((await listScheduledSends(db))[0].queueID, db))
      .toMatchObject({ kind: "later", mode: "local", status: "pending" });
    expect(get(sendToast)).toMatchObject({ type: "scheduled" });
    advance(3_599_000);
    await processDue();
    expect(mail.compose.send).not.toHaveBeenCalled();
    advance(2_000);
    await processDue();
    expect(mail.compose.send).toHaveBeenCalledTimes(1);
  });

  test("правка: письмо приостановлено, новая отправка заменяет запись", async () => {
    let mail = fakeMail(account);
    await queueSend(mail, { sendAt: new Date(Date.now() + 3_600_000) });
    let [item] = await listScheduledSends(db);
    await editScheduledSend(item.queueID);
    expect(mocks.openComposer).toHaveBeenCalledWith(mail);
    expect(await getScheduledSend(item.queueID, db)).toMatchObject({ status: "paused" });
    advance(7_200_000);
    await processDue();
    expect(mail.compose.send).not.toHaveBeenCalled();

    await queueSend(mail, { sendAt: new Date(Date.now() + 60_000) });
    let items = await listScheduledSends(db);
    expect(items).toHaveLength(1);
    expect(items[0].queueID).not.toBe(item.queueID);
  });

  test("EWS: отправку держит сервер; отмена удаляет письмо на сервере", async () => {
    account.canDeferSendOnServer = true;
    let mail = fakeMail(account);
    let sendAt = new Date(Date.now() + 3_600_000);
    await queueSend(mail, { sendAt });
    let [item] = await listScheduledSends(db);
    expect(item).toMatchObject({ mode: "server", status: "server" });
    expect(mail.compose.send).toHaveBeenCalledWith({ deferred: { sendAt, queueID: item.queueID } });
    // Таймер приложения письмо не трогает
    advance(3_600_000 + 1_000);
    await processDue();
    expect(mail.compose.send).toHaveBeenCalledTimes(1);
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("EWS: «Отменить» до срока — письмо с сервера возвращается в редактор", async () => {
    account.canDeferSendOnServer = true;
    let mail = fakeMail(account);
    await queueSend(mail, { sendAt: new Date(Date.now() + 3_600_000) });
    let [item] = await listScheduledSends(db);
    await undoSend(item.queueID);
    expect(mocks.cancelEWSDeferred).toHaveBeenCalledTimes(1);
    expect(mocks.openComposer).toHaveBeenCalledTimes(1);
    expect(await listScheduledSends(db)).toEqual([]);
  });

  test("EWS: сервер отказал — письмо в локальной очереди", async () => {
    account.canDeferSendOnServer = true;
    let mail = fakeMail(account);
    mail.compose.send.mockRejectedValueOnce(new Error("The request failed schema validation"));
    await queueSend(mail, { sendAt: new Date(Date.now() + 3_600_000) });
    let [item] = await listScheduledSends(db);
    expect(mocks.findEWSDeferred).toHaveBeenCalledTimes(1);
    expect(item).toMatchObject({ mode: "local", status: "pending" });
  });

  test("EWS: ответ потерялся, но сервер принял — повторно не отправляем", async () => {
    account.canDeferSendOnServer = true;
    let mail = fakeMail(account);
    mail.compose.send.mockRejectedValueOnce(new Error("socket hang up"));
    mocks.findEWSDeferred.mockResolvedValueOnce(["item-1"]);
    await queueSend(mail, { sendAt: new Date(Date.now() + 3_600_000) });
    let [item] = await listScheduledSends(db);
    expect(item).toMatchObject({ mode: "server", status: "server" });
  });
});
