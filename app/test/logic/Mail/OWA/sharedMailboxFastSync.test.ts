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
    if (request.action == "SyncFolderItems") {
      return { Changes: {}, SyncState: "state-1", IncludesLastItemInRange: true };
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

test("догоняющая загрузка берёт заголовок через явный mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.downloadMessages = async (messages: any) => messages;

  let requests: { action: string; mailbox?: string; delegateAnchor?: string }[] = [];
  main.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    requests.push({ action: request.action, mailbox, delegateAnchor });
    if (request.action == "FindItem" && request.Body.Paging.BasePoint == "End") {
      if (!mailbox) {
        // Delegate-контекст ещё не видит письмо.
        return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
      }
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "unread-message" }, IsRead: false }],
          IncludesLastItemInRange: true,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
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
  // Свежий рост unread — окно догона активно (папка большая: работает chase,
  // а не полная сверка маленькой папки).
  folder.applyServerCounts(9_743, 1);

  await folder.syncRecentArrivals();

  expect(folder.getEmailByItemID("unread-message")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
  expect(requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: "FindItem", mailbox: "shared@example.test" }),
    expect.objectContaining({ action: "GetItem", mailbox: "shared@example.test" }),
  ]));
});

test("большая shared-папка не сканируется целиком при догоне unread", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  (folder as any).haveReadFolder = true;
  folder.downloadMessages = async (messages: any) => messages;
  folder.getNewMessageHeaders = async () => new ArrayColl();

  let listCalls: Array<[boolean | undefined, boolean | undefined, number | undefined]> = [];
  folder.listMessages = async (recentOnly, force, maxItems) => {
    listCalls.push([recentOnly, force, maxItems]);
    return new ArrayColl();
  };
  // Свежий рост unread — окно догона активно.
  folder.applyServerCounts(9_743, 27);

  await folder.syncRecentArrivals();

  // Только быстрые страницы: полный обход тысяч писем недопустим.
  expect(listCalls.every(([recentOnly]) => recentOnly)).toBe(true);
  expect(folder.countUnread).toBe(27);
});

test("ограничивает повторы догона для большой shared-папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  (folder as any).haveReadFolder = true;

  let fetchCalls = 0;
  folder.getNewMessages = async () => {
    fetchCalls++;
    return new ArrayColl();
  };
  // Свежий рост unread — окно догона активно.
  folder.applyServerCounts(9_743, 27);

  await folder.syncRecentArrivals();

  // Shared-ящик: максимум два прохода за вызов, остальное — следующий опрос.
  expect(fetchCalls).toBe(2);
  expect(folder.countUnread).toBe(27);
});


test("счётчик shared-папки не помечает кэш dirty при повторе устаревшего unread", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.applyServerCounts(16, 16);
  (folder as any).haveReadFolder = true;
  let messages = Array.from({ length: 16 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });
  main.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 16, UnreadCount: 16 }] };
    }
    return {};
  };

  await folder.markMessagesRead(messages, true);
  expect(folder.countUnread).toBe(0);
  folder.dirty = false;

  (shared as any).refreshFolderBadge(folder);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("общий polling счётчиков не помечает папку dirty из-за устаревшего unread", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.specialFolder = SpecialFolder.Normal;
  folder.applyServerCounts(16, 16);
  (folder as any).haveReadFolder = true;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);
  let messages = Array.from({ length: 16 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });
  main.callOWA = async (request: any) => {
    if (request.action == "FindFolder") {
      return {
        RootFolder: {
          Folders: [{ FolderId: { Id: folder.id }, TotalCount: 16, UnreadCount: 16 }],
        },
      };
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 16, UnreadCount: 16 }] };
    }
    return {};
  };

  await folder.markMessagesRead(messages, true);
  folder.dirty = false;

  await shared.refreshAllFolderCounts();

  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("полная сверка shared-папки не принимает delegate-список за список mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 2;
  folder.countUnread = 1;

  let requests: { action: string; mailbox?: string; delegateAnchor?: string }[] = [];
  main.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    requests.push({ action: request.action, mailbox, delegateAnchor });
    if (request.action == "FindItem") {
      if (!mailbox) {
        return {
          RootFolder: {
            Items: [{ ItemId: { Id: "delegate-message" }, IsRead: false }],
            IncludesLastItemInRange: true,
            TotalItemsInView: 1,
          },
        };
      }
      return {
        RootFolder: {
          Items: [
            { ItemId: { Id: "unread-message" }, IsRead: false },
            { ItemId: { Id: "read-message" }, IsRead: true },
          ],
          IncludesLastItemInRange: true,
          TotalItemsInView: 2,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-09-30T10:00:00Z",
          DateTimeReceived: "2026-09-30T10:00:00Z",
          IsRead: item.Id == "read-message",
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.listMessages(false, true);

  expect(requests.filter(request => request.action == "FindItem")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: "FindItem", mailbox: "shared@example.test" }),
    ]),
  );
  expect(requests.some(request => request.action == "FindItem" && !request.mailbox)).toBe(false);
  expect(folder.messages.length).toBe(2);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
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

  // Deep FindFolder + сверка точным GetFolder — оба через явный вход в mailbox.
  expect(explicitMailboxes).toEqual(["shared@example.test", "shared@example.test"]);
  expect(delegateAnchors).toEqual([undefined, undefined]);
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

test("shared-подпапка сверяется через GetFolder, даже если Deep FindFolder вернул старые счётчики", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";

  let inbox = shared.newFolder();
  inbox.id = "shared-inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  shared.rootFolders.add(inbox);
  shared.folderMap.set(inbox.id, inbox);

  let subfolder = shared.newFolder();
  subfolder.id = "server-errors";
  subfolder.name = "Ошибки серверов";
  subfolder.specialFolder = SpecialFolder.Normal;
  subfolder.countTotal = 9_600;
  shared.rootFolders.add(subfolder);
  shared.folderMap.set(subfolder.id, subfolder);

  let actions: string[] = [];
  main.callOWA = async (request: any, mailbox?: string) => {
    expect(mailbox).toBe("shared@example.test");
    actions.push(request.action);
    if (request.action == "FindFolder") {
      return { RootFolder: { Folders: [
        { FolderId: { Id: inbox.id }, TotalCount: 3_355, UnreadCount: 0 },
        { FolderId: { Id: subfolder.id }, TotalCount: 9_597, UnreadCount: 0 },
      ] } };
    }
    if (request.action == "GetFolder") {
      return { ResponseMessages: { Items: request.Body.FolderIds.map((entry: any) => ({
        ResponseClass: "Success",
        Folders: [{ FolderId: { Id: entry.Id }, TotalCount: entry.Id == subfolder.id ? 9_608 : 3_355,
          UnreadCount: entry.Id == subfolder.id ? 11 : 0 }],
      })) } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await shared.refreshAllFolderCounts();

  expect(actions).toContain("GetFolder");
  expect(subfolder.countTotal).toBe(9_608);
  expect(subfolder.countUnread).toBe(11);
  expect((subfolder as any).countTotalDecreased).toBe(false);
});

test("неполный batch GetFolder не оставляет хвост shared-подпапок без обновления", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";

  let inbox = shared.newFolder();
  inbox.id = "shared-inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  shared.rootFolders.add(inbox);
  shared.folderMap.set(inbox.id, inbox);
  let subfolders = Array.from({ length: 35 }, (_, index) => {
    let folder = shared.newFolder();
    folder.id = `errors-${index}`;
    folder.specialFolder = SpecialFolder.Normal;
    shared.rootFolders.add(folder);
    shared.folderMap.set(folder.id, folder);
    return folder;
  });

  let singleRequests: string[] = [];
  main.callOWA = async (request: any) => {
    if (request.action == "FindFolder") {
      return { RootFolder: { Folders: [
        { FolderId: { Id: inbox.id }, TotalCount: 0, UnreadCount: 0 },
      ] } };
    }
    if (request.action == "GetFolder") {
      let ids = request.Body.FolderIds.map((entry: any) => entry.Id);
      if (ids.length > 1) {
        return { ResponseMessages: { Items: ids.slice(0, 5).map((id: string) => ({
          ResponseClass: "Success",
          Folders: [{ FolderId: { Id: id }, TotalCount: 1, UnreadCount: 1 }],
        })) } };
      }
      singleRequests.push(ids[0]);
      return { Folders: [{ FolderId: { Id: ids[0] }, TotalCount: 1, UnreadCount: 1 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await shared.refreshAllFolderCounts();
  expect((shared as any).supportsBatchedFolderCounts).toBe(false);
  await shared.refreshAllFolderCounts();

  expect(singleRequests).toContain(subfolders[34].id);
});

test("временная ошибка batch GetFolder не отключает проверку shared-подпапок навсегда", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  (shared as any).msgFolderRootID = "shared-root";
  let folders = ["errors-a", "errors-b"].map(id => {
    let folder = shared.newFolder();
    folder.id = id;
    folder.specialFolder = SpecialFolder.Normal;
    shared.rootFolders.add(folder);
    shared.folderMap.set(id, folder);
    return folder;
  });
  shared.handleBackgroundSyncError = () => {};
  let batchRequests = 0;
  main.callOWA = async (request: any) => {
    if (request.action == "FindFolder") {
      return { RootFolder: { Folders: [] } };
    }
    if (request.action == "GetFolder") {
      let ids = request.Body.FolderIds.map((entry: any) => entry.Id);
      if (ids.length > 1) {
        batchRequests++;
        if (batchRequests == 1) {
          throw new Error("Временный сбой сети");
        }
        return { ResponseMessages: { Items: ids.map((id: string) => ({
          ResponseClass: "Success",
          Folders: [{ FolderId: { Id: id }, TotalCount: 1, UnreadCount: 1 }],
        })) } };
      }
      return { Folders: [{ FolderId: { Id: ids[0] }, TotalCount: 1, UnreadCount: 1 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await shared.refreshAllFolderCounts();
  expect((shared as any).supportsBatchedFolderCounts).toBe(true);
  await shared.refreshAllFolderCounts();

  expect(batchRequests).toBe(2);
  expect(folders.every(folder => folder.countUnread == 1)).toBe(true);
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
    if (request.action == "SyncFolderItems") {
      return { Changes: {}, SyncState: "state-1", IncludesLastItemInRange: true };
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
