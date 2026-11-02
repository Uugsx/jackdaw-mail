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

/** Локально 3 строки (одна — призрак), на сервере 2 письма и счётчик совпадает с локальным. */
test("удалённое на сервере письмо пропадает, даже если счётчик не изменился", async () => {
  let deletedIDs: string[] = [];
  let account = fakeAccount(request => {
    if (request.action == "GetFolder") {
      return { Folders: [{ TotalCount: 2, UnreadCount: 0 }] };
    }
    if (request.action == "FindItem") {
      return findItemResponse(["a", "b"]);
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
  (folder as any).actionFlagsCheckedIDs = new Set(["a", "b", "ghost"]);
  (folder as any).attachmentFlagsSynced = true;
  folder.countTotal = 2;
  folder.countUnread = 0;
  for (let [id, t] of [["a", 3], ["ghost", 2], ["b", 1]] as [string, number][]) {
    let m = folder.newEMail();
    m.itemID = id;
    m.sent = new Date(2026, 7, t);
    m.isRead = true;
    folder.messages.add(m);
  }
  await folder.getNewMessages(true);
  expect(folder.messages.contents.map(m => (m as OWAEMail).itemID)).toEqual(["a", "b"]);
  expect(deletedIDs).toEqual(["ghost"]);
});

/** Равные счётчики (удалено одно, пришло другое): без периодической сверки призрак жил бы вечно. */
test("при равных счётчиках полная сверка запускается раз в полчаса", () => {
  let account = fakeAccount(() => ({}));
  let folder = account.newFolder() as any;
  folder.id = "inbox";
  folder.countTotal = 1;
  let m = folder.newEMail();
  m.itemID = "a";
  folder.messages.add(m);
  expect(folder.needsFullReconcile()).toBe(false);
  folder.lastFullListAttemptAt = Date.now() - 31 * 60 * 1000;
  expect(folder.needsFullReconcile()).toBe(true);
});
