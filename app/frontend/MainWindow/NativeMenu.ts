import { tick } from "svelte";
import { get } from "svelte/store";
import { appGlobal } from "../../logic/app";
import {
  nativeMenuActions,
  type NativeMenuAction,
  type NativeMenuLabels,
} from "../../logic/util/nativeMenu";
import { gt, locale } from "../../l10n/l10n";
import { createNewEvent } from "../Calendar/event";
import { calendarApp } from "../Calendar/CalendarJackdawApp";
import { chatApp } from "../Chat/ChatJackdawApp";
import { contactsApp } from "../Contacts/ContactsJackdawApp";
import { newPerson, selectedPerson } from "../Contacts/Person/Selected";
import { filesApp } from "../Files/FilesJackdawApp";
import { mailApp } from "../Mail/MailJackdawApp";
import { deleteMessagesFromUI } from "../Mail/mailDeleteUndo";
import { markMessagesRead } from "../Mail/mailReadActions";
import {
  selectedAccount,
  selectedFolder,
  selectedMessage,
  selectedMessages,
} from "../Mail/Selected";
import { getLocalStorage } from "../Util/LocalStorage";
import { catchErrors } from "../Util/error";
import { reportsApp } from "../Reports/ReportsJackdawApp";
import { settingsApp } from "../Settings/Window/SettingsJackdawApp";
import { openApp } from "../AppsBar/selectedApp";

type NativeMenuAPI = {
  onNativeMenuAction?: (
    listener: (action: string) => void,
  ) => (() => void) | void;
  setNativeMenuLabels?: (labels: NativeMenuLabels) => void;
};

const nativeMenuActionValues = new Set<string>(
  Object.values(nativeMenuActions),
);

function isNativeMenuAction(action: string): action is NativeMenuAction {
  return nativeMenuActionValues.has(action);
}

/** Подписывает рендерер на действия из нативного меню настольного приложения. */
export function subscribeToNativeMenuActions(
  listener: (action: NativeMenuAction) => void,
): () => void {
  const api = (globalThis as typeof globalThis & { api?: NativeMenuAPI }).api;
  const unsubscribe = api?.onNativeMenuAction?.((action) => {
    if (isNativeMenuAction(action)) {
      listener(action);
    }
  });
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

/** Передаёт нативному меню переводы текущего языка приложения. */
export function syncNativeMenuLabels(): void {
  const api = (globalThis as typeof globalThis & { api?: NativeMenuAPI }).api;
  api?.setNativeMenuLabels?.({
    about: gt`About Jackdaw Mail`,
    services: gt`Services`,
    hide: gt`Hide Jackdaw Mail`,
    hideOthers: gt`Hide Others`,
    showAll: gt`Show All`,
    quit: gt`Quit Jackdaw Mail`,
    file: gt`File`,
    new: gt`New`,
    email: gt`Email`,
    calendarEvent: gt`Calendar event`,
    contact: gt`Contact`,
    close: gt`Close`,
    edit: gt`Edit`,
    undo: gt`Undo`,
    redo: gt`Redo`,
    cut: gt`Cut`,
    copy: gt`Copy`,
    paste: gt`Paste`,
    selectAll: gt`Select All`,
    view: gt`View`,
    mail: gt`Mail`,
    calendar: gt`Calendar`,
    contacts: gt`Contacts`,
    files: gt`Files`,
    chat: gt`Chat`,
    reports: gt`Reports`,
    search: gt`Search`,
    currentApp: gt`Current app`,
    toggleDevTools: gt`Toggle Developer Tools`,
    resetZoom: gt`Reset Zoom`,
    zoomIn: gt`Zoom In`,
    zoomOut: gt`Zoom Out`,
    fullscreen: gt`Toggle Fullscreen`,
    message: gt`Message`,
    reply: gt`Reply`,
    replyAll: gt`Reply all`,
    forward: gt`Forward`,
    markReadUnread: gt`Mark as read/unread`,
    archive: gt`Archive`,
    delete: gt`Delete`,
    tools: gt`Tools`,
    getMail: gt`Get mail`,
    settings: gt`Settings`,
    window: gt`Window`,
    minimize: gt`Minimize`,
    zoom: gt`Zoom`,
    front: gt`Bring All to Front`,
  });
}

export async function handleNativeMenuAction(
  action: NativeMenuAction,
): Promise<void> {
  switch (action) {
    case nativeMenuActions.newEmail:
      createNewEmail();
      return;
    case nativeMenuActions.newEvent:
      createNewEvent(getCalendar(), new Date(), false);
      return;
    case nativeMenuActions.newContact:
      createNewContact();
      return;
    case nativeMenuActions.openMail:
      openApp(mailApp, {});
      return;
    case nativeMenuActions.openCalendar:
      openApp(calendarApp, {});
      return;
    case nativeMenuActions.openContacts:
      openApp(contactsApp, {});
      return;
    case nativeMenuActions.openFiles:
      openApp(filesApp, {});
      return;
    case nativeMenuActions.openChat:
      openApp(chatApp, {});
      return;
    case nativeMenuActions.openReports:
      openApp(reportsApp, {});
      return;
    case nativeMenuActions.focusSearch:
      await focusSearch();
      return;
    case nativeMenuActions.searchMail:
      await openSearch(mailApp);
      return;
    case nativeMenuActions.searchCalendar:
      await openSearch(calendarApp);
      return;
    case nativeMenuActions.searchContacts:
      await openSearch(contactsApp);
      return;
    case nativeMenuActions.searchFiles:
      await openSearch(filesApp);
      return;
    case nativeMenuActions.searchChat:
      await openSearch(chatApp);
      return;
    case nativeMenuActions.reply:
      await replyToAuthor();
      return;
    case nativeMenuActions.replyAll:
      await replyToAll();
      return;
    case nativeMenuActions.forward:
      await forwardMessage();
      return;
    case nativeMenuActions.toggleRead:
      await toggleRead();
      return;
    case nativeMenuActions.archive:
      await archiveMessages();
      return;
    case nativeMenuActions.delete:
      await deleteMessages();
      return;
    case nativeMenuActions.getMail:
      await getMail();
      return;
    case nativeMenuActions.openSettings:
      openApp(settingsApp, {});
      return;
  }
}

function createNewEmail(): void {
  const account = get(selectedAccount) ?? appGlobal.emailAccounts.first;
  if (!account) {
    throw new Error(gt`Please select a mail account first`);
  }
  mailApp.writeMail(account.newEMailFrom());
}

function getCalendar() {
  return appGlobal.calendars.first;
}

function createNewContact(): void {
  const addressbook = appGlobal.addressbooks.first;
  if (!addressbook) {
    throw new Error(gt`Please set up an address book first`);
  }
  let contact = get(newPerson);
  if (!contact) {
    contact = addressbook.newPerson();
    contact.name = "";
    contact.addressbook = addressbook;
    newPerson.set(contact);
  }
  selectedPerson.set(contact);
  openApp(contactsApp, {});
}

async function openSearch(app: Parameters<typeof openApp>[0]): Promise<void> {
  openApp(app, {});
  await focusSearch();
}

async function focusSearch(): Promise<void> {
  await tick();
  const input = document.querySelector<HTMLInputElement>(
    'input[type="search"]',
  );
  if (input) {
    input.focus();
    return;
  }
  openApp(mailApp, {});
  await tick();
  document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
}

function selectedMailMessages() {
  const selected = get(selectedMessages);
  if (selected?.hasItems) {
    return selected.contents.slice();
  }
  const message = get(selectedMessage);
  return message ? [message] : [];
}

function selectedMailMessage() {
  const message = get(selectedMessage) ?? selectedMailMessages()[0];
  if (!message) {
    throw new Error(gt`Please select a message first`);
  }
  return message;
}

async function replyToAuthor(): Promise<void> {
  const message = selectedMailMessage();
  await message.loadForDisplay();
  mailApp.writeMail(message.compose.replyToAuthor());
}

async function replyToAll(): Promise<void> {
  const message = selectedMailMessage();
  await message.loadForDisplay();
  mailApp.writeMail(message.compose.replyAll());
}

async function forwardMessage(): Promise<void> {
  const message = selectedMailMessage();
  await message.loadForDisplay();
  const setting = getLocalStorage("mail.send.forward", "inline").value;
  const forward =
    setting === "attachment"
      ? await message.compose.forwardAsAttachment()
      : await message.compose.forwardInline();
  mailApp.writeMail(forward);
}

async function toggleRead(): Promise<void> {
  const messages = selectedMailMessages();
  if (!messages.length) {
    throw new Error(gt`Please select a message first`);
  }
  const isRead = !messages[0].isRead;
  await markMessagesRead(messages, isRead);
}

async function archiveMessages(): Promise<void> {
  const messages = selectedMailMessages();
  if (!messages.length) {
    throw new Error(gt`Please select a message first`);
  }
  for (const message of messages) {
    await message.moveToArchive();
  }
}

async function deleteMessages(): Promise<void> {
  const messages = selectedMailMessages();
  if (!messages.length) {
    throw new Error(gt`Please select a message first`);
  }
  await deleteMessagesFromUI(messages);
}

async function getMail(): Promise<void> {
  const folder = get(selectedFolder) ?? get(selectedAccount)?.inbox;
  if (!folder) {
    throw new Error(gt`Please select a folder first`);
  }
  const account = folder.account;
  if (!account.isLoggedIn) {
    await account.login(true);
  }
  await folder.fetchNewMailQuick();
}

export function handleNativeMenuActionWithErrors(
  action: NativeMenuAction,
): void {
  void catchErrors(() => handleNativeMenuAction(action));
}
