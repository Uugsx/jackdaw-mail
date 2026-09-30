import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
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

test("shared mailbox использует тот же интервал polling, что и основной ящик", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let account = makeSharedAccount(main, "shared@example.test");

  (account as any).startPolling(42_000);
  expect((account as any).pollIntervalMs).toBe(42_000);
});

test("основной ящик обновляет счётчики подпапок в фоне", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let refreshCalls = 0;
  main.refreshAllFolderCounts = async () => {
    refreshCalls++;
  };

  try {
    (main as any).startSharedCountsPolling();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refreshCalls).toBeGreaterThan(0);
  } finally {
    (main as any).stopPolling();
  }
});

test("pollOneDependentSharedAccount синхронизирует dirty-папки помимо Inbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let inbox = shared.newFolder();
  inbox.id = "inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  shared.rootFolders.add(inbox);
  shared.folderMap.set(inbox.id, inbox);

  let dirty = shared.newFolder();
  dirty.id = "errors";
  dirty.name = "Ошибки";
  dirty.dirty = true;
  dirty.countUnread = 2;
  shared.rootFolders.add(dirty);
  shared.folderMap.set(dirty.id, dirty);

  let synced: string[] = [];
  inbox.syncRecentArrivals = async () => {
    synced.push("inbox");
    return new ArrayColl();
  };
  dirty.getNewMessages = async () => {
    synced.push("errors");
    return new ArrayColl();
  };

  await (main as any).pollOneDependentSharedAccount(shared);

  expect(synced).toContain("inbox");
  expect(synced).toContain("errors");
});

test("явно настроенная shared-подпапка синхронизируется без открытия", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки";
  folder.specialFolder = SpecialFolder.Normal;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let syncCalls = 0;
  folder.syncRecentArrivals = async () => {
    syncCalls++;
    return new ArrayColl();
  };
  (main as any).poller = {};
  shared.setNotificationFolderPolling(folder, true);

  try {
    expect((main as any).sharedAccountRowFolderIDs(shared)).toContain(folder.id);
    expect(shared.shouldBackgroundSyncBodies(folder)).toBe(true);
    await (main as any).pollOneDependentSharedAccount(shared);
    expect(syncCalls).toBe(1);
  } finally {
    (main as any).poller = null;
    shared.setNotificationFolderPolling(folder, false);
  }
});

test("явно настроенная личная подпапка синхронизируется быстрым путём", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let folder = main.newFolder();
  folder.id = "personal-important";
  folder.name = "Важное";
  folder.specialFolder = SpecialFolder.Normal;
  main.rootFolders.add(folder);
  main.folderMap.set(folder.id, folder);

  let syncCalls = 0;
  folder.syncRecentArrivals = async () => {
    syncCalls++;
    return new ArrayColl();
  };
  (main as any).poller = {};
  main.setNotificationFolderPolling(folder, true);

  try {
    expect((main as any).notificationFolderIDs()).toContain(folder.id);
    await (main as any).pollNotificationFolders();
    expect(syncCalls).toBe(1);
  } finally {
    (main as any).poller = null;
    main.setNotificationFolderPolling(folder, false);
  }
});

test("обновление счётчика shared Inbox загружает отсутствующий заголовок", async () => {
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
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let existing = folder.newEMail();
  existing.itemID = "old-message";
  existing.sent = new Date("2026-09-22T09:00:00Z");
  existing.received = existing.sent;
  existing.isRead = true;
  folder.messages.add(existing);
  folder.downloadMessages = async (messages: any) => messages;

  shared.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 2, UnreadCount: 1 }] };
    }
    if (request.action == "FindItem") {
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "new-message" } }],
          IncludesLastItemInRange: true,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "new-message" },
          InternetMessageId: "<new-message@example.test>",
          Subject: "Новое письмо",
          DateTimeSent: "2026-09-22T10:00:00Z",
          DateTimeReceived: "2026-09-22T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  (shared as any).refreshFolderBadge(folder);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.countUnread).toBe(1);
});

test("shared unread-поиск добирает заголовок через явный mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 2;
  folder.countUnread = 1;
  folder.downloadMessages = async (messages: any) => messages;

  let requests: { action: string; mailbox?: string; delegateAnchor?: string }[] = [];
  main.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    requests.push({ action: request.action, mailbox, delegateAnchor });
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      if (!mailbox) {
        return {
          RootFolder: {
            Items: [],
            IncludesLastItemInRange: true,
            TotalItemsInView: 0,
          },
        };
      }
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "unread-message" }, IsRead: false }],
          IncludesLastItemInRange: true,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      if (!mailbox) {
        return { Items: [] };
      }
      return {
        Items: [{
          ItemId: { Id: "unread-message" },
          InternetMessageId: "<unread-message@example.test>",
          Subject: "Ошибка сервера",
          DateTimeSent: "2026-09-30T10:00:00Z",
          DateTimeReceived: "2026-09-30T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.fetchUnreadArrivals();

  expect(folder.getEmailByItemID("unread-message")).toBeDefined();
  expect(folder.messages.length).toBe(1);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
  expect(requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "FindItem", mailbox: "shared@example.test" }),
    expect.objectContaining({ action: "GetItem", mailbox: "shared@example.test" }),
  ]));
});

test("счётчики дополнительного OWA запрашиваются через явный вход в mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.specialFolder = SpecialFolder.Inbox;
  folder.countTotal = 3;
  folder.countUnread = 3;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let requests: any[] = [];
  let explicitMailboxes: (string | undefined)[] = [];
  let delegateAnchors: (string | undefined)[] = [];
  main.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    requests.push(request);
    explicitMailboxes.push(mailbox);
    delegateAnchors.push(delegateAnchor);
    return {
      RootFolder: {
        Folders: [{ FolderId: { Id: folder.id }, TotalCount: 0, UnreadCount: 0 }],
      },
    };
  };

  await shared.refreshAllFolderCounts();

  expect(explicitMailboxes).toEqual(["shared@example.test"]);
  expect(delegateAnchors).toEqual([undefined]);
  expect(requests[0].Body.ParentFolderIds[0].Id).toBe("msgfolderroot");
  expect(requests[0].Body.ParentFolderIds[0].Mailbox.EmailAddress).toBe("shared@example.test");
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
});

test("не ставит новый цикл счётчиков shared-папок в очередь поверх текущего", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.specialFolder = SpecialFolder.Inbox;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let calls = 0;
  let release!: () => void;
  let requestFinished = new Promise<void>(resolve => {
    release = resolve;
  });
  main.callOWA = async () => {
    calls++;
    await requestFinished;
    return {
      RootFolder: {
        Folders: [{ FolderId: { Id: folder.id }, TotalCount: 0, UnreadCount: 0 }],
      },
    };
  };

  let first = shared.refreshAllFolderCounts();
  await Promise.resolve();
  let second = shared.refreshAllFolderCounts();
  await Promise.resolve();

  try {
    expect(calls).toBe(1);
  } finally {
    release();
    await Promise.all([first, second]);
  }
});

test("пустой Deep FindFolder не блокирует fallback счётчика shared-папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.specialFolder = SpecialFolder.Inbox;
  folder.countTotal = 2;
  folder.countUnread = 2;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let actions: string[] = [];
  let explicitMailboxes: string[] = [];
  main.callOWA = async (request: any, mailbox?: string) => {
    actions.push(request.action);
    if (mailbox) {
      explicitMailboxes.push(mailbox);
    }
    if (request.action == "FindFolder") {
      return { RootFolder: { Folders: [] } };
    }
    return { Folders: [{ TotalCount: 0, UnreadCount: 0 }] };
  };

  await shared.refreshAllFolderCounts();

  expect(actions).toEqual(["FindFolder", "GetFolder"]);
  expect(explicitMailboxes).toEqual(["shared@example.test", "shared@example.test"]);
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
});

test("push shared Inbox обновляет счётчик после добавления заголовка", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  shared.watchedFolder = folder;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let message = folder.newEMail();
  message.itemID = "push-message";
  message.isRead = false;
  let headerAdded = false;
  folder.getNewMessageHeaders = async () => {
    headerAdded = true;
    return new ArrayColl([message]);
  };
  folder.downloadMessages = async (messages: any) => messages;

  let badgeCountCalls = 0;
  let requestedAfterHeader = false;
  shared.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      badgeCountCalls++;
      requestedAfterHeader = headerAdded;
      return { Folders: [{ TotalCount: 1, UnreadCount: 1 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  (shared as any).syncFolderAfterServerCountUpdate = (
    updatedFolder: OWAFolder,
    countTotal: number,
    countUnread: number,
  ) => {
    updatedFolder.applyServerCounts(countTotal, countUnread);
    updatedFolder.dirty = false;
  };

  await shared.onNotificationMessages([[
    {
      NotificationType: "NewMailNotification",
      FolderId: folder.id,
      ItemId: { Id: message.itemID },
    },
  ]]);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(folder.getEmailByItemID("push-message")).toBe(message);
  expect(requestedAfterHeader).toBe(true);
  expect(badgeCountCalls).toBe(1);
  expect(folder.countUnread).toBe(1);
});

test("Deep FindFolder обновляет письмо в открытом shared Inbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  appGlobal.emailAccounts.addAll([main, shared]);
  (shared as any).msgFolderRootID = "shared-root";

  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);
  let existing = folder.newEMail();
  existing.itemID = "old-message";
  existing.sent = new Date("2026-09-22T09:00:00Z");
  existing.received = existing.sent;
  existing.isRead = true;
  folder.messages.add(existing);
  folder.downloadMessages = async (messages: any) => messages;

  shared.callOWA = async (request: any) => {
    if (request.action == "FindFolder") {
      return {
        RootFolder: {
          Folders: [{ FolderId: { Id: folder.id }, TotalCount: 2, UnreadCount: 1 }],
        },
      };
    }
    if (request.action == "FindItem") {
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "new-message" } }],
          IncludesLastItemInRange: true,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "new-message" },
          InternetMessageId: "<new-message@example.test>",
          Subject: "Новое письмо",
          DateTimeSent: "2026-09-22T10:00:00Z",
          DateTimeReceived: "2026-09-22T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await shared.refreshAllFolderCounts();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.countUnread).toBe(1);
});

test("после SessionLimit backoff повторно подписывается на Row-уведомления", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  appGlobal.emailAccounts.addAll([main, shared]);
  (main as any).notificationChannelReady = true;
  (main as any).sharedMailboxBlockedUntil.set("shared@example.test", Date.now() - 1);
  (main as any).sharedRowSubscriptionFailures.add(shared.id);

  let refreshCount = 0;
  main.refreshNotificationSubscriptions = async () => {
    refreshCount++;
  };
  shared.refreshAllFolderCounts = async () => {};

  (main as any).startSharedCountsPolling();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect((main as any).sharedMailboxBlockedUntil.has("shared@example.test")).toBe(false);
  expect((main as any).sharedRowSubscriptionFailures.has(shared.id)).toBe(false);
  expect(refreshCount).toBeGreaterThan(0);

  (main as any).stopPolling();
});

test("Row-подписка для открытой shared-папки использует delegateAnchor", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  appGlobal.emailAccounts.addAll([main, shared]);
  (main as any).notificationChannelReady = true;

  let folder = shared.newFolder() as OWAFolder;
  folder.id = "shared-inbox";
  shared.folderMap.set(folder.id, folder);

  let anchors: string[] = [];
  main.callOWA = async (_request: any, _mailbox?: string, delegateAnchor?: string) => {
    if (delegateAnchor) {
      anchors.push(delegateAnchor);
    }
    return { ResponseMessages: { Items: [{ ResponseClass: "Success" }] } };
  };

  await shared.setWatchedFolder(folder);

  expect(anchors).toContain("shared@example.test");
});
