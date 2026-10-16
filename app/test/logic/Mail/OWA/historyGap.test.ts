import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { afterEach, expect, test } from "vitest";

const kDay = 24 * 60 * 60_000;

function makeInbox(): { account: OWAAccount, folder: OWAFolder } {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.id = "account-id";
  account.username = "user@example.test";
  account.emailAddress = "user@example.test";
  (account as any).hasLoggedIn = true;
  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  account.rootFolders.add(folder);
  account.folderMap.set(folder.id, folder);
  folder.downloadMessages = async (messages: any) => messages;
  return { account, folder };
}

function addCached(folder: OWAFolder, id: string, received: Date): void {
  let email = folder.newEMail();
  email.itemID = id;
  email.sent = received;
  email.received = received;
  email.isRead = true;
  folder.messages.add(email);
}

function header(id: string, received: Date): any {
  return {
    ItemId: { Id: id },
    InternetMessageId: `<${id}@example.test>`,
    Subject: id,
    DateTimeSent: received.toISOString(),
    DateTimeReceived: received.toISOString(),
    IsRead: true,
    ItemClass: "IPM.Note",
  };
}

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

test("дельта не сдвигает токен, если GetItem не вернул заголовки новых писем", async () => {
  let { account, folder } = makeInbox();
  folder.syncState = "state-old";
  let now = Date.now();
  addCached(folder, "cached", new Date(now - 18 * kDay));
  let getItemFails = true;
  let syncStates: (string | null)[] = [];
  account.callOWA = async (request: any) => {
    if (request.action == "SyncFolderItems") {
      syncStates.push(request.Body.SyncState ?? null);
      return {
        Changes: { Create: [{ Message: { ItemId: { Id: "missed" } } }] },
        SyncState: "state-new",
        IncludesLastItemInRange: true,
      };
    }
    if (request.action == "GetItem") {
      if (getItemFails) {
        throw new Error("Too many active sessions");
      }
      return { Items: [header("missed", new Date(now - 5 * kDay))] };
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 2, UnreadCount: 0 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  account.errorCallback = () => {};

  await folder.updateChangedMessages();
  expect(folder.syncState).toBe("state-old");
  expect(folder.getEmailByItemID("missed")).toBeUndefined();

  getItemFails = false;
  await folder.updateChangedMessages();
  expect(syncStates).toEqual(["state-old", "state-old"]);
  expect(folder.getEmailByItemID("missed")).toBeDefined();
  expect(folder.syncState).toBe("state-new");
});

test("дельта сдвигает токен после лимита повторов, чтобы не блокировать новую почту", async () => {
  let { account, folder } = makeInbox();
  folder.syncState = "state-old";
  addCached(folder, "cached", new Date(Date.now() - kDay));
  account.callOWA = async (request: any) => {
    if (request.action == "SyncFolderItems") {
      return {
        Changes: { Create: [{ Message: { ItemId: { Id: "broken" } } }] },
        SyncState: "state-new",
        IncludesLastItemInRange: true,
      };
    }
    if (request.action == "GetItem") {
      return { Items: [] };
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    await folder.updateChangedMessages();
    expect(folder.syncState).toBe("state-old");
  }
  await folder.updateChangedMessages();
  expect(folder.syncState).toBe("state-new");
});

test("проверка истории догружает письма между свежей страницей и старым кешем", async () => {
  let { account, folder } = makeInbox();
  let now = Date.now();
  // В кеше сегодняшние письма (их уже загрузил проход текущего дня) и письма
  // 18-дневной давности; промежуток между ними на сервере есть, локально нет.
  let server: any[] = [];
  for (let index = 0; index < 60; index++) {
    server.push(header(`today-${index}`, new Date(now - index * 60_000)));
  }
  for (let index = 0; index < 70; index++) {
    server.push(header(`gap-${index}`, new Date(now - kDay - index * 3 * 60 * 60_000)));
  }
  for (let index = 0; index < 30; index++) {
    server.push(header(`old-${index}`, new Date(now - 18 * kDay - index * 60 * 60_000)));
  }
  for (let item of server) {
    if (!String(item.ItemId.Id).startsWith("gap-")) {
      addCached(folder, item.ItemId.Id, new Date(item.DateTimeReceived));
    }
  }
  let byID = new Map(server.map(item => [item.ItemId.Id, item]));
  let findItemCalls = 0;
  account.callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      findItemCalls++;
      let offset = request.Body.Paging.Offset;
      let size = request.Body.Paging.MaxEntriesReturned;
      return {
        RootFolder: {
          Items: server.slice(offset, offset + size).map(item => ({
            ItemId: item.ItemId,
            DateTimeReceived: item.DateTimeReceived,
          })),
          IncludesLastItemInRange: offset + size >= server.length,
        },
      };
    }
    if (request.action == "GetItem") {
      let ids: string[] = request.Body.ItemIds.map((itemId: any) => itemId.Id);
      return { Items: ids.map(id => byID.get(id)) };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  let found = await folder.verifyRecentHistory(true);
  expect(found.length).toBe(70);
  for (let index = 0; index < 70; index++) {
    expect(folder.getEmailByItemID(`gap-${index}`)?.isNewArrived).toBe(false);
  }
  let verifiedUntil = folder.toExtraJSON().historyVerifiedUntil;
  expect(verifiedUntil).toBeGreaterThanOrEqual(now);

  // Следующая проверка идёт только до сохранённой границы с часовым запасом:
  // 60 писем за последний час занимают две страницы, третья уже целиком старше.
  findItemCalls = 0;
  let again = await folder.verifyRecentHistory(true);
  expect(again.length).toBe(0);
  expect(findItemCalls).toBe(3);
});

test("граница проверенной истории переживает перезапуск через JSON папки", () => {
  let { folder } = makeInbox();
  folder.fromExtraJSON({ historyVerifiedUntil: 1_790_000_000_000 });
  expect(folder.toExtraJSON().historyVerifiedUntil).toBe(1_790_000_000_000);
  folder.fromExtraJSON({ historyVerifiedUntil: "мусор" });
  expect(folder.toExtraJSON().historyVerifiedUntil).toBeUndefined();
});
