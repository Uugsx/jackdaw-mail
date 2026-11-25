import { describe, expect, test } from "vitest";
import {
  currentMailSearchAccount,
  syncSearchToCurrentMailbox,
} from "../../../frontend/Mail/Search/searchScope";
import type { Folder } from "../../../logic/Mail/Folder";
import type { MailAccount } from "../../../logic/Mail/MailAccount";

function account(id: string, protocol = "imap"): MailAccount {
  return { id, protocol } as MailAccount;
}

function folder(account: MailAccount): Folder {
  return { account } as Folder;
}

describe("область поиска почты", () => {
  test("берёт ящик из текущей папки", () => {
    let selectedAccount = account("old-account");
    let currentAccount = account("current-account");

    expect(currentMailSearchAccount(selectedAccount, folder(currentAccount)))
      .toBe(currentAccount);
  });

  test("использует выбранный ящик без текущей папки", () => {
    let selectedAccount = account("selected-account");

    expect(currentMailSearchAccount(selectedAccount, null)).toBe(selectedAccount);
  });

  test("не ограничивает поиск в объединённом представлении", () => {
    let allAccounts = account("all-accounts", "all");

    expect(currentMailSearchAccount(allAccounts, folder(allAccounts))).toBeNull();
  });

  test("перепривязывает активный поиск к новому ящику и сбрасывает папку", () => {
    let oldAccount = account("old-account");
    let newAccount = account("new-account");
    let search = {
      account: oldAccount,
      folder: folder(oldAccount),
    } as any;

    expect(syncSearchToCurrentMailbox(search, newAccount, folder(newAccount))).toBe(true);
    expect(search.account).toBe(newAccount);
    expect(search.folder).toBeNull();
  });

  test("не меняет область поиска, если ящик не изменился", () => {
    let currentAccount = account("current-account");
    let search = { account: currentAccount, folder: null } as any;

    expect(syncSearchToCurrentMailbox(search, currentAccount, null)).toBe(false);
  });

  test("фильтр «Только папка» переходит на открытую папку того же ящика", () => {
    let currentAccount = account("current-account");
    let inbox = folder(currentAccount);
    let archiveInbox = folder(currentAccount);
    let search = { account: currentAccount, folder: inbox } as any;

    expect(syncSearchToCurrentMailbox(search, currentAccount, archiveInbox)).toBe(true);
    expect(search.folder).toBe(archiveInbox);
    expect(syncSearchToCurrentMailbox(search, currentAccount, archiveInbox)).toBe(false);
  });

  test("без фильтра по папке смена папки не меняет область поиска", () => {
    let currentAccount = account("current-account");
    let search = { account: currentAccount, folder: null } as any;

    expect(syncSearchToCurrentMailbox(search, currentAccount, folder(currentAccount))).toBe(false);
    expect(search.folder).toBeNull();
  });

  test("сбрасывает ящик и папку для объединённого вида", () => {
    let oldAccount = account("old-account");
    let allAccounts = account("all-accounts", "all");
    let search = {
      account: oldAccount,
      folder: folder(oldAccount),
    } as any;

    expect(syncSearchToCurrentMailbox(search, allAccounts, folder(allAccounts))).toBe(true);
    expect(search.account).toBeNull();
    expect(search.folder).toBeNull();
  });
});
