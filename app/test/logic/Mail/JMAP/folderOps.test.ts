import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

type Call = { method: string, args: any };

function newAccount(reply: (method: string, args: any) => any) {
  appGlobal.remoteApp = { kyCreate: () => ({}) };
  let account = new JMAPAccount();
  account.storage = new DummyMailStorage();
  (account as any).session = { accounts: {}, primaryAccounts: {} };
  Object.defineProperty(account, "accountID", { value: "acc" });
  let calls: Call[] = [];
  account.makeSingleCall = async (method: string, args: any) => {
    calls.push({ method, args });
    return reply(method, args);
  };
  return { account, calls };
}

function newFolder(account: JMAPAccount, id: string, specialFolder = SpecialFolder.Normal) {
  let folder = account.newFolder() as any;
  folder.id = id;
  folder.name = id;
  folder.specialFolder = specialFolder;
  account.rootFolders.add(folder);
  account.allFolders.set(id, folder);
  return folder;
}

test("JMAP «Отметить всё прочитанным» ставит $seen на сервере, а не только локально", async () => {
  let { account, calls } = newAccount((method, args) => {
    if (method == "Email/query") {
      return { ids: args.position == 0 ? ["e1", "e2"] : [] };
    }
    return { updated: { e1: null, e2: null } };
  });
  let folder = newFolder(account, "inbox", SpecialFolder.Inbox);
  folder.countUnread = 2;

  await folder.markAllRead();

  let query = calls.find(call => call.method == "Email/query")!;
  expect(query.args.filter).toEqual({ inMailbox: "inbox", notKeyword: "$seen" });
  let set = calls.find(call => call.method == "Email/set")!;
  expect(set.args.update).toEqual({ e1: { "keywords/$seen": true }, e2: { "keywords/$seen": true } });
  expect(folder.countUnread).toBe(0);
});

test("JMAP: отказ сервера при «Отметить всё» не меняет локальные флаги", async () => {
  let { account } = newAccount(method => method == "Email/query"
    ? { ids: ["e1"] }
    : { notUpdated: { e1: { type: "forbidden", description: "read-only" } } });
  let folder = newFolder(account, "shared");
  folder.countUnread = 1;

  await expect(folder.markAllRead()).rejects.toThrow();
  expect(folder.countUnread).toBe(1);
});

test("JMAP: письмо, которое сервер отказался переносить, не удаляется локально", async () => {
  let { account } = newAccount(() => ({ notUpdated: { e1: { type: "forbidden" } } }));
  let source = newFolder(account, "readonly");
  let target = newFolder(account, "target");
  let message = source.newEMail();
  message.jmapID = "e1";
  source.messages.add(message);
  let deletedLocally = false;
  message.deleteMessageLocally = async () => {
    deletedLocally = true;
  };

  await expect(target.moveOrCopyMessagesOnServer("move", new ArrayColl([message]))).rejects.toThrow();
  expect(deletedLocally).toBe(false);
});

test("JMAP: удаление папки удаляет и её письма, отказ сервера показывается", async () => {
  let { account, calls } = newAccount(() => ({ notDestroyed: { box: { type: "mailboxHasEmail" } } }));
  let folder = newFolder(account, "box");

  await expect(folder.deleteItOnServer()).rejects.toThrow();
  expect(calls[0].args.onDestroyRemoveEmails).toBe(true);
});

test("JMAP: счётчики папок обновляются с сервера, а не только при запуске", async () => {
  let { account } = newAccount(() => ({
    list: [{ id: "inbox", totalEmails: 12, unreadEmails: 3 }, { id: "unknown", totalEmails: 1, unreadEmails: 1 }],
  }));
  let inbox = newFolder(account, "inbox", SpecialFolder.Inbox);
  inbox.countTotal = 10;
  inbox.countUnread = 0;

  await account.refreshFolderCounts();

  expect(inbox.countTotal).toBe(12);
  expect(inbox.countUnread).toBe(3);
});
