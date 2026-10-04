import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { kMaxFetchCount, OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { mailSyncing } from "../../../../logic/Mail/mailSyncStatus";
import type { EMail } from "../../../../logic/Mail/EMail";
import { ArrayColl } from "svelte-collections";
import { expect, test, vi } from "vitest";
import { get } from "svelte/store";

function findItemResponse(itemIDs: string[]): any {
  return {
    RootFolder: {
      Items: itemIDs.map((ItemId) => ({ ItemId: { Id: ItemId } })),
      IncludesLastItemInRange: true,
      TotalItemsInView: itemIDs.length,
    },
  };
}

function isUnreadQuery(query: unknown): boolean {
  return query == "isread:false" || query == "isread:no";
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
      isUnreadQuery(request.Body.QueryString)
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

test("чистая shared-подпапка проверяется при открытии, даже когда кешированный счётчик не изменился", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = main;
  account.username = "integrators@example.test";
  let folder = account.newFolder();
  folder.id = "server-errors";
  folder.countTotal = 1;
  (folder as any).haveReadFolder = true;
  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);
  let refreshed = 0;
  folder.refreshOpenFolder = async () => { refreshed++; };

  await folder.syncOnFolderOpen();

  expect(refreshed).toBe(1);
});

test("открывает кэшированную shared-папку до завершения сетевой сверки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();
  account.username = "integrators@example.test";
  let folder = account.newFolder();
  folder.id = "server-errors";
  folder.countTotal = 1;
  (folder as any).haveReadFolder = true;
  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);

  let refreshCalls = 0;
  folder.refreshOpenFolder = async () => {
    refreshCalls++;
    await new Promise<void>(() => {});
  };
  (folder as any).refreshVisibleMessageMetadataInBackground = () => {};
  (folder as any).backfillMessageActionFlags = () => {};

  let returnedBeforeRefresh = await Promise.race([
    folder.syncOnFolderOpen(true).then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50)),
  ]);

  expect(returnedBeforeRefresh).toBe(true);
  expect(refreshCalls).toBe(1);
  expect(folder.messages.contents).toEqual([cached]);
});

test("shared-подпапка добирает новый заголовок из альтернативного контекста непустой страницы", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = main;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;
  (account as any).sharedFolderRoot = "msgfolderroot";
  let folder = account.newFolder();
  folder.id = "server-errors";
  folder.countTotal = 1;
  (folder as any).haveReadFolder = true;
  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);
  folder.downloadMessages = async messages => messages;

  main.callOWA = async (request: any, mailbox?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [
        { ItemId: { Id: mailbox ? "cached-message" : "new-message" }, IsRead: !!mailbox },
      ], IncludesLastItemInRange: true, TotalItemsInView: 1 } };
    }
    if (request.action == "GetItem") {
      return { Items: [{ ItemId: { Id: "new-message" },
        InternetMessageId: "<new-message@example.test>", Subject: "Свежая ошибка",
        DateTimeSent: "2026-09-30T13:40:00Z", DateTimeReceived: "2026-09-30T13:40:00Z",
        IsRead: false, ItemClass: "IPM.Note" }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.listMessages(true, true);

  expect(folder.getEmailByItemID("new-message")?.subject).toBe("Свежая ошибка");
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
      isUnreadQuery(request.Body.QueryString)
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
        request.Body.Paging.BasePoint == "Beginning",
    ),
  ).toBe(true);
});

test("делает полную сверку маленькой папки, пока бейдж больше видимых непрочитанных", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let fullReconcileCalls = 0;
  (account as any).callOWA = async (request: any) => {
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

  let fullReconcileCalls = 0;
  (account as any).callOWA = async (request: any) => {
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

test("полная сверка исправляет лишние локальные непрочитанные письма", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let unreadIDs = Array.from({ length: 10 }, (_, index) => `unread-${index}`);
  let readIDs = Array.from({ length: 5 }, (_, index) => `read-${index}`);
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      return {
        RootFolder: {
          Items: [...unreadIDs, ...readIDs].map(Id => ({
            ItemId: { Id },
            IsRead: unreadIDs.includes(Id) ? false : true,
          })),
          IncludesLastItemInRange: true,
          TotalItemsInView: 15,
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
  folder.countUnread = 10;
  folder.dirty = true;
  folder.downloadMessages = async (messages: any) => messages;

  // Устаревший кеш: все 15 строк помечены непрочитанными, хотя на сервере 10.
  for (let index = 0; index < 15; index++) {
    let message = folder.newEMail();
    message.itemID = index < 10 ? `unread-${index}` : `read-${index - 10}`;
    message.sent = new Date(2026, 8, 29, 17, index);
    message.isRead = false;
    folder.messages.add(message);
  }

  await folder.listMessages(false, true);

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
  let chaseStartedResolve!: () => void;
  let chaseStarted = new Promise<void>(resolve => {
    chaseStartedResolve = resolve;
  });
  let getNewMessagesCalls = 0;

  let folder = account.newFolder();
  folder.id = "integrators-inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.dirty = true;
  (folder as any).getNewMessages = async () => {
    getNewMessagesCalls++;
    if (getNewMessagesCalls == 1) {
      firstSyncStartedResolve();
      await firstSyncGate;
      return new ArrayColl<OWAEMail>();
    }
    chaseStartedResolve();
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
  let countSync = folder.syncRecentArrivalsWithServerCounts(9_743, 1);

  release();
  await Promise.all([initialSync, countSync]);
  await chaseStarted;

  expect(getNewMessagesCalls).toBe(2);
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
  folder.dirty = true;
  (folder as any).getNewMessages = async () => {
    getNewMessagesCalls++;
    if (getNewMessagesCalls == 1) {
      folder.applyServerCounts(9_743, 1);
      firstSyncStartedResolve();
      await syncGate;
      return new ArrayColl<OWAEMail>();
    }
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
  // Свежий рост unread по данным сервера — окно догона активно.
  folder.applyServerCounts(9_743, 1);

  let fetchCalls = 0;
  (folder as any).getNewMessages = async () => {
    fetchCalls++;
    if (fetchCalls == 1) {
      return new ArrayColl<OWAEMail>();
    }
    let message = folder.newEMail();
    message.itemID = "delayed-message";
    message.isRead = false;
    folder.addMessagesIfAbsent([message]);
    folder.dirty = false;
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

test("серверный счётчик сбрасывает зависший бейдж непрочитанных", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let getFolderCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      getFolderCalls++;
      // Сервер говорит: все прочитаны. Локальный бейдж 9 — устаревший.
      return { Folders: [{ TotalCount: 824, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 824 } };
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

  expect(getFolderCalls).toBeGreaterThan(0);
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
  // Фоновый скан вложений не должен попадать в счётчик полных страниц.
  (folder as any).attachmentFlagsSynced = true;
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

  // Устаревший бейдж: сервер уже говорит «все прочитаны».
  await folder.syncRecentArrivals();
  expect(folder.countUnread).toBe(0);
  expect(folder.countNewArrived).toBe(0);

  // А авторитетная полная сверка исправляет и сами строки.
  await folder.listMessages(false, true);
  expect(fullReconcileCalls).toBe(1);
  expect(folder.countUnread).toBe(0);
  expect(folder.dirty).toBe(false);
  expect([...folder.messages].every(message => message.isRead)).toBe(true);
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
    if (request.action == "GetItem") {
      // Имитируем отставание Exchange: GetItem всё ещё возвращает те же 39
      // писем непрочитанными, хотя UpdateItem уже успешно применён.
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          IsRead: false,
        })),
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

  // 2. Имитируем опрос refreshMessages при отстающем сервере
  await folder.refreshMessages(messages.map(message => message.itemID));

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

test("догружает все заголовки текущего дня до границы 00:00", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_407;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  (folder as any).lastCountRefreshAt = Date.now();
  let dayKey = (folder as any).recentDayKey(new Date());
  (folder as any).recentDaySyncOffsetKey = dayKey;
  (folder as any).recentDaySyncQueryKey = dayKey;
  (folder as any).recentDaySyncUseQuery = false;

  let now = new Date();
  let cached = folder.newEMail();
  cached.itemID = "day-0";
  cached.isRead = true;
  cached.sent = now;
  cached.received = now;
  folder.messages.add(cached);

  let findOffsets: number[] = [];
  let headerCount = 0;
  let downloadCalls = 0;
  folder.downloadMessages = async messages => {
    downloadCalls++;
    return messages;
  };
  folder.getNewMessageHeaders = async (ids: string[]) => {
    headerCount += ids.length;
    let headers = new ArrayColl<OWAEMail>();
    for (let id of ids) {
      let message = folder.newEMail();
      message.itemID = id;
      message.isRead = true;
      message.sent = now;
      message.received = now;
      headers.add(message);
    }
    return headers;
  };
  (folder as any).backfillMessageActionFlags = () => {};
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    let offset = request.Body.Paging.Offset;
    findOffsets.push(offset);
    if (offset >= 623) {
      let yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "yesterday" },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + 1,
          TotalItemsInView: 12_407,
        },
      };
    }
    let pageLength = Math.min(kMaxFetchCount, 623 - offset);
    let ids = Array.from({ length: pageLength }, (_, index) => `day-${offset + index}`);
    return {
      RootFolder: {
        Items: ids.map(id => ({
          ItemId: { Id: id },
          DateTimeReceived: now.toISOString(),
          DateTimeSent: now.toISOString(),
          IsRead: true,
        })),
        IncludesLastItemInRange: true,
        IndexedPagingOffset: offset + ids.length,
        TotalItemsInView: 12_407,
      },
    };
  };

  await folder.syncRecentDayMessages();

  expect(folder.messages.length).toBe(623);
  expect(findOffsets).toEqual([
    0, 50, 100, 150, 200, 250, 300,
    350, 400, 450, 500, 550, 600, 623,
  ]);
  expect(headerCount).toBe(622);
  expect(downloadCalls).toBe(0);

  let callsAfterComplete = findOffsets.length;
  await folder.syncRecentDayMessages();
  expect(findOffsets).toHaveLength(callsAfterComplete);
});

test("фоновые шаги догружают текущий день без удержания глобального спиннера", async () => {
  vi.useFakeTimers();
  try {
    appGlobal.remoteApp = { OWA: {} };
    let account = new OWAAccount();
    account.storage = new DummyMailStorage();
    let folder = account.newFolder();
    folder.id = "errors-servers";
    folder.countTotal = 12_407;
    folder.countUnread = 0;
    (folder as any).haveReadFolder = true;
    (folder as any).lastCountRefreshAt = Date.now();
    let dayKey = (folder as any).recentDayKey(new Date());
    (folder as any).recentDaySyncOffsetKey = dayKey;
    (folder as any).recentDaySyncQueryKey = dayKey;
    (folder as any).recentDaySyncUseQuery = false;

    let now = new Date();
    let findOffsets: number[] = [];
    folder.getNewMessageHeaders = async (ids: string[]) => {
      let headers = new ArrayColl<OWAEMail>();
      for (let id of ids) {
        let message = folder.newEMail();
        message.itemID = id;
        message.isRead = true;
        message.sent = now;
        message.received = now;
        headers.add(message);
      }
      return headers;
    };
    (folder as any).backfillMessageActionFlags = () => {};
    (account as any).callOWA = async (request: any) => {
      let offset = request.Body.Paging.Offset;
      findOffsets.push(offset);
      if (offset >= 623) {
        let yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return {
          RootFolder: {
            Items: [{
              ItemId: { Id: "yesterday" },
              DateTimeReceived: yesterday.toISOString(),
              DateTimeSent: yesterday.toISOString(),
              IsRead: true,
            }],
            IncludesLastItemInRange: true,
            IndexedPagingOffset: offset + 1,
            TotalItemsInView: 12_407,
          },
        };
      }
      let pageLength = Math.min(kMaxFetchCount, 623 - offset);
      let ids = Array.from({ length: pageLength }, (_, index) => `day-${offset + index}`);
      return {
        RootFolder: {
          Items: ids.map(id => ({
            ItemId: { Id: id },
            DateTimeReceived: now.toISOString(),
            DateTimeSent: now.toISOString(),
            IsRead: true,
          })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + ids.length,
          TotalItemsInView: 12_407,
        },
      };
    };

    folder.syncRecentDayMessagesInBackground();
    await vi.advanceTimersByTimeAsync(0);
    expect(folder.messages.length).toBe(200);
    expect(findOffsets).toEqual([0, 50, 100, 150]);
    expect(get(mailSyncing)).toBe(false);

    for (let step = 0; step < 4 && folder.messages.length < 623; step++) {
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(folder.messages.length).toBe(623);
    expect(get(mailSyncing)).toBe(false);
    expect(findOffsets).toEqual([
      0, 50, 100, 150, 200, 250, 300, 350,
      400, 450, 500, 550, 600, 623,
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("переключается на обычный FindItem, если AQS обрывается на неполной странице", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_474;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  (folder as any).lastCountRefreshAt = Date.now();

  let now = new Date();
  let yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let todayIDs = Array.from({ length: 623 }, (_, index) => `today-${index}`);
  let queryOffsets: number[] = [];
  let fallbackOffsets: number[] = [];
  folder.getNewMessageHeaders = async (ids: string[]) => {
    let headers = new ArrayColl<OWAEMail>();
    for (let id of ids) {
      let message = folder.newEMail();
      message.itemID = id;
      message.isRead = true;
      message.sent = now;
      message.received = now;
      headers.add(message);
    }
    return headers;
  };
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    let offset = request.Body.Paging.Offset;
    let isQuery = request.Body.QueryString == "received:today";
    if (isQuery) {
      queryOffsets.push(offset);
      let page = todayIDs.slice(offset, Math.min(offset + kMaxFetchCount, 275));
      return {
        RootFolder: {
          Items: page.length
            ? page.map(id => ({
              ItemId: { Id: id },
              DateTimeReceived: now.toISOString(),
              DateTimeSent: now.toISOString(),
              IsRead: true,
            }))
            : [],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: 275,
        },
      };
    }

    fallbackOffsets.push(offset);
    let page = todayIDs.slice(offset, offset + kMaxFetchCount);
    if (!page.length) {
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "yesterday" },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + 1,
          TotalItemsInView: 12_474,
        },
      };
    }
    return {
      RootFolder: {
        Items: page.map(id => ({
          ItemId: { Id: id },
          DateTimeReceived: now.toISOString(),
          DateTimeSent: now.toISOString(),
          IsRead: true,
        })),
        IncludesLastItemInRange: true,
        IndexedPagingOffset: offset + page.length,
        TotalItemsInView: 12_474,
      },
    };
  };

  await folder.syncRecentDayMessages();

  expect(folder.messages).toHaveLength(623);
  expect(queryOffsets).toEqual([0, 50, 100, 150, 200, 250, 275]);
  expect(fallbackOffsets).toEqual([
    0, 50, 100, 150, 200, 250, 300, 350,
    400, 450, 500, 550, 600, 623,
  ]);
});

test("переключается на обычный FindItem после пустого AQS-ответа текущего дня", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_474;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  (folder as any).lastCountRefreshAt = Date.now();

  let now = new Date();
  let yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let todayIDs = Array.from({ length: 147 }, (_, index) => `today-${index}`);
  let queryCalls = 0;
  let fallbackOffsets: number[] = [];
  folder.getNewMessageHeaders = async (ids: string[]) => {
    let headers = new ArrayColl<OWAEMail>();
    for (let id of ids) {
      let message = folder.newEMail();
      message.itemID = id;
      message.isRead = true;
      message.sent = now;
      message.received = now;
      headers.add(message);
    }
    return headers;
  };
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    if (request.Body.QueryString == "received:today") {
      queryCalls++;
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 0,
        },
      };
    }

    let offset = request.Body.Paging.Offset;
    fallbackOffsets.push(offset);
    let page = todayIDs.slice(offset, offset + kMaxFetchCount);
    if (!page.length) {
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "yesterday" },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + 1,
          TotalItemsInView: 12_474,
        },
      };
    }
    return {
      RootFolder: {
        Items: page.map(id => ({
          ItemId: { Id: id },
          DateTimeReceived: now.toISOString(),
          DateTimeSent: now.toISOString(),
          IsRead: true,
        })),
        IncludesLastItemInRange: true,
        IndexedPagingOffset: offset + page.length,
        TotalItemsInView: 12_474,
      },
    };
  };

  await folder.syncRecentDayMessages();

  expect(queryCalls).toBe(1);
  expect((folder as any).recentDaySyncUseQuery).toBe(false);
  expect(fallbackOffsets).toEqual([0, 50, 100, 147]);
  expect(folder.messages).toHaveLength(147);
});

test("переключается на обычный FindItem, если сервер не умеет десериализовать AQS", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_474;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  (folder as any).lastCountRefreshAt = Date.now();

  let now = new Date();
  let yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let todayIDs = Array.from({ length: 623 }, (_, index) => `today-${index}`);
  let queryCalls = 0;
  let fallbackOffsets: number[] = [];
  folder.getNewMessageHeaders = async (ids: string[]) => {
    let headers = new ArrayColl<OWAEMail>();
    for (let id of ids) {
      let message = folder.newEMail();
      message.itemID = id;
      message.isRead = true;
      message.sent = now;
      message.received = now;
      headers.add(message);
    }
    return headers;
  };
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    if (request.Body.QueryString == "received:today") {
      queryCalls++;
      throw new OWAError({ message: "Cannot deserialize object of type FindItemJsonRequest" });
    }

    let offset = request.Body.Paging.Offset;
    fallbackOffsets.push(offset);
    let page = todayIDs.slice(offset, offset + kMaxFetchCount);
    if (!page.length) {
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "yesterday" },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + 1,
          TotalItemsInView: 12_474,
        },
      };
    }
    return {
      RootFolder: {
        Items: page.map(id => ({
          ItemId: { Id: id },
          DateTimeReceived: now.toISOString(),
          DateTimeSent: now.toISOString(),
          IsRead: true,
        })),
        IncludesLastItemInRange: true,
        IndexedPagingOffset: offset + page.length,
        TotalItemsInView: 12_474,
      },
    };
  };

  await folder.syncRecentDayMessages();

  expect(folder.messages).toHaveLength(623);
  expect(queryCalls).toBe(1);
  expect((folder as any).recentDaySyncUseQuery).toBe(false);
  expect(fallbackOffsets).toEqual([
    0, 50, 100, 150, 200, 250, 300, 350,
    400, 450, 500, 550, 600, 623,
  ]);
});

test("повторяет shared-поиск от начала, если BasePoint=End отдаёт старые письма", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  mainAccount.storage = new DummyMailStorage();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_474;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  (folder as any).lastCountRefreshAt = Date.now();
  let dayKey = (folder as any).recentDayKey(new Date());
  (folder as any).recentDaySyncOffsetKey = dayKey;
  (folder as any).recentDaySyncQueryKey = dayKey;
  (folder as any).recentDaySyncUseQuery = false;

  let now = new Date();
  let yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let todayIDs = Array.from({ length: 623 }, (_, index) => `today-${index}`);
  let basePoints: string[] = [];
  folder.getNewMessageHeaders = async (ids: string[]) => {
    let headers = new ArrayColl<OWAEMail>();
    for (let id of ids) {
      let message = folder.newEMail();
      message.itemID = id;
      message.isRead = true;
      message.sent = now;
      message.received = now;
      headers.add(message);
    }
    return headers;
  };
  (mainAccount as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    let offset = request.Body.Paging.Offset;
    if (request.Body.QueryString == "received:today") {
      let page = todayIDs.slice(offset, Math.min(offset + kMaxFetchCount, 275));
      if (!page.length) {
        page = Array.from({ length: kMaxFetchCount }, (_, index) => `old-query-${offset + index}`);
      }
      return {
        RootFolder: {
          Items: page.map(id => ({
            ItemId: { Id: id },
            DateTimeReceived: id.startsWith("old-query-") ? yesterday.toISOString() : now.toISOString(),
            DateTimeSent: id.startsWith("old-query-") ? yesterday.toISOString() : now.toISOString(),
            IsRead: true,
          })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: 275,
        },
      };
    }
    basePoints.push(request.Body.Paging.BasePoint);
    if (request.Body.Paging.BasePoint == "End") {
      return {
        RootFolder: {
          Items: Array.from({ length: kMaxFetchCount }, (_, index) => ({
            ItemId: { Id: `old-${offset + index}` },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + kMaxFetchCount,
          TotalItemsInView: 12_474,
        },
      };
    }
    let page = todayIDs.slice(offset, offset + kMaxFetchCount);
    if (!page.length) {
      return {
        RootFolder: {
          Items: [{
            ItemId: { Id: "yesterday" },
            DateTimeReceived: yesterday.toISOString(),
            DateTimeSent: yesterday.toISOString(),
            IsRead: true,
          }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + 1,
          TotalItemsInView: 12_474,
        },
      };
    }
    return {
      RootFolder: {
        Items: page.map(id => ({
          ItemId: { Id: id },
          DateTimeReceived: now.toISOString(),
          DateTimeSent: now.toISOString(),
          IsRead: true,
        })),
        IncludesLastItemInRange: true,
        IndexedPagingOffset: offset + page.length,
        TotalItemsInView: 12_474,
      },
    };
  };

  await folder.syncRecentDayMessages();

  expect(folder.messages).toHaveLength(623);
  expect(basePoints).toContain("End");
  expect(basePoints).toContain("Beginning");
});

test("повторяет фоновую догрузку после пустого ответа OWA", async () => {
  vi.useFakeTimers();
  try {
    appGlobal.remoteApp = { OWA: {} };
    let account = new OWAAccount();
    account.storage = new DummyMailStorage();
    let folder = account.newFolder();
    folder.id = "errors-servers";
    folder.countTotal = 12_407;
    let dayKey = (folder as any).recentDayKey(new Date());
    (folder as any).recentDaySyncOffsetKey = dayKey;
    (folder as any).recentDaySyncQueryKey = dayKey;
    (folder as any).recentDaySyncUseQuery = false;

    let listMessagesCalls = 0;
    (folder as any).listMessages = async () => {
      listMessagesCalls++;
      if (listMessagesCalls == 2) {
        (folder as any).recentDaySyncOffset = kMaxFetchCount;
        (folder as any).recentDaySyncCompletedKey = (folder as any).recentDayKey(new Date());
      }
      return new ArrayColl<OWAEMail>();
    };

    await folder.syncRecentDayMessages(true);
    expect(listMessagesCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(listMessagesCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listMessagesCalls).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("догружает непрочитанные письма из большой shared-папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  mainAccount.storage = new DummyMailStorage();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_345;
  folder.countUnread = 504;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_345, 504);
  for (let index = 0; index < 120; index++) {
    let message = folder.newEMail();
    message.itemID = `cached-${index}`;
    message.isRead = true;
    folder.messages.add(message);
  }
  folder.downloadMessages = async messages => messages;
  folder.syncHasAttachmentFlags = async () => {};
  (folder as any).refreshVisibleMessageMetadataInBackground = () => {};
  (folder as any).backfillMessageActionFlags = () => {};

  let unreadIDs = Array.from({ length: 504 }, (_, index) => `unread-${index}`);
  let unreadFindItemCalls = 0;
  let unreadQueries: string[] = [];
  (mainAccount as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_345, UnreadCount: 504 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      unreadQueries.push(request.Body.QueryString);
      let offset = request.Body.Paging.Offset;
      let pageSize = request.Body.Paging.MaxEntriesReturned;
      let page = unreadIDs.slice(offset, offset + pageSize);
      return {
        RootFolder: {
          Items: page.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: offset + page.length >= unreadIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: unreadIDs.length,
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
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncOnFolderOpen(true);
  await folder.refreshOpenFolder();

  expect(unreadFindItemCalls).toBe(Math.ceil(unreadIDs.length / kMaxFetchCount));
  expect(unreadQueries[0]).toBe("isread:false");
  expect(folder.messages.length).toBe(120 + unreadIDs.length);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(504);
  expect(folder.countUnread).toBe(504);
});

test("читает непрочитанные shared-папки через delegate-контекст", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  mainAccount.storage = new DummyMailStorage();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;
  (account as any).sharedFolderRoot = "msgfolderroot";

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_000;
  folder.countUnread = 2;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_000, 2);
  folder.downloadMessages = async messages => messages;

  let readContexts: Array<{ action: string; mailbox?: string; delegateAnchor?: string }> = [];
  mainAccount.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_000, UnreadCount: 2 }] };
    }
    if (request.action == "FindItem" || request.action == "GetItem") {
      readContexts.push({ action: request.action, mailbox, delegateAnchor });
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      return {
        RootFolder: {
          Items: [
            { ItemId: { Id: "delegate-unread-1" }, IsRead: false },
            { ItemId: { Id: "delegate-unread-2" }, IsRead: false },
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
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(readContexts.length).toBeGreaterThan(0);
  expect(readContexts.every(context =>
    context.mailbox == null && context.delegateAnchor == account.emailAddress)).toBe(true);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(2);
});

test("догружает unread из explicit mailbox, если delegate-контекст вернул пустую страницу", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 2;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 2);
  folder.downloadMessages = async messages => messages;

  let explicitFindItemCalls = 0;
  let delegateFindItemCalls = 0;
  mainAccount.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 2 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      if (delegateAnchor) {
        delegateFindItemCalls++;
        return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
      }
      expect(mailbox).toBe(account.username);
      explicitFindItemCalls++;
      return {
        RootFolder: {
          Items: [
            { ItemId: { Id: "explicit-unread-1" }, IsRead: false },
            { ItemId: { Id: "explicit-unread-2" }, IsRead: false },
          ],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 2,
          TotalItemsInView: 2,
        },
      };
    }
    if (request.action == "GetItem") {
      if (delegateAnchor) {
        return { Items: [] };
      }
      expect(mailbox).toBe(account.username);
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(delegateFindItemCalls).toBeGreaterThan(0);
  expect(explicitFindItemCalls).toBe(1);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(2);
  expect(folder.getEmailByItemID("explicit-unread-1")).toBeDefined();
  expect(folder.getEmailByItemID("explicit-unread-2")).toBeDefined();
});

test("переключает shared unread на explicit mailbox, если delegate вернул только прочитанные строки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 1);
  folder.downloadMessages = async messages => messages;

  let explicitFindItemCalls = 0;
  mainAccount.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 1 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      if (delegateAnchor) {
        return {
          RootFolder: {
            Items: [{ ItemId: { Id: "today-read" }, IsRead: true }],
            IncludesLastItemInRange: true,
            TotalItemsInView: 1,
          },
        };
      }
      expect(mailbox).toBe(account.username);
      explicitFindItemCalls++;
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "explicit-friday-unread" }, IsRead: false }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      expect(mailbox).toBe(account.username);
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(explicitFindItemCalls).toBe(1);
  expect(folder.getEmailByItemID("explicit-friday-unread")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("повторяет первую shared unread-страницу через explicit mailbox после устаревшего delegate ItemId", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 1);
  folder.downloadMessages = async messages => messages;

  let explicitFindItemCalls = 0;
  let delegateFindItemCalls = 0;
  mainAccount.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 1 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      if (delegateAnchor) {
        delegateFindItemCalls++;
        return {
          RootFolder: {
            Items: [{ ItemId: { Id: "stale-delegate-unread" }, IsRead: false }],
            IncludesLastItemInRange: true,
            TotalItemsInView: 1,
          },
        };
      }
      expect(mailbox).toBe(account.username);
      explicitFindItemCalls++;
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "explicit-current-unread" }, IsRead: false }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      if (delegateAnchor || request.Body.ItemIds.some((item: any) => item.Id == "stale-delegate-unread")) {
        return { Items: [] };
      }
      expect(mailbox).toBe(account.username);
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    if (request.action == "FindItem") {
      return {
        RootFolder: {
          Items: [],
          IncludesLastItemInRange: true,
          TotalItemsInView: 12_867,
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(delegateFindItemCalls).toBeGreaterThan(0);
  expect(explicitFindItemCalls).toBe(1);
  expect(folder.getEmailByItemID("explicit-current-unread")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("переключает shared unread на explicit mailbox, если delegate вернул только удалённые строки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 2;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 2);
  folder.downloadMessages = async messages => messages;
  folder.deletions.add("deleted-unread");

  let explicitFindItemCalls = 0;
  mainAccount.callOWA = async (request: any, mailbox?: string, delegateAnchor?: string) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 2 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      if (delegateAnchor) {
        return {
          RootFolder: {
            Items: [{ ItemId: { Id: "deleted-unread" }, IsRead: false }],
            IncludesLastItemInRange: true,
            TotalItemsInView: 1,
          },
        };
      }
      expect(mailbox).toBe(account.username);
      explicitFindItemCalls++;
      return {
        RootFolder: {
          Items: [
            { ItemId: { Id: "remaining-unread-1" }, IsRead: false },
            { ItemId: { Id: "remaining-unread-2" }, IsRead: false },
          ],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 2,
          TotalItemsInView: 2,
        },
      };
    }
    if (request.action == "GetItem") {
      expect(mailbox).toBe(account.username);
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(explicitFindItemCalls).toBe(1);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(2);
  expect(folder.getEmailByItemID("remaining-unread-1")).toBeDefined();
  expect(folder.getEmailByItemID("remaining-unread-2")).toBeDefined();
});

test("принудительно догружает unread для умного представления после фоновой попытки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_726;
  folder.countUnread = 110;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_726, 110);

  let cachedUnreadIDs = Array.from({ length: 7 }, (_, index) => `unread-${index}`);
  for (let id of cachedUnreadIDs) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.downloadMessages = async messages => messages;

  let unreadIDs = Array.from({ length: 110 }, (_, index) => `unread-${index}`);
  let unreadFindItemCalls = 0;
  (folder as any).lastUnreadReconcileAt = Date.now();
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      let offset = request.Body.Paging.Offset;
      let pageSize = request.Body.Paging.MaxEntriesReturned;
      let page = unreadIDs.slice(offset, offset + pageSize);
      return {
        RootFolder: {
          Items: page.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: offset + page.length >= unreadIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: unreadIDs.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-03T10:00:00Z",
          DateTimeReceived: "2026-10-03T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(unreadFindItemCalls).toBe(Math.ceil(unreadIDs.length / kMaxFetchCount));
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(110);
  expect(get(mailSyncing)).toBe(false);
});

test("обновляет серверный unread-счётчик перед фильтром", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 103;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 103);
  folder.downloadMessages = async messages => messages;

  let unreadIDs = Array.from({ length: 147 }, (_, index) => `server-unread-${index}`);
  let getFolderCalls = 0;
  let unreadFindItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      getFolderCalls++;
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 147 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      let offset = request.Body.Paging.Offset;
      let pageSize = request.Body.Paging.MaxEntriesReturned;
      let page = unreadIDs.slice(offset, offset + pageSize);
      return {
        RootFolder: {
          Items: page.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: offset + page.length >= unreadIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: unreadIDs.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(getFolderCalls).toBe(1);
  expect(unreadFindItemCalls).toBe(Math.ceil(unreadIDs.length / kMaxFetchCount));
  expect(folder.countUnread).toBe(147);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(147);
});

test("ручной unread-фильтр сверяет сервер даже при нулевом локальном unread-кеше", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_867;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 0);

  let cached = folder.newEMail();
  cached.itemID = "cached-read";
  cached.isRead = true;
  folder.messages.add(cached);

  let unreadFindItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "server-unread" }, IsRead: false }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "server-unread" },
          InternetMessageId: "<server-unread@example.test>",
          Subject: "Непрочитанное письмо с сервера",
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(unreadFindItemCalls).toBe(1);
  expect(folder.getEmailByItemID("server-unread")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("переключается на legacy AQS, если сервер отклоняет isread:false", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_867;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 1);
  folder.downloadMessages = async messages => messages;

  let queries: string[] = [];
  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 1 }] };
    }
    if (request.action == "FindItem" && request.Body.QueryString) {
      queries.push(request.Body.QueryString);
      if (request.Body.QueryString == "isread:false") {
        throw new OWAError({ type: "ErrorInvalidRequest", message: "Unsupported QueryString isread:false" });
      }
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "legacy-unread" }, IsRead: false }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "legacy-unread" },
          InternetMessageId: "<legacy-unread@example.test>",
          Subject: "Непрочитанное письмо через legacy AQS",
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(queries).toEqual(["isread:false", "isread:no"]);
  expect(folder.getEmailByItemID("legacy-unread")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("принимает unread-заголовок, если shared OWA не возвращает IsRead в GetItem", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.countTotal = 12_867;
  folder.countUnread = 103;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 103);

  (account as any).callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 103 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "shared-unread-without-flag" } }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "shared-unread-without-flag" },
          InternetMessageId: "<shared-unread-without-flag@example.test>",
          Subject: "Непрочитанное письмо без IsRead",
          DateTimeSent: "2026-10-04T10:00:00Z",
          DateTimeReceived: "2026-10-04T10:00:00Z",
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  let message = folder.getEmailByItemID("shared-unread-without-flag");
  expect(message).toBeDefined();
  expect(message?.isRead).toBe(false);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("переходит на обычные страницы, если AQS unread преждевременно обрывается", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_992;
  folder.countUnread = 228;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_992, 228);

  let currentUnreadIDs = Array.from({ length: 125 }, (_, index) => `current-${index}`);
  for (let id of currentUnreadIDs) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.downloadMessages = async messages => messages;

  let olderUnreadIDs = Array.from({ length: 103 }, (_, index) => `older-${index}`);
  let folderIDs = [...currentUnreadIDs, ...olderUnreadIDs, ...Array.from({ length: 22 }, (_, index) => `read-${index}`)];
  let unreadFindItemCalls = 0;
  let folderFindItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      let offset = request.Body.Paging.Offset;
      let pageSize = request.Body.Paging.MaxEntriesReturned;
      let page = currentUnreadIDs.slice(offset, offset + pageSize);
      return {
        RootFolder: {
          Items: page.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: offset + page.length >= currentUnreadIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: currentUnreadIDs.length,
        },
      };
    }
    if (request.action == "FindItem") {
      folderFindItemCalls++;
      let offset = request.Body.Paging.Offset;
      let pageSize = request.Body.Paging.MaxEntriesReturned;
      let page = folderIDs.slice(offset, offset + pageSize);
      return {
        RootFolder: {
          Items: page.map(id => ({
            ItemId: { Id: id },
            IsRead: !olderUnreadIDs.includes(id) && !currentUnreadIDs.includes(id),
          })),
          IncludesLastItemInRange: offset + page.length >= folderIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: folderIDs.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T22:00:00Z",
          DateTimeReceived: "2026-10-02T22:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  // The canonical AQS boolean is tried first; a legacy spelling is kept for
  // older OWA builds before the opposite end and ordinary-folder fallback.
  expect(unreadFindItemCalls).toBe(Math.ceil(currentUnreadIDs.length / kMaxFetchCount) * 3);
  expect(folderFindItemCalls).toBe(Math.ceil(folderIDs.length / kMaxFetchCount));
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(228);
  expect(get(mailSyncing)).toBe(false);
});

test("продолжает fallback unread после ложного IncludesLastItemInRange", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_474;
  folder.countUnread = 225;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_474, 225);

  let currentUnreadIDs = Array.from({ length: 122 }, (_, index) => `current-${index}`);
  for (let id of currentUnreadIDs) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.downloadMessages = async messages => messages;

  let olderUnreadIDs = Array.from({ length: 103 }, (_, index) => `older-${index}`);
  let folderIDs = [...currentUnreadIDs, ...olderUnreadIDs, ...Array.from({ length: 22 }, (_, index) => `read-${index}`)];
  let unreadFindItemCalls = 0;
  let fallbackOffsets: number[] = [];
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      // Реальный проблемный сервер возвращает больше MaxEntriesReturned и
      // одновременно помечает только текущую страницу последней.
      return {
        RootFolder: {
          Items: currentUnreadIDs.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: currentUnreadIDs.length,
          TotalItemsInView: currentUnreadIDs.length,
        },
      };
    }
    if (request.action == "FindItem") {
      let offset = request.Body.Paging.Offset;
      fallbackOffsets.push(offset);
      let page = folderIDs.slice(offset, offset + (offset == 0 ? currentUnreadIDs.length : kMaxFetchCount));
      return {
        RootFolder: {
          Items: page.map(id => ({
            ItemId: { Id: id },
            IsRead: !olderUnreadIDs.includes(id) && !currentUnreadIDs.includes(id),
          })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: folderIDs.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-03T10:00:00Z",
          DateTimeReceived: "2026-10-03T10:00:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  // The malformed first AQS page is checked with both boolean spellings and
  // from both ends before the ordinary-folder fallback is started.
  expect(unreadFindItemCalls).toBe(3);
  expect(fallbackOffsets).toEqual([0, 122, 172, 222]);
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(225);
  expect(get(mailSyncing)).toBe(false);
});

test("начинает shared fallback unread с последних писем", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 1);
  let cached = folder.newEMail();
  cached.itemID = "cached-read";
  cached.isRead = true;
  folder.messages.add(cached);

  let fallbackBasePoints: string[] = [];
  mainAccount.callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "today-read" }, IsRead: true }],
          IncludesLastItemInRange: true,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "FindItem") {
      fallbackBasePoints.push(request.Body.Paging.BasePoint);
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "friday-unread" }, IsRead: false }],
          IncludesLastItemInRange: true,
          IndexedPagingOffset: 1,
          TotalItemsInView: 12_867,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "friday-unread" },
          InternetMessageId: "<friday-unread@example.test>",
          Subject: "Непрочитанное письмо за пятницу",
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(fallbackBasePoints).toEqual(["End"]);
  expect(folder.getEmailByItemID("friday-unread")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(1);
});

test("продолжает shared fallback через прочитанную первую страницу до старых unread", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 103;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 103);
  folder.downloadMessages = async messages => messages;

  let olderUnreadIDs = Array.from({ length: 103 }, (_, index) => `friday-unread-${index}`);
  let folderIDs = [
    ...Array.from({ length: kMaxFetchCount }, (_, index) => `today-read-${index}`),
    ...olderUnreadIDs,
  ];
  let fallbackOffsets: number[] = [];
  mainAccount.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 103 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "today-read" }, IsRead: true }],
          IncludesLastItemInRange: true,
          TotalItemsInView: 1,
        },
      };
    }
    if (request.action == "FindItem") {
      let offset = request.Body.Paging.Offset;
      let page = folderIDs.slice(offset, offset + kMaxFetchCount);
      fallbackOffsets.push(offset);
      return {
        RootFolder: {
          Items: page.map(id => ({
            ItemId: { Id: id },
            IsRead: !olderUnreadIDs.includes(id),
          })),
          IncludesLastItemInRange: offset + page.length >= folderIDs.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: folderIDs.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(fallbackOffsets).toContain(0);
  expect(fallbackOffsets).toContain(kMaxFetchCount);
  expect(folder.getEmailByItemID("friday-unread-0")).toBeDefined();
  expect(folder.getEmailByItemID("friday-unread-102")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(103);
});

test("перепроверяет shared fallback от начала, если BasePoint=End отдаёт только текущие unread", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let mainAccount = new OWAAccount();
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = mainAccount;
  account.username = "integrators@example.test";
  account.emailAddress = account.username;

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 103;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 103);
  folder.downloadMessages = async messages => messages;

  let currentUnreadIDs = Array.from({ length: 39 }, (_, index) => `today-unread-${index}`);
  for (let id of currentUnreadIDs) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  let olderUnreadIDs = Array.from({ length: 64 }, (_, index) => `friday-unread-${index}`);
  let fallbackBasePoints: string[] = [];
  mainAccount.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 12_867, UnreadCount: 103 }] };
    }
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      return {
        RootFolder: {
          Items: currentUnreadIDs.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: currentUnreadIDs.length,
          TotalItemsInView: currentUnreadIDs.length,
        },
      };
    }
    if (request.action == "FindItem") {
      let fromEnd = request.Body.Paging.BasePoint == "End";
      fallbackBasePoints.push(request.Body.Paging.BasePoint);
      let ids = fromEnd ? currentUnreadIDs : [...currentUnreadIDs, ...olderUnreadIDs];
      let offset = request.Body.Paging.Offset;
      let page = ids.slice(offset, offset + kMaxFetchCount);
      return {
        RootFolder: {
          Items: page.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: offset + page.length >= ids.length,
          IndexedPagingOffset: offset + page.length,
          TotalItemsInView: ids.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(fallbackBasePoints[0]).toBe("End");
  expect(fallbackBasePoints.slice(1).every(basePoint => basePoint == "Beginning")).toBe(true);
  expect(folder.getEmailByItemID("friday-unread-0")).toBeDefined();
  expect(folder.getEmailByItemID("friday-unread-63")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(103);
});

test("получает старые unread из конца AQS-выборки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  folder.countTotal = 12_867;
  folder.countUnread = 3;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_867, 3);

  let currentUnreadIDs = ["today-unread"];
  let olderUnreadIDs = ["friday-unread-1", "friday-unread-2"];
  let unreadQueryBasePoints: string[] = [];
  for (let id of currentUnreadIDs) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = false;
    folder.messages.add(message);
  }
  folder.downloadMessages = async messages => messages;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      let fromEnd = request.Body.Paging.BasePoint == "End";
      unreadQueryBasePoints.push(request.Body.Paging.BasePoint);
      let ids = fromEnd ? olderUnreadIDs : currentUnreadIDs;
      return {
        RootFolder: {
          Items: ids.map(id => ({ ItemId: { Id: id }, IsRead: false })),
          IncludesLastItemInRange: true,
          IndexedPagingOffset: ids.length,
          TotalItemsInView: ids.length,
        },
      };
    }
    if (request.action == "GetItem") {
      return {
        Items: request.Body.ItemIds.map((item: any) => ({
          ItemId: { Id: item.Id },
          InternetMessageId: `<${item.Id}@example.test>`,
          Subject: item.Id,
          DateTimeSent: "2026-10-02T21:09:00Z",
          DateTimeReceived: "2026-10-02T21:09:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        })),
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await folder.syncUnreadMessages();

  expect(unreadQueryBasePoints).toEqual(["Beginning", "Beginning", "End"]);
  expect(folder.getEmailByItemID("friday-unread-1")).toBeDefined();
  expect(folder.getEmailByItemID("friday-unread-2")).toBeDefined();
  expect([...folder.messages].filter(message => !message.isRead)).toHaveLength(3);
  expect(get(mailSyncing)).toBe(false);
});

test("не запускает общий проход при одном только расхождении unread-кеша", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-folder";
  folder.countTotal = 12_345;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_345, 1);
  let cached = folder.newEMail();
  cached.itemID = "cached-read";
  cached.isRead = true;
  folder.messages.add(cached);
  folder.dirty = false;

  let generalSyncCalls = 0;
  let unreadSyncCalls = 0;
  folder.syncRecentArrivals = async () => {
    generalSyncCalls++;
    return new ArrayColl<OWAEMail>();
  };
  (folder as any).syncUnreadMessagesIfNeeded = async () => {
    unreadSyncCalls++;
    return new ArrayColl<OWAEMail>();
  };
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("GetFolder");
    return { Folders: [{ TotalCount: 12_345, UnreadCount: 1 }] };
  };

  await folder.refreshOpenFolder();
  folder.dirty = true;
  await folder.refreshOpenFolder();

  expect(generalSyncCalls).toBe(0);
  expect(unreadSyncCalls).toBe(2);
});

test("останавливает unread-поиск, если OWA проигнорировал AQS-фильтр", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-folder";
  folder.countTotal = 12_345;
  folder.countUnread = 1;
  (folder as any).haveReadFolder = true;
  folder.applyServerCounts(12_345, 1);
  folder.dirty = false;

  let unreadFindItemCalls = 0;
  let downloadCalls = 0;
  folder.downloadMessages = async messages => {
    downloadCalls++;
    return messages;
  };
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem" && isUnreadQuery(request.Body.QueryString)) {
      unreadFindItemCalls++;
      return {
        RootFolder: {
          Items: Array.from({ length: kMaxFetchCount }, (_, index) => ({
            ItemId: { Id: `read-${index}` },
            IsRead: true,
          })),
          IncludesLastItemInRange: false,
          IndexedPagingOffset: kMaxFetchCount,
          TotalItemsInView: 12_345,
        },
      };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  await (folder as any).syncUnreadMessagesIfNeeded();

  expect(unreadFindItemCalls).toBe(1);
  expect(folder.messages.length).toBe(0);
  expect(downloadCalls).toBe(0);
  expect(folder.dirty).toBe(true);
});

test("останавливает полный FindItem, если Exchange бесконечно повторяет одну страницу", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 100;

  let cachedIDs = Array.from({ length: 50 }, (_, index) => "cached-" + index);
  for (let id of [...cachedIDs, "must-not-be-deleted"]) {
    let message = folder.newEMail();
    message.itemID = id;
    message.isRead = true;
    folder.messages.add(message);
  }

  let findItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    findItemCalls++;
    return {
      RootFolder: {
        Items: cachedIDs.map(Id => ({ ItemId: { Id }, IsRead: true })),
        IncludesLastItemInRange: false,
      },
    };
  };

  await folder.listMessages(false, true);

  expect(findItemCalls).toBe(2);
  expect(folder.messages.length).toBe(51);
  expect(folder.getEmailByItemID("must-not-be-deleted")).toBeDefined();
  expect(folder.dirty).toBe(true);
});

test("не зацикливает FindItem при обновлении флагов вложений", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  let cached = folder.newEMail();
  cached.itemID = "missing-cached-message";
  cached.isRead = true;
  folder.messages.add(cached);

  let findItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    findItemCalls++;
    return {
      RootFolder: {
        Items: [{ ItemId: { Id: "server-message" }, IsRead: true }],
        IncludesLastItemInRange: false,
      },
    };
  };

  await folder.syncHasAttachmentFlags();

  expect(findItemCalls).toBe(2);
  expect((folder as any).attachmentFlagsSynced).toBe(false);
  await folder.syncHasAttachmentFlags();
  expect(findItemCalls).toBe(2);
  (folder as any).nextAttachmentFlagsSyncAt = 0;
  await folder.syncHasAttachmentFlags();
  expect(findItemCalls).toBe(4);
});

test("долгое обновление флагов вложений не блокирует свежие письма открытой папки", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-errors";
  folder.countTotal = 1;
  (folder as any).haveReadFolder = true;
  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);

  let scanStarted!: () => void;
  let scanning = new Promise<void>(resolve => { scanStarted = resolve; });
  let releaseScan!: () => void;
  let blockedScan = new Promise<void>(resolve => { releaseScan = resolve; });
  let findCalls = 0;
  account.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      if (++findCalls == 1) {
        scanStarted();
        await blockedScan;
      }
      return { RootFolder: { Items: [{ ItemId: { Id: "cached-message" }, IsRead: true }],
        IncludesLastItemInRange: true, TotalItemsInView: 1 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let attachmentScan = folder.syncHasAttachmentFlags();
  await scanning;
  let recentFinished = false;
  let recent = folder.listMessages(true, true).then(() => { recentFinished = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(recentFinished).toBe(true);
  } finally {
    releaseScan();
    await Promise.all([attachmentScan, recent]);
  }
});

test("не сканирует десять тысяч писем целиком при догоне свежих непрочитанных", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.mainAccount = new OWAAccount();
  let folder = account.newFolder();
  folder.id = "large-errors";
  (folder as any).haveReadFolder = true;
  folder.downloadMessages = async messages => messages;
  folder.getNewMessageHeaders = async () => new ArrayColl();

  let fullPages = 0;
  account.callOWA = async (request: any) => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 9_743, UnreadCount: 11 }] };
    }
    if (request.action == "FindItem") {
      if (request.Body.Paging.BasePoint == "Beginning" && !request.Body.SortOrder) {
        fullPages++;
      }
      return { RootFolder: { Items: Array.from({ length: 50 }, (_, index) => ({
        ItemId: { Id: `old-${request.Body.Paging.Offset + index}` }, IsRead: true,
      })), IncludesLastItemInRange: false, TotalItemsInView: 9_743 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  // Свежий рост unread запускает окно догона, но большой папке хватает
  // быстрых страниц: непрочитанные могут лежать за их пределами.
  folder.applyServerCounts(9_743, 11);

  await folder.syncRecentArrivals();

  expect(fullPages).toBe(0);
  expect(folder.messages.length).toBeLessThanOrEqual(100);
  expect(folder.countUnread).toBe(11);
});

test("заканчивает обновление флагов после обработки всех закешированных писем", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-errors";
  folder.name = "Ошибки серверов";
  let cached = folder.newEMail();
  cached.itemID = "cached-message";
  cached.isRead = true;
  folder.messages.add(cached);

  let findItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    expect(request.action).toBe("FindItem");
    findItemCalls++;
    return {
      RootFolder: {
        Items: [{ ItemId: { Id: "cached-message" }, IsRead: true, HasAttachments: true }],
        IncludesLastItemInRange: false,
        TotalItemsInView: 9_743,
      },
    };
  };

  await folder.syncHasAttachmentFlags();

  expect(findItemCalls).toBe(1);
  expect((folder as any).attachmentFlagsSynced).toBe(true);
});

test("ограничивает полный FindItem, если сервер бесконечно выдаёт новые страницы", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "large-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 500;

  let cached = folder.newEMail();
  cached.itemID = "must-not-be-deleted";
  cached.isRead = true;
  folder.messages.add(cached);

  let findItemCalls = 0;
  (account as any).callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      findItemCalls++;
      return {
        RootFolder: {
          Items: [{ ItemId: { Id: "new-" + findItemCalls }, IsRead: true }],
          IncludesLastItemInRange: false,
        },
      };
    }
    if (request.action == "GetItem") {
      return { Items: [] };
    }
    throw new Error("Неожиданный запрос OWA: " + request.action);
  };

  await folder.listMessages(false, true);

  // Динамический кап: размер папки (500) / 50 страниц + запас.
  expect(findItemCalls).toBe(14);
  expect(folder.messages.length).toBe(1);
  expect(folder.getEmailByItemID("must-not-be-deleted")).toBeDefined();
  expect(folder.dirty).toBe(true);
});
