import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { afterEach, expect, test } from "vitest";

function makeMainAccount(): OWAAccount {
  let main = new OWAAccount();
  main.storage = new DummyMailStorage();
  main.id = "main-id";
  main.username = "user@example.test";
  main.emailAddress = "user@example.test";
  (main as any).hasLoggedIn = true;
  return main;
}

function makeSharedAccount(main: OWAAccount, email: string): OWAAccount {
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.id = `${email}-id`;
  account.mainAccount = main;
  account.username = email;
  account.emailAddress = email;
  account.sharedFolderRoot = "msgfolderroot";
  (account as any).hasLoggedIn = true;
  return account;
}

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

test("новое письмо в открытой shared-Входящие нотифицирует папку и поднимает бейдж", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "integrators@smartds.ru");
  appGlobal.emailAccounts.addAll([main, shared]);

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  folder.countTotal = 3389;
  folder.countUnread = 0;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);
  shared.watchedFolder = folder;
  folder.downloadMessages = async (messages: any) => messages;

  let notifications: (string | null)[] = [];
  folder.subscribe((_f, prop) => notifications.push(prop ?? null));

  // Пользователь только что прочитал всю почту в этой папке.
  await folder.markMessagesRead([], true);
  folder.countUnread = 0;
  notifications = [];

  shared.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 3390, UnreadCount: 1 }] };
    }
    if (request.action == "SyncFolderItems") {
      return { Changes: {}, SyncState: "state-1", IncludesLastItemInRange: true };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "new-message" },
          InternetMessageId: "<new-message@smartds.ru>",
          Subject: "RE: Halyk",
          DateTimeSent: "2026-10-01T11:55:00Z",
          DateTimeReceived: "2026-10-01T11:55:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await shared.onNotificationMessages([[
    {
      NotificationType: "NewMailNotification",
      FolderId: folder.id,
      ItemId: { Id: "new-message" },
    },
  ]]);
  // Дождаться асинхронных цепочек refreshFolderBadge.
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.countUnread).toBe(1);
  // Папка должна была уведомить наблюдателей (sidebar перерисовался бы).
  expect(notifications.length).toBeGreaterThan(0);
});

test("параллельные sync-проходы не оставляют папку навсегда заглушённой", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;
  folder.downloadMessages = async (messages: any) => messages;

  let notifications = 0;
  folder.subscribe(() => notifications++);

  let release!: () => void;
  let jobStarted = new Promise<void>(resolve => {
    release = resolve;
  });
  let getNewMessagesCalls = 0;
  (folder as any).getNewMessages = async () => {
    getNewMessagesCalls++;
    if (getNewMessagesCalls == 1) {
      // Первый проход держится открытым, пока не вмешается badge-опрос.
      await jobStarted;
    }
    return new ArrayColl();
  };

  shared.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "SyncFolderItems") {
      return { Changes: {}, SyncState: "state-1", IncludesLastItemInRange: true };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let first = folder.syncRecentArrivals();
  await new Promise(resolve => setTimeout(resolve, 0));
  let second = folder.syncRecentArrivalsWithServerCounts(1, 0);
  await new Promise(resolve => setTimeout(resolve, 0));

  release();
  await Promise.all([first, second]);
  let notificationsAfterRace = notifications;

  // Гонка завершена. Последующие изменения счётчика обязаны доходить до UI.
  folder.countUnread = 1;
  expect(notifications).toBeGreaterThan(notificationsAfterRace);

  await folder.syncRecentArrivals();
  let before = notifications;
  folder.countUnread = 2;
  expect(notifications).toBeGreaterThan(before);
});

test("чужое чтение в Outlook снимает бейдж, пока пользователь читает в Jackdaw", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "integrators@smartds.ru");

  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 11_228;
  folder.countUnread = 25;
  folder.downloadMessages = async (messages: any) => messages;

  // 25 непрочитанных писем в кеше (шторм dpd-replica-api).
  let messages = Array.from({ length: 25 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `msg-${index}`;
    message.sent = new Date(2026, 9, 1, 13, index);
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });

  // Сервер подтвердил 25.
  folder.applyServerCounts(11_228, 25);
  expect(folder.countUnread).toBe(25);

  shared.callOWA = async (request: any) => {
    if (request.action == "UpdateItem") {
      return { ResponseMessages: { Items: request.Body.ItemChanges.map(() => ({
        ResponseClass: "Success",
        ResponseCode: "NoError",
      })) } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  // Пользователь открывает одно письмо в Jackdaw: бейдж 24, окно подавления активно.
  await folder.markMessagesRead([messages[0]], true);
  expect(folder.countUnread).toBe(24);
  // Сервер подтверждает прочтение этого письма (как GetItem-обновление строки).
  messages[0].setFlags({ IsRead: true }, "list");

  // Коллега прочитал остальные в Outlook: сервер уже говорит 14 непрочитанных.
  folder.applyServerCounts(11_228, 14);

  // Бейдж обязан последовать за сервером, а не зависнуть на локальных 24.
  expect(folder.countUnread).toBe(14);

  // Полностью прочитали: бейдж 0, а не «локальное ожидание».
  folder.applyServerCounts(11_228, 0);
  expect(folder.countUnread).toBe(0);
});

test("отметка «непрочитано» в Jackdaw всё ещё защищена от лага сервера", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 10;
  folder.countUnread = 0;

  let message = folder.newEMail();
  message.itemID = "msg-1";
  message.isRead = true;
  folder.messages.add(message);
  shared.callOWA = async (request: any) => {
    if (request.action == "UpdateItem") {
      return { ResponseMessages: { Items: request.Body.ItemChanges.map(() => ({
        ResponseClass: "Success",
        ResponseCode: "NoError",
      })) } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  // Пользователь возвращает письмо в непрочитанные.
  await folder.markMessagesRead([message], false);
  expect(folder.countUnread).toBe(1);

  // Сервер ещё отвечает старым «0» — бейдж не должен упасть.
  folder.applyServerCounts(10, 0);
  expect(folder.countUnread).toBe(1);
});
