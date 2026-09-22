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

  release();
  await sync;
  folder.notifyObservers();

  expect(snapshots.at(-1)).toEqual({ countUnread: 1, messages: 1 });
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
