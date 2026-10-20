// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import "../../../logic/app";
import type { PendingResponseRequest } from "../../../logic/Reports/ResponseReminder";

const LIVE_SORT_STORAGE_KEY = "reports.live-response.sort.v1";

let pendingRequests: PendingResponseRequest[] = [];

// База писем в тесте не нужна: очередь отдаётся из памяти.
vi.mock("../../../logic/Reports/ResponseReminderData", () => ({
  loadPendingResponseRequests: vi.fn(async () => pendingRequests),
}));
vi.mock("../../../frontend/Mail/ResponseReminderWatcher", async () => {
  const { writable } = await import("svelte/store");
  return {
    getResponseReminderStateSnapshot: () => ({}),
    getResponseReminderSlaStartAt: (request: PendingResponseRequest) => request.receivedAt,
    isResponseReminderRequestSuppressed: () => false,
    responseReminderMailEpoch: writable(0),
  };
});
vi.mock("../../../frontend/Mail/openPendingResponse", () => ({
  openPendingResponseMessage: vi.fn(async () => {}),
}));

let LiveResponseControl: any;
let ReportSortButton: any;
let storage: Map<string, string>;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  LiveResponseControl = (await import("../../../frontend/Reports/LiveResponseControl.svelte")).default;
  ReportSortButton = (await import("../../../frontend/Reports/ReportSortButton.svelte")).default;
});

beforeEach(() => {
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  pendingRequests = [
    request(1, "Бета", minutesAgo(20)),
    request(2, "Альфа", minutesAgo(10)),
    request(3, "Гамма", minutesAgo(30)),
  ];
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function request(emailId: number, subject: string, receivedAt: Date): PendingResponseRequest {
  return {
    accountId: 1,
    folderId: 1,
    emailId,
    messageID: null,
    threadID: null,
    subject,
    receivedAt,
    categoryNames: [],
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
  }
}

async function mountLiveControl(): Promise<HTMLElement> {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(LiveResponseControl, {
    target,
    props: { accountId: 1, accountName: "integrators", folderId: 1, folderName: "Inbox" },
  }));
  await flush();
  return target;
}

function sortButtons(target: HTMLElement): HTMLButtonElement[] {
  return [...target.querySelectorAll<HTMLButtonElement>(".live-sort-controls .table-sort-button")];
}

function sortButton(target: HTMLElement, label: string): HTMLButtonElement {
  let button = sortButtons(target).find(candidate => candidate.textContent?.trim() == label);
  expect(button, label).toBeTruthy();
  return button!;
}

function subjects(target: HTMLElement): string[] {
  return [...target.querySelectorAll(".live-email-link > span")].map(span => span.textContent?.trim() ?? "");
}

describe("сортировка живого контроля ответов", () => {
  test("у каждой кнопки полная подпись и подсказка с направлением", async () => {
    let target = await mountLiveControl();
    let buttons = sortButtons(target);
    expect(buttons.map(button => button.textContent?.trim())).toEqual([
      "Status",
      "Received",
      "SLA deadline",
      "Response time",
      "Assigned to",
      "Subject",
    ]);
    for (let button of buttons) {
      let label = button.textContent!.trim();
      expect(button.title).toBe(`${label} — not sorted`);
      expect(button.getAttribute("aria-label")).toBe(button.title);
    }
  });

  test("переключение работает как раньше: по возрастанию, по убыванию, без сортировки", async () => {
    let target = await mountLiveControl();
    // Без выбранной колонки — рабочий порядок: самые давние сверху.
    expect(subjects(target)).toEqual(["Гамма", "Бета", "Альфа"]);

    sortButton(target, "Subject").click();
    await flush();
    expect(subjects(target)).toEqual(["Альфа", "Бета", "Гамма"]);
    expect(sortButton(target, "Subject").title).toBe("Subject — sorted ascending");
    expect(sortButton(target, "Subject").classList.contains("is-active")).toBe(true);
    expect(sortButton(target, "Status").title).toBe("Status — not sorted");
    expect(JSON.parse(storage.get(LIVE_SORT_STORAGE_KEY)!)).toEqual({ column: "subject", direction: "asc" });

    sortButton(target, "Subject").click();
    await flush();
    expect(subjects(target)).toEqual(["Гамма", "Бета", "Альфа"]);
    expect(sortButton(target, "Subject").title).toBe("Subject — sorted descending");

    sortButton(target, "Subject").click();
    await flush();
    expect(subjects(target)).toEqual(["Гамма", "Бета", "Альфа"]);
    expect(sortButton(target, "Subject").title).toBe("Subject — not sorted");
    expect(sortButton(target, "Subject").classList.contains("is-active")).toBe(false);
    expect(storage.get(LIVE_SORT_STORAGE_KEY)).toBe("null");
  });

  test("сохранённая сортировка восстанавливается при открытии панели", async () => {
    storage.set(LIVE_SORT_STORAGE_KEY, JSON.stringify({ column: "received", direction: "desc" }));
    let target = await mountLiveControl();
    expect(subjects(target)).toEqual(["Альфа", "Бета", "Гамма"]);
    expect(sortButton(target, "Received").title).toBe("Received — sorted descending");
  });
});

describe("кнопка сортировки в таблице отчёта", () => {
  test("даёт подсказку, но не меняет имя: направление озвучивает aria-sort заголовка", async () => {
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(ReportSortButton, { target, props: { label: "Day", direction: "asc" } }));
    await tick();
    let button = target.querySelector<HTMLButtonElement>(".table-sort-button")!;
    expect(button.title).toBe("Day — sorted ascending");
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(button.textContent?.trim()).toBe("Day");
  });
});
