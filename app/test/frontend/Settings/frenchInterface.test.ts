// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { gt, setUILocale } from "../../../l10n/l10n";
import { loadLanguageMessages } from "../../../l10n/messagesLoader";

let localStorageValues = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

/** Строки со скриншота пользователя: при французском языке они оставались английскими */
const screenshotStrings = [
  "Keyboard shortcuts",
  "Title bar",
  "These colors override the current theme. Clear restores the default.",
  "Interface density",
  "Extra compact",
  "Changes text size, spacing and message header density",
  "Side panel",
  "Show website and calendar widgets on the right",
  "Live response control",
  "Control scope",
  "Choose the mailbox and folder whose unanswered requests should be monitored.",
  "Mail account",
  "Mail folder",
  "Response target",
  "working minutes",
  "SLA tracking and reminders",
  "Refresh",
  "The timer follows the selected mailbox schedule until a message is taken into work. If it is taken outside working hours, the timer continues without pausing from that moment.",
  "without a reply",
  "overdue",
  "within SLA",
  "waiting for working hours",
  "Sort messages",
  "SLA deadline",
  "Response time",
  "Assigned to",
  "Tracking archive",
  "Waiting for working hours",
  "Stop tracking",
  "Not assigned",
  "Excluded categories and unassigned messages follow the SLA settings.",
];

describe("интерфейс на французском", () => {
  beforeAll(() => loadLanguageMessages("fr"));

  afterEach(() => {
    setUILocale("en");
    document.body.replaceChildren();
    localStorageValues.clear();
    vi.unstubAllGlobals();
  });

  test("строки настроек и живого SLA-контроля переведены", () => {
    setUILocale("fr");

    let untranslated = screenshotStrings.filter(source => gt([source]) == source);
    expect(untranslated).toEqual([]);
    expect(gt(["Title bar"])).toBe("Barre de titre");
    expect(gt(["Stop tracking"])).toBe("Arrêter le suivi");
  });

  test("настройки цветов отображаются на французском", async () => {
    setUILocale("fr");
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    let { default: AppThemeColors } = await import("../../../frontend/Settings/Global/AppThemeColors.svelte");
    let target = document.createElement("div");
    document.body.append(target);

    let instance = mount(AppThemeColors, { target });
    await tick();

    expect(target.textContent).toContain("Barre de titre");
    expect(target.textContent).toContain("Ces couleurs remplacent le thème actuel.");
    expect(target.textContent).not.toContain("Title bar");
    unmount(instance);
  });

  test("встроенные панели показывают имя на текущем языке, а не сохранённое", async () => {
    setUILocale("fr");
    let { normalizeWidgetList } = await import("../../../frontend/Widgets/widgetState");

    let widgets = normalizeWidgetList([
      { id: "calendar", name: "Календарь", kind: "calendar" },
      { id: "live-sla", name: "Живой контроль ответов", kind: "live-sla" },
      { id: "site", name: "Мой сайт", kind: "web", url: "https://example.com" },
    ]);

    expect(widgets.map(widget => widget.name)).toEqual([
      gt(["Calendar"]),
      "Suivi des réponses en direct",
      "Мой сайт",
    ]);
  });
});
