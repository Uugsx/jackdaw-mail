import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAFolder } from "../../../../logic/Mail/OWA/OWAFolder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { afterEach, expect, test } from "vitest";

function makeMainAccount(): OWAAccount {
  let main = new OWAAccount();
  main.storage = new DummyMailStorage();
  main.id = "main-id";
  main.username = "user@example.test";
  main.emailAddress = "user@example.test";
  (main as any).hasLoggedIn = true;
  return main;
}

function makeSharedAccount(main: OWAAccount, email: string): OWAAccount {
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.id = `${email}-id`;
  account.mainAccount = main;
  account.username = email;
  account.emailAddress = email;
  account.sharedFolderRoot = "msgfolderroot";
  (account as any).hasLoggedIn = true;
  return account;
}

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

test("shared mailbox использует тот же интервал polling, что и основной ящик", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let account = makeSharedAccount(main, "shared@example.test");

  (account as any).startPolling(42_000);
  expect((account as any).pollIntervalMs).toBe(42_000);
});

test("основной ящик обновляет счётчики подпапок в фоне", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let refreshCalls = 0;
  main.refreshAllFolderCounts = async () => {
    refreshCalls++;
  };

  try {
    (main as any).startSharedCountsPolling();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refreshCalls).toBeGreaterThan(0);
  } finally {
    (main as any).stopPolling();
  }
});

test("pollOneDependentSharedAccount синхронизирует dirty-папки помимо Inbox", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  let inbox = shared.newFolder();
  inbox.id = "inbox";
  inbox.specialFolder = SpecialFolder.Inbox;
  shared.rootFolders.add(inbox);
  shared.folderMap.set(inbox.id, inbox);

  let dirty = shared.newFolder();
  dirty.id = "errors";
  dirty.name = "Ошибки";
  dirty.dirty = true;
  dirty.countUnread = 2;
  shared.rootFolders.add(dirty);
  shared.folderMap.set(dirty.id, dirty);

  let synced: string[] = [];
  inbox.syncRecentArrivals = async () => {
    synced.push("inbox");
    return new ArrayColl();
  };
  dirty.getNewMessages = async () => {
    synced.push("errors");
    return new ArrayColl();
  };

  await (main as any).pollOneDependentSharedAccount(shared);

  expect(synced).toContain("inbox");
  expect(synced).toContain("errors");
});

test("после SessionLimit backoff повторно подписывается на Row-уведомления", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  appGlobal.emailAccounts.addAll([main, shared]);
  (main as any).notificationChannelReady = true;
  (main as any).sharedMailboxBlockedUntil.set("shared@example.test", Date.now() - 1);
  (main as any).sharedRowSubscriptionFailures.add(shared.id);

  let refreshCount = 0;
  main.refreshNotificationSubscriptions = async () => {
    refreshCount++;
  };
  shared.refreshAllFolderCounts = async () => {};

  (main as any).startSharedCountsPolling();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect((main as any).sharedMailboxBlockedUntil.has("shared@example.test")).toBe(false);
  expect((main as any).sharedRowSubscriptionFailures.has(shared.id)).toBe(false);
  expect(refreshCount).toBeGreaterThan(0);

  (main as any).stopPolling();
});

test("Row-подписка для открытой shared-папки использует delegateAnchor", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = makeMainAccount();
  let shared = makeSharedAccount(main, "shared@example.test");
  appGlobal.emailAccounts.addAll([main, shared]);
  (main as any).notificationChannelReady = true;

  let folder = shared.newFolder() as OWAFolder;
  folder.id = "shared-inbox";
  shared.folderMap.set(folder.id, folder);

  let anchors: string[] = [];
  main.callOWA = async (_request: any, _mailbox?: string, delegateAnchor?: string) => {
    if (delegateAnchor) {
      anchors.push(delegateAnchor);
    }
    return { ResponseMessages: { Items: [{ ResponseClass: "Success" }] } };
  };

  await shared.setWatchedFolder(folder);

  expect(anchors).toContain("shared@example.test");
});
