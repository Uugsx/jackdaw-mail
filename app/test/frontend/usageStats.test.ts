import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

vi.mock("../../logic/app", () => ({
  appGlobal: { remoteApp: { platform: async () => "darwin", arch: async () => "arm64" } },
}));
vi.mock("../../logic/build", () => ({ appVersion: "0.10.5", isMobile: false, webMail: false }));

import { mapOS, sanitizeArch, sendUsageStatsPing, shouldPing, usageStatsSetting, utcDay } from "../../frontend/MainWindow/usageStats";

beforeEach(() => {
  store.clear();
  usageStatsSetting.value = true;
  vi.restoreAllMocks();
});

describe("анонимная статистика", () => {
  test("ОС и архитектура приводятся к формату сервера", () => {
    expect(mapOS("darwin")).toBe("mac");
    expect(mapOS("win32")).toBe("win");
    expect(mapOS("freebsd")).toBeNull();
    expect(sanitizeArch("arm64")).toBe("arm64");
    expect(sanitizeArch("X64")).toBe("x64");
    expect(sanitizeArch(undefined)).toBe("unknown");
  });

  test("отправляет один пинг в сутки с минимумом данных", async () => {
    let fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendUsageStatsPing()).toBe(true);
    let [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://license.jackdaw-mail.pro/v1/telemetry/ping");
    let body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["arch", "installId", "os", "version"]);
    expect(body.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body).toMatchObject({ version: "0.10.5", os: "mac", arch: "arm64" });
    expect(await sendUsageStatsPing()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shouldPing(new Date(Date.now() + 36 * 3600_000))).toBe(true);
    expect(utcDay(new Date("2026-11-19T23:59:00Z"))).toBe("2026-11-19");
  });

  test("при выключателе ничего не отправляется", async () => {
    let fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    usageStatsSetting.value = false;
    expect(await sendUsageStatsPing()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("сетевая ошибка молча проглатывается и день не отмечается", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await sendUsageStatsPing()).toBe(false);
    expect(shouldPing()).toBe(true);
  });
});
