import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { IMAPAccount, ConnectionPurpose } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { Lock } from "../../../../logic/util/flow/Lock";
import { ArrayColl } from "svelte-collections";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

function createFolder(path = "INBOX"): IMAPFolder {
  appGlobal.remoteApp = { createIMAPFlowConnection: () => null };
  let account = new IMAPAccount();
  account.storage = new DummyMailStorage();
  account.log = () => {};
  let folder = new IMAPFolder(account);
  folder.path = path;
  folder.name = path;
  folder.dbID = 1;
  (folder as any).haveReadFolder = true;
  return folder;
}

function addMessage(folder: IMAPFolder, uid: number, isRead: boolean) {
  let msg = folder.newEMail();
  msg.uid = uid;
  msg.dbID = uid;
  msg.isRead = isRead;
  msg.received = new Date();
  folder.messages.add(msg);
  return msg;
}

test("новое письмо: счётчик не ниже числа непрочитанных в списке, даже если STATUS устарел", async () => {
  let folder = createFolder();
  folder.countTotal = 1;
  folder.countUnread = 0;
  addMessage(folder, 1, true);
  let fresh = addMessage(folder, 2, false);
  vi.spyOn(folder as any, "listNewMessages").mockResolvedValue(new ArrayColl([fresh]));
  vi.spyOn(folder, "downloadMessages").mockResolvedValue(new ArrayColl());
  vi.spyOn(folder as any, "checkDeletedMessages").mockResolvedValue(undefined);
  vi.spyOn(folder as any, "scheduleStatusRecheck").mockImplementation(() => {});

  await folder.getNewMessages(true, false);

  expect(folder.countTotal).toBe(2);
  expect(folder.countUnread).toBe(1);
});

test("флаг \\Seen из другого клиента сразу меняет счётчик в обе стороны", async () => {
  let folder = createFolder();
  folder.countUnread = 1;
  let msg = addMessage(folder, 5, false);
  vi.spyOn(folder as any, "scheduleStatusRecheck").mockImplementation(() => {});
  let nextRead = true;
  (folder as any).fetchFlags = async () => {
    msg.isRead = nextRead;
    return { updatedMessages: new ArrayColl([msg]) };
  };

  await folder.messageFlagsChanged(5, 1, new Set(["\\Seen"]));
  expect(folder.countUnread).toBe(0);

  nextRead = false;
  await folder.messageFlagsChanged(5, 1, new Set());
  expect(folder.countUnread).toBe(1);
});

test("опрос, повисший на мёртвом сокете, освобождается и закрывает Fetch-соединение", async () => {
  vi.useFakeTimers();
  let folder = createFolder();
  let reset = vi.spyOn(folder.account, "resetFetchConnection").mockImplementation(() => {});
  let calls = 0;
  (folder as any).fetchNewMailQuick = () => {
    calls++;
    return calls == 1 ? new Promise(() => {}) : Promise.resolve(new ArrayColl());
  };

  let first = (folder as any).pollRun();
  let firstResult = expect(first).rejects.toMatchObject({ code: "ETIMEDOUT" });
  await vi.advanceTimersByTimeAsync(91_000);
  await firstResult;
  expect(reset).toHaveBeenCalledOnce();

  await (folder as any).pollRun();
  expect(calls).toBe(2);
});

test("опрос идёт не реже, чем раз в 5 минут, даже если в настройках 10", () => {
  vi.useFakeTimers();
  let folder = createFolder();
  folder.account.pollIntervalMinutes = 10;
  let poll = vi.spyOn(folder as any, "pollRun").mockResolvedValue(undefined);

  folder.startPolling();
  expect(poll).toHaveBeenCalledTimes(1); // сразу
  vi.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(poll).toHaveBeenCalledTimes(2);
  folder.stopPolling();
});

test("после сна закрывает Fetch, переподключает Main и забирает пропущенную почту", async () => {
  let folder = createFolder();
  let account = folder.account as any;
  account._inbox = folder;
  let make = () => ({ close: vi.fn(), id: Math.random() });
  let main = make(), fetch = make(), mainNew = make();
  account.connections.set(ConnectionPurpose.Main, main);
  account.connections.set(ConnectionPurpose.Fetch, fetch);
  account.connectionLock.set(main, new Lock());
  account.connectionLock.set(fetch, new Lock());
  account.password = "x";
  account.connection = async () => {
    account.connections.set(ConnectionPurpose.Main, mainNew);
    account.connectionLock.set(mainNew, new Lock());
    return mainNew;
  };
  account.startIDLE = vi.fn(async () => {});
  let quick = vi.spyOn(folder, "fetchNewMailQuick").mockResolvedValue(new ArrayColl());

  await account.recoverAfterWake();

  expect(fetch.close).toHaveBeenCalled();
  expect(main.close).toHaveBeenCalled();
  expect(account.connections.get(ConnectionPurpose.Fetch)).toBeFalsy();
  expect(account.connections.get(ConnectionPurpose.Main)).toBe(mainNew);
  expect(account.startIDLE).toHaveBeenCalledWith(mainNew);
  expect(quick).toHaveBeenCalledOnce();
});
