import "../../../../logic/app";
import { ArrayColl } from "svelte-collections";
import { AllAccounts } from "../../../../logic/Mail/Virtual/AllAccounts";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { expect, test } from "vitest";

test("пересчитывает unread-счётчик общей папки после изменения ящика", () => {
  let accounts = new ArrayColl<MailAccount>();
  let allAccounts = new AllAccounts(accounts);

  let firstAccount = new MailAccount();
  let firstInbox = new Folder(firstAccount);
  firstInbox.specialFolder = SpecialFolder.Inbox;
  firstInbox.countUnread = 2;
  firstAccount.rootFolders.add(firstInbox);

  let secondAccount = new MailAccount();
  let secondInbox = new Folder(secondAccount);
  secondInbox.specialFolder = SpecialFolder.Inbox;
  secondInbox.countUnread = 1;
  secondAccount.rootFolders.add(secondInbox);

  accounts.add(firstAccount);
  accounts.add(secondAccount);

  let allInbox = allAccounts.getSpecialFolder(SpecialFolder.Inbox);
  expect(allInbox.countUnread).toBe(3);

  firstInbox.countUnread = 4;
  expect(allInbox.countUnread).toBe(5);

  secondInbox.countNewArrived = 2;
  expect(allInbox.countNewArrived).toBe(2);
});

function twoInboxes() {
  let accounts = new ArrayColl<MailAccount>();
  let allAccounts = new AllAccounts(accounts);
  let inboxes = [new MailAccount(), new MailAccount()].map(account => {
    let inbox = new Folder(account);
    inbox.specialFolder = SpecialFolder.Inbox;
    account.rootFolders.add(inbox);
    accounts.add(account);
    return inbox;
  });
  return { allInbox: allAccounts.getSpecialFolder(SpecialFolder.Inbox), inboxes };
}

test("«Отметить всё прочитанным» в общей папке выполняется в каждом ящике", async () => {
  let { allInbox, inboxes } = twoInboxes();
  let calls: Folder[] = [];
  for (let inbox of inboxes) {
    inbox.markAllRead = async () => {
      calls.push(inbox);
    };
  }
  await allInbox.markAllRead();
  expect(calls).toEqual(inboxes);
});

test("ошибка одного ящика не отменяет отметку в другом и показывается", async () => {
  let { allInbox, inboxes } = twoInboxes();
  let done: Folder[] = [];
  inboxes[0].markAllUnread = async () => {
    throw new Error("offline");
  };
  inboxes[1].markAllUnread = async () => {
    done.push(inboxes[1]);
  };
  await expect(allInbox.markAllUnread()).rejects.toThrow("offline");
  expect(done).toEqual([inboxes[1]]);
});

test("общую папку нельзя переименовать или удалить", () => {
  let { allInbox } = twoInboxes();
  expect(allInbox.disableRename()).toBeTruthy();
  expect(allInbox.disableDelete()).toBeTruthy();
});
