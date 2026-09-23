import { SetColl } from "svelte-collections";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { availableTags, type Tag } from "./Tag";
import type { EMail } from "../Mail/EMail";

/** Named preset: apply several categories to a message at once. */
export class TagCombination {
  id: string = crypto.randomUUID();
  name: string = "";
  tagNames: string[] = [];
  sortOrder = 0;
}

export const tagCombinations = new SetColl<TagCombination>();

const kTagCombinations = "tagCombinations";

export function sortedTagCombinations(
  combinations: Iterable<TagCombination> = tagCombinations.contents,
): TagCombination[] {
  return [...combinations].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function resolveCombinationTags(combination: TagCombination): Tag[] {
  let tags: Tag[] = [];
  for (let name of combination.tagNames) {
    let tag = availableTags.find(entry => entry.name == name);
    if (tag) {
      tags.push(tag);
    }
  }
  return tags;
}

export async function loadTagCombinations(): Promise<void> {
  let json: any[] = sanitize.array(
    JSON.parse(sanitize.nonemptystring(localStorage.getItem(kTagCombinations), "[]")),
    [],
  );
  tagCombinations.clear();
  for (let [index, item] of json.entries()) {
    let combination = new TagCombination();
    combination.id = sanitize.string(item.id, crypto.randomUUID());
    combination.name = sanitize.label(item.name);
    combination.tagNames = sanitize.array(item.tagNames, [])
      .map(name => sanitize.label(name))
      .filter(name => availableTags.find(tag => tag.name == name));
    combination.sortOrder = typeof item.sortOrder == "number" && Number.isFinite(item.sortOrder)
      ? item.sortOrder
      : index;
    if (combination.name) {
      tagCombinations.add(combination);
    }
  }
  assignCombinationSortOrders(sortedTagCombinations());
}

export function usableTagCombinations(
  combinations: Iterable<TagCombination> = tagCombinations.contents,
): TagCombination[] {
  return sortedTagCombinations(combinations).filter(combination =>
    combination.name.trim() && combination.tagNames.length > 0);
}

export async function saveTagCombinations(): Promise<void> {
  for (let combination of tagCombinations) {
    combination.tagNames = combination.tagNames.filter(name =>
      availableTags.find(tag => tag.name == name));
  }
  let json = sortedTagCombinations().map(combination => ({
    id: combination.id,
    name: combination.name,
    tagNames: combination.tagNames,
    sortOrder: combination.sortOrder,
  }));
  localStorage.setItem(kTagCombinations, JSON.stringify(json));
  notifyTagCombinationsChanged();
}

export function assignCombinationSortOrders(combinations: readonly TagCombination[]): void {
  for (let [index, combination] of combinations.entries()) {
    combination.sortOrder = index;
  }
}

function notifyTagCombinationsChanged(): void {
  (tagCombinations as SetColl<TagCombination> & { _notifySvelteOfChanges(): void })._notifySvelteOfChanges();
}

export function createTagCombination(name = "", tagNames: string[] = []): TagCombination {
  let combination = new TagCombination();
  combination.name = name;
  combination.tagNames = tagNames.filter(entry =>
    availableTags.find(tag => tag.name == entry));
  combination.sortOrder = sortedTagCombinations().length;
  tagCombinations.add(combination);
  return combination;
}

export async function removeTagCombination(combination: TagCombination): Promise<void> {
  tagCombinations.remove(combination);
  assignCombinationSortOrders(sortedTagCombinations());
  await saveTagCombinations();
}

export async function applyTagCombinationToEmails(
  emails: readonly EMail[],
  combination: TagCombination,
): Promise<void> {
  let tags = resolveCombinationTags(combination);
  if (!tags.length) {
    return;
  }
  let results = await Promise.allSettled(emails.map(email => email.addTags(tags)));
  let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
  if (failed) {
    throw failed.reason;
  }
}

/** Keep combinations in sync when a category is deleted. */
export async function removeTagFromCombinations(tagName: string): Promise<void> {
  let changed = false;
  for (let combination of [...tagCombinations.contents]) {
    let next = combination.tagNames.filter(name => name != tagName);
    if (next.length != combination.tagNames.length) {
      combination.tagNames = next;
      changed = true;
    }
    if (!combination.tagNames.length) {
      tagCombinations.remove(combination);
    }
  }
  if (changed) {
    assignCombinationSortOrders(sortedTagCombinations());
    await saveTagCombinations();
  }
}
