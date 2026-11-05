import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";

function newTrash(count: number) {
  void appGlobal;
  let account = new EWSAccount();
  account.storage = new DummyMailStorage();
  let trash = account.newFolder();
  trash.specialFolder = SpecialFolder.Trash;
  for (let index = 0; index < count; index++) {
    let message = trash.newEMail();
    message.itemID = `item-${index}`;
    message.isRead = index % 2 == 0;
    trash.messages.add(message);
  }
  trash.countTotal = count;
  trash.countUnread = Math.floor(count / 2);
  return { account, trash };
}

test("EWS: очистка корзины идёт пакетами DeleteItem и обнуляет счётчики", async () => {
  let { account, trash } = newTrash(120);
  let requests: any[] = [];
  (account as any).callEWS = async (request: any) => {
    requests.push(request);
    return request.m$DeleteItem.m$ItemIds.t$ItemId.map(() => ({ ResponseClass: "Success" }));
  };

  await trash.clearFolder();

  expect(requests.map(request => request.m$DeleteItem.m$ItemIds.t$ItemId.length)).toEqual([50, 50, 20]);
  expect(requests[0].m$DeleteItem.DeleteType).toBe("HardDelete");
  expect(trash.messages.isEmpty).toBe(true);
  expect(trash.countTotal).toBe(0);
  expect(trash.countUnread).toBe(0);
});

test("EWS: письма, которых уже нет на сервере, убираются; настоящие ошибки остаются", async () => {
  let { account, trash } = newTrash(3);
  (account as any).callEWS = async () => [
    { ResponseClass: "Success" },
    { ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "Not found" },
    { ResponseClass: "Error", ResponseCode: "ErrorAccessDenied", MessageText: "Access denied" },
  ];

  await expect(trash.clearFolder()).rejects.toBeInstanceOf(EWSItemError);
  expect(trash.messages.contents.map((message: any) => message.itemID)).toEqual(["item-2"]);
  expect(trash.countTotal).toBe(1);
});

test("EWS: перенос не откатывается из-за письма, которого уже нет на сервере", async () => {
  let { account, trash } = newTrash(0);
  let inbox = account.newFolder();
  (account as any).callEWS = async () => [
    { ResponseClass: "Success" },
    { ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "Not found" },
  ];
  let messages = ["a", "b"].map(id => {
    let message = inbox.newEMail();
    message.itemID = id;
    inbox.messages.add(message);
    return message;
  });
  await expect((trash as any).moveOrCopyMessagesOnServer("move", { contents: messages, length: 2 }))
    .resolves.toBeUndefined();
  await expect((trash as any).moveOrCopyMessagesOnServer("copy", { contents: messages, length: 2 }))
    .rejects.toBeInstanceOf(EWSItemError);
});
