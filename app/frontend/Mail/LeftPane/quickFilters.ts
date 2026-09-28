import { getLocalStorage } from "../../Util/LocalStorage";
import { get, writable } from "svelte/store";
import { gt } from "../../../l10n/l10n";
import type { Folder } from "../../../logic/Mail/Folder";

/** Built-in Outlook-style quick filters / sorts for the message list. */
export type QuickFilterId =
  | "unread"
  | "starred"
  | "important"
  | "attachments"
  | "fromMe"
  | "toMe"
  | "replied"
  | "newest"
  | "oldest"
  | "bySender"
  | "bySubject";

export type MailListSort = "date-desc" | "date-asc" | "sender" | "subject";

export interface QuickFilterDef {
  id: QuickFilterId;
  kind: "filter" | "sort";
  label: () => string;
  /** Вариант сортировки для пункта меню. */
  sort?: MailListSort;
}

export const allQuickFilters: QuickFilterDef[] = [
  { id: "unread", kind: "filter", label: () => gt`Unread` },
  { id: "starred", kind: "filter", label: () => gt`Flagged` },
  { id: "important", kind: "filter", label: () => gt`Important` },
  { id: "attachments", kind: "filter", label: () => gt`Has attachments` },
  { id: "toMe", kind: "filter", label: () => gt`To me` },
  { id: "fromMe", kind: "filter", label: () => gt`From me` },
  { id: "replied", kind: "filter", label: () => gt`Replied` },
  { id: "newest", kind: "sort", label: () => gt`Newest`, sort: "date-desc" },
  { id: "oldest", kind: "sort", label: () => gt`Oldest`, sort: "date-asc" },
  { id: "bySender", kind: "sort", label: () => gt`By sender`, sort: "sender" },
  { id: "bySubject", kind: "sort", label: () => gt`By subject`, sort: "subject" },
];

const defaultSort: MailListSort = "date-desc";
const sortSetting = getLocalStorage<MailListSort>("mail.listSort", defaultSort);
const folderSortSetting = getLocalStorage<Record<string, MailListSort>>(
  "mail.listSortByFolder",
  {},
);

const validSorts = new Set<MailListSort>(["date-desc", "date-asc", "sender", "subject"]);
const initialSort = validSorts.has(sortSetting.value)
  ? sortSetting.value
  : defaultSort;
let activeFolderSortKey: string | null = null;
let syncingSort = false;

/** Reactive sort used by message lists. */
export const mailListSort = writable<MailListSort>(initialSort);
mailListSort.subscribe(sort => {
  if (syncingSort || !validSorts.has(sort)) {
    return;
  }
  if (activeFolderSortKey) {
    let saved = readFolderSorts();
    if (saved[activeFolderSortKey] !== sort) {
      folderSortSetting.value = { ...saved, [activeFolderSortKey]: sort };
    }
  } else if (sortSetting.value !== sort) {
    sortSetting.value = sort;
  }
});

function readFolderSorts(): Record<string, MailListSort> {
  let value = folderSortSetting.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, sort]) => validSorts.has(sort)),
  ) as Record<string, MailListSort>;
}

function folderSortKey(folder: Folder | null | undefined): string | null {
  if (!folder?.id) {
    return null;
  }
  let accountKey = folder.account?.id ?? folder.account?.emailAddress ?? "account";
  return `${String(accountKey)}:${folder.id}`;
}

/** Activate the sort saved for the currently visible folder. */
export function activateMailListSort(folder: Folder | null | undefined): void {
  let key = folderSortKey(folder);
  activeFolderSortKey = key;
  if (!key) {
    return;
  }
  let nextSort = readFolderSorts()[key] ?? initialSort;
  if (mailListSortValue() === nextSort) {
    return;
  }
  syncingSort = true;
  mailListSort.set(nextSort);
  syncingSort = false;
}

/** Save a sort choice for one folder without changing other folders. */
export function setMailListSort(folder: Folder | null | undefined, sort: MailListSort): void {
  if (!validSorts.has(sort)) {
    return;
  }
  activeFolderSortKey = folderSortKey(folder);
  if (activeFolderSortKey) {
    let saved = readFolderSorts();
    folderSortSetting.value = { ...saved, [activeFolderSortKey]: sort };
  }
  syncingSort = true;
  mailListSort.set(sort);
  syncingSort = false;
}

function mailListSortValue(): MailListSort {
  return get(mailListSort);
}
