import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { EMail } from "../../../../logic/Mail/EMail";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function findItemResponse(itemIDs: string[]): any {
  return {
    RootFolder: {
      Items: itemIDs.map((ItemId) => ({ ItemId: { Id: ItemId } })),
      IncludesLastItemInRange: true,
      TotalItemsInView: itemIDs.length,
    },
  };
}

test("загружает письмо при открытии shared-папки после пустого быстрого поиска", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 2, UnreadCount: 1 }] };
    }
    if (
      request.action == "FindItem" &&
      request.Body.QueryString == "isread:no"
    ) {
      return findItemResponse([]);
    }
    if (
      request.action == "FindItem" &&
      request.Body.Paging.BasePoint == "End"
    ) {
      return findItemResponse([]);
    }
    if (request.action == "FindItem") {
      return findItemResponse(["new-message", "cached-message"]);
    }
    if (request.action == "GetItem") {
      return {
        Items: [
          {
            ItemId: { Id: "new-message" },
            InternetMessageId: "<new-message@example.test>",
            Subject: "Новое письмо",
            DateTimeSent: "2026-08-28T10:00:00Z",
            DateTimeReceived: "2026-08-28T10:00:00Z",
            IsRead: false,
            ItemClass: "IPM.Note",
          },
        ],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-wb";
  folder.name = "Ошибки WB";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 2;
  folder.countUnread = 1;

  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.sent = new Date("2026-08-27T10:00:00Z");
  cached.isRead = true;
  folder.messages.add(cached);
  folder.downloadMessages = async (messages: any) => messages;

  await folder.syncOnFolderOpen();

  let newMessage = folder.getEmailByItemID("new-message") as OWAEMail;
  expect(newMessage).toBeDefined();
  expect(newMessage.subject).toBe("Новое письмо");
  expect(folder.messages.length).toBe(2);
  expect(
    requests.some(
      (request) =>
        request.action == "FindItem" &&
        !request.Body.QueryString &&
        request.Body.Paging.BasePoint == "Beginning",
    ),
  ).toBe(true);
});

test("подтягивает письмо в фоновой синхронизации после пустого unread-запроса", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    if (
      request.action == "FindItem" &&
      request.Body.QueryString == "isread:no"
    ) {
      return findItemResponse([]);
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 1 }] };
    }
    if (request.action == "FindItem") {
      return findItemResponse(["new-message"]);
    }
    if (request.action == "GetItem") {
      return {
        Items: [
          {
            ItemId: { Id: "new-message" },
            InternetMessageId: "<new-message@example.test>",
            Subject: "Новое письмо",
            DateTimeSent: "2026-08-28T10:00:00Z",
            DateTimeReceived: "2026-08-28T10:00:00Z",
            IsRead: false,
            ItemClass: "IPM.Note",
          },
        ],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 1;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  await folder.syncRecentArrivals();

  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.messages.length).toBe(1);
  expect(
    requests.some(
      (request) =>
        request.action == "FindItem" &&
        !request.Body.QueryString &&
        request.Body.Paging.BasePoint == "End",
    ),
  ).toBe(true);
});

test("делает полную сверку после частичного unread-ответа", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let fullReconcileCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      return findItemResponse(["unread-1"]);
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 4, UnreadCount: 3 }] };
    }
    if (request.action == "FindItem" && request.Body.Paging.BasePoint == "End") {
      return findItemResponse(["unread-2"]);
    }
    if (request.action == "FindItem") {
      fullReconcileCalls++;
      return findItemResponse(["cached-message", "unread-1", "unread-2", "unread-3"]);
    }
    if (request.action == "GetItem") {
      let ids = request.Body.ItemIds.map((item: any) => item.Id);
      return {
        Items: ids.map((id: string) => ({
          ItemId: { Id: id },
          InternetMessageId: `<${id}@example.test>`,
          Subject: id,
          DateTimeSent: "2026-09-22T10:00:00Z",
          DateTimeReceived: "2026-09-22T10:00:00Z",
          IsRead: id == "cached-message" ? true : false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 4;
  folder.countUnread = 3;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);

  await folder.syncRecentArrivals();

  expect(fullReconcileCalls).toBe(1);
  expect(folder.messages.length).toBe(4);
  expect(folder.getEmailByItemID("unread-3")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(3);
});

test("исправляет лишние локальные непрочитанные письма по полному unread-ответу", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let unreadIDs = Array.from({ length: 10 }, (_, index) => `unread-${index}`);
  let unreadQueryCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      unreadQueryCalls++;
      return {
        RootFolder: {
          Items: unreadIDs.map(ItemId => ({ ItemId: { Id: ItemId }, IsRead: false })),
          IncludesLastItemInRange: true,
          TotalItemsInView: unreadIDs.length,
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 15;
  folder.countUnread = unreadIDs.length;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  for (let index = 0; index < 15; index++) {
    let message = folder.newEMail();
    message.itemID = `unread-${index}`;
    message.sent = new Date(2026, 8, 29, 17, index);
    message.isRead = false;
    folder.messages.add(message);
  }

  await folder.syncRecentArrivals();

  expect(unreadQueryCalls).toBe(1);
  expect(folder.countUnread).toBe(10);
  expect(folder.dirty).toBe(false);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(10);
});

test("объединяет параллельные обновления shared Inbox в один запрос", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let findItemCalls = 0;
  let release!: () => void;
  let requestGate = new Promise<void>(resolve => {
    release = resolve;
  });
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      findItemCalls++;
      await requestGate;
      return findItemResponse(["new-message"]);
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

  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 1;
  folder.downloadMessages = async (messages: any) => messages;

  let first = folder.syncRecentArrivals();
  let second = folder.syncRecentArrivals();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(findItemCalls).toBe(1);

  release();
  await Promise.all([first, second]);

  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.messages.length).toBe(1);
});

test("публикует счётчик shared Inbox вместе с загруженным письмом", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let release!: () => void;
  let requestGate = new Promise<void>(resolve => {
    release = resolve;
  });
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      await requestGate;
      return findItemResponse(["new-message"]);
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

  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.downloadMessages = async (messages: any) => messages;

  let snapshots: Array<{ countUnread: number; messages: number }> = [];
  folder.subscribe(() => {
    snapshots.push({ countUnread: folder.countUnread, messages: folder.messages.length });
  });

  let sync = folder.syncRecentArrivalsWithServerCounts(1, 1);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(snapshots).toHaveLength(1);

  let overlappingSync = folder.syncRecentArrivalsWithServerCounts(1, 1);
  release();
  await Promise.all([sync, overlappingSync]);
  folder.notifyObservers();

  expect(snapshots.at(-1)).toEqual({ countUnread: 1, messages: 1 });
});

test("не публикует счётчик до появления строки письма", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";

  let release!: () => void;
  let syncGate = new Promise<void>(resolve => {
    release = resolve;
  });
  (folder as any).syncRecentArrivalsWithServerCounts = async (
    countTotal: number,
    countUnread: number,
  ) => {
    folder.applyServerCounts(countTotal, countUnread);
    await syncGate;
    let message = folder.newEMail();
    message.itemID = "new-message";
    folder.addMessagesIfAbsent([message]);
    return new ArrayColl([message]);
  };

  let snapshots: Array<{ countUnread: number; messages: number }> = [];
  (account as any).notifyFolderUIUpdates = (folders: any[]) => {
    for (let updatedFolder of folders) {
      snapshots.push({
        countUnread: updatedFolder.countUnread,
        messages: updatedFolder.messages.length,
      });
    }
  };

  (account as any).syncFolderAfterServerCountUpdate(folder, 1, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(snapshots).toEqual([]);

  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(snapshots).toEqual([{ countUnread: 1, messages: 1 }]);
});

test("повторяет синхронизацию, если счётчик пришёл во время уже идущего запроса", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let release!: () => void;
  let firstSyncStartedResolve!: () => void;
  let firstSyncStarted = new Promise<void>(resolve => {
    firstSyncStartedResolve = resolve;
  });
  let firstSyncGate = new Promise<void>(resolve => {
    release = resolve;
  });
  let fetchUnreadArrivalsStartedResolve!: () => void;
  let fetchUnreadArrivalsStarted = new Promise<void>(resolve => {
    fetchUnreadArrivalsStartedResolve = resolve;
  });
  let getNewMessagesCalls = 0;
  let fetchUnreadArrivalsCalls = 0;

  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  (folder as any).getNewMessages = async () => {
    getNewMessagesCalls++;
    if (getNewMessagesCalls == 1) {
      firstSyncStartedResolve();
      await firstSyncGate;
      return new ArrayColl<OWAEMail>();
    }
    return new ArrayColl<OWAEMail>();
  };
  (folder as any).fetchUnreadArrivals = async () => {
    fetchUnreadArrivalsCalls++;
    fetchUnreadArrivalsStartedResolve();
    let message = folder.newEMail();
    message.itemID = "new-message";
    message.sent = new Date("2026-09-22T10:00:00Z");
    message.received = message.sent;
    message.isRead = false;
    folder.addMessagesIfAbsent([message]);
    folder.dirty = false;
    return new ArrayColl([message]);
  };

  let initialSync = folder.syncRecentArrivals();
  await firstSyncStarted;
  let countSync = folder.syncRecentArrivalsWithServerCounts(1, 1);

  release();
  await Promise.all([initialSync, countSync]);
  await fetchUnreadArrivalsStarted;

  expect(getNewMessagesCalls).toBe(1);
  expect(fetchUnreadArrivalsCalls).toBe(1);
  expect(folder.countUnread).toBe(1);
  expect(folder.getEmailByItemID("new-message")).toBeDefined();
  expect(folder.messages.length).toBe(1);
});

test("не публикует счётчик во время обычной быстрой синхронизации", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let firstSyncStartedResolve!: () => void;
  let firstSyncStarted = new Promise<void>(resolve => {
    firstSyncStartedResolve = resolve;
  });
  let release!: () => void;
  let syncGate = new Promise<void>(resolve => {
    release = resolve;
  });
  let getNewMessagesCalls = 0;
  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  (folder as any).getNewMessages = async () => {
    getNewMessagesCalls++;
    if (getNewMessagesCalls == 1) {
      folder.applyServerCounts(1, 1);
      firstSyncStartedResolve();
      await syncGate;
      return new ArrayColl<OWAEMail>();
    }
    return new ArrayColl<OWAEMail>();
  };
  (folder as any).fetchUnreadArrivals = async () => {
    let message = folder.newEMail();
    message.itemID = "new-message";
    message.isRead = false;
    folder.addMessagesIfAbsent([message]);
    folder.dirty = false;
    return new ArrayColl([message]);
  };

  let snapshots: Array<{ countUnread: number; messages: number }> = [];
  folder.subscribe(() => {
    snapshots.push({ countUnread: folder.countUnread, messages: folder.messages.length });
  });

  let sync = folder.syncRecentArrivals();
  await firstSyncStarted;
  expect(snapshots).toEqual([{ countUnread: 0, messages: 0 }]);

  release();
  await sync;

  expect(snapshots.at(-1)).toEqual({ countUnread: 1, messages: 1 });
});

test("повторяет быструю синхронизацию, если новый заголовок появляется с задержкой", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 1;

  let fetchCalls = 0;
  (folder as any).fetchUnreadArrivals = async () => {
    fetchCalls++;
    if (fetchCalls == 1) {
      return new ArrayColl<OWAEMail>();
    }
    let message = folder.newEMail();
    message.itemID = "delayed-message";
    message.isRead = false;
    folder.addMessagesIfAbsent([message]);
    return new ArrayColl([message]);
  };

  let finished = false;
  let sync = folder.syncRecentArrivals().then(() => {
    finished = true;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(finished).toBe(false);

  await sync;
  expect(fetchCalls).toBe(2);
  expect(folder.getEmailByItemID("delayed-message")).toBeDefined();
});

test("запускает синхронизацию входящих после hierarchy-события без счётчиков", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).hasLoggedIn = true;

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  account.folderMap.set(folder.id, folder);

  let syncCount = 0;
  folder.syncRecentArrivals = async () => {
    syncCount++;
    return new ArrayColl();
  };
  (account as any).callOWA = async () => ({
    Folders: [{ TotalCount: 1, UnreadCount: 1 }],
  });

  (account as any).handleHierarchyNotification({
    EventType: "RowModified",
    id: "HierarchyNotification",
    folderId: folder.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(syncCount).toBe(1);
  expect(folder.countTotal).toBe(1);
  expect(folder.countUnread).toBe(1);
});

test("при открытии из кеша подтягивает категории для свежих писем без меток", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let findItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      findItemCalls++;
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "recent-message" },
            Categories: { String: ["Переписка (мы в копии)"] },
          }],
          IncludesLastItemInRange: true,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "recent-message" },
          Categories: { String: ["Переписка (мы в копии)"] },
          Subject: "Test",
          DateTimeSent: "2026-09-03T07:00:00Z",
          DateTimeReceived: "2026-09-03T07:00:00Z",
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;

  let recent = folder.newEMail();
  recent.itemID = "recent-message";
  recent.received = new Date();
  recent.sent = recent.received;
  folder.messages.add(recent);
  folder.downloadMessages = async (messages: any) => messages;

  await folder.syncOnFolderOpen();

  expect(findItemCalls).toBeGreaterThan(0);
  expect(recent.tags.contents.map(tag => tag.name)).toEqual(["Переписка (мы в копии)"]);
});

test("refreshMessages подтягивает изменённые категории с сервера", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-1";
  message.tags.replaceAll([{ name: "Старая метка", color: "#00aa00" } as any]);
  folder.messages.add(message);

  (account as any).callOWA = async () => ({
    Items: [{
      ItemId: { Id: message.itemID },
      Categories: { String: ["Новая метка"] },
      Subject: message.subject,
      DateTimeSent: "2026-09-03T07:00:00Z",
      DateTimeReceived: "2026-09-03T07:00:00Z",
      ItemClass: "IPM.Note",
    }],
  });

  await folder.refreshMessages([message.itemID!]);

  expect(message.tags.contents.map(tag => tag.name)).toEqual(["Новая метка"]);
});

/** Как SQLMailStorage: saveTags требует dbID, а saveMessage мог ещё не выставить его. */
class TagAssertStorage extends DummyMailStorage {
  async saveMessageTags(email: EMail): Promise<void> {
    if (!email.dbID) {
      throw new Error("Need Email DB ID");
    }
  }
}

test("refreshVisibleMessageMetadata не падает на письме без dbID", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new TagAssertStorage();

  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-no-db";
  folder.messages.add(message);

  (account as any).callOWA = async () => ({
    Items: [{
      ItemId: { Id: message.itemID },
      Categories: { String: ["Метка"] },
      Subject: message.subject,
      DateTimeSent: "2026-09-03T07:00:00Z",
      DateTimeReceived: "2026-09-03T07:00:00Z",
      ItemClass: "IPM.Note",
    }],
  });

  await expect(folder.refreshVisibleMessageMetadata()).resolves.toBeUndefined();
  expect(message.tags.contents.map(tag => tag.name)).toEqual(["Метка"]);
});

test("не запускает параллельные обновления metadata видимой папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-1";
  folder.messages.add(message);

  let requests = 0;
  let release!: () => void;
  let requestGate = new Promise<void>(resolve => {
    release = resolve;
  });
  (account as any).callOWA = async () => {
    requests++;
    await requestGate;
    return { Items: [] };
  };

  let first = folder.refreshVisibleMessageMetadata();
  let second = folder.refreshVisibleMessageMetadata();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(requests).toBe(1);

  release();
  await Promise.all([first, second]);
});

test("не блокирует открытие папки на фоновом обновлении metadata", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let folder = account.newFolder();
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;
  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = true;
  message.tags.replaceAll([{ name: "Метка", color: "#00aa00" } as any]);
  folder.messages.add(message);

  let metadataStarted = false;
  let metadataFinished = false;
  let release!: () => void;
  let requestGate = new Promise<void>(resolve => {
    release = resolve;
  });
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("GetItem");
    metadataStarted = true;
    await requestGate;
    metadataFinished = true;
    return { Items: [] };
  };

  await folder.syncOnFolderOpen();
  expect(metadataStarted).toBe(true);
  expect(metadataFinished).toBe(false);

  release();
  await folder.refreshVisibleMessageMetadata();
});
