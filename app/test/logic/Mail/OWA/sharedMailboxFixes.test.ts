import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
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

test("OWAFolder.fromJSON распознает спецпапки по именам без DistinguishedFolderId", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");

  // Корзина (русское имя)
  let trashFolder = shared.newFolder();
  trashFolder.fromJSON({ FolderId: { Id: "folder-trash" }, DisplayName: "Удаленные", TotalCount: 5, UnreadCount: 0 });
  expect(trashFolder.specialFolder).toBe(SpecialFolder.Trash);

  // Корзина (английское имя)
  let trashEn = shared.newFolder();
  trashEn.fromJSON({ FolderId: { Id: "folder-trash-en" }, DisplayName: "Deleted Items", TotalCount: 2, UnreadCount: 0 });
  expect(trashEn.specialFolder).toBe(SpecialFolder.Trash);

  // Входящие (русское имя)
  let inboxRu = shared.newFolder();
  inboxRu.fromJSON({ FolderId: { Id: "folder-inbox-ru" }, DisplayName: "Входящие", TotalCount: 10, UnreadCount: 2 });
  expect(inboxRu.specialFolder).toBe(SpecialFolder.Inbox);

  // Отправленные
  let sentRu = shared.newFolder();
  sentRu.fromJSON({ FolderId: { Id: "folder-sent-ru" }, DisplayName: "Отправленные", TotalCount: 8, UnreadCount: 0 });
  expect(sentRu.specialFolder).toBe(SpecialFolder.Sent);

  // Черновики
  let draftsRu = shared.newFolder();
  draftsRu.fromJSON({ FolderId: { Id: "folder-drafts-ru" }, DisplayName: "Черновики", TotalCount: 1, UnreadCount: 0 });
  expect(draftsRu.specialFolder).toBe(SpecialFolder.Drafts);

  // Спам
  let spamRu = shared.newFolder();
  spamRu.fromJSON({ FolderId: { Id: "folder-spam-ru" }, DisplayName: "Нежелательная почта", TotalCount: 3, UnreadCount: 3 });
  expect(spamRu.specialFolder).toBe(SpecialFolder.Spam);
});

test("needsExplicitLogon возвращает true для мутирующих операций над shared-ящиком", () => {
  expect((OWAAccount as any).needsExplicitLogon({ action: "DeleteItem" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "UpdateItem" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "MoveItem" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "CopyItem" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "MarkAllItemsAsRead" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "MarkAsJunk" })).toBe(true);
  expect((OWAAccount as any).needsExplicitLogon({ action: "CreateItem" })).toBe(true);
});

test("shouldSyncFolderAfterCountUpdate возвращает true при изменении счетчиков без блокировки", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-subfolder";
  folder.name = "Проекты";

  // shouldBackgroundSyncBodies возвращает false для обычной подпапки
  expect(shared.shouldBackgroundSyncBodies(folder)).toBe(false);

  // Но shouldSyncFolderAfterCountUpdate возвращает true, если пришло письмо (TotalCount вырос)
  let arrived = (shared as any).shouldSyncFolderAfterCountUpdate(folder, 10, 0, 11, 1);
  expect(arrived).toBe(true);

  // И возвращает true, если письмо удалено (TotalCount уменьшился и в папке были сообщения)
  folder.messages.add(new OWAEMail(folder));
  let removed = (shared as any).shouldSyncFolderAfterCountUpdate(folder, 11, 1, 10, 0);
  expect(removed).toBe(true);
});

test("needsFullReconcile сбрасывает countTotalDecreased, если локальных писем не больше countTotal", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-subfolder";
  folder.countTotal = 5;

  (folder as any).countTotalDecreased = true;
  // Локально 3 письма (<= 5)
  folder.messages.addAll(new ArrayColl([new OWAEMail(folder), new OWAEMail(folder), new OWAEMail(folder)]));

  let needsReconcile = (folder as any).needsFullReconcile();
  expect(needsReconcile).toBe(false);
  expect((folder as any).countTotalDecreased).toBe(false);
});

test("операции deleteMessageOnServer, updateIsReadOnServer, updateFlagOnServer передают mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.specialFolder = SpecialFolder.Inbox;

  let email = new OWAEMail(folder);
  email.itemID = "item-123";

  let capturedRequests: { action: string; mailbox?: string }[] = [];
  main.callOWA = async (request: any, mailbox?: string) => {
    capturedRequests.push({ action: request.action, mailbox });
    return { ResponseMessages: { Items: [{ ResponseClass: "Success" }] } };
  };

  await (email as any).updateIsReadOnServer(true);
  expect(capturedRequests).toContainEqual({ action: "UpdateItem", mailbox: "shared@example.test" });

  capturedRequests = [];
  await (email as any).updateFlagOnServer(true);
  expect(capturedRequests).toContainEqual({ action: "UpdateItem", mailbox: "shared@example.test" });

  capturedRequests = [];
  await email.deleteMessageOnServer();
  expect(capturedRequests).toContainEqual({ action: "DeleteItem", mailbox: "shared@example.test" });
});

test("delta-sync baseline устанавливается для открытой shared-папки через явный mailbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "integrators@smartds.ru");
  let folder = shared.newFolder();
  folder.id = "folder-server-errors";
  folder.name = "Ошибки серверов";
  shared.watchedFolder = folder;
  shared.rootFolders.add(folder);
  shared.folderMap.set(folder.id, folder);

  let requests: { action: string; mailbox?: string; state: string | null }[] = [];
  main.callOWA = async (request: any, mailbox?: string) => {
    requests.push({ action: request.action, mailbox, state: request.Body?.SyncState ?? null });
    if (request.action == "SyncFolderItems") {
      return {
        Changes: {
          Create: [{ ItemId: { Id: "fresh-message" }, IsRead: false }],
        },
        SyncState: "state-1",
        IncludesLastItemInRange: true,
      };
    }
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 1 }] };
    }
    if (request.action == "GetItem") {
      return {
        Items: [{
          ItemId: { Id: "fresh-message" },
          InternetMessageId: "<fresh-message@smartds.ru>",
          Subject: "Свежая ошибка",
          DateTimeSent: "2026-10-01T09:45:00Z",
          DateTimeReceived: "2026-10-01T09:45:00Z",
          IsRead: false,
          ItemClass: "IPM.Note",
        }],
      };
    }
    if (request.action == "FindItem") {
      return { RootFolder: { Items: [], IncludesLastItemInRange: true, TotalItemsInView: 0 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };
  folder.downloadMessages = async (messages: any) => messages;

  await folder.syncRecentArrivals();

  // Baseline-токен запрошен в явном mailbox-контексте и сохранён.
  let syncRequests = requests.filter(request => request.action == "SyncFolderItems");
  expect(syncRequests.length).toBe(1);
  expect(syncRequests[0].mailbox).toBe("integrators@smartds.ru");
  expect(syncRequests[0].state).toBeNull();
  expect(folder.syncState).toBe("state-1");
  // Письмо из дельты попало в список без FindItem-проходов.
  expect(folder.getEmailByItemID("fresh-message")).toBeDefined();
  expect(folder.countUnread).toBe(1);

  // Следующий проход использует сохранённый токен и не сканирует папку.
  requests = [];
  await folder.syncRecentArrivals();
  syncRequests = requests.filter(request => request.action == "SyncFolderItems");
  expect(syncRequests.length).toBe(1);
  expect(syncRequests[0].state).toBe("state-1");
});

test("новые непрочитанные строки поднимают бейдж, но никогда не опускают", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-inbox";
  folder.countTotal = 3;
  folder.countUnread = 0;
  (folder as any).haveReadFolder = true;

  folder.newEMail().itemID = "";

  let arrived = folder.newEMail();
  arrived.itemID = "arrived-1";
  arrived.isRead = false;
  folder.addMessagesIfAbsent([arrived]);

  // GetFolder ещё отстал: письма видны, бейдж догоняет строки вверх.
  expect(folder.countUnread).toBe(1);

  // Бейдж от сервера больше, чем строки: локальный кеш его не занижает.
  folder.countUnread = 5;
  let another = folder.newEMail();
  another.itemID = "arrived-2";
  another.isRead = false;
  folder.addMessagesIfAbsent([another]);
  expect(folder.countUnread).toBe(5);
});

test("новое письмо на полностью прочитанной папке поднимает бейдж с нуля", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let folder = shared.newFolder();
  folder.id = "shared-errors";
  folder.applyServerCounts(11015, 0);
  (folder as any).haveReadFolder = true;

  // Все прочитано; сервер только что получил новое письмо:
  // TotalCount вырос, поэтому такой unread — новые письма, а не лаг.
  folder.applyServerCounts(11016, 1);
  expect(folder.countUnread).toBe(1);

  // Повтор устаревшего счётчика без роста Total не раздувает бейдж.
  folder.applyServerCounts(11016, 1);
  expect(folder.countUnread).toBe(1);
});
