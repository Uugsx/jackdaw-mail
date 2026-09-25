import type { EMail } from "../../logic/Mail/EMail";
import { MailAccount } from "../../logic/Mail/MailAccount";
import type { Folder } from "../../logic/Mail/Folder";
import { selectedMessage, selectedFolder, selectedAccount } from "./Selected";
import { mailApp } from "./MailJackdawApp";
import { openApp, bringAppToFront } from "../AppsBar/selectedApp";
import { appGlobal } from "../../logic/app";
import { SystemNotification, NotificationKinds } from "../Shared/SystemNotification";
import { getLocalStorage } from "../Util/LocalStorage";
import MailIcon from '../asset/icon/appBar/mail.svg?raw';
import { logError, showError } from "../Util/error";
import { CollectionObserver, type ArrayColl } from "svelte-collections";
import type { Account } from "../../logic/Abstract/Account";
import { syncMailTaskbarBadge } from "./mailUnreadCounts";
import {
  getMailAccountNotificationSetting,
  getMailNotificationSound,
  readMailAccountNotificationSettings,
} from "./mailNotificationSettings";
import {
  canNotifyMailFolder,
  getMailFolderNotificationSetting,
  getMailFolderNotificationSound,
  readMailFolderNotificationSettings,
  stopMailFolderNotificationPolling,
  syncMailFolderNotificationPolling,
} from "./mailFolderNotificationSettings";

export async function newMailListener() {
  appGlobal.emailAccounts.registerObserver(accountsObserver);
  for (let account of appGlobal.emailAccounts.contents) {
    hookMailAccount(account);
  }
}

export async function showNewMail(messages: EMail[]) {
  if (!messages?.length) {
    return;
  }

  messages = messages.filter(message => shouldNotifyMessage(message));
  if (!messages.length) {
    return;
  }

  let account = messages[0]?.folder?.account;

  // settings
  const kinds = new NotificationKinds(getLocalStorage("notifications.mail", ["popup", "sound"]).value);
  const onlyInAB = getLocalStorage("notifications.mail.only.addressbook", false).value;

  const filterConditions: ((msg: EMail) => boolean)[] = [];
  filterConditions.push(msg => msg.isNewArrived && !msg.isRead);
  if (onlyInAB) {
    filterConditions.push(msg => msg.from?.findPerson() && appGlobal.addressbooks.some(ab => ab.persons.some(person => person == msg.from.person)));
  }

  messages = messages.filter(msg => filterConditions.every(func => func(msg)));
  if (!messages?.length) {
    return;
  }
  let count = messages.length;
  messages = messages.slice(0, 5);
  let singleMsg = messages.length == 1 ? messages[0] : null;
  let firstMsg = singleMsg ?? messages[0];

  for (let msg of messages) {
    // Для уведомления достаточно заголовка. Временная ошибка тела/MIME не
    // должна скрывать уведомление о письме, которое уже пришло.
    try {
      await msg.download();
    } catch (ex) {
      logError(ex);
    }
  }
  let title = singleMsg?.subject ??
    messages.map(msg => msg.subject?.substring(0, 20) ?? "").join(", ").substring(0, 60);
  let body = singleMsg?.text ??
    messages.map(msg => msg.text?.substring(0, 30)).join(", ").substring(0, 160);

  let notification = new SystemNotification(
    kinds,
    title,
    body,
    "New Mail",
    "mail-incoming",
    firstMsg.folder
      ? getMailFolderNotificationSound(firstMsg.folder)
      : account
        ? getMailNotificationSound(account)
        : undefined,
  );
  // Which mailbox received this. With several accounts, or a shared mailbox,
  // the subject alone does not say where the mail landed.
  notification.subtitle = [senderLabel(singleMsg), mailboxLabel(firstMsg)]
    .filter(Boolean)
    .join(" · ") || null;
  notification.count = count;
  notification.icon = MailIcon;
  // Dock-бейдж должен следовать фактическому числу непрочитанных писем.
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => openMessage(firstMsg);
  notification.onReply = replyText => reply(firstMsg, replyText);
  notification.replyPlaceholder = "Reply…";
  await notification.show();
  syncMailTaskbarBadge();
}

/** Who sent it. Only for a single message - for a batch it would be a list. */
function senderLabel(msg: EMail | null): string | null {
  if (!msg) {
    return null;
  }
  let name = msg.from?.name;
  let address = msg.from?.emailAddress;
  if (name && address && name != address) {
    return `${name} <${address}>`;
  }
  return address || name || null;
}

/** The mailbox that received the mail, as the user knows it: the account name
 * they gave it, or its address when the name adds nothing. */
function mailboxLabel(msg: EMail): string | null {
  let account = msg.folder?.account;
  if (!account) {
    return null;
  }
  let address = account.emailAddress;
  let name = account.name;
  if (!name || name == address) {
    return address || null;
  }
  return address
    ? `${name} (${address})`
    : name;
}

async function openMessage(msg: EMail) {
  try {
    selectedMessage.set(msg);
    selectedFolder.set(msg.folder);
    selectedAccount.set(msg.folder?.account);
    openApp(mailApp, {
      message: msg,
      folder: msg.folder,
      account: msg.folder?.account,
    });
    bringAppToFront();
  } catch (ex) {
    console.error(ex);
  }
}

async function reply(msg: EMail, replyText: string) {
  try {
    if (!replyText?.trim()) {
      return;
    }
    let replyMsg = msg.compose.replyToAuthor();
    replyMsg.compose.insertQuickReplyPlaintext(replyText);
    await replyMsg.compose.send();
  } catch (ex) {
    showError(ex);
  }
}

class NewMessageObserver extends CollectionObserver<EMail> {
  added(messages: EMail[] | ArrayColl<EMail>) {
    // `addAll()` hands us whatever the caller passed, usually a `Collection`, which has no [0]
    showNewMail(Array.from(messages))
      .catch(logError);
  }
  removed(messages: EMail[] | ArrayColl<EMail>) {
    // do nothing
  }
}
let newMessageObserver = new NewMessageObserver();

const hookedAccounts = new WeakSet<Account>();
const accountLoginStateUnsubscribers = new WeakMap<MailAccount, () => void>();

function hookMailAccount(account: Account): void {
  if (!(account instanceof MailAccount) || hookedAccounts.has(account)) {
    return;
  }
  hookedAccounts.add(account);
  account.rootFolders.registerObserver(foldersObserver);
  observeMailFolders(account.rootFolders.contents);
  for (let folder of account.getAllFolders().contents) {
    observeMailFolders([folder]);
  }
  observeMailAccountLoginState(account);
  account.dependentAccounts().registerObserver(dependentsObserver);
  for (let dependent of account.dependentAccounts()) {
    hookMailAccount(dependent);
  }
}

class AccountsObserver extends CollectionObserver<MailAccount> {
  added(accounts: MailAccount[]) {
    for (let account of accounts) {
      hookMailAccount(account);
    }
  }
  removed(accounts: MailAccount[]) {
    for (let account of accounts) {
      account.rootFolders.unregisterObserver(foldersObserver);
      for (let folder of account.getAllFolders().contents) {
        folder.subFolders.unregisterObserver(foldersObserver);
        folder.messages.unregisterObserver(newMessageObserver);
        stopMailFolderNotificationPolling(folder);
      }
      accountLoginStateUnsubscribers.get(account)?.();
      accountLoginStateUnsubscribers.delete(account);
      hookedAccounts.delete(account);
    }
  }
}
let accountsObserver = new AccountsObserver();

class DependentsObserver extends CollectionObserver<Account> {
  added(accounts: Account[]) {
    for (let account of accounts) {
      hookMailAccount(account);
    }
  }
  removed(_accounts: Account[]) {
    // inbox observers cleaned when folders are removed
  }
}
let dependentsObserver = new DependentsObserver();

/** We know the account long before its folders: They arrive one by one,
 * first from the database, then from the server. */
class FoldersObserver extends CollectionObserver<Folder> {
  added(folders: Folder[]) {
    observeMailFolders(folders);
  }
  removed(folders: Folder[]) {
    for (let folder of folders) {
      unobserveMailFolderTree(folder);
    }
  }
}
let foldersObserver = new FoldersObserver();

function unobserveMailFolderTree(folder: Folder): void {
  for (let descendant of folder.getInclusiveDescendants()) {
    descendant.subFolders.unregisterObserver(foldersObserver);
    descendant.messages.unregisterObserver(newMessageObserver);
    stopMailFolderNotificationPolling(descendant);
  }
}

function observeMailAccountLoginState(account: MailAccount): void {
  let wasLoggedIn = account.isLoggedIn;
  let unsubscribe = account.subscribe(() => {
    let isLoggedIn = account.isLoggedIn;
    if (isLoggedIn && !wasLoggedIn) {
      for (let folder of account.getAllFolders().contents) {
        syncMailFolderNotificationPolling(folder, true);
      }
    } else if (!isLoggedIn && wasLoggedIn) {
      for (let folder of account.getAllFolders().contents) {
        stopMailFolderNotificationPolling(folder);
      }
    }
    wasLoggedIn = isLoggedIn;
  });
  accountLoginStateUnsubscribers.set(account, unsubscribe);
}

function shouldNotifyMessage(message: EMail): boolean {
  let folder = message.folder;
  if (!folder) {
    return true;
  }
  if (!canNotifyMailFolder(folder)) {
    return false;
  }
  let accountEnabled = readMailAccountNotificationSettings(
    getMailAccountNotificationSetting(folder.account).value,
  ).enabled;
  let folderEnabled = readMailFolderNotificationSettings(
    getMailFolderNotificationSetting(folder).value,
  ).enabled;
  return accountEnabled && folderEnabled;
}

function observeMailFolders(folders: Folder[]) {
  for (let folder of folders) {
    folder.subFolders.unregisterObserver(foldersObserver);
    folder.subFolders.registerObserver(foldersObserver);
    if (!canNotifyMailFolder(folder)) {
      folder.messages.unregisterObserver(newMessageObserver);
      stopMailFolderNotificationPolling(folder);
      continue;
    }
    folder.messages.unregisterObserver(newMessageObserver);
    folder.messages.registerObserver(newMessageObserver);
    syncMailFolderNotificationPolling(folder);
  }
}
