import { writable } from "svelte/store";

export type KeyboardShortcut = {
  kind: "keyboard";
  code: string;
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

type StoredKeyboardShortcut = {
  actionId: string;
  shortcut: KeyboardShortcut;
};

const kKeyboardShortcutsStorageKey = "keyboard.shortcuts";
const kMaxShortcutTextLength = 128;
const kMaxActionIdLength = 128;
const kShortcutDuplicateWindowMs = 500;

/** Изменение этого счётчика обновляет список назначений в настройках. */
export const keyboardShortcutsChanged = writable(0);
let keyboardShortcuts = loadKeyboardShortcuts();

/** Не даёт одному физическому нажатию выполнить команду несколько раз. */
export class KeyboardShortcutPressGuard {
  private readonly pressedCodes = new Set<string>();
  private readonly lastClaimedAt = new Map<string, number>();

  claim(code: string, now = Date.now()): boolean {
    if (!code || this.pressedCodes.has(code)) {
      return false;
    }
    const lastClaim = this.lastClaimedAt.get(code);
    if (lastClaim != null && now - lastClaim < kShortcutDuplicateWindowMs) {
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

function notifyKeyboardShortcutsChanged(): void {
  keyboardShortcutsChanged.update(revision => revision + 1);
}

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage == "undefined" ? null : globalThis.localStorage;
  } catch (_ex) {
    return null;
  }
}

function loadKeyboardShortcuts(): StoredKeyboardShortcut[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  let stored: string | null;
  try {
    stored = storage.getItem(kKeyboardShortcutsStorageKey);
  } catch (_ex) {
    return [];
  }
  if (!stored) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(readStoredKeyboardShortcut)
      .filter((entry): entry is StoredKeyboardShortcut => !!entry)
      .filter((entry, index, entries) => entries.findIndex(other =>
        other.actionId == entry.actionId || sameKeyboardShortcut(other.shortcut, entry.shortcut)
      ) == index);
  } catch (_ex) {
    return [];
  }
}

function readStoredKeyboardShortcut(value: unknown): StoredKeyboardShortcut | null {
  if (!value || typeof value != "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.actionId != "string" ||
      !record.actionId.length || record.actionId.length > kMaxActionIdLength) {
    return null;
  }
  const shortcut = readKeyboardShortcut(record.shortcut);
  return shortcut ? { actionId: record.actionId, shortcut } : null;
}

function readKeyboardShortcut(value: unknown): KeyboardShortcut | null {
  if (!value || typeof value != "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
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

function saveKeyboardShortcuts(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(kKeyboardShortcutsStorageKey, JSON.stringify(keyboardShortcuts));
  } catch (_ex) {
    // Настройки остаются действующими в памяти, даже если хранилище недоступно.
  }
}

export function getKeyboardShortcut(actionId: string): KeyboardShortcut | null {
  return keyboardShortcuts.find(entry => entry.actionId == actionId)?.shortcut ?? null;
}

/** Возвращает действие, назначенное на конкретное сочетание. */
export function findKeyboardShortcut(shortcut: KeyboardShortcut): string | null {
  return keyboardShortcuts.find(entry => sameKeyboardShortcut(entry.shortcut, shortcut))?.actionId ?? null;
}

/** Назначает сочетание и снимает его с предыдущего действия, если оно занято. */
export function assignKeyboardShortcut(
  actionId: string,
  shortcut: KeyboardShortcut,
): string | null {
  if (!actionId || actionId.length > kMaxActionIdLength) {
    return null;
  }
  const displaced = keyboardShortcuts.find(entry =>
    sameKeyboardShortcut(entry.shortcut, shortcut) && entry.actionId != actionId
  )?.actionId ?? null;
  keyboardShortcuts = keyboardShortcuts.filter(entry =>
    entry.actionId != actionId && !sameKeyboardShortcut(entry.shortcut, shortcut)
  );
  keyboardShortcuts.push({ actionId, shortcut });
  saveKeyboardShortcuts();
  notifyKeyboardShortcutsChanged();
  return displaced;
}

export function clearKeyboardShortcut(actionId: string): void {
  const next = keyboardShortcuts.filter(entry => entry.actionId != actionId);
  if (next.length == keyboardShortcuts.length) {
    return;
  }
  keyboardShortcuts = next;
  saveKeyboardShortcuts();
  notifyKeyboardShortcutsChanged();
}

export function keyboardShortcutFromEvent(
  event: KeyboardEvent,
  modifiers: Partial<Pick<KeyboardShortcut, "ctrl" | "alt" | "shift" | "meta">> = {},
): KeyboardShortcut | null {
  const code = event.code || event.key;
  if (!code) {
    return null;
  }
  const modifierOnly = isModifierKey(event);
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

export function isModifierKey(event: KeyboardEvent): boolean {
  return ["Control", "Shift", "Alt", "Meta"].includes(event.key);
}

export function isModifierOnlyKeyboardShortcut(shortcut: KeyboardShortcut): boolean {
  return ["Control", "Shift", "Alt", "Meta"].includes(shortcut.key);
}

/**
 * Такие сочетания уже перехватываются меню приложения или операционной системой
 * до доставки события в renderer. Их нельзя назначать пользовательским командам.
 */
export function isReservedKeyboardShortcut(shortcut: KeyboardShortcut): boolean {
  const commandOrControl = shortcut.ctrl || shortcut.meta;
  const noAlt = !shortcut.alt;
  const noShift = !shortcut.shift;
  if (shortcut.code == "KeyQ" && shortcut.meta && noAlt && noShift) {
    return true;
  }
  if (!commandOrControl) {
    return false;
  }
  if (shortcut.code == "KeyN" && shortcut.alt && !shortcut.shift) {
    return true;
  }
  if (!noAlt) {
    return false;
  }
  if (shortcut.code == "KeyW" && noShift) {
    return true;
  }
  if (["KeyA", "KeyC", "KeyV", "KeyX", "KeyY", "KeyZ"].includes(shortcut.code)) {
    return noShift;
  }
  if (shortcut.code == "KeyN" && !shortcut.shift) {
    return true;
  }
  if (shortcut.code == "KeyK" && noShift) {
    return true;
  }
  if (shortcut.code == "KeyR") {
    return true;
  }
  if (shortcut.code == "KeyM" && shortcut.shift) {
    return true;
  }
  if (shortcut.code == "Comma" && noShift) {
    return true;
  }
  if (/^Digit[1-6]$/.test(shortcut.code) && noShift) {
    return true;
  }
  return false;
}

function sameKeyboardShortcut(a: KeyboardShortcut, b: KeyboardShortcut): boolean {
  return a.kind == b.kind &&
    a.code == b.code &&
    a.ctrl == b.ctrl &&
    a.alt == b.alt &&
    a.shift == b.shift &&
    a.meta == b.meta;
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

export function formatKeyboardShortcut(shortcut: KeyboardShortcut): string {
  const modifiers: string[] = [];
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
