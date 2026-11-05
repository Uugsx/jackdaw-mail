import "../../../logic/app";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { expect, test, vi } from "vitest";

function accountWithInbox() {
  let account = new MailAccount();
  account.storage = new DummyMailStorage();
  let inbox = new Folder(account);
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  let saved: Folder[] = [];
  account.storage.saveFolder = vi.fn(async (folder: Folder) => {
    saved.push(folder);
  }) as any;
  return { account, inbox, saved };
}

test("«В архив»: созданная раньше папка «Archive» снова получает роль, а не создаётся заново", async () => {
  let { account, inbox, saved } = accountWithInbox();
  let existing = new Folder(account);
  existing.name = "Archive";
  existing.parent = inbox;
  inbox.subFolders.add(existing);
  inbox.createSubFolder = vi.fn();

  let archive = await account.getOrCreateArchiveFolder();

  expect(archive).toBe(existing);
  expect(inbox.createSubFolder).not.toHaveBeenCalled();
  expect(archive.specialFolder).toBe(SpecialFolder.Archive);
  expect(saved).toEqual([existing]);
});

test("«В архив»: новая папка сохраняет роль в базе", async () => {
  let { account, inbox, saved } = accountWithInbox();
  let created = new Folder(account);
  created.name = "Архив";
  inbox.createSubFolder = vi.fn(async () => created);

  let archive = await account.getOrCreateArchiveFolder();

  expect(archive).toBe(created);
  expect(archive.specialFolder).toBe(SpecialFolder.Archive);
  expect(saved).toEqual([created]);
});

test("«В архив»: папка с ролью используется как есть", async () => {
  let { account, inbox } = accountWithInbox();
  let archive = new Folder(account);
  archive.specialFolder = SpecialFolder.Archive;
  account.rootFolders.add(archive);
  inbox.createSubFolder = vi.fn();

  expect(await account.getOrCreateArchiveFolder()).toBe(archive);
  expect(inbox.createSubFolder).not.toHaveBeenCalled();
});
