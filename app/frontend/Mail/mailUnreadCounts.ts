import { writable } from "svelte/store";
import { appGlobal } from "../../logic/app";
import { SpecialFolder, type Folder } from "../../logic/Mail/Folder";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import { accountInboxBadgeCount, findInboxFolder, totalUnreadFromAccounts } from "../../logic/Mail/MailUnreadBadge";
import { CollectionObserver, type ArrayColl } from "svelte-collections";
import { getLocalStorage } from "../Util/LocalStorage";
import { backgroundError } from "../Util/error";
import { gt } from "../../l10n/l10n";
import { webMail } from "../../logic/build";
import { bringAppToFront, openApp } from "../AppsBar/selectedApp";
import { openSettingsCategoryByID } from "../Settings/Window/CategoriesUtils";
import { mailApp } from "./MailJackdawApp";
import { bubbleImageURL } from "../Shared/SystemNotification";
import MailIcon from "../asset/icon/appBar/mail.svg?raw";

export { accountInboxBadgeCount, findInboxFolder } from "../../logic/Mail/MailUnreadBadge";

/** Bumped when any inbox counter changes — refreshes account-row badges. */
export const mailUnreadEpoch = writable(0);

let trackingStarted = false;
const inboxUnsubs = new Map<Folder, () => void>();
const watchedSubFolders = new WeakSet<Folder>();
const mailNotificationsSetting = getLocalStorage<string[]>("notifications.mail", ["popup", "sound"]);
const mailStatusBarSetting = getLocalStorage<boolean>("notifications.mail.statusbar", true);
let nativeMailBadgeCount: number | undefined;
let nativeBadgeRemoteApp: any;
let nativeBadgeUpdate = Promise.resolve();
let nativeStatusBarCount: number | undefined;
let nativeStatusBarRemoteApp: any;
let nativeStatusBarUpdate = Promise.resolve();
let statusBarUpdateID = 0;
const statusBarMailIcon = MailIcon
  .replace(/#000\b/g, "#FFFFFF")
  .replace(/#C5CDD6\b/g, "#FFFFFF");

function bumpMailUnreadEpoch(): void {
  mailUnreadEpoch.update(n => n + 1);
  syncMailTaskbarBadge();
  syncMailStatusBarWidget();
}

/** Keep the native Dock/taskbar badge aligned with the Mail unread count. */
export function syncMailTaskbarBadge(): void {
  let remoteApp = appGlobal.remoteApp;
  if (typeof remoteApp?.setBadgeCount != "function") {
    return;
  }

  let taskbarEnabled = (mailNotificationsSetting.value ?? []).includes("taskbar");
  if (!taskbarEnabled && nativeMailBadgeCount === undefined) {
    return;
  }
  let nextCount = taskbarEnabled ? totalMailUnreadCount() : 0;
  if (nextCount === nativeMailBadgeCount && remoteApp === nativeBadgeRemoteApp) {
    return;
  }
  nativeMailBadgeCount = nextCount;
  nativeBadgeRemoteApp = remoteApp;
  let targetRemoteApp = remoteApp;

  nativeBadgeUpdate = nativeBadgeUpdate
    .catch(() => {})
    .then(() => targetRemoteApp.setBadgeCount(nextCount))
    .catch(ex => {
      if (nativeMailBadgeCount === nextCount && nativeBadgeRemoteApp === targetRemoteApp) {
        nativeMailBadgeCount = undefined;
        nativeBadgeRemoteApp = undefined;
      }
      backgroundError(ex);
    });
}

mailNotificationsSetting.subscribe(() => syncMailTaskbarBadge());

function openMailFromStatusBar(): void {
  try {
    openApp(mailApp, {});
    bringAppToFront();
  } catch (ex) {
    backgroundError(ex);
  }
}

function composeMailFromStatusBar(): void {
  try {
    let account = appGlobal.emailAccounts.first;
    if (!account) {
      openMailFromStatusBar();
      return;
    }
    bringAppToFront();
    mailApp.writeMail(account.newEMailFrom());
  } catch (ex) {
    backgroundError(ex);
  }
}

async function fetchMailFromStatusBar(): Promise<void> {
  let results = await Promise.allSettled(
    appGlobal.emailAccounts.contents
      .filter(account => account.protocol != "all")
      .map(async account => {
        let inbox = findInboxFolder(account);
        if (!inbox) {
          return;
        }
        if (!account.isLoggedIn) {
          await account.login(true);
        }
        await inbox.fetchNewMailQuick();
        inbox.notifyObservers();
      }),
  );
  let rejected = results.find(result => result.status == "rejected");
  if (rejected?.status == "rejected") {
    backgroundError(rejected.reason as Error);
  }
}

function openMailSettingsFromStatusBar(): void {
  try {
    openSettingsCategoryByID("mail-notifications");
    bringAppToFront();
  } catch (ex) {
    backgroundError(ex);
  }
}

function disableMailStatusBarWidget(): void {
  mailStatusBarSetting.value = false;
}

function isMailStatusBarEnabled(): boolean {
  return mailStatusBarSetting.value !== false;
}

/** Поддерживает постоянный значок Mail в системной строке меню. */
export function syncMailStatusBarWidget(): void {
  let remoteApp = appGlobal.remoteApp;
  if (webMail || appGlobal.isMobile || typeof remoteApp?.setStatusBarIcon != "function") {
    return;
  }

  let enabled = isMailStatusBarEnabled();
  let targetRemoteApp = remoteApp;
  if (!enabled) {
    if (nativeStatusBarRemoteApp === targetRemoteApp && nativeStatusBarCount === undefined) {
      return;
    }
    let updateID = ++statusBarUpdateID;
    nativeStatusBarCount = undefined;
    nativeStatusBarRemoteApp = targetRemoteApp;
    if (typeof targetRemoteApp.clearStatusBarIcon != "function") {
      return;
    }
    nativeStatusBarUpdate = nativeStatusBarUpdate
      .catch(() => {})
      .then(() => {
        if (updateID !== statusBarUpdateID) {
          return;
        }
        return targetRemoteApp.clearStatusBarIcon();
      })
      .catch(ex => {
        if (updateID === statusBarUpdateID) {
          nativeStatusBarRemoteApp = undefined;
          backgroundError(ex);
        }
      });
    return;
  }

  let nextCount = totalMailUnreadCount();
  if (nextCount === nativeStatusBarCount && targetRemoteApp === nativeStatusBarRemoteApp) {
    return;
  }
  let updateID = ++statusBarUpdateID;
  nativeStatusBarCount = nextCount;
  nativeStatusBarRemoteApp = targetRemoteApp;
  nativeStatusBarUpdate = nativeStatusBarUpdate
    .catch(() => {})
    .then(async () => {
      if (updateID !== statusBarUpdateID || appGlobal.remoteApp !== targetRemoteApp ||
          !isMailStatusBarEnabled()) {
        return;
      }
      let image = await bubbleImageURL(nextCount, statusBarMailIcon);
      if (updateID !== statusBarUpdateID || appGlobal.remoteApp !== targetRemoteApp ||
          !isMailStatusBarEnabled()) {
        return;
      }
      let tooltip = nextCount
        ? gt`Jackdaw Mail — ${nextCount} unread`
        : gt`Jackdaw Mail`;
      await targetRemoteApp.setStatusBarIcon(
        image,
        tooltip,
        openMailFromStatusBar,
        {
          newMessage: composeMailFromStatusBar,
          fetchMail: fetchMailFromStatusBar,
          openSettings: openMailSettingsFromStatusBar,
          disableWidget: disableMailStatusBarWidget,
          unreadCount: nextCount,
        },
      );
    })
    .catch(ex => {
      if (updateID === statusBarUpdateID && nativeStatusBarRemoteApp === targetRemoteApp &&
          nativeStatusBarCount === nextCount) {
        nativeStatusBarCount = undefined;
        nativeStatusBarRemoteApp = undefined;
        backgroundError(ex);
      }
    });
}

mailStatusBarSetting.subscribe(() => syncMailStatusBarWidget());
appGlobal.subscribe((_app, propertyName) => {
  if (propertyName == "remoteApp") {
    syncMailStatusBarWidget();
  }
});

function trackInbox(folder: Folder | null | undefined): void {
  if (!folder || inboxUnsubs.has(folder)) {
    return;
  }
  // Любая нотификация папки может нести новый unread: часть проходов
  // публикует итог одним уведомлением без имени свойства.
  inboxUnsubs.set(folder, folder.subscribe(() => {
    bumpMailUnreadEpoch();
  }));
  bumpMailUnreadEpoch();
}

function untrackInbox(folder: Folder): void {
  inboxUnsubs.get(folder)?.();
  inboxUnsubs.delete(folder);
}

/** Inbox may live under msgfolderroot, not in rootFolders top level. */
function scanAccountInboxes(account: MailAccount): void {
  for (let folder of account.getAllFolders().contents) {
    if (folder.specialFolder === SpecialFolder.Inbox) {
      trackInbox(folder);
    }
  }
}

function watchFolderSubtree(folder: Folder): void {
  if (folder.specialFolder === SpecialFolder.Inbox) {
    trackInbox(folder);
  }
  if (!watchedSubFolders.has(folder)) {
    watchedSubFolders.add(folder);
    folder.subFolders.registerObserver(foldersObserver);
  }
  for (let child of folder.subFolders.contents) {
    watchFolderSubtree(child);
  }
}

function watchAccountFolders(account: MailAccount): void {
  scanAccountInboxes(account);
  for (let folder of account.rootFolders.contents) {
    watchFolderSubtree(folder);
  }
}

class MailUnreadFoldersObserver extends CollectionObserver<Folder> {
  added(folders: Folder[] | ArrayColl<Folder>) {
    let accounts = new Set<MailAccount>();
    for (let folder of Array.from(folders)) {
      accounts.add(folder.account);
      watchFolderSubtree(folder);
    }
    for (let account of accounts) {
      scanAccountInboxes(account);
    }
  }
  removed(folders: Folder[] | ArrayColl<Folder>) {
    for (let folder of Array.from(folders)) {
      if (folder.specialFolder === SpecialFolder.Inbox) {
        untrackInbox(folder);
      }
    }
  }
}
const foldersObserver = new MailUnreadFoldersObserver();

class MailUnreadAccountsObserver extends CollectionObserver<MailAccount> {
  added(accounts: MailAccount[]) {
    for (let account of accounts) {
      account.rootFolders.registerObserver(foldersObserver);
      account.subscribe(() => bumpMailUnreadEpoch());
      watchAccountFolders(account);
    }
  }
  removed(accounts: MailAccount[]) {
    for (let account of accounts) {
      account.rootFolders.unregisterObserver(foldersObserver);
      for (let folder of account.getAllFolders().contents) {
        if (folder.specialFolder === SpecialFolder.Inbox) {
          untrackInbox(folder);
        }
      }
    }
  }
}
const accountsObserver = new MailUnreadAccountsObserver();

/** Subscribe to inbox counters on all mail accounts. */
export function startMailUnreadTracking(): void {
  if (trackingStarted) {
    return;
  }
  trackingStarted = true;
  appGlobal.emailAccounts.registerObserver(accountsObserver);
  for (let account of appGlobal.emailAccounts.contents) {
    account.rootFolders.registerObserver(foldersObserver);
    account.subscribe(() => bumpMailUnreadEpoch());
    watchAccountFolders(account);
  }
  syncMailTaskbarBadge();
  syncMailStatusBarWidget();
}

/** Total unread across real mail accounts (not the virtual "All accounts"). */
export function totalMailUnreadCount(): number {
  return totalUnreadFromAccounts(appGlobal.emailAccounts.contents);
}
