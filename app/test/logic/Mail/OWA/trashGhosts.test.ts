import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { expect, test } from "vitest";

function newTrash() {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.specialFolder = SpecialFolder.Trash;
  folder.releaseDeletionAfterGracePeriod = () => {};
  (folder as any).haveReadFolder = true;
  return { account, folder };
}

test("очистка корзины: письма, которых уже нет на сервере, убираются из списка", async () => {
  let { account, folder } = newTrash();
  (account as any).callOWA = async (request: any) => ({
    ResponseMessages: {
      Items: request.Body.ItemIds.map((item: any) => item.Id == "alive"
        ? { ResponseClass: "Success", ResponseCode: "NoError" }
        : { ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "The specified object was not found in the store." }),
    },
  });
  for (let id of ["ghost-1", "alive", "ghost-2"]) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.countTotal = 3;
  folder.countUnread = 3;

  await folder.clearFolder();

  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
});

test("очистка корзины: настоящая ошибка Exchange по-прежнему останавливает очистку", async () => {
  let { account, folder } = newTrash();
  (account as any).callOWA = async () => ({
    ResponseMessages: {
      Items: [{ ResponseClass: "Error", ResponseCode: "ErrorAccessDenied", MessageText: "Access is denied." }],
    },
  });
  let message = folder.newEMail();
  message.itemID = "locked";
  folder.messages.add(message);
  folder.countTotal = 1;

  await expect(folder.clearFolder()).rejects.toThrow();
  expect(folder.messages.contents).toEqual([message]);
});

test("сервер подтвердил 0 писем: устаревший счётчик непрочитанных не держит «призраки»", async () => {
  let { account, folder } = newTrash();
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 0, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  for (let index = 0; index < 5; index++) {
    let message = folder.newEMail();
    message.itemID = `ghost-${index}`;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.countTotal = 0;
  folder.countUnread = 5;
  (folder as any).lastServerCountTotal = 0;

  await folder.listMessages(false, true);

  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countUnread).toBe(0);
});

test("пустой ответ FindItem без подтверждённого GetFolder не стирает кеш", async () => {
  let { account, folder } = newTrash();
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  let message = folder.newEMail();
  message.itemID = "kept";
  message.isRead = false;
  folder.messages.add(message);
  folder.countTotal = 0;
  folder.countUnread = 1;

  await folder.listMessages(false, true);

  expect(folder.messages.contents).toEqual([message]);
});

test("сверка, начатая до очистки, не возвращает удалённые письма в список", async () => {
  let { account, folder } = newTrash();
  let messages = ["a", "b", "c"].map(id => {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });
  folder.countTotal = 3;
  folder.countUnread = 3;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      // Полная страница прочитана до очистки; в Outlook письма уже прочитаны
      return {
        RootFolder: {
          Items: ["a", "b", "c"].map(Id => ({ ItemId: { Id }, IsRead: true })),
          IncludesLastItemInRange: true,
          TotalItemsInView: 3,
        },
      };
    }
    if (request.action == "DeleteItem") {
      return { ResponseMessages: { Items: request.Body.ItemIds.map(() => ({ ResponseClass: "Success", ResponseCode: "NoError" })) } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  // Сохранение изменившихся флагов прочтения — ожидание посреди сверки,
  // в которое пользователь успевает очистить корзину
  let releaseFlags!: () => void;
  let flagsGate = new Promise<void>(resolve => releaseFlags = resolve);
  let flagsStarted!: () => void;
  let flagsSaving = new Promise<void>(resolve => flagsStarted = resolve);
  (folder as any).persistEmailFlagsAll = async () => {
    flagsStarted();
    await flagsGate;
  };

  let sync = folder.listMessages(false, true);
  await flagsSaving;
  await folder.clearFolder();
  releaseFlags();
  await sync;

  expect(messages.every(message => message.isDeleted)).toBe(true);
  expect(folder.messages.contents.filter(message => messages.includes(message))).toEqual([]);
});

test("очистка корзины общего ящика идёт в контексте этого ящика", async () => {
  let { account, folder } = newTrash();
  account.mainAccount = new OWAAccount();
  account.username = "shared@example.com";
  let mailboxes: any[] = [];
  (account as any).callOWA = async (request: any, mailbox: any) => {
    mailboxes.push(mailbox);
    return { ResponseMessages: { Items: request.Body.ItemIds.map(() => ({ ResponseClass: "Success", ResponseCode: "NoError" })) } };
  };
  let message = folder.newEMail();
  message.itemID = "m1";
  folder.messages.add(message);
  folder.countTotal = 1;

  await folder.clearFolder();

  expect(mailboxes).toEqual(["shared@example.com"]);
  expect(folder.messages.isEmpty).toBe(true);
});

test("«не найдено» по недавно перенесённому письму не считается удалением", async () => {
  let { account, folder } = newTrash();
  (account as any).callOWA = async () => ({
    ResponseMessages: { Items: [{ ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "Not found" }] },
  });
  let message = folder.newEMail();
  message.itemID = "old-id";
  folder.messages.add(message);
  folder.countTotal = 1;
  (folder as any).preserveMovedUntil.set("old-id", Date.now() + 60_000);

  await expect(folder.clearFolder()).rejects.toThrow();
  expect(folder.messages.contents).toEqual([message]);
});
