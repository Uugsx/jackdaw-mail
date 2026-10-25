import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { expect, test } from "vitest";

/** Корзина, в которой Exchange насчитал `serverTotal` элементов, а в списке
 * писем после полной загрузки оказались только `mailIDs`: остальное —
 * встречи, контакты, задачи и заметки без IsRead. */
function newTrash(mailIDs: string[], serverTotal = mailIDs.length, specialFolder = SpecialFolder.Trash) {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.id = "trash-id";
  folder.specialFolder = specialFolder;
  folder.releaseDeletionAfterGracePeriod = () => {};
  (folder as any).haveReadFolder = true;
  folder.dirty = false;
  folder.countTotal = serverTotal;
  let listCalls = 0;
  (folder as any).listMessages = async () => {
    listCalls++;
    for (let id of mailIDs) {
      if (!folder.getEmailByItemID(id)) {
        let message = folder.newEMail();
        message.itemID = id;
        message.isRead = false;
        folder.messages.add(message);
      }
    }
    folder.countUnread = mailIDs.length;
    return folder.messages;
  };
  return { account, folder, listCalls: () => listCalls };
}

function addSubFolder(folder: any, id: string) {
  let subFolder = folder.account.newFolder();
  subFolder.id = id;
  subFolder.parent = folder;
  folder.subFolders.add(subFolder);
  return subFolder;
}

function success(request: any) {
  if (request.action == "DeleteItem") {
    return { ResponseMessages: { Items: request.Body.ItemIds.map(() => ({ ResponseClass: "Success", ResponseCode: "NoError" })) } };
  }
  return { ResponseClass: "Success", ResponseCode: "NoError" };
}

test("корзина со встречами и контактами очищается целиком через EmptyFolder", async () => {
  let { account, folder } = newTrash(["mail-1", "mail-2", "mail-3"], 5);
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return success(request);
  };

  await folder.clearFolder();

  expect(requests.map(request => request.action)).toEqual(["EmptyFolder"]);
  expect(requests[0].Body.FolderIds[0].Id).toBe("trash-id");
  expect(requests[0].Body.DeleteType).toBe("HardDelete");
  expect(requests[0].Body.DeleteSubFolders).toBe(false);
  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
  expect(folder.clearProgress).toBeNull();
  expect(folder.dirty).toBe(false);
});

test("корзина только с не-письмами: список пуст, но сервер всё равно очищается", async () => {
  let { account, folder } = newTrash([], 2);
  let actions: string[] = [];
  (account as any).callOWA = async (request: any) => {
    actions.push(request.action);
    return success(request);
  };

  await folder.clearFolder();

  expect(actions).toEqual(["EmptyFolder"]);
  expect(folder.countTotal).toBe(0);
});

test("подпапки корзины удаляются на сервере и локально", async () => {
  let { account, folder } = newTrash(["mail-1"]);
  let subFolder = addSubFolder(folder, "sub-id");
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return success(request);
  };

  await folder.clearFolder();

  expect(requests.map(request => request.action)).toEqual(["EmptyFolder"]);
  expect(requests[0].Body.DeleteSubFolders).toBe(true);
  expect(folder.subFolders.contains(subFolder)).toBe(false);
  expect(folder.messages.isEmpty).toBe(true);
});

test("подпапки спама не удаляются", async () => {
  let { account, folder } = newTrash(["mail-1"], 2, SpecialFolder.Spam);
  let subFolder = addSubFolder(folder, "sub-id");
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return success(request);
  };

  await folder.clearFolder();

  expect(requests.map(request => request.action)).toEqual(["EmptyFolder"]);
  expect(requests[0].Body.DeleteSubFolders).toBe(false);
  expect(folder.subFolders.contains(subFolder)).toBe(true);
});

test("корзина больше одной страницы: без EmptyFolder удаляется пачками до конца", async () => {
  let mailIDs = Array.from({ length: 60 }, (_, index) => `mail-${index}`);
  let otherIDs = Array.from({ length: 60 }, (_, index) => `item-${index}`);
  let { account, folder } = newTrash(mailIDs, 120);
  let subFolder = addSubFolder(folder, "sub-id");
  let onServer = [...mailIDs, ...otherIDs];
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    switch (request.action) {
    case "EmptyFolder":
      throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorInvalidRequest", MessageText: "Not supported" } });
    case "FindItem": {
      let size = request.Body.Paging.MaxEntriesReturned;
      return { RootFolder: { Items: onServer.slice(0, size).map(id => ({ ItemId: { Id: id } })), TotalItemsInView: onServer.length } };
    }
    case "DeleteItem": {
      let ids = request.Body.ItemIds.map((item: any) => item.Id);
      onServer = onServer.filter(id => !ids.includes(id));
      return success(request);
    }
    default:
      return success(request);
    }
  };

  await folder.clearFolder();

  let deletes = requests.filter(request => request.action == "DeleteItem");
  expect(deletes.map(request => request.Body.ItemIds.length)).toEqual([50, 50, 20]);
  expect(deletes[0].Body.DeleteType).toBe("HardDelete");
  expect(deletes[0].Body.SendMeetingCancellations).toBe("SendToNone");
  expect(onServer).toEqual([]);
  let deleteFolder = requests.find(request => request.action == "DeleteFolder");
  expect(deleteFolder.Body.FolderIds[0].Id).toBe("sub-id");
  expect(folder.subFolders.contains(subFolder)).toBe(false);
  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
});

test("частичный ответ сервера: понятная ошибка, локальный список не стирается", async () => {
  let { account, folder } = newTrash(["mail-1", "mail-2"], 3);
  (account as any).callOWA = async (request: any) => {
    switch (request.action) {
    case "EmptyFolder":
      throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorInvalidRequest", MessageText: "Not supported" } });
    case "FindItem":
      // Сервер принимает удаление, но элемент остаётся
      return { RootFolder: { Items: [{ ItemId: { Id: "stuck" } }] } };
    default:
      return success(request);
    }
  };

  let error = await folder.clearFolder().catch(ex => ex);

  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/HTTP/);
  expect(error.message).toMatch(/could not be cleared completely/);
  expect(folder.messages.length).toBe(2);
  expect((folder as any).deletions.has("mail-1")).toBe(false);
  expect(folder.dirty).toBe(true);
  expect(folder.clearProgress).toBeNull();
});

test("запасная очистка: «не найдено» по последнему элементу не мешает", async () => {
  let { account, folder } = newTrash(["mail-1"], 2);
  let onServer = ["mail-1", "gone"];
  (account as any).callOWA = async (request: any) => {
    switch (request.action) {
    case "EmptyFolder":
      throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorInvalidRequest", MessageText: "Not supported" } });
    case "FindItem":
      return { RootFolder: { Items: onServer.slice(0, 1).map(id => ({ ItemId: { Id: id } })) } };
    case "DeleteItem":
      onServer.shift();
      if (request.Body.ItemIds[0].Id == "gone") {
        throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "Not found" } });
      }
      return success(request);
    default:
      return success(request);
    }
  };

  await folder.clearFolder();

  expect(onServer).toEqual([]);
  expect(folder.messages.isEmpty).toBe(true);
});

test("настоящая ошибка Exchange при запасной очистке доходит до пользователя", async () => {
  let { account, folder } = newTrash(["mail-1"], 2);
  (account as any).callOWA = async (request: any) => {
    switch (request.action) {
    case "EmptyFolder":
      throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorAccessDenied", MessageText: "Access is denied." } });
    case "FindItem":
      return { RootFolder: { Items: [{ ItemId: { Id: "mail-1" } }, { ItemId: { Id: "item-1" } }] } };
    case "DeleteItem":
      return { ResponseMessages: { Items: request.Body.ItemIds.map(() => ({ ResponseClass: "Error", ResponseCode: "ErrorAccessDenied", MessageText: "Access is denied." })) } };
    default:
      return success(request);
    }
  };

  await expect(folder.clearFolder()).rejects.toBeInstanceOf(OWAError);
  expect(folder.messages.length).toBe(1);
});

test("лимит сеансов на EmptyFolder не запускает пакетное удаление", async () => {
  let { account, folder } = newTrash(["mail-1"], 2);
  let actions: string[] = [];
  (account as any).callOWA = async (request: any) => {
    actions.push(request.action);
    throw new OWAError({ json: { ResponseClass: "Error", ResponseCode: "ErrorTooManyObjectsOpened", MessageText: "Too many" } });
  };

  await expect(folder.clearFolder()).rejects.toBeInstanceOf(OWAError);
  expect(actions).toEqual(["EmptyFolder"]);
  expect(folder.messages.length).toBe(1);
});

test("общий ящик: EmptyFolder идёт в контексте этого ящика", async () => {
  let { account, folder } = newTrash(["mail-1"], 2);
  account.mainAccount = new OWAAccount();
  account.username = "shared@example.com";
  let mailboxes: any[] = [];
  (account as any).callOWA = async (request: any, mailbox: any) => {
    mailboxes.push(mailbox);
    return success(request);
  };

  await folder.clearFolder();

  expect(mailboxes).toEqual(["shared@example.com"]);
});

test("только письма на нескольких страницах: прежний пакетный DeleteItem без EmptyFolder", async () => {
  let mailIDs = Array.from({ length: 120 }, (_, index) => `mail-${index}`);
  let { account, folder, listCalls } = newTrash(mailIDs, 120);
  folder.countTotal = 120;
  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return success(request);
  };
  // Кеш неполный: полный список подгружается перед очисткой
  let cached = folder.newEMail();
  cached.itemID = "mail-0";
  folder.messages.add(cached);

  await folder.clearFolder();

  expect(listCalls()).toBe(1);
  expect(requests.map(request => request.action)).toEqual(["DeleteItem", "DeleteItem", "DeleteItem"]);
  expect(requests.map(request => request.Body.ItemIds.length)).toEqual([50, 50, 20]);
  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
});
