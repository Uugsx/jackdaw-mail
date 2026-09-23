import { get, writable } from "svelte/store";
import { gt } from "../../l10n/l10n";
import { availableTags, type Tag } from "../../logic/Abstract/Tag";
import {
  resolveCombinationTags,
  tagCombinations,
  usableTagCombinations,
} from "../../logic/Abstract/TagCombination";
import type { EMail } from "../../logic/Mail/EMail";
import { selectedMessage, selectedMessages } from "./Selected";
import { runMailActions } from "./mailBulkActions";

export type CategoryShortcutTarget =
  | { type: "tag"; id: string }
  | { type: "combination"; id: string };

export type KeyboardCategoryShortcut = {
  kind: "keyboard";
  code: string;
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

export type MouseCategoryShortcut = {
  kind: "mouse";
  button: number;
};

export type CategoryShortcut = KeyboardCategoryShortcut | MouseCategoryShortcut;

const kCategoryShortcutDuplicateWindowMs = 500;

/** Не даёт одному физическому нажатию применить категорию несколько раз. */
export class KeyboardCategoryShortcutPressGuard {
  private readonly pressedCodes = new Set<string>();
  private readonly lastClaimedAt = new Map<string, number>();

  claim(code: string, now = Date.now()): boolean {
    if (!code || this.pressedCodes.has(code)) {
      return false;
    }
    let lastClaim = this.lastClaimedAt.get(code);
    if (lastClaim != null && now - lastClaim < kCategoryShortcutDuplicateWindowMs) {
      return false;
    }
    this.pressedCodes.add(code);
    this.lastClaimedAt.set(code, now);
    return true;
  }

  release(code: string): void {
    this.pressedCodes.delete(code);
  }

  clear(): void {
    this.pressedCodes.clear();
    this.lastClaimedAt.clear();
  }
}

type StoredCategoryShortcut = {
  target: CategoryShortcutTarget;
  shortcut: CategoryShortcut;
};

const kCategoryShortcutsStorageKey = "mail.categoryShortcuts";
const kMaxShortcutTextLength = 128;
const kMaxMouseButton = 31;

/** Изменение этого счётчика обновляет список назначений в настройках. */
export const categoryShortcutsChanged = writable(0);
let categoryShortcuts = loadCategoryShortcuts();

function notifyCategoryShortcutsChanged(): void {
  categoryShortcutsChanged.update(revision => revision + 1);
}

function loadCategoryShortcuts(): StoredCategoryShortcut[] {
  if (typeof localStorage == "undefined") {
    return [];
  }
  let stored = localStorage.getItem(kCategoryShortcutsStorageKey);
  if (!stored) {
    return [];
  }
  try {
    let parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(readStoredCategoryShortcut)
      .filter((entry): entry is StoredCategoryShortcut => !!entry)
      .filter((entry, index, entries) =>
        entries.findIndex(other => sameTarget(other.target, entry.target)) == index);
  } catch (_ex) {
    return [];
  }
}

function readStoredCategoryShortcut(value: unknown): StoredCategoryShortcut | null {
  if (!value || typeof value != "object") {
    return null;
  }
  let record = value as Record<string, unknown>;
  let target = readTarget(record.target);
  let shortcut = readShortcut(record.shortcut);
  return target && shortcut ? { target, shortcut } : null;
}

function readTarget(value: unknown): CategoryShortcutTarget | null {
  if (!value || typeof value != "object") {
    return null;
  }
  let record = value as Record<string, unknown>;
  let type: CategoryShortcutTarget["type"] | null =
    record.type == "tag" ? "tag" : record.type == "combination" ? "combination" : null;
  if (!type) {
    return null;
  }
  return typeof record.id == "string" && record.id.length > 0 && record.id.length <= kMaxShortcutTextLength
    ? { type, id: record.id }
    : null;
}

function readShortcut(value: unknown): CategoryShortcut | null {
  if (!value || typeof value != "object") {
    return null;
  }
  let record = value as Record<string, unknown>;
  if (record.kind == "mouse") {
    return Number.isInteger(record.button) &&
      (record.button as number) >= 0 &&
      (record.button as number) <= kMaxMouseButton
      ? { kind: "mouse", button: record.button as number }
      : null;
  }
  if (record.kind != "keyboard" ||
      typeof record.code != "string" ||
      typeof record.key != "string" ||
      !record.code.length ||
      record.code.length > kMaxShortcutTextLength ||
      record.key.length > kMaxShortcutTextLength ||
      typeof record.ctrl != "boolean" ||
      typeof record.alt != "boolean" ||
      typeof record.shift != "boolean" ||
      typeof record.meta != "boolean") {
    return null;
  }
  return {
    kind: "keyboard",
    code: record.code,
    key: record.key,
    ctrl: record.ctrl,
    alt: record.alt,
    shift: record.shift,
    meta: record.meta,
  };
}

function saveCategoryShortcuts(): void {
  if (typeof localStorage == "undefined") {
    return;
  }
  localStorage.setItem(kCategoryShortcutsStorageKey, JSON.stringify(categoryShortcuts));
}

export function getCategoryShortcut(target: CategoryShortcutTarget): CategoryShortcut | null {
  return categoryShortcuts.find(entry => sameTarget(entry.target, target))?.shortcut ?? null;
}

/** Возвращает цель, назначенную на конкретную клавишу или кнопку мыши. */
export function findCategoryShortcut(shortcut: CategoryShortcut): CategoryShortcutTarget | null {
  return categoryShortcuts.find(entry => sameShortcut(entry.shortcut, shortcut))?.target ?? null;
}

/** Назначает сочетание и снимает его с предыдущей категории, если оно уже занято. */
export function assignCategoryShortcut(
  target: CategoryShortcutTarget,
  shortcut: CategoryShortcut,
): CategoryShortcutTarget | null {
  let displaced = categoryShortcuts.find(entry =>
    sameShortcut(entry.shortcut, shortcut) && !sameTarget(entry.target, target))?.target ?? null;
  categoryShortcuts = categoryShortcuts.filter(entry =>
    !sameTarget(entry.target, target) && !sameShortcut(entry.shortcut, shortcut));
  categoryShortcuts.push({ target, shortcut });
  saveCategoryShortcuts();
  notifyCategoryShortcutsChanged();
  return displaced;
}

export function clearCategoryShortcut(target: CategoryShortcutTarget): void {
  let next = categoryShortcuts.filter(entry => !sameTarget(entry.target, target));
  if (next.length == categoryShortcuts.length) {
    return;
  }
  categoryShortcuts = next;
  saveCategoryShortcuts();
  notifyCategoryShortcutsChanged();
}

/** Удаляет назначения для категорий и комбинаций, которых больше нет. */
export function pruneCategoryShortcuts(): void {
  let next = categoryShortcuts.filter(entry => {
    if (entry.target.type == "tag") {
      return availableTags.contents.some(tag => tag.name == entry.target.id);
    }
    return usableTagCombinations().some(combination => combination.id == entry.target.id);
  });
  if (next.length == categoryShortcuts.length) {
    return;
  }
  categoryShortcuts = next;
  saveCategoryShortcuts();
  notifyCategoryShortcutsChanged();
}

function sameTarget(a: CategoryShortcutTarget, b: CategoryShortcutTarget): boolean {
  return a.type == b.type && a.id == b.id;
}

function sameShortcut(a: CategoryShortcut, b: CategoryShortcut): boolean {
  if (a.kind != b.kind) {
    return false;
  }
  if (a.kind == "mouse" && b.kind == "mouse") {
    return a.button == b.button;
  }
  if (a.kind != "keyboard" || b.kind != "keyboard") {
    return false;
  }
  return a.code == b.code &&
    a.ctrl == b.ctrl &&
    a.alt == b.alt &&
    a.shift == b.shift &&
    a.meta == b.meta;
}

export function keyboardCategoryShortcutFromEvent(
  event: KeyboardEvent,
  modifiers: Partial<Pick<KeyboardCategoryShortcut, "ctrl" | "alt" | "shift" | "meta">> = {},
): KeyboardCategoryShortcut | null {
  let code = event.code || event.key;
  if (!code) {
    return null;
  }
  let modifierOnly = ["Control", "Shift", "Alt", "Meta"].includes(event.key);
  return {
    kind: "keyboard",
    code,
    key: event.key || code,
    ctrl: modifiers.ctrl ?? (modifierOnly ? event.key == "Control" : event.ctrlKey),
    alt: modifiers.alt ?? (modifierOnly ? event.key == "Alt" : event.altKey),
    shift: modifiers.shift ?? (modifierOnly ? event.key == "Shift" : event.shiftKey),
    meta: modifiers.meta ?? (modifierOnly ? event.key == "Meta" : event.metaKey),
  };
}

export function mouseCategoryShortcutFromEvent(event: MouseEvent): MouseCategoryShortcut | null {
  return Number.isInteger(event.button) && event.button >= 0 && event.button <= kMaxMouseButton
    ? { kind: "mouse", button: event.button }
    : null;
}

/** Применяет назначение ко всем выбранным письмам или к текущему письму. */
export async function applyCategoryShortcut(target: CategoryShortcutTarget): Promise<boolean> {
  let messages = getSelectedMessages();
  if (!messages.length) {
    return false;
  }
  if (target.type == "tag") {
    let tag = availableTags.find(entry => entry.name == target.id);
    if (!tag) {
      return false;
    }
    await toggleCategoryTags(messages, [tag]);
    return true;
  }
  let combination = tagCombinations.find(entry => entry.id == target.id);
  if (!combination) {
    return false;
  }
  let tags = resolveCombinationTags(combination);
  if (!tags.length) {
    return false;
  }
  await toggleCategoryTags(messages, tags);
  return true;
}

/** Переключает категории по той же majority-логике, что и меню категорий. */
async function toggleCategoryTags(messages: readonly EMail[], tags: readonly Tag[]): Promise<void> {
  let remove = tags.every(tag => majorityHasTag(tag, messages));
  await runMailActions(messages, message => remove
    ? message.removeTags(tags)
    : message.addTags(tags));
}

function majorityHasTag(tag: Tag, messages: readonly EMail[]): boolean {
  return messages.filter(message => message.tags.contains(tag)).length / messages.length > 0.5;
}

function getSelectedMessages(): EMail[] {
  let messages = get(selectedMessages).contents.slice();
  if (!messages.length) {
    let message = get(selectedMessage);
    if (message) {
      messages = [message];
    }
  }
  return messages;
}

const kKeyNames: Record<string, string> = {
  " ": "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Control: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "⌘",
};

export function formatCategoryShortcut(shortcut: CategoryShortcut): string {
  if (shortcut.kind == "mouse") {
    return shortcut.button == 0 ? gt`Mouse left` :
      shortcut.button == 1 ? gt`Mouse middle` :
      shortcut.button == 2 ? gt`Mouse right` :
      gt`Mouse button ${shortcut.button + 1}`;
  }
  let modifiers: string[] = [];
  if (shortcut.meta) modifiers.push("⌘");
  if (shortcut.ctrl) modifiers.push("Ctrl");
  if (shortcut.alt) modifiers.push("Alt");
  if (shortcut.shift) modifiers.push("Shift");
  let key = kKeyNames[shortcut.key] ?? shortcut.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(shortcut.key)) {
    return key;
  }
  if (key == "Unidentified" || !key) {
    key = shortcut.code.replace(/^Key/, "").replace(/^Digit/, "");
  } else if (key.length == 1) {
    key = key.toUpperCase();
  }
  return [...modifiers, key].join("+");
}
