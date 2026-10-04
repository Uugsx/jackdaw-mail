import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { DeleteStrategy } from "../../../../logic/Mail/MailAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

test("очистка корзины удаляет элементы календаря без отправки отмен", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.specialFolder = SpecialFolder.Trash;
  folder.releaseDeletionAfterGracePeriod = () => {};

  let request: any;
  (account as any).callOWA = async (nextRequest: any) => {
    request = nextRequest;
    return { ResponseClass: "Success", ResponseCode: "NoError" };
  };

  let message = folder.newEMail();
  message.itemID = "calendar-item";
  folder.messages.add(message);
  folder.countTotal = 1;

  await folder.clearFolder();

  expect(request.action).toBe("DeleteItem");
  expect(request.Body.DeleteType).toBe("HardDelete");
  expect(request.Body.SendMeetingCancellations).toBe("SendToNone");
  expect(request.Body.SuppressReadReceipts).toBe(true);
  expect(folder.messages.isEmpty).toBe(true);
});

test("очистка корзины OWA удаляет письма одним пакетным запросом", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.specialFolder = SpecialFolder.Trash;
  folder.releaseDeletionAfterGracePeriod = () => {};

  let requests: any[] = [];
  let progress: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return {
      ResponseMessages: {
        Items: request.Body.ItemIds.map(() => ({
          ResponseClass: "Success",
          ResponseCode: "NoError",
        })),
      },
    };
  };

  for (let id of ["message-1", "message-2", "message-3"]) {
    let message = folder.newEMail();
    message.itemID = id;
    folder.messages.add(message);
  }
  folder.countTotal = 3;
  folder.subscribe(() => progress.push(folder.clearProgress));

  await folder.clearFolder();

  expect(requests).toHaveLength(1);
  expect(requests[0].Body.ItemIds.map((item: any) => item.Id)).toEqual([
    "message-1", "message-2", "message-3",
  ]);
  expect(requests[0].Body.DeleteType).toBe("HardDelete");
  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
  expect(progress).toContainEqual({ phase: "deleting", completed: 3, total: 3 });
});

test("очистка корзины OWA принудительно загружает полный список при неполном кеше", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.specialFolder = SpecialFolder.Trash;
  folder.releaseDeletionAfterGracePeriod = () => {};

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return {
      ResponseMessages: {
        Items: request.Body.ItemIds.map(() => ({
          ResponseClass: "Success",
          ResponseCode: "NoError",
        })),
      },
    };
  };

  let cached = folder.newEMail();
  cached.itemID = "message-1";
  folder.messages.add(cached);
  folder.countTotal = 3;
  let listMessagesArgs: any[] = [];
  (folder as any).listMessages = async (...args: any[]) => {
    listMessagesArgs.push(args);
    for (let id of ["message-2", "message-3"]) {
      let message = folder.newEMail();
      message.itemID = id;
      folder.messages.add(message);
    }
    return folder.messages;
  };

  await folder.clearFolder();

  expect(listMessagesArgs).toEqual([[false, true]]);
  expect(requests).toHaveLength(1);
  expect(requests[0].Body.ItemIds.map((item: any) => item.Id)).toEqual([
    "message-1", "message-2", "message-3",
  ]);
  expect(folder.clearProgress).toBeNull();
  expect(folder.messages.isEmpty).toBe(true);
});

test("очистка обычной OWA-папки переносит письма одной операцией", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let source = account.newFolder();
  source.id = "source-folder";
  source.specialFolder = SpecialFolder.Normal;
  let trash = account.newFolder();
  trash.id = "trash-folder";
  trash.specialFolder = SpecialFolder.Trash;
  account.rootFolders.add(source);
  account.rootFolders.add(trash);

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return { ResponseClass: "Success", ResponseCode: "NoError" };
  };

  for (let id of ["message-1", "message-2", "message-3"]) {
    let message = source.newEMail();
    message.itemID = id;
    source.messages.add(message);
  }
  source.countTotal = 3;

  await source.clearFolder();

  expect(requests).toHaveLength(1);
  expect(requests[0].action).toBe("MoveItem");
  expect(requests[0].Body.ItemIds.map((item: any) => item.Id)).toEqual([
    "message-1", "message-2", "message-3",
  ]);
  expect(requests[0].Body.ToFolderId.BaseFolderId.Id).toBe("trash-folder");
  expect(source.messages.isEmpty).toBe(true);
  expect(source.countTotal).toBe(0);
  expect(trash.countTotal).toBe(3);
});

test("удаление письма через OWA сохраняет параметр отмен встреч", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.releaseDeletionAfterGracePeriod = () => {};

  let request: any;
  (account as any).callOWA = async (nextRequest: any) => {
    request = nextRequest;
    return { ResponseClass: "Success", ResponseCode: "NoError" };
  };

  let message = folder.newEMail();
  message.itemID = "message";

  await message.deleteMessageOnServer(DeleteStrategy.MoveToTrash);

  expect(request.Body.DeleteType).toBe("MoveToDeletedItems");
  expect(request.Body.SendMeetingCancellations).toBe("SendToNone");
});

test("массовое удаление из обычной OWA-папки отправляет MoveItem пакетами", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let source = account.newFolder();
  source.id = "source-folder";
  let trash = account.newFolder();
  trash.id = "trash-folder";
  trash.specialFolder = SpecialFolder.Trash;
  account.rootFolders.addAll([source, trash]);
  source.releaseDeletionAfterGracePeriod = () => {};

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return {
      ResponseMessages: {
        Items: request.Body.ItemIds.map((item: any) => ({
          ResponseClass: "Success",
          ResponseCode: "NoError",
          Items: [{ ItemId: { Id: `trash-${item.Id}` } }],
        })),
      },
    };
  };

  let messages = Array.from({ length: 55 }, (_, index) => {
    let message = source.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    message.isNewArrived = index < 7;
    source.messages.add(message);
    return message;
  });
  source.countTotal = messages.length;
  source.countUnread = messages.length;
  source.countNewArrived = 7;
  let originalItemIDs = messages.map(message => message.itemID);
  let sourceNotifications = 0;
  let trashNotifications = 0;
  source.subscribe(() => sourceNotifications++);
  trash.subscribe(() => trashNotifications++);
  let initialSourceNotifications = sourceNotifications;
  let initialTrashNotifications = trashNotifications;

  await source.deleteMessages(new ArrayColl(messages));

  expect(requests).toHaveLength(2);
  expect(requests[0].action).toBe("MoveItem");
  expect(requests.every(request => request.Body.ItemIds.length <= 50)).toBe(true);
  expect(requests.flatMap(request => request.Body.ItemIds.map((item: any) => item.Id))).toEqual(
    originalItemIDs,
  );
  expect(source.messages.isEmpty).toBe(true);
  expect(source.countTotal).toBe(0);
  expect(source.countUnread).toBe(0);
  expect(source.countNewArrived).toBe(0);
  expect(trash.countTotal).toBe(messages.length);
  expect(trash.countUnread).toBe(messages.length);
  expect(trash.countNewArrived).toBe(7);
  expect(messages.every(message => message.folder === trash)).toBe(true);
  expect(sourceNotifications - initialSourceNotifications).toBe(2);
  expect(trashNotifications - initialTrashNotifications).toBe(2);
});

test("не возвращает устаревший unread-счётчик после пакетного удаления", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let source = account.newFolder();
  source.id = "source-folder";
  let trash = account.newFolder();
  trash.id = "trash-folder";
  trash.specialFolder = SpecialFolder.Trash;
  account.rootFolders.addAll([source, trash]);
  source.releaseDeletionAfterGracePeriod = () => {};
  (source as any).haveReadFolder = true;

  (account as any).callOWA = async (request: any) => ({
    ResponseMessages: {
      Items: request.Body.ItemIds.map((item: any) => ({
        ResponseClass: "Success",
        ResponseCode: "NoError",
        Items: [{ ItemId: { Id: `trash-${item.Id}` } }],
      })),
    },
  });

  let messages = Array.from({ length: 3 }, (_, index) => {
    let message = source.newEMail();
    message.itemID = `message-${index}`;
    message.isRead = false;
    source.messages.add(message);
    return message;
  });
  // В кеше только выбранные строки, а серверный TotalCount включает архив.
  source.countTotal = 20;
  source.countUnread = messages.length;

  await source.deleteMessages(new ArrayColl(messages));

  expect(source.countTotal).toBe(17);
  expect(source.countUnread).toBe(0);

  // Exchange ещё возвращает снимок до MoveItem. Он не должен воскресить
  // удалённые непрочитанные письма и старый TotalCount.
  source.applyServerCounts(20, messages.length);
  expect(source.countTotal).toBe(17);
  expect(source.countUnread).toBe(0);

  // Даже если между ответами пришёл уже уменьшенный TotalCount, последующий
  // запоздалый старый ответ не должен снова поднять бейдж.
  source.applyServerCounts(17, 0);
  source.applyServerCounts(20, messages.length);
  expect(source.countTotal).toBe(17);
  expect(source.countUnread).toBe(0);
});

test("массовое удаление из корзины OWA отправляет один DeleteItem", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  folder.specialFolder = SpecialFolder.Trash;
  folder.releaseDeletionAfterGracePeriod = () => {};

  let requests: any[] = [];
  (account as any).callOWA = async (request: any) => {
    requests.push(request);
    return {
      ResponseMessages: {
        Items: request.Body.ItemIds.map(() => ({
          ResponseClass: "Success",
          ResponseCode: "NoError",
        })),
      },
    };
  };

  let messages = Array.from({ length: 10 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `trash-message-${index}`;
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });
  folder.countTotal = messages.length;
  folder.countUnread = messages.length;
  let notifications = 0;
  folder.subscribe(() => notifications++);
  let initialNotifications = notifications;

  await folder.deleteMessages(new ArrayColl(messages), DeleteStrategy.DeleteImmediately);

  expect(requests).toHaveLength(1);
  expect(requests[0].action).toBe("DeleteItem");
  expect(requests[0].Body.ItemIds).toHaveLength(messages.length);
  expect(requests[0].Body.DeleteType).toBe("HardDelete");
  expect(folder.messages.isEmpty).toBe(true);
  expect(folder.countTotal).toBe(0);
  expect(folder.countUnread).toBe(0);
  expect(notifications - initialNotifications).toBe(1);
});
