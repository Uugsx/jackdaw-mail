import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { IMAPFolder } from "../../../../logic/Mail/IMAP/IMAPFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test, vi } from "vitest";

function folderWithMessages(local: number, onServer: number) {
  appGlobal.remoteApp = { createIMAPFlowConnection: () => null };
  let account = new IMAPAccount();
  account.storage = new DummyMailStorage();
  account.hasCapability = async () => true;
  let folder = new IMAPFolder(account);
  folder.path = "Projects";
  folder.name = "Projects";
  (folder as any).haveReadFolder = true;
  folder.syncState = "100";
  for (let uid = 1; uid <= local; uid++) {
    let message = folder.newEMail();
    message.uid = uid;
    folder.messages.add(message);
  }
  folder.countTotal = local;
  (folder as any).refreshStatus = async () => {
    folder.countTotal = onServer;
  };
  let reconcile = vi.fn(async () => new ArrayColl());
  let changed = vi.fn(async () => new ArrayColl());
  (folder as any).listAllUnknownMessages = reconcile;
  (folder as any).listChangedMessages = changed;
  return { folder, reconcile, changed };
}

test("IMAP с CONDSTORE: письма удалили в другом клиенте — UID сверяются", async () => {
  let { folder, reconcile, changed } = folderWithMessages(5, 3);
  await folder.listMessages();
  expect(reconcile).toHaveBeenCalledWith(false);
  expect(changed).not.toHaveBeenCalled();
});

test("IMAP с CONDSTORE: без удалений остаётся быстрый путь changedSince", async () => {
  let { folder, reconcile, changed } = folderWithMessages(3, 4);
  await folder.listMessages();
  expect(changed).toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
});
