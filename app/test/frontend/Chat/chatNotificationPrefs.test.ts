// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { chatNotificationKinds, chatNotificationsSetting, isChatRoomMuted, setChatRoomMuted } from "../../../frontend/Chat/chatNotificationPrefs";

const storedValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
    clear: () => storedValues.clear(),
  },
});

beforeEach(() => {
  localStorage.clear();
});

test("по умолчанию — окно и звук, как было до настройки", () => {
  expect(chatNotificationKinds("room-1", "available")).toEqual(["popup", "sound"]);
});

test("выбор пользователя в настройках применяется", () => {
  chatNotificationsSetting.value = ["popup"];
  expect(chatNotificationKinds("room-1", "available")).toEqual(["popup"]);
});

test("«Не беспокоить» и отключённый чат — без окна и звука", () => {
  expect(chatNotificationKinds("room-1", "dnd")).toEqual([]);
  setChatRoomMuted("room-2", true);
  expect(isChatRoomMuted("room-2")).toBe(true);
  expect(chatNotificationKinds("room-2", "available")).toEqual([]);
  expect(chatNotificationKinds("room-1", "busy")).toEqual(["popup", "sound"]);
  setChatRoomMuted("room-2", false);
  expect(chatNotificationKinds("room-2", "available")).toEqual(["popup", "sound"]);
});
