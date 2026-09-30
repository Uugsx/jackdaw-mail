import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

test("не возвращает письмо в непрочитанные из-за устаревшего ответа OWA", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);
  folder.countUnread = 1;

  let release!: () => void;
  let requestStarted!: () => void;
  let requestStartedPromise = new Promise<void>(resolve => requestStarted = resolve);
  let requestGate = new Promise<void>(resolve => release = resolve);
  (account as any).callOWA = async () => {
    requestStarted();
    await requestGate;
    return {};
  };

  let markRead = message.markRead(true);
  await requestStartedPromise;

  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(true);

  release();
  await markRead;

  // Старый запрос списка мог завершиться уже после UpdateItem.
  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(true);

  // После подтверждения серверного состояния внешнее изменение снова принимается.
  message.setFlags({ IsRead: true }, "list");
  message.setFlags({ IsRead: false }, "list");
  expect(message.isRead).toBe(false);
});

test("уведомляет папку после автоматического прочтения письма", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countUnread = 1;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);

  let observedUnreadCounts: number[] = [];
  folder.subscribe(() => observedUnreadCounts.push(folder.countUnread));

  await message.markRead(true);

  expect(folder.countUnread).toBe(0);
  expect(observedUnreadCounts).toContain(0);
});

test("не возвращает устаревший счётчик после чтения в частично загруженной папке", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 9875;
  folder.countUnread = 104;
  (folder as any).haveReadFolder = true;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);

  await folder.markMessagesRead([message], true);
  expect(folder.countUnread).toBe(103);
  expect(folder.dirty).toBe(true);

  // GetFolder может вернуть старый unread-count после успешного UpdateItem.
  folder.applyServerCounts(9875, 104);
  expect(folder.countUnread).toBe(103);
});

test("не принимает повторно завышенный локальный счётчик за новое письмо", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 1;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);

  await message.markRead(true);
  expect(folder.countUnread).toBe(0);

  // Имитируем гонку: другой поток уже успел вернуть старую цифру до
  // следующего серверного ответа.
  folder.countUnread = 1;
  folder.applyServerCounts(1, 1);
  expect(folder.countUnread).toBe(0);
});

test("не занижает счётчик после возврата письма в непрочитанные при лаге OWA", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 9875;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = true;
  folder.messages.add(message);

  await folder.markMessagesRead([message], false);
  expect(folder.countUnread).toBe(1);

  // После UpdateItem Exchange ещё может вернуть старый unread-count = 0.
  folder.applyServerCounts(9875, 0);
  expect(folder.countUnread).toBe(1);
  expect(message.isRead).toBe(false);
});

test("защищает счётчик до завершения первой загрузки папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 9875;
  folder.countUnread = 104;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);

  await folder.markMessagesRead([message], true);
  expect(folder.countUnread).toBe(103);

  folder.applyServerCounts(9875, 104);
  expect(folder.countUnread).toBe(103);
});

test("не возвращает старый счётчик, если TotalCount уже обновился до чтения", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 9875;
  folder.countUnread = 104;
  (folder as any).haveReadFolder = true;

  // Новый серверный счётчик уже пришёл до локальной отметки письма.
  folder.applyServerCounts(9880, 109);

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);

  await folder.markMessagesRead([message], true);
  expect(folder.countUnread).toBe(108);

  // Повторный ответ с устаревшим UnreadCount не должен вернуть письмо.
  folder.applyServerCounts(9880, 109);
  expect(folder.countUnread).toBe(108);
  expect(folder.dirty).toBe(true);
});

test("не удерживает badge после чтения новых писем, если GetFolder отстал от FindItem", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async () => ({});

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 9_916;
  folder.countUnread = 16;
  (folder as any).lastServerCountTotal = 9_900;
  (folder as any).haveReadFolder = true;

  let messages = Array.from({ length: 16 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });

  await folder.markMessagesRead(messages, true);
  expect(folder.countUnread).toBe(0);

  // Запоздавший GetFolder считает те же 16 сообщений новыми. Их TotalCount
  // уже был виден в FindItem до отметки писем прочитанными.
  folder.applyServerCounts(9_916, 16);
  expect(folder.countUnread).toBe(0);
});

test("не запускает повторную сверку из-за неизменного устаревшего unread-счётчика", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 16, UnreadCount: 16 }] };
    }
    return {};
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.applyServerCounts(16, 16);
  (folder as any).haveReadFolder = true;
  let messages = Array.from({ length: 16 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });

  await folder.markMessagesRead(messages, true);
  expect(folder.countUnread).toBe(0);

  // Первая сверка уже завершилась; Exchange всё ещё повторяет старый счётчик.
  folder.dirty = false;
  expect(await folder.folderCountsChanged(true)).toBe(false);
  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
  expect(await folder.folderCountsChanged(true)).toBe(false);
  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("сбрасывает stale unread-счётчик по полному локальному кешу", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      return {
        RootFolder: {
          // Exchange ещё видит письмо непрочитанным, хотя локальный флаг уже read.
          Items: [{ ItemId: { Id: "message-1" }, IsRead: false }],
          IncludesLastItemInRange: true,
          TotalItemsInView: 1,
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 1;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = true;
  folder.messages.add(message);

  await folder.fetchUnreadArrivals();

  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("синхронизирует счётчик после внешнего прочтения письма", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("SyncFolderItems");
    return {
      Changes: {
        ReadFlagChange: [
          { ItemId: { Id: "message-1" }, IsRead: true },
          { ItemId: { Id: "message-2" }, IsRead: true },
          { ItemId: { Id: "message-3" }, IsRead: true },
        ],
      },
      SyncState: "state-2",
      IncludesLastItemInRange: true,
    };
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.syncState = "state-1";
  folder.countTotal = 3;
  folder.countUnread = 3;
  folder.countNewArrived = 3;

  for (let itemID of ["message-1", "message-2", "message-3"]) {
    let message = folder.newEMail();
    message.itemID = itemID;
    message.isRead = false;
    folder.messages.add(message);
  }

  await folder.updateChangedMessages();

  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(folder.messages.every(message => message.isRead)).toBe(true);
});
