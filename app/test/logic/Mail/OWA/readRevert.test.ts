import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

test("подтверждённое локальное чтение не откатывается устаревшей страницей FindItem", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();

  let folder = account.newFolder();
  folder.id = "shared-errors";
  folder.name = "Ошибки серверов";
  (folder as any).haveReadFolder = true;
  folder.countTotal = 100;
  folder.countUnread = 24;

  let messages = Array.from({ length: 24 }, (_, index) => {
    let message = folder.newEMail();
    message.itemID = `msg-${index}`;
    message.sent = new Date(2026, 9, 1, 15, index);
    message.isRead = false;
    folder.messages.add(message);
    return message;
  });
  folder.downloadMessages = async (m: any) => m;

  account.callOWA = async (request: any) => {
    if (request.action == "UpdateItem") {
      return { ResponseMessages: { Items: request.Body.ItemChanges.map(() => ({
        ResponseClass: "Success", ResponseCode: "NoError",
      })) } };
    }
    if (request.action == "GetItem") {
      // Транзакционный GetItem подтверждает прочтение (снимает pending-щит).
      return { Items: request.Body.ItemIds.map((item: any) => ({
        ItemId: { Id: item.Id },
        InternetMessageId: `<${item.Id}@example.test>`,
        Subject: item.Id,
        DateTimeSent: "2026-10-01T15:00:00Z",
        DateTimeReceived: "2026-10-01T15:00:00Z",
        IsRead: true,
        ItemClass: "IPM.Note",
      })) };
    }
    if (request.action == "GetFolder") {
      // Счётчик папки тоже отстаёт: Exchange ещё говорит 24.
      return { Folders: [{ TotalCount: 100, UnreadCount: 24 }] };
    }
    if (request.action == "FindItem") {
      // Поисковый индекс отстаёт: та же страница всё ещё IsRead:false.
      return { RootFolder: { Items: messages.map(message => ({
        ItemId: { Id: message.itemID }, IsRead: false,
      })), IncludesLastItemInRange: true, TotalItemsInView: 100 } };
    }
    throw new Error(`Неожиданный запрос OWA: ${request.action}`);
  };

  // Пользователь отмечает 24 письма прочитанными.
  await folder.markMessagesRead(messages, true);
  expect(folder.countUnread).toBe(0);
  expect(messages.every(message => message.isRead)).toBe(true);

  // Транзакционный GetItem подтверждает прочтение и снимает pending-щит.
  await folder.refreshMessages(messages.map(message => message.itemID));
  expect(messages.every(message => message.isRead)).toBe(true);
  expect(folder.countUnread).toBe(0);

  // Фоновый опрос приносит устаревшую страницу FindItem (IsRead:false).
  await folder.listMessages(true, true);

  expect(messages.every(message => message.isRead)).toBe(true);
  expect(folder.countUnread).toBe(0);
});
