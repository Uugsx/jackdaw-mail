import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  // startup.ts читает параметры из location.hash при загрузке модуля
  (globalThis as any).location ??= { hash: "" };
});

const reads = vi.hoisted(() => ({
  mail: null as unknown as () => Promise<any[]>,
}));

vi.mock("../../logic/Mail/AccountsList/MailAccounts", () => ({ readMailAccounts: vi.fn(() => reads.mail()) }));
vi.mock("../../logic/Chat/AccountsList/ChatAccounts", () => ({ readChatAccounts: vi.fn(async () => []) }));
vi.mock("../../logic/Meet/AccountsList/MeetAccounts", () => ({ readMeetAccounts: vi.fn(async () => []) }));
vi.mock("../../logic/Files/AccountsList/FileSharingAccounts", () => ({ readFileSharingAccounts: vi.fn(async () => []) }));
vi.mock("../../logic/Contacts/AccountsList/Addressbooks", () => ({ readAddressbooks: vi.fn(async () => []) }));
vi.mock("../../logic/Calendar/AccountsList/Calendars", () => ({ readCalendars: vi.fn(async () => []) }));
vi.mock("../../logic/Topic/TopicAccounts", () => ({ readTopicAccounts: vi.fn(async () => []) }));
vi.mock("../../logic/Mail/Virtual/SavedSearchFolder", () => ({ readSavedSearches: vi.fn() }));
vi.mock("../../logic/Abstract/Workspace", () => ({ loadWorkspaces: vi.fn(async () => {}) }));
vi.mock("../../logic/Abstract/Tag", () => ({ loadTagsList: vi.fn(async () => {}) }));
vi.mock("../../logic/Abstract/TagCombination", () => ({ loadTagCombinations: vi.fn(async () => {}) }));
vi.mock("../../logic/Billing/ProEntitlement", () => ({ refreshProEntitlement: vi.fn(async () => {}) }));

import { appGlobal } from "../../logic/app";
import { getStartObjects } from "../../logic/startup";
import { isDatabaseBusyError } from "../../logic/util/friendlyError";
import { retryWhileDatabaseBusy } from "../../logic/util/retryWhileDatabaseBusy";
import { loadStartObjects } from "../../frontend/MainWindow/startObjectsNotice";
import { notifications, NotificationSeverity } from "../../frontend/MainWindow/Notification";

function busyError(): Error {
  return Object.assign(new Error("database is locked"), { name: "SqliteError", code: "SQLITE_BUSY" });
}

describe("isDatabaseBusyError", () => {
  test("узнаёт SQLITE_BUSY и SQLITE_LOCKED по коду, причине и тексту после JPC", () => {
    expect(isDatabaseBusyError(busyError())).toBe(true);
    expect(isDatabaseBusyError({ code: "SQLITE_LOCKED", message: "database table is locked" })).toBe(true);
    expect(isDatabaseBusyError(new Error("[SqliteError · SQLITE_BUSY] database is locked"))).toBe(true);
    expect(isDatabaseBusyError(new Error("database is locked"))).toBe(true);
    expect(isDatabaseBusyError(new Error("Failed", { cause: busyError() }))).toBe(true);
    expect(isDatabaseBusyError(Object.assign(new Error("disk I/O error"), { code: "SQLITE_IOERR" }))).toBe(false);
    expect(isDatabaseBusyError(new Error("no such table: account"))).toBe(false);
    expect(isDatabaseBusyError(null)).toBe(false);
  });
});

describe("retryWhileDatabaseBusy", () => {
  test("SQLITE_BUSY на первой попытке → успешный повтор", async () => {
    let func = vi.fn()
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce("ok");
    let onBusy = vi.fn();
    expect(await retryWhileDatabaseBusy(func, onBusy, [1, 1])).toBe("ok");
    expect(func).toHaveBeenCalledTimes(2);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect(onBusy.mock.calls[0][1]).toBe(1);
  });

  test("другие ошибки не повторяются", async () => {
    let func = vi.fn().mockRejectedValue(new Error("no such table: account"));
    await expect(retryWhileDatabaseBusy(func, undefined, [1, 1])).rejects.toThrow("no such table");
    expect(func).toHaveBeenCalledTimes(1);
  });

  test("после всех попыток пробрасывает SQLITE_BUSY", async () => {
    let func = vi.fn().mockRejectedValue(busyError());
    await expect(retryWhileDatabaseBusy(func, undefined, [1, 2, 3])).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    expect(func).toHaveBeenCalledTimes(4);
  });

  test("паузы нарастают и в сумме около 30 с", async () => {
    let { kDatabaseBusyRetryDelaysMs } = await import("../../logic/util/retryWhileDatabaseBusy");
    for (let i = 1; i < kDatabaseBusyRetryDelaysMs.length; i++) {
      expect(kDatabaseBusyRetryDelaysMs[i]).toBeGreaterThan(kDatabaseBusyRetryDelaysMs[i - 1]);
    }
    let total = kDatabaseBusyRetryDelaysMs.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(20_000);
    expect(total).toBeLessThanOrEqual(40_000);
  });
});

describe("загрузка стартовых объектов при занятой базе", () => {
  beforeEach(() => {
    appGlobal.remoteApp = {}; // бэкенд уже подключён: проверяем только чтение баз
    appGlobal.emailAccounts.clear();
  });

  afterEach(() => {
    notifications.clear();
    vi.useRealTimers();
  });

  test("getStartObjects: SQLITE_BUSY на первой попытке → повтор, аккаунты не задваиваются", async () => {
    let account = { id: "a1" };
    let attempts = 0;
    reads.mail = async () => {
      attempts++;
      if (attempts == 1) {
        throw busyError();
      }
      return [account];
    };
    let onBusy = vi.fn();
    await getStartObjects(onBusy);
    expect(attempts).toBe(2);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect(appGlobal.emailAccounts.contents).toEqual([account]);
    // Повторный вызов (например, «Повторить» после ошибки) не читает уже прочитанное
    await getStartObjects();
    expect(attempts).toBe(2);
    expect(appGlobal.emailAccounts.contents).toEqual([account]);
  });

  test("пока база занята — баннер о загрузке, после успеха он исчезает", async () => {
    let shownWhileWaiting: string[] = [];
    let onLoaded = vi.fn(async () => {});
    let loaded = await loadStartObjects(async onBusy => {
      onBusy(busyError(), 1, 500);
      onBusy(busyError(), 2, 1000);
      shownWhileWaiting = notifications.contents.map(notification => notification.severity);
    }, onLoaded);
    expect(loaded).toBe(true);
    expect(shownWhileWaiting).toEqual([NotificationSeverity.Info]);
    expect(notifications.contents).toEqual([]);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  test("первая попытка ждёт блокировку долго → баннер о загрузке, а не пустая почта", async () => {
    vi.useFakeTimers();
    let finish: () => void;
    let loading = loadStartObjects(() => new Promise<void>(resolve => finish = resolve), async () => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(notifications.contents).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(notifications.contents.map(notification => notification.severity)).toEqual([NotificationSeverity.Info]);
    finish();
    expect(await loading).toBe(true);
    expect(notifications.contents).toEqual([]);
  });

  test("все попытки не удались → понятная ошибка, «Повторить» запускает загрузку заново", async () => {
    let attempts = 0;
    let getStartObjectsFake = vi.fn(async () => {
      attempts++;
      if (attempts == 1) {
        throw busyError();
      }
    });
    let onLoaded = vi.fn(async () => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await loadStartObjects(getStartObjectsFake, onLoaded)).toBe(false);
    expect(onLoaded).not.toHaveBeenCalled();
    let error = notifications.contents.find(notification => notification.severity == NotificationSeverity.Error);
    expect(error).toBeTruthy();
    expect(error.ex).toMatchObject({ code: "SQLITE_BUSY" });
    expect(error.message).not.toMatch(/SQLITE_BUSY/);
    expect(error.buttons.length).toBe(1);

    await error.buttons.first.onClick();
    expect(getStartObjectsFake).toHaveBeenCalledTimes(2);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });
});
