import { getLocalStorage } from "../../Util/LocalStorage";
import { writable } from "svelte/store";
import { gt } from "../../../l10n/l10n";

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

const sortSetting = getLocalStorage<MailListSort>("mail.listSort", "date-desc");

/** Reactive sort used by message lists */
export const mailListSort = writable<MailListSort>(sortSetting.value ?? "date-desc");
mailListSort.subscribe(v => {
  if (v && sortSetting.value !== v) {
    sortSetting.value = v;
  }
});
