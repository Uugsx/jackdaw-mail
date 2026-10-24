// @vitest-environment happy-dom
import { describe, expect, test, beforeEach } from "vitest";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  },
});

const { callLog, recordCallInLog, removeCallLogEntry, clearCallLog, callLogSummary, loadCallLog, CALL_LOG_LIMIT } =
  await import("../../../../logic/Meet/Jackdaw/callLog");

const STORAGE_KEY = "jackdaw.calls.log.v1";

function fakeCall(overrides: Record<string, any> = {}): any {
  return {
    callID: crypto.randomUUID(),
    remoteEmail: "bob@example.com",
    participants: { first: { name: "Bob" } },
    outgoing: true,
    hasVideo: false,
    started: null,
    ended: new Date("2026-10-22T10:00:00Z"),
    endReason: null,
    missed: false,
    ...overrides,
  };
}

describe("журнал звонков", () => {
  beforeEach(() => {
    clearCallLog();
  });

  test("разговор: длительность, видео и сводка", () => {
    recordCallInLog(fakeCall({
      hasVideo: true,
      started: new Date("2026-10-22T10:00:00Z"),
      ended: new Date("2026-10-22T10:03:12Z"),
    }));
    let entry = callLog.first;
    expect(entry.email).toBe("bob@example.com");
    expect(entry.name).toBe("Bob");
    expect(entry.video).toBe(true);
    expect(entry.duration).toBe(192);
    expect(entry.at).toBe(new Date("2026-10-22T10:00:00Z").getTime());
    expect(callLogSummary(entry)).toBe("Outgoing call · 3:12");
  });

  test("пропущенный и неотвеченный: без длительности, новые первыми", () => {
    recordCallInLog(fakeCall({ endReason: "no-answer" }));
    recordCallInLog(fakeCall({ outgoing: false, endReason: "cancelled", missed: true, remoteEmail: "carol@example.com", participants: { first: null } }));
    expect(callLog.length).toBe(2);
    let [missed, unanswered] = callLog.contents;
    expect(missed.name).toBe("carol@example.com");
    expect(missed.duration).toBeNull();
    expect(callLogSummary(missed)).toBe("Missed call");
    expect(callLogSummary(unanswered)).toBe("Outgoing call · no answer");
  });

  test("сохраняется, повторная запись того же звонка не дублируется, предел записей", () => {
    let call = fakeCall({ endReason: "declined" });
    recordCallInLog(call);
    recordCallInLog(call);
    expect(callLog.length).toBe(1);
    let saved = JSON.parse(store.get(STORAGE_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(call.callID);

    for (let i = 0; i < CALL_LOG_LIMIT + 5; i++) {
      recordCallInLog(fakeCall());
    }
    expect(callLog.length).toBe(CALL_LOG_LIMIT);
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toHaveLength(CALL_LOG_LIMIT);
  });

  test("удаление одной записи и очистка", () => {
    recordCallInLog(fakeCall());
    recordCallInLog(fakeCall());
    removeCallLogEntry(callLog.first);
    expect(callLog.length).toBe(1);
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toHaveLength(1);
    clearCallLog();
    expect(callLog.length).toBe(0);
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual([]);
  });

  test("звонок без адреса не записывается; повторная загрузка не затирает журнал", () => {
    recordCallInLog(fakeCall({ remoteEmail: "" }));
    expect(callLog.length).toBe(0);
    recordCallInLog(fakeCall());
    store.set(STORAGE_KEY, "{broken");
    expect(loadCallLog().length).toBe(1);
  });
});
