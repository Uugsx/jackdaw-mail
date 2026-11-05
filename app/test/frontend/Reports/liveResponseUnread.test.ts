// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import "../../../logic/app";
import type { PendingResponseRequest } from "../../../logic/Reports/ResponseReminder";
import type { WorkingHoursSchedule } from "../../../logic/Reports/WorkingHours";

const RESPONSE_REMINDER_STATE_STORAGE_KEY = "reports.response-reminders.state.v1";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const RECEIVED_AT = new Date("2026-10-20T09:00:00.000Z");
// Круглосуточный график: результат не зависит от часового пояса машины.
const ALL_DAY: WorkingHoursSchedule = {
  days: Array.from({ length: 7 }, () => ({ enabled: true, startMinutes: 0, endMinutes: 24 * 60 })),
};

let pendingRequests: PendingResponseRequest[] = [];

// Выборка из базы проверяется в ResponseReminderData.test.ts; здесь очередь
// отдаётся из памяти, а наблюдатель SLA — настоящий.
vi.mock("../../../logic/Reports/ResponseReminderData", () => ({
  loadPendingResponseRequests: vi.fn(async () => pendingRequests),
  MAX_PENDING_RESPONSE_REQUESTS: 5_000,
}));
vi.mock("../../../frontend/Mail/openPendingResponse", () => ({
  openPendingResponseMessage: vi.fn(async () => {}),
}));

let LiveResponseControl: any;
let storage: Map<string, string>;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  LiveResponseControl = (await import("../../../frontend/Reports/LiveResponseControl.svelte")).default;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function overdueRequest(isRead: boolean): PendingResponseRequest {
  return {
    accountId: 1,
    folderId: 1,
    emailId: 42,
    messageID: "<request-42>",
    threadID: "<thread-42>",
    subject: "Просроченный запрос",
    receivedAt: RECEIVED_AT,
    categoryNames: [],
    isRead,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
  }
}

/** Открывает панель заново: очередь и состояние SLA читаются с нуля. */
async function openLiveControl(request: PendingResponseRequest): Promise<HTMLElement> {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  pendingRequests = [request];
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(LiveResponseControl, {
    target,
    props: {
      accountId: 1,
      accountName: "integrators",
      folderId: 1,
      folderName: "Inbox",
      targetMinutes: 30,
      workingHours: ALL_DAY,
    },
  }));
  await flush();
  return target;
}

function overdueSubjects(target: HTMLElement): string[] {
  return [...target.querySelectorAll(".live-row.overdue .live-email-link > span")]
    .map(span => span.textContent?.trim() ?? "");
}

function storedState(): Record<string, Record<string, unknown>> {
  return JSON.parse(storage.get(RESPONSE_REMINDER_STATE_STORAGE_KEY) ?? "{}");
}

describe("живой контроль: прочитано / непрочитано", () => {
  test("просроченное письмо остаётся в контроле после прочтения и возврата в непрочитанное", async () => {
    let target = await openLiveControl(overdueRequest(false));
    expect(overdueSubjects(target)).toEqual(["Просроченный запрос"]);

    target = await openLiveControl(overdueRequest(true));
    expect(overdueSubjects(target)).toEqual(["Просроченный запрос"]);
    expect(storedState()["1:1:42"]).toMatchObject({ takenInWork: true });

    target = await openLiveControl(overdueRequest(false));
    expect(overdueSubjects(target)).toEqual(["Просроченный запрос"]);
    let entry = storedState()["1:1:42"];
    // Непрочитанное — снова «ждёт», без скрытия и без нового отсчёта.
    expect(entry).toMatchObject({ receivedAt: RECEIVED_AT.getTime(), takenInWork: false });
    expect(entry.suppressedUntilTakenInWork).toBeUndefined();
    expect(entry.startedAt).toBeUndefined();
  });

  test("состояние прежней версии со скрытием не прячет письмо", async () => {
    storage.set(RESPONSE_REMINDER_STATE_STORAGE_KEY, JSON.stringify({
      "1:1:42": {
        receivedAt: RECEIVED_AT.getTime(),
        firedIntervalsMinutes: [],
        takenInWork: false,
        suppressedUntilTakenInWork: true,
        overdue: false,
      },
    }));
    let target = await openLiveControl(overdueRequest(false));
    expect(overdueSubjects(target)).toEqual(["Просроченный запрос"]);
    expect(storedState()["1:1:42"].suppressedUntilTakenInWork).toBeUndefined();
  });

  test("отвеченное или удалённое письмо уходит из контроля", async () => {
    let target = await openLiveControl(overdueRequest(true));
    expect(overdueSubjects(target)).toEqual(["Просроченный запрос"]);
    // Выборка не возвращает письмо после ответа, переноса или удаления.
    pendingRequests = [];
    for (let instance of mounted) {
      unmount(instance);
    }
    mounted = [];
    document.body.replaceChildren();
    target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(LiveResponseControl, {
      target,
      props: { accountId: 1, accountName: "integrators", folderId: 1, folderName: "Inbox", targetMinutes: 30, workingHours: ALL_DAY },
    }));
    await flush();
    expect(target.querySelectorAll(".live-row")).toHaveLength(0);
  });
});
