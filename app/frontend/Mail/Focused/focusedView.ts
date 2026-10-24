import type { EMail } from "../../../logic/Mail/EMail";
import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
import { createClassifier, loadServerClassification, type FocusedTab } from "../../../logic/Mail/Focused/FocusedInbox";
import { backgroundError } from "../../Util/error";
import type { Collection } from "svelte-collections";
import { writable } from "svelte/store";

/** Открытая вкладка во «Входящих» */
export const focusedTab = writable<FocusedTab>("focused");

const asked = new WeakSet<Folder>();

export function isFocusedFolder(folder: Folder | null | undefined, enabled: boolean): boolean {
  return enabled && folder?.specialFolder == SpecialFolder.Inbox;
}

/**
 * Письма папки для списка: во «Входящих» при включённой сортировке — только вкладка `tab`.
 * `version` — номер изменения классификации, чтобы Svelte пересобрал фильтр.
 */
export function focusedMessages(folder: Folder | null | undefined, tab: FocusedTab, enabled: boolean, version: number): Collection<EMail> | undefined {
  if (!folder) {
    return undefined;
  }
  if (!isFocusedFolder(folder, enabled)) {
    return folder.messages;
  }
  if (!asked.has(folder)) {
    asked.add(folder);
    loadServerClassification(folder).catch(backgroundError);
  }
  let classify = createClassifier();
  return folder.messages.filterObservable(email => classify(email) == tab);
}
