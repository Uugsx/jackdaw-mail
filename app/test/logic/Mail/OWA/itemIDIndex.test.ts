import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { expect, test } from "vitest";

function fakeFolder() {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = {
    readFolderHierarchy: async () => void 0,
    saveFolder: async () => void 0,
    deleteFolder: async () => void 0,
  } as any;
  let folder = account.newFolder();
  folder.id = "inbox";
  return folder;
}

function mail(folder: ReturnType<typeof fakeFolder>, itemID: string) {
  let message = folder.newEMail();
  message.itemID = itemID;
  return message;
}

test("находит письмо по itemID и видит добавление и удаление", () => {
  let folder = fakeFolder();
  let first = mail(folder, "a");
  folder.messages.addAll([first]);
  expect(folder.getEmailByItemID("a")).toBe(first);
  expect(folder.getEmailByItemID("b")).toBeUndefined();

  let second = mail(folder, "b");
  folder.messages.add(second);
  expect(folder.getEmailByItemID("b")).toBe(second);

  folder.messages.remove(first);
  expect(folder.getEmailByItemID("a")).toBeUndefined();
});

test("учитывает смену itemID у письма из папки", () => {
  let folder = fakeFolder();
  let message = mail(folder, "old");
  let empty = mail(folder, "");
  folder.messages.addAll([message, empty]);
  expect(folder.getEmailByItemID("old")).toBe(message);

  message.itemID = "new";
  expect(folder.getEmailByItemID("old")).toBeUndefined();
  expect(folder.getEmailByItemID("new")).toBe(message);

  empty.itemID = "later";
  expect(folder.getEmailByItemID("later")).toBe(empty);
});

test("не находит письмо, которое ещё не добавлено в папку", () => {
  let folder = fakeFolder();
  folder.messages.addAll([mail(folder, "a")]);
  expect(folder.getEmailByItemID("a")).toBeDefined();
  mail(folder, "pending");
  expect(folder.getEmailByItemID("pending")).toBeUndefined();
});

test("при повторяющемся itemID возвращает первое письмо, как раньше find()", () => {
  let folder = fakeFolder();
  let first = mail(folder, "dup");
  let second = mail(folder, "dup");
  folder.messages.addAll([first, second]);
  expect(folder.getEmailByItemID("dup")).toBe(first);

  first.itemID = "moved";
  expect(folder.getEmailByItemID("dup")).toBe(second);
  expect(folder.getEmailByItemID("moved")).toBe(first);
});
