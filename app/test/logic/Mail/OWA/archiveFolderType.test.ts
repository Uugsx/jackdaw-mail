import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { afterEach, expect, test } from "vitest";

function makeAccount(): OWAAccount {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.id = "account-id";
  account.username = "integrators@example.test";
  account.emailAddress = "integrators@example.test";
  (account as any).hasLoggedIn = true;
  return account;
}

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

test("папки сетевого архива не становятся «Входящими» и другими особыми папками по имени", () => {
  let account = makeAccount();
  for (let name of ["входящие", "Inbox", "Удаленные", "Отправленные", "Черновики", "Нежелательная почта"]) {
    let folder = account.newFolder();
    folder.fromJSON({ FolderId: { Id: "archive-" + name }, DisplayName: name, TotalCount: 21_754 }, true);
    expect(folder.specialFolder).toBe(SpecialFolder.Normal);
    expect(folder.isArchiveMailbox).toBe(true);
  }
});

test("папки основного ящика по-прежнему распознаются по имени", () => {
  let account = makeAccount();
  let inbox = account.newFolder();
  inbox.fromJSON({ FolderId: { Id: "inbox" }, DisplayName: "Входящие" });
  expect(inbox.specialFolder).toBe(SpecialFolder.Inbox);
  let archive = account.newFolder();
  archive.fromJSON({ FolderId: { Id: "archive" }, DisplayName: "Архив" });
  expect(archive.specialFolder).toBe(SpecialFolder.Archive);
});

test("папка архива, сохранённая прежней версией как «Входящие», загружается обычной", () => {
  let account = makeAccount();
  let folder = account.newFolder();
  // Так SQLFolder.read восстанавливает строку: сначала specialUse, затем json
  folder.specialFolder = SpecialFolder.Inbox;
  folder.fromExtraJSON({ archiveMailbox: true });
  expect(folder.specialFolder).toBe(SpecialFolder.Normal);
  // Входящие самого ящика не меняются
  let inbox = account.newFolder();
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.fromExtraJSON({});
  expect(inbox.specialFolder).toBe(SpecialFolder.Inbox);
});

test("архивные «входящие» общего ящика не участвуют в уведомлениях как его Входящие", () => {
  let account = makeAccount();
  (account as any).sharedFolderRoot = "msgfolderroot";
  let archiveInbox = account.newFolder();
  archiveInbox.fromJSON({ FolderId: { Id: "archive-inbox" }, DisplayName: "входящие" }, true);
  expect(account.isNotificationFolder(archiveInbox)).toBe(false);
});

test("обновление категорий видимой страницы сохраняет письма одной транзакцией", async () => {
  let account = makeAccount();
  let batches: EMail[][] = [];
  let singleSaves = 0;
  let storage = account.storage as any;
  storage.saveMessagesMetadata = async (emails: EMail[]) => {
    batches.push([...emails]);
  };
  storage.saveMessage = async () => {
    singleSaves++;
  };
  let folder = account.newFolder();
  folder.id = "inbox";
  folder.specialFolder = SpecialFolder.Inbox;
  (folder as any).haveReadFolder = true;
  account.rootFolders.add(folder);
  account.folderMap.set(folder.id, folder);
  let ids: string[] = [];
  for (let index = 0; index < 20; index++) {
    let email = folder.newEMail();
    email.itemID = `item-${index}`;
    email.received = new Date();
    email.sent = email.received;
    folder.messages.add(email);
    ids.push(email.itemID);
  }
  account.callOWA = async (request: any) => {
    expect(request.action).toBe("GetItem");
    return {
      Items: request.Body.ItemIds.map((itemId: any) => ({
        ItemId: { Id: itemId.Id },
        InternetMessageId: `<${itemId.Id}@example.test>`,
        ItemClass: "IPM.Note",
        Subject: itemId.Id,
        IsRead: true,
        Categories: ["Клиент"],
        DateTimeReceived: new Date().toISOString(),
        DateTimeSent: new Date().toISOString(),
      })),
    };
  };

  let errors: unknown[] = [];
  account.errorCallback = ex => errors.push(ex);
  (account as any).handleBackgroundSyncError = (ex: unknown) => errors.push(ex);
  await folder.refreshMessages(ids);
  expect(errors).toEqual([]);

  expect(batches.length).toBe(1);
  expect(batches[0].length).toBe(20);
  expect(singleSaves).toBe(0);
  expect(folder.messages.contents.every(email => email.tags.contents.some(tag => tag.name == "Клиент"))).toBe(true);
});
