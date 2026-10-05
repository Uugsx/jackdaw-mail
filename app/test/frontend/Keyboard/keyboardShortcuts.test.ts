// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vitest";
import {
  assignKeyboardShortcut,
  clearKeyboardShortcut,
  findKeyboardShortcut,
  formatKeyboardShortcut,
  getKeyboardShortcut,
  isModifierOnlyKeyboardShortcut,
  isReservedKeyboardShortcut,
  keyboardShortcutFromEvent,
  KeyboardShortcutPressGuard,
} from "../../../frontend/Keyboard/KeyboardShortcuts";

const firstAction = "test.keyboard.first";
const secondAction = "test.keyboard.second";

afterEach(() => {
  clearKeyboardShortcut(firstAction);
  clearKeyboardShortcut(secondAction);
});

describe("configurable keyboard shortcuts", () => {
  test("creates a normalized shortcut from a native event", () => {
    let shortcut = keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      shiftKey: true,
    }));

    expect(shortcut).toEqual({
      kind: "keyboard",
      code: "KeyK",
      key: "k",
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
    expect(formatKeyboardShortcut(shortcut!)).toBe("Ctrl+Shift+K");
    expect(isModifierOnlyKeyboardShortcut(shortcut!)).toBe(false);
  });

  test("moves a shortcut when another action claims it", () => {
    let shortcut = keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
    }))!;

    expect(assignKeyboardShortcut(firstAction, shortcut)).toBeNull();
    expect(findKeyboardShortcut(shortcut)).toBe(firstAction);
    expect(assignKeyboardShortcut(secondAction, shortcut)).toBe(firstAction);
    expect(getKeyboardShortcut(firstAction)).toBeNull();
    expect(getKeyboardShortcut(secondAction)).toEqual(shortcut);
  });

  test("does not claim one physical key twice before release", () => {
    let guard = new KeyboardShortcutPressGuard();

    expect(guard.claim("KeyK", 0)).toBe(true);
    expect(guard.claim("KeyK", 1)).toBe(false);
    guard.release("KeyK");
    expect(guard.claim("KeyK", 499)).toBe(false);
    expect(guard.claim("KeyK", 500)).toBe(true);
    guard.clear();
    expect(guard.claim("KeyK", 501)).toBe(true);
  });

  test("rejects application and operating-system reserved combinations", () => {
    expect(isReservedKeyboardShortcut(keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "r",
      code: "KeyR",
      ctrlKey: true,
    }))!)).toBe(true);
    expect(isReservedKeyboardShortcut(keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "q",
      code: "KeyQ",
      metaKey: true,
    }))!)).toBe(true);
    expect(isReservedKeyboardShortcut(keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      altKey: true,
    }))!)).toBe(false);
    expect(isReservedKeyboardShortcut(keyboardShortcutFromEvent(new KeyboardEvent("keydown", {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
      altKey: true,
    }))!)).toBe(true);
  });
});
