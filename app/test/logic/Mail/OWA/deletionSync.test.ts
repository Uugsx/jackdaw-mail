import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

function fakeAccount(onRequest: (request: any) => any): OWAAccount {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).callOWA = async (request: any) => onRequest(request);
  return account;
}

function findItemResponse(itemIDs: string[]): any {
  return {
    RootFolder: {
      Items: itemIDs.map(ItemId => ({ ItemId: { Id: ItemId } })),
      IncludesLastItemInRange: true,
      TotalItemsInView: itemIDs.length,
    },
  };
}

test("полностью сверяет список после уменьшения серверного счётчика", async () => {
  let requests: string[] = [];
  let deletedIDs: string[] = [];
  let account = fakeAccount(request => {
    requests.push(request.action);
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return findItemResponse(["kept-message"]);
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  });
  account.storage.deleteMessage = async email => {
    deletedIDs.push(String((email as OWAEMail).itemID));
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  // Оставляем этот тест про сверку папки; необязательное обогащение метаданных
  // и загрузка признаков вложений проверяются отдельно.
  (folder as any).actionFlagsCheckedIDs = new Set(["kept-message", "deleted-message"]);
  (folder as any).attachmentFlagsSynced = true;
  folder.countTotal = 2;
  folder.countUnread = 0;

  let deleted = folder.newEMail();
  deleted.itemID = "deleted-message";
  deleted.sent = new Date("2026-08-27T21:00:00Z");
  deleted.isRead = true;
  let kept = folder.newEMail();
  kept.itemID = "kept-message";
  kept.sent = new Date("2026-08-27T20:00:00Z");
  kept.isRead = true;
  folder.messages.addAll([deleted, kept]);

  await folder.getNewMessages(true);

  expect(folder.messages.contents).toEqual([kept]);
  expect(deletedIDs).toEqual(["deleted-message"]);
  expect(requests).toEqual(["GetFolder", "FindItem", "FindItem"]);
});

test("удаляет устаревшую локальную копию при уже сохранённом счётчике", async () => {
  let deletedIDs: string[] = [];
  let account = fakeAccount(request => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 1, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return findItemResponse(["kept-message"]);
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  });
  account.storage.deleteMessage = async email => {
    deletedIDs.push(String((email as OWAEMail).itemID));
  };

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 1;
  folder.countUnread = 0;

  let deleted = folder.newEMail();
  deleted.itemID = "deleted-message";
  deleted.sent = new Date("2026-08-27T21:00:00Z");
  deleted.isRead = true;
  let kept = folder.newEMail();
  kept.itemID = "kept-message";
  kept.sent = new Date("2026-08-27T20:00:00Z");
  kept.isRead = true;
  folder.messages.addAll([deleted, kept]);

  await folder.getNewMessages(true);

  expect(folder.messages.contents).toEqual([kept]);
  expect(deletedIDs).toEqual(["deleted-message"]);
});

test("полная повторная синхронизация удаляет локальные письма после удаления в Outlook", async () => {
  let deletedIDs: string[] = [];
  let account = fakeAccount(request => {
    if (request.action == "FindItem") {
      return findItemResponse(["kept-message"]);
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  });
  account.storage.deleteMessage = async email => {
    deletedIDs.push(String((email as OWAEMail).itemID));
  };

  let folder = account.newFolder();
  folder.id = "errors-servers";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  (folder as any).actionFlagsCheckedIDs = new Set(["kept-message", "deleted-message"]);
  (folder as any).attachmentFlagsSynced = true;
  // Серверный счётчик в кеше ещё старый — это тот же случай, что после
  // массового удаления писем в Outlook при выключенном Jackdaw.
  folder.countTotal = 2;
  folder.countUnread = 0;

  let deleted = folder.newEMail();
  deleted.itemID = "deleted-message";
  deleted.isRead = true;
  let kept = folder.newEMail();
  kept.itemID = "kept-message";
  kept.isRead = true;
  folder.messages.addAll([deleted, kept]);

  await folder.fullResync();

  expect(folder.messages.contents).toEqual([kept]);
  expect(folder.countTotal).toBe(1);
  expect(deletedIDs).toEqual(["deleted-message"]);
});

test("синхронизирует папку с уведомлениями после уменьшения серверного счётчика", () => {
  let account = fakeAccount(() => ({}));
  let folder = account.newFolder();
  folder.id = "errors-servers";
  account.watchedFolder = folder;
  folder.countTotal = 2;
  let message = folder.newEMail();
  message.itemID = "old-message";
  folder.messages.add(message);

  expect((account as any).shouldSyncFolderAfterCountUpdate(folder, 2, 0, 1, 0)).toBe(true);
});
