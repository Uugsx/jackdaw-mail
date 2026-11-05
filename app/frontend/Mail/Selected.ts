import type { MailAccount } from "../../logic/Mail/MailAccount";
import type { Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import { QuickSearchEMail } from "../../logic/Mail/Store/QuickSearchEMail";
import { SearchView } from "./LeftPane/SearchSwitcher.svelte";
import { ArrayColl, type Collection } from "svelte-collections";
import { writable, type Writable } from "svelte/store";

export const selectedAccount = writable<MailAccount>();
export const selectedFolder = writable<Folder>();
export const selectedMessage = writable<EMail>();

/** Selection to restore when leaving a message opened from a file/attachment (e.g. nested .eml). */
export const selectionToRestore = writable<{ account: MailAccount, folder: Folder, message: EMail } | null>(null);

/** Message whose correspondent should be opened when switching to Mail Chat. */
export const mailChatEntryMessage = writable<EMail | null>(null);

/** Never allow null — FastList/drag/ribbon all call `.contains` on this collection. */
function writableArrayColl<T>(): Writable<ArrayColl<T>> {
  const inner = writable(new ArrayColl<T>());
  return {
    subscribe: inner.subscribe,
    set(value: ArrayColl<T>) {
      inner.set(value ?? new ArrayColl<T>());
    },
    update(fn) {
      inner.update(v => fn(v ?? new ArrayColl<T>()) ?? new ArrayColl<T>());
    },
  };
}

export const selectedMessages = writableArrayColl<EMail>();
export const selectedSearchTab = writable<SearchView>(SearchView.Folder);

/** Messages currently shown in the list (after filters). Used for Ctrl/Cmd+A outside FastList. */
export const listVisibleMessages = writable<Collection<EMail> | null>(null);

/** True while the open folder is fetching new messages from the server.
 * Existing rows stay interactive during this background refresh. */
export const folderSyncing = writable(false);

/** Folder IDs with an active mail fetch shown in the folder list. */
export const folderFetchBusy = writable<Set<string>>(new Set());

export function setFolderFetchBusy(folder: Folder | null | undefined, isBusy: boolean) {
  let folderID = folder?.id;
  if (!folderID) {
    return;
  }
  folderFetchBusy.update(ids => {
    if (isBusy === ids.has(folderID)) {
      return ids;
    }
    let next = new Set(ids);
    if (isBusy) {
      next.add(folderID);
    } else {
      next.delete(folderID);
    }
    return next;
  });
}

/** The current quick search criteria that filter the message list.
 * Allows to restore the view after coming back. */
export const quickSearch = new QuickSearchEMail();
