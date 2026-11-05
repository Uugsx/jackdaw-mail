import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";

function newTrash(mailCount: number, serverTotal: number) {
  void appGlobal;
  let account = new EWSAccount();
  account.storage = new DummyMailStorage();
  let trash = account.newFolder();
  trash.id = "trash-id";
  trash.specialFolder = SpecialFolder.Trash;
  for (let index = 0; index < mailCount; index++) {
    let message = trash.newEMail();
    message.itemID = `item-${index}`;
    trash.messages.add(message);
  }
  trash.countTotal = serverTotal;
  let requests: any[] = [];
  (account as any).callEWS = async (request: any) => {
    requests.push(request);
    if (request.m$DeleteItem) {
      return request.m$DeleteItem.m$ItemIds.t$ItemId.map(() => ({ ResponseClass: "Success" }));
    }
    return { ResponseClass: "Success" };
  };
  return { account, trash, requests };
}

test("EWS: встречи и контакты в корзине удаляются через EmptyFolder", async () => {
  let { trash, requests } = newTrash(2, 4);

  await trash.clearFolder();

  expect(requests.map(request => Object.keys(request)[0])).toEqual(["m$DeleteItem", "m$EmptyFolder"]);
  let empty = requests[1].m$EmptyFolder;
  expect(empty.m$FolderIds.t$FolderId.Id).toBe("trash-id");
  expect(empty.DeleteType).toBe("HardDelete");
  expect(empty.DeleteSubFolders).toBe(false);
  expect(trash.messages.isEmpty).toBe(true);
  expect(trash.countTotal).toBe(0);
});

test("EWS: подпапки корзины удаляются на сервере и локально", async () => {
  let { account, trash, requests } = newTrash(1, 1);
  let subFolder = account.newFolder();
  subFolder.parent = trash;
  trash.subFolders.add(subFolder);

  await trash.clearFolder();

  expect(requests[1].m$EmptyFolder.DeleteSubFolders).toBe(true);
  expect(trash.subFolders.contains(subFolder)).toBe(false);
});

test("EWS: корзина только из писем обходится без EmptyFolder", async () => {
  let { trash, requests } = newTrash(3, 3);

  await trash.clearFolder();

  expect(requests.map(request => Object.keys(request)[0])).toEqual(["m$DeleteItem"]);
});

test("EWS: ошибка EmptyFolder не скрывается", async () => {
  let { account, trash } = newTrash(1, 3);
  (account as any).callEWS = async (request: any) => {
    if (request.m$EmptyFolder) {
      throw new Error("Access is denied.");
    }
    return [{ ResponseClass: "Success" }];
  };

  await expect(trash.clearFolder()).rejects.toThrow("Access is denied.");
});
