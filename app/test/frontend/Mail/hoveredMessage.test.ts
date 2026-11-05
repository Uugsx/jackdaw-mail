// @vitest-environment happy-dom

import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";

vi.mock("../../../logic/Mail/Store/QuickSearchEMail", () => ({
  QuickSearchEMail: class {},
}));
vi.mock("../../../frontend/Mail/LeftPane/SearchSwitcher.svelte", () => ({
  SearchView: { Folder: 0, Person: 1, Search: 2 },
}));

import {
  getHoveredMessage,
  hotkeysOnHoveredMessageSetting,
  getMailActionTargets,
  resolveMailActionTargets,
} from "../../../frontend/Mail/hoveredMessage";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { hoverRow } from "./hoverRow";

const a = { id: "a" } as unknown as EMail;
const b = { id: "b" } as unknown as EMail;
const c = { id: "c" } as unknown as EMail;

describe("письмо под курсором для горячих клавиш", () => {
  test("курсор над письмом вне выделения — только это письмо", () => {
    expect(resolveMailActionTargets([a, b], a, c)).toEqual({ messages: [c], hoverOnly: true });
    expect(resolveMailActionTargets([], a, c)).toEqual({ messages: [c], hoverOnly: true });
    expect(resolveMailActionTargets([], undefined, c)).toEqual({ messages: [c], hoverOnly: true });
  });

  test("курсор над одним из выделенных — всё выделение", () => {
    expect(resolveMailActionTargets([a, b], a, b)).toEqual({ messages: [a, b], hoverOnly: false });
    expect(resolveMailActionTargets([], a, a)).toEqual({ messages: [a], hoverOnly: false });
  });

  test("курсор не над списком — как раньше", () => {
    expect(resolveMailActionTargets([a, b], a, null)).toEqual({ messages: [a, b], hoverOnly: false });
    expect(resolveMailActionTargets([], a, null)).toEqual({ messages: [a], hoverOnly: false });
    expect(resolveMailActionTargets([], undefined, null)).toEqual({ messages: [], hoverOnly: false });
  });
});

function memoryStorage(): Storage {
  let data = new Map<string, string>();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: key => void data.delete(key),
    clear: () => data.clear(),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

describe("отслеживание строки под курсором", () => {
  let previousMessage: EMail | undefined;
  let previousMessages: ArrayColl<EMail>;
  let hover: ReturnType<typeof hoverRow> | null = null;

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    previousMessage = get(selectedMessage);
    previousMessages = get(selectedMessages);
    selectedMessage.set(a);
    selectedMessages.set(new ArrayColl([a]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    hover?.leave();
    hover = null;
    document.body.classList.remove("mail-webview-pointer-active");
    selectedMessage.set(previousMessage!);
    selectedMessages.set(previousMessages);
    document.body.replaceChildren();
  });

  test("находит письмо строки и цели действия", () => {
    hover = hoverRow(b);
    expect(getHoveredMessage()).toBe(b);
    expect(getMailActionTargets()).toEqual({ messages: [b], hoverOnly: true });
    expect(get(selectedMessage)).toBe(a);
  });

  test("строка, переиспользованная под другое письмо, отдаёт новое письмо", () => {
    hover = hoverRow(b);
    hover.action.update(c);
    expect(getHoveredMessage()).toBe(c);
  });

  test("после ухода курсора действие снова для выделенного", () => {
    hover = hoverRow(b);
    hover.leave();
    hover = null;
    expect(getHoveredMessage()).toBeNull();
    expect(getMailActionTargets()).toEqual({ messages: [a], hoverOnly: false });
  });

  test("стрелки отключают курсор до следующего движения мыши", () => {
    hover = hoverRow(b);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(getHoveredMessage()).toBeNull();
    document.dispatchEvent(new Event("pointermove"));
    expect(getHoveredMessage()).toBe(b);
  });

  test("обновление выделения после действия не сбрасывает курсор", () => {
    hover = hoverRow(b);
    selectedMessage.set(c);
    selectedMessages.set(new ArrayColl([c]));
    selectedMessage.set(a);
    expect(getHoveredMessage()).toBe(b);
  });

  test("курсор над телом письма (WebView) не считается наведением на строку", () => {
    hover = hoverRow(b);
    document.body.classList.add("mail-webview-pointer-active");
    expect(getHoveredMessage()).toBeNull();
  });

  test("настройка выключена — горячие клавиши только на выделенное", () => {
    hover = hoverRow(b);
    expect(getMailActionTargets()).toEqual({ messages: [b], hoverOnly: true });
    hotkeysOnHoveredMessageSetting.value = false;
    try {
      expect(getHoveredMessage()).toBeNull();
      expect(getMailActionTargets()).toEqual({ messages: [a], hoverOnly: false });
    } finally {
      hotkeysOnHoveredMessageSetting.value = true;
    }
    expect(getHoveredMessage()).toBe(b);
  });

  test("по умолчанию настройка включена", () => {
    localStorage.removeItem("mail.hotkeys.hovered");
    expect(hotkeysOnHoveredMessageSetting.value).toBe(true);
  });
});
