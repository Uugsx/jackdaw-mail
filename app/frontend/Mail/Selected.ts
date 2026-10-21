import type { MailAccount } from "../../logic/Mail/MailAccount";
import type { Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import { QuickSearchEMail } from "../../logic/Mail/Store/QuickSearchEMail";
import { SearchView } from "./LeftPane/SearchSwitcher.svelte";
import { ArrayColl, type Collection } from "svelte-collections";
import { get, writable, type Writable } from "svelte/store";
import type { MailListRow } from "./mailListRows";

export const selectedAccount = writable<MailAccount>();
export const selectedFolder = writable<Folder>();
export const selectedMessage = writable<EMail>();

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

/** Строки списка писем в порядке на экране: сортировка, группы, фильтр, поиск. */
export const listRowsInView = writable<Collection<MailListRow> | null>(null);

/**
 * Соседнее письмо в том порядке, который видит пользователь.
 * `folder.messages` хранится в порядке загрузки, поэтому при сортировке по
 * отправителю, в поиске и в фильтре «следующее» оттуда было не тем письмом.
 * @param previous true — строка выше, false — ниже, не задано — письмо,
 *   которое встанет на место удаляемого или перемещаемого
 * @returns null, если список пуст. Стрелка у края списка оставляет то же письмо.
 */
export function neighbourMessage(message: EMail, previous?: boolean): EMail | null {
  let rows = get(listRowsInView)?.contents;
  let ordered = rows?.flatMap(row => row.kind == "message" ? [row.message] : []) ?? [];
  let i = ordered.indexOf(message);
  if (i < 0) {
    // Письмо не в видимом списке (например, внутри свёрнутого инцидента)
    return message.nextMessage(previous);
  }
  if (previous === true) {
    return ordered[i - 1] ?? message;
  }
  if (previous === false) {
    return ordered[i + 1] ?? message;
  }
  return ordered[i + 1] ?? ordered[i - 1] ?? null;
}

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
