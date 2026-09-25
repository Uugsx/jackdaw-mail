import { afterEach, expect, test, vi } from "vitest";
import {
  getMailAccountNotificationSetting,
  getMailNotificationSound,
  readMailAccountNotificationSettings,
  updateMailAccountNotificationSettings,
} from "../../../frontend/Mail/mailNotificationSettings";
import {
  canNotifyMailFolder,
  getMailFolderNotificationSetting,
  getMailFolderNotificationSound,
  readMailFolderNotificationSettings,
  syncMailFolderNotificationPolling,
  updateMailFolderNotificationSettings,
} from "../../../frontend/Mail/mailFolderNotificationSettings";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { Folder } from "../../../logic/Mail/Folder";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(): Map<string, string> {
  let values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

test("хранит настройки уведомлений отдельно для разных ящиков", () => {
  stubStorage();
  let accountA = { id: "notification-test-a" } as MailAccount;
  let accountB = { id: "notification-test-b" } as MailAccount;

  updateMailAccountNotificationSettings(accountA, { enabled: false, sound: "bell" });

  expect(readMailAccountNotificationSettings(getMailAccountNotificationSetting(accountA).value)).toMatchObject({
    enabled: false,
    sound: "bell",
  });
  expect(readMailAccountNotificationSettings(getMailAccountNotificationSetting(accountB).value)).toMatchObject({
    enabled: true,
    sound: "global",
  });
});

test("возвращает пользовательский звук для выбранного ящика", () => {
  stubStorage();
  let account = { id: "notification-test-custom" } as MailAccount;
  let dataURL = "data:audio/wav;base64,AAAA";

  updateMailAccountNotificationSettings(account, {
    sound: "custom",
    customSoundDataURL: dataURL,
    customSoundName: "office.wav",
  });

  expect(getMailNotificationSound(account)).toEqual({
    id: "custom",
    dataURL,
    name: "office.wav",
  });
});

test("возвращает глобальный звук для повреждённой настройки пользовательского звука", () => {
  stubStorage();
  let account = { id: "notification-test-invalid-custom" } as MailAccount;

  updateMailAccountNotificationSettings(account, { sound: "custom" });

  expect(readMailAccountNotificationSettings(getMailAccountNotificationSetting(account).value).sound)
    .toBe("global");
});

test("хранит настройки уведомлений отдельно для разных папок", () => {
  stubStorage();
  let account = { id: "folder-notification-test" } as MailAccount;
  let folderA = { id: "important", dbID: 101, account } as Folder;
  let folderB = { id: "regular", dbID: 102, account } as Folder;

  updateMailFolderNotificationSettings(folderA, { enabled: false, sound: "alarm" });

  expect(readMailFolderNotificationSettings(getMailFolderNotificationSetting(folderA).value))
    .toMatchObject({ enabled: false, sound: "alarm" });
  expect(readMailFolderNotificationSettings(getMailFolderNotificationSetting(folderB).value))
    .toMatchObject({ enabled: true, sound: "account" });
});

test("использует звук ящика по умолчанию и отдельный звук папки после настройки", () => {
  stubStorage();
  let account = { id: "folder-notification-sound-test" } as MailAccount;
  let folder = { id: "important", dbID: 103, account } as Folder;

  updateMailAccountNotificationSettings(account, { sound: "bell" });
  expect(getMailFolderNotificationSound(folder)).toBe("bell");

  updateMailFolderNotificationSettings(folder, { sound: "chime" });
  expect(getMailFolderNotificationSound(folder)).toBe("chime");

  let dataURL = "data:audio/wav;base64,AAAA";
  updateMailFolderNotificationSettings(folder, {
    sound: "custom",
    customSoundDataURL: dataURL,
    customSoundName: "important.wav",
  });
  expect(getMailFolderNotificationSound(folder)).toEqual({
    id: "custom",
    dataURL,
    name: "important.wav",
  });
});

test("не включает уведомления для исходящей папки", () => {
  let folder = { specialFolder: "sent" } as Folder;
  expect(canNotifyMailFolder(folder)).toBe(false);
  expect(canNotifyMailFolder({ specialFolder: "normal" } as Folder)).toBe(true);
});

test("запускает фоновую проверку только для явно настроенной папки", () => {
  stubStorage();
  let startPolling = vi.fn();
  let stopPolling = vi.fn();
  let fetchNewMailQuick = vi.fn(() => Promise.resolve());
  let account = {
    id: "folder-notification-polling-test",
    protocol: "graph",
    errorCallback: vi.fn(),
  } as unknown as MailAccount;
  let folder = {
    id: "important",
    dbID: 104,
    account,
    specialFolder: "normal",
    startPolling,
    stopPolling,
    fetchNewMailQuick,
  } as unknown as Folder;

  syncMailFolderNotificationPolling(folder);
  expect(startPolling).not.toHaveBeenCalled();
  updateMailFolderNotificationSettings(folder, { enabled: true });
  expect(startPolling).toHaveBeenCalledOnce();
  expect(fetchNewMailQuick).toHaveBeenCalledOnce();

  updateMailFolderNotificationSettings(folder, { enabled: false });
  expect(stopPolling).toHaveBeenCalledOnce();
});

test("использует резервный опрос для протокола без опроса на уровне папки", () => {
  vi.useFakeTimers();
  try {
    stubStorage();
    let fetchNewMailQuick = vi.fn(() => Promise.resolve());
    let account = {
      id: "folder-notification-fallback-test",
      protocol: "owa",
      isLoggedIn: true,
      errorCallback: vi.fn(),
    } as unknown as MailAccount;
    let folder = {
      id: "important",
      dbID: 105,
      account,
      specialFolder: "normal",
      fetchNewMailQuick,
    } as unknown as Folder;

    updateMailFolderNotificationSettings(folder, { enabled: true });
    expect(fetchNewMailQuick).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60 * 1000);
    expect(fetchNewMailQuick).toHaveBeenCalledTimes(2);

    updateMailFolderNotificationSettings(folder, { enabled: false });
    vi.advanceTimersByTime(60 * 1000);
    expect(fetchNewMailQuick).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
