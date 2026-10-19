import { SpecialFolder, type Folder } from "./Folder";
import type { MailAccount } from "./MailAccount";
import type { Workspace } from "../Abstract/Workspace";

/** Inbox folder for badge display — searches the full tree, not only rootFolders. */
export function findInboxFolder(account: MailAccount): Folder | null {
  return account.findFolder(folder => folder.specialFolder === SpecialFolder.Inbox)
    ?? account.inbox;
}

/** Unread count shown on an account row (0 = hide badge). */
export function accountInboxBadgeCount(
  account: MailAccount,
  selectedAccount: MailAccount | undefined,
  selectedFolder: Folder | undefined,
  inboxCounts?: { countUnread: number; countNewArrived: number },
): number {
  let unread = inboxCounts?.countUnread ?? findInboxFolder(account)?.countUnread ?? 0;
  let newArrived = inboxCounts?.countNewArrived ?? findInboxFolder(account)?.countNewArrived ?? 0;
  let count = unread || newArrived;
  if (!count) {
    return 0;
  }
  if (selectedAccount === account &&
      selectedFolder?.specialFolder === SpecialFolder.Inbox &&
      selectedFolder.account === account) {
    return 0;
  }
  return count;
}

/** Total unread across real mail accounts (not the virtual "All accounts"). */
export function totalUnreadFromAccounts(accounts: Iterable<MailAccount>): number {
  let total = 0;
  for (let account of accounts) {
    if (account.protocol === "all") {
      continue;
    }
    let inbox = findInboxFolder(account);
    if (!inbox) {
      continue;
    }
    total += inbox.countUnread;
  }
  return total;
}

/** Непрочитанные во «Входящих» одного ящика (0 — ящик без «Входящих»). */
export function inboxUnreadCount(account: MailAccount): number {
  return findInboxFolder(account)?.countUnread ?? 0;
}

/** Непрочитанные ящиков пространства; `null` — все ящики. */
export function workspaceUnreadCount(accounts: Iterable<MailAccount>, workspace: Workspace | null): number {
  let total = 0;
  for (let account of accounts) {
    if (account.protocol === "all" || (workspace && account.workspace !== workspace)) {
      continue;
    }
    total += inboxUnreadCount(account);
  }
  return total;
}

export type UnreadWorkspaceGroup = {
  /** `null` — ящики без пространства */
  workspace: Workspace | null;
  unread: number;
  accounts: { account: MailAccount; unread: number }[];
};

/** Ящики и их непрочитанные по пространствам: в порядке пространств,
 * ящики без пространства — последней группой. Пустые группы пропускаются. */
export function unreadByWorkspace(accounts: Iterable<MailAccount>, workspaces: Iterable<Workspace>): UnreadWorkspaceGroup[] {
  let mailAccounts = [...accounts].filter(account => account.protocol !== "all");
  let known = [...workspaces];
  let groups: UnreadWorkspaceGroup[] = [];
  for (let workspace of [...known, null]) {
    let members = mailAccounts.filter(account => workspace
      ? account.workspace === workspace
      : !account.workspace || !known.includes(account.workspace));
    if (!members.length) {
      continue;
    }
    let entries = members.map(account => ({ account, unread: inboxUnreadCount(account) }));
    groups.push({
      workspace,
      unread: entries.reduce((sum, entry) => sum + entry.unread, 0),
      accounts: entries,
    });
  }
  return groups;
}
