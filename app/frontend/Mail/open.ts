import { selectedAccount, selectedFolder, selectedMessage, selectedSearchTab } from "./Selected";
import type { SearchView } from "./LeftPane/SearchSwitcher.svelte";
import { mailApp } from "./MailJackdawApp";
import { goTo, openApp, selectedApp } from "../AppsBar/selectedApp";
import { appGlobal } from "../../logic/app";
import type { EMail } from "../../logic/Mail/EMail";
import type { Folder } from "../../logic/Mail/Folder";
import { URLPart } from "../Util/util";
import { assert } from "../../logic/util/util";
import { tick } from "svelte";

export async function openEMailMessage(message: EMail, tab?: SearchView) {
  assert(message.folder?.account, "no account for email");
  selectedAccount.set(message.folder?.account);
  selectedFolder.set(message.folder);
  selectedMessage.set(message);
  if (tab) {
    selectedSearchTab.set(tab);
  }

  if (appGlobal.isMobile) { // TODO unify
    goTo(URLPart`/mail/message/${message.folder.account.id}/${message.folder.id}/${message.id}/display`, {
      message: message,
      folder: message.folder,
      account: message.folder?.account,
      tab: tab,
    });
  } else {
    openApp(mailApp, {
      message: message,
      folder: message.folder,
      account: message.folder?.account,
      tab: tab,
    });
  }

  await tick();
  selectedAccount.set(message.folder?.account);
  selectedFolder.set(message.folder);
  selectedMessage.set(message);
  if (tab) {
    selectedSearchTab.set(tab);
  }
}

/** Открывает письмо отдельным полноэкранным экраном на десктопе. */
/** Показывает папку без выбранного письма */
export function openMailFolder(folder: Folder) {
  selectedAccount.set(folder.account);
  selectedFolder.set(folder);
  selectedMessage.set(null);
}

export async function openEMailMessageFullscreen(message: EMail, tab?: SearchView) {
  assert(message.folder?.account, "no account for email");
  selectedAccount.set(message.folder?.account);
  selectedFolder.set(message.folder);
  selectedMessage.set(message);
  if (tab) {
    selectedSearchTab.set(tab);
  }

  if (appGlobal.isMobile) {
    await openEMailMessage(message, tab);
    return;
  }

  selectedApp.set(mailApp);
  goTo(URLPart`/mail/message/${message.folder.account.id}/${message.folder.id}/${message.id}/display`, {
    message,
    folder: message.folder,
    account: message.folder.account,
    tab,
  });

  await tick();
  selectedAccount.set(message.folder?.account);
  selectedFolder.set(message.folder);
  selectedMessage.set(message);
  if (tab) {
    selectedSearchTab.set(tab);
  }
}

export function openComposer(mail: EMail) {
  mailApp.writeMail(mail);
}
