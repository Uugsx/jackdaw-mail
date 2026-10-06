// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from "vitest";
import { appGlobal } from "../../../logic/app";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { syncMailStatusBarWidget, syncMailTaskbarBadge } from "../../../frontend/Mail/mailUnreadCounts";
import { totalUnreadFromAccounts } from "../../../logic/Mail/MailUnreadBadge";
import { NotificationKinds, SystemNotification } from "../../../frontend/Shared/SystemNotification";
import { playNotificationSound } from "../../../frontend/Shared/NotificationSound";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("recognizes appbar and taskbar notification kinds", () => {
  let kinds = new NotificationKinds(["popup", "appbar", "taskbar"]);

  expect(kinds.popup).toBe(true);
  expect(kinds.appbar).toBe(true);
  expect(kinds.taskbar).toBe(true);
  expect(kinds.sound).toBe(false);
});

test("keeps the classic notification sound at the browser default volume", async () => {
  let storage = new Map<string, string>([
    ["notifications.sounds", JSON.stringify({ "mail-incoming": "default" })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let audio = {
    play: vi.fn(async () => {}),
    addEventListener: vi.fn(),
  };
  let AudioMock = vi.fn(function() {
    return audio;
  });
  vi.stubGlobal("Audio", AudioMock);

  await playNotificationSound("mail-incoming", { preview: true });

  expect(AudioMock).toHaveBeenCalledWith("sound/new-message.mp3");
  expect(audio.volume).toBeUndefined();
  expect(audio.play).toHaveBeenCalledOnce();
});

test("updates the native badge for taskbar notifications", async () => {
  let previousRemoteApp = appGlobal.remoteApp;
  let setBadgeCount = vi.fn(async () => {});
  appGlobal.remoteApp = { setBadgeCount };

  try {
    let notification = new SystemNotification(
      new NotificationKinds(["taskbar"]),
      "New mail",
      "A message arrived",
      "test-notification",
    );
    notification.count = 3;

    await notification.show();

    expect(setBadgeCount).toHaveBeenCalledWith(3);
  } finally {
    appGlobal.remoteApp = previousRemoteApp;
  }
});

test("allows a domain-owned badge to skip notification-level updates", async () => {
  let previousRemoteApp = appGlobal.remoteApp;
  let setBadgeCount = vi.fn(async () => {});
  appGlobal.remoteApp = { setBadgeCount };

  try {
    let notification = new SystemNotification(
      new NotificationKinds(["taskbar"]),
      "New mail",
      "A message arrived",
      "mail-notification",
    );
    notification.updatesTaskbarBadge = false;

    await notification.show();

    expect(setBadgeCount).not.toHaveBeenCalled();
  } finally {
    appGlobal.remoteApp = previousRemoteApp;
  }
});

test("does not treat arrived-only mail as unread", () => {
  let account = {
    protocol: "mail",
    findFolder: () => null,
    inbox: { countUnread: 0, countNewArrived: 1 },
  } as any;

  expect(totalUnreadFromAccounts([account])).toBe(0);
});

test("clears the native badge when taskbar notifications have no unread mail", async () => {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let previousRemoteApp = appGlobal.remoteApp;
  let notificationsSetting = getLocalStorage<string[]>("notifications.mail", ["popup", "sound"]);
  let previousSetting = notificationsSetting.value;
  let setBadgeCount = vi.fn(async () => {});
  appGlobal.remoteApp = { setBadgeCount };

  try {
    notificationsSetting.value = ["taskbar"];
    syncMailTaskbarBadge();

    await vi.waitFor(() => expect(setBadgeCount).toHaveBeenLastCalledWith(0));
  } finally {
    notificationsSetting.value = previousSetting;
    appGlobal.remoteApp = previousRemoteApp;
  }
});

test("keeps the persistent Mail status bar widget synchronized", async () => {
  let context = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,status-bar");
  vi.stubGlobal("Image", class {
    src = "";
    async decode() {}
  });

  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let previousRemoteApp = appGlobal.remoteApp;
  let statusBarSetting = getLocalStorage<boolean>("notifications.mail.statusbar", true);
  let previousSetting = statusBarSetting.value;
  let setStatusBarIcon = vi.fn(async () => {});
  let clearStatusBarIcon = vi.fn(async () => {});
  statusBarSetting.value = true;
  appGlobal.remoteApp = { setStatusBarIcon, clearStatusBarIcon };

  try {
    syncMailStatusBarWidget();

    await vi.waitFor(() => expect(setStatusBarIcon).toHaveBeenCalledWith(
      "data:image/png;base64,status-bar",
      "Jackdaw Mail",
      expect.any(Function),
      expect.objectContaining({
        newMessage: expect.any(Function),
        fetchMail: expect.any(Function),
        openSettings: expect.any(Function),
        disableWidget: expect.any(Function),
        unreadCount: expect.any(Number),
      }),
    ));

    statusBarSetting.value = false;
    await vi.waitFor(() => expect(clearStatusBarIcon).toHaveBeenCalledOnce());
  } finally {
    statusBarSetting.value = previousSetting;
    appGlobal.remoteApp = previousRemoteApp;
  }
});
