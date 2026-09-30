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

test("не сбрасывает dirty после незавершённой синхронизации при открытии папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 100;
  folder.countUnread = 1;
  folder.dirty = true;

  let message = folder.newEMail();
  message.itemID = "message-1";
  message.isRead = false;
  folder.messages.add(message);
  folder.getNewMessages = async () => new ArrayColl([message]);

  await folder.syncOnFolderOpen();

  expect(folder.dirty).toBe(true);
  expect(folder.isBehindServer()).toBe(true);
});

test("обновляет открытую папку без переключения профиля", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;
  let existing = folder.newEMail();
  existing.itemID = "cached-message";
  existing.isRead = true;
  folder.messages.add(existing);

  let syncCalls = 0;
  folder.syncRecentArrivals = async () => {
    syncCalls++;
    return new ArrayColl();
  };
  let getFolderCalls = 0;
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("GetFolder");
    getFolderCalls++;
    return { Folders: [{ TotalCount: 2, UnreadCount: 1 }] };
  };

  await folder.refreshOpenFolder();

  expect(getFolderCalls).toBe(1);
  expect(syncCalls).toBe(1);
  expect(folder.countTotal).toBe(2);
  expect(folder.countUnread).toBe(1);
});

test("загружает новые письма открытой папки, даже если серверный счётчик не изменился", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  mainAccount.storage = new DummyMailStorage();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 12;
  folder.countUnread = 0;

  for (let index = 0; index < 2; index++) {
    let message = folder.newEMail();
    message.itemID = `cached-${index}`;
    message.sent = new Date(`2026-09-30T12:0${index}:00Z`);
    message.isRead = true;
    folder.messages.add(message);
  }

  (folder as any).lastOpenFolderRecentRefreshAt = Date.now() - 60_000;
  folder.downloadMessages = async messages => messages;
  let requests: { request: any; mailbox?: string }[] = [];
  (mainAccount as any).callOWA = async (request: any, mailbox?: string) => {
    requests.push({ request, mailbox });
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return {
        RootFolder: {
          Items: Array.from({ length: 10 }, (_, index) => ({
            ItemId: { Id: `new-${index}` },
            IsRead: false,
          })),
          IncludesLastItemInRange: true,
          TotalItemsInView: 12,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any, index: number) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: `Ошибка ${index + 1}`,
          DateTimeSent: `2026-09-30T14:${String(index).padStart(2, "0")}:00Z`,
          DateTimeReceived: `2026-09-30T14:${String(index).padStart(2, "0")}:00Z`,
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.refreshOpenFolder();

  expect(requests.some(({ request, mailbox }) =>
    request.action == "FindItem" && !request.Body.QueryString &&
    request.Body.Paging.BasePoint == "End" && mailbox == "integrators@example.test",
  )).toBe(true);
  expect(Array.from({ length: 10 }, (_, index) => folder.getEmailByItemID(`new-${index}`)))
    .not.toContain(undefined);
  expect(folder.messages.length).toBe(12);
  expect(folder.countUnread).toBe(10);
});

test("полностью сверяет список после уменьшения total при обновлении открытой папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let requests: any[] = [];
  let deletedIDs: string[] = [];
  account.storage.deleteMessage = async email => {
    deletedIDs.push(String((email as OWAEMail).itemID));
  };
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return findItemResponse(["kept-message"]);
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 2;
  folder.countUnread = 1;

  let stale = folder.newEMail();
  stale.itemID = "stale-message";
  stale.isRead = false;
  let kept = folder.newEMail();
  kept.itemID = "kept-message";
  kept.isRead = true;
  folder.messages.addAll([stale, kept]);

  await folder.refreshOpenFolder();

  expect(requests.filter(request => request.action == "FindItem")).toHaveLength(1);
  expect(folder.messages.contents).toEqual([kept]);
  expect(deletedIDs).toEqual(["stale-message"]);
  expect(folder.countTotal).toBe(1);
  expect(folder.countUnread).toBe(0);
  expect(folder.isBehindServer()).toBe(false);
});

test("не сбрасывает признак уменьшения total равным повторным счётчиком", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 2;
  folder.countUnread = 0;

  let calls = 0;
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("GetFolder");
    calls++;
    return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
  };

  await folder.folderCountsChanged(true);
  expect((folder as any).countTotalDecreased).toBe(true);

  await folder.folderCountsChanged(true);

  expect(calls).toBe(2);
  expect((folder as any).countTotalDecreased).toBe(true);
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
  account.mainAccount = new OWAAccount();

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

test("добирает заголовки после прочтения при частичном unread-ответе", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

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

  // Exchange может ещё отдавать старый unread-count после локального чтения.
  // Это не должно запрещать добор остальных писем из папки.
  folder.noteLocalReadMutation(2);

  await folder.syncRecentArrivals();

  expect(fullReconcileCalls).toBe(1);
  expect(folder.messages.length).toBe(4);
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

test("сбрасывает зависший счётчик непрочитанных, когда все письма прочитаны", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let unreadQueryCalls = 0;
  let fullReconcileCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      unreadQueryCalls++;
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 0,
        },
      };
    }
    if (request.action == "FindItem") {
      fullReconcileCalls++;
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 0,
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 824;
  folder.countUnread = 9;
  folder.countNewArrived = 9;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  for (let index = 0; index < 824; index++) {
    let message = folder.newEMail();
    message.itemID = `msg-${index}`;
    message.sent = new Date(2026, 8, 29, 17, index);
    message.isRead = true;
    folder.messages.add(message);
  }

  await folder.syncRecentArrivals();

  expect(unreadQueryCalls).toBe(1);
  expect(fullReconcileCalls).toBe(0);
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("полная сверка синхронизирует countUnread, если на сервере все письма прочитаны", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let fullReconcileCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 0,
        },
      };
    }
    if (request.action == "FindItem" && (request.Body.SortOrder || request.Body.Paging.BasePoint == "End")) {
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 0,
        },
      };
    }
    if (request.action == "FindItem") {
      fullReconcileCalls++;
      return {
        RootFolder: {
          Items: [
            { ItemId: { Id: "msg-1" }, IsRead: true },
            { ItemId: { Id: "msg-2" }, IsRead: true },
          ],
          IncludesLastItemInRange: true,
          TotalItemsInView: 2,
        },
      };
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 2, UnreadCount: 0 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 2;
  folder.countUnread = 2;
  folder.countNewArrived = 2;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  let m1 = folder.newEMail();
  m1.itemID = "msg-1";
  m1.isRead = false;
  folder.messages.add(m1);

  let m2 = folder.newEMail();
  m2.itemID = "msg-2";
  m2.isRead = false;
  folder.messages.add(m2);

  await folder.syncRecentArrivals();

  expect(fullReconcileCalls).toBe(1);
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(folder.dirty).toBe(false);
});

test("refreshMessages уменьшает счётчик непрочитанных при смене статуса на прочитано", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetItem") {
      return {
        Items: [
          {
            ItemId: { Id: "msg-1" },
            InternetMessageId: "<msg-1@example.test>",
            Subject: "Тест",
            DateTimeSent: "2026-09-29T10:00:00Z",
            IsRead: true,
            ItemClass: "IPM.Note",
          },
        ],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.countTotal = 1;
  folder.countUnread = 1;
  folder.countNewArrived = 1;

  let message = folder.newEMail();
  message.itemID = "msg-1";
  message.isRead = false;
  folder.messages.add(message);

  let observerNotified = false;
  folder.subscribe((_f, prop) => {
    if (prop === "countUnread" || prop == null) {
      observerNotified = true;
    }
  });

  await folder.refreshMessages(["msg-1"]);

  expect(message.isRead).toBe(true);
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(observerNotified).toBe(true);
});

test("пакетная пометка прочитанными отправляет один UpdateItem и не откатывается лагом AQS", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();

  let updateItemRequests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    if (request.action == "UpdateItem") {
      updateItemRequests.push(request);
      return {
        ResponseMessages: {
          Items: request.Body.ItemChanges.map(() => ({
            ResponseClass: "Success",
            ResponseCode: "NoError",
          })),
        },
      };
    }
    if (request.action == "FindItem" && request.Body.QueryString == "isread:no") {
      // Имитируем отставание поискового индекса Exchange AQS:
      // он всё ещё возвращает те же 39 ID как непрочитанные
      return {
        RootFolder: {
          TotalItemsInView: 39,
          IncludesLastItemInRange: true,
          Items: Array.from({ length: 39 }, (_, i) => ({
            ItemId: { Id: `msg-${i}` },
            IsRead: false,
          })),
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let folder = account.newFolder();
  folder.id = "folder-errors";
  folder.countTotal = 2740;
  folder.countUnread = 39;
  folder.countNewArrived = 39;
  (folder as any).haveReadFolder = true;

  let messages: any[] = [];
  for (let i = 0; i < 39; i++) {
    let msg = folder.newEMail();
    msg.itemID = `msg-${i}`;
    msg.isRead = false;
    folder.messages.add(msg);
    messages.push(msg);
  }

  // 1. Помечаем все 39 писем прочитанными
  await folder.markMessagesRead(messages, true);

  // Должен был уйти ровно один пакетный UpdateItem со всеми 39 письмами
  expect(updateItemRequests.length).toBe(1);
  expect(updateItemRequests[0].Body.ItemChanges.length).toBe(39);
  expect(updateItemRequests[0].Body.ItemChanges[0].Updates[0].Item.IsRead).toBe(true);

  // Счётчики должны мгновенно стать 0
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(messages.every(m => m.isRead)).toBe(true);

  // 2. Имитируем опрос fetchUnreadArrivals при отстающем AQS сервере
  await folder.fetchUnreadArrivals(50);

  // Письма не должны откатиться в непрочитанные, счётчик должен остаться 0
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);
  expect(messages.every(m => m.isRead)).toBe(true);

  // 3. Имитируем получение устаревшего счётчика GetFolder / FindFolder с сервера
  folder.applyServerCounts(2740, 39);
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);

  // 4. Имитируем поступление одного нового письма при продолжающемся отставании сервера
  folder.applyServerCounts(2741, 39);
  expect(folder.countUnread).toBe(1);
  expect(folder.countNewArrived).toBe(1);

  // 5. Имитируем поступление ещё одного письма (всего 2 новых)
  folder.applyServerCounts(2742, 39);
  expect(folder.countUnread).toBe(2);
  expect(folder.countNewArrived).toBe(2);
});

test("large folder with partial local history reconciles dirty without full-scan", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();
  (account as any).callOWA = async () => ({ Folders: [] });
  Object.defineProperty(account, "isLoggedIn", { value: true });
  let folder = account.newFolder();
  folder.id = "folder-large";
  folder.countTotal = 9758;
  folder.countUnread = 0;
  folder.countNewArrived = 0;
  (folder as any).haveReadFolder = true;

  // Локально загружено только 372 письма из 9758
  for (let i = 0; i < 372; i++) {
    let msg = folder.newEMail();
    msg.itemID = `msg-${i}`;
    msg.isRead = true;
    folder.messages.add(msg);
  }

  folder.dirty = true;
  (folder as any).markCountsReconciled();
  // dirty должен сброситься, несмотря на то что local 372 < total 9758
  expect(folder.dirty).toBe(false);

  // needsRecentRefresh не должен возвращать true, если все локальные письма прочитаны
  expect((folder as any).needsRecentRefresh()).toBe(false);

  // getNewMessages(true) не должен вызывать listMessages(false, true)
  let listMessagesCalls: Array<{ recentOnly: boolean; force: boolean }> = [];
  (folder as any).listMessages = async (recentOnly = false, force = false) => {
    listMessagesCalls.push({ recentOnly, force });
    return new ArrayColl();
  };

  await folder.getNewMessages(true);
  expect(listMessagesCalls.some(call => !call.recentOnly)).toBe(false);
});
