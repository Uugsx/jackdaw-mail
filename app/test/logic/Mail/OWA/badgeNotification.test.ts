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
