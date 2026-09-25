import type { Folder } from "../../logic/Mail/Folder";
import {
  getMailNotificationSound,
  normalizeCustomNotificationSoundDataURL,
  normalizeCustomNotificationSoundName,
} from "./mailNotificationSettings";
import {
  getNotificationSound,
  isNotificationSoundId,
  type NotificationSoundId,
  type NotificationSoundSelection,
} from "../Shared/NotificationSound";
import { getLocalStorage } from "../Util/LocalStorage";

export type MailFolderNotificationSound = "account" | "custom" | NotificationSoundId;

export interface MailFolderNotificationSettings {
  enabled: boolean;
  sound: MailFolderNotificationSound;
  customSoundDataURL: string | null;
  customSoundName: string | null;
}

type StoredMailFolderNotificationSettings = Partial<MailFolderNotificationSettings>;

const kMailFolderNotificationSettingsPrefix = "notifications.mail.folder.";
const kNonNotificationSpecialFolders = new Set([
  "sent",
  "drafts",
  "trash",
  "spam",
  "outbox",
  "all",
  "search",
]);
const notificationPollingFolders = new WeakSet<Folder>();
const notificationPollingTimers = new WeakMap<Folder, ReturnType<typeof setInterval>>();
const kFallbackMailFolderNotificationPollingIntervalMs = 60 * 1000;

const defaultMailFolderNotificationSettings: MailFolderNotificationSettings = {
  enabled: true,
  sound: "account",
  customSoundDataURL: null,
  customSoundName: null,
};

/** Наблюдаемая настройка одной папки. Если её нет, сохраняется текущее
 * поведение уведомлений на уровне ящика. */
export function getMailFolderNotificationSetting(folder: Folder | null | undefined) {
  return getLocalStorage<StoredMailFolderNotificationSettings>(
    settingKey(folder),
    {},
  );
}

export function readMailFolderNotificationSettings(
  value: unknown,
): MailFolderNotificationSettings {
  let stored =
    value && typeof value == "object"
      ? (value as StoredMailFolderNotificationSettings)
      : {};
  let sound: MailFolderNotificationSound = "account";
  if (
    stored.sound == "account" ||
    stored.sound == "custom" ||
    isNotificationSoundId(stored.sound)
  ) {
    sound = stored.sound;
  }
  let customSoundDataURL = normalizeCustomNotificationSoundDataURL(
    stored.customSoundDataURL,
  );
  if (sound == "custom" && !customSoundDataURL) {
    sound = "account";
  }
  return {
    enabled:
      typeof stored.enabled == "boolean"
        ? stored.enabled
        : defaultMailFolderNotificationSettings.enabled,
    sound,
    customSoundDataURL,
    customSoundName: customSoundDataURL
      ? normalizeCustomNotificationSoundName(stored.customSoundName)
      : null,
  };
}

export function updateMailFolderNotificationSettings(
  folder: Folder | null | undefined,
  patch: Partial<MailFolderNotificationSettings>,
): void {
  if (!hasFolderStorageKey(folder)) {
    return;
  }
  let setting = getMailFolderNotificationSetting(folder);
  setting.value = readMailFolderNotificationSettings({
    ...readMailFolderNotificationSettings(setting.value),
    ...patch,
  });
  syncMailFolderNotificationPolling(folder);
}

export function getMailFolderNotificationSound(
  folder: Folder | null | undefined,
): NotificationSoundSelection {
  let settings = readMailFolderNotificationSettings(
    getMailFolderNotificationSetting(folder).value,
  );
  if (settings.sound == "account") {
    return folder
      ? getMailNotificationSound(folder.account)
      : getNotificationSound("mail-incoming");
  }
  if (settings.sound == "custom") {
    if (settings.customSoundDataURL) {
      return {
        id: "custom",
        dataURL: settings.customSoundDataURL,
        name: settings.customSoundName ?? undefined,
      };
    }
    return folder
      ? getMailNotificationSound(folder.account)
      : getNotificationSound("mail-incoming");
  }
  return settings.sound;
}

/** Может ли папка получать уведомления о входящей почте. */
export function canNotifyMailFolder(folder: Folder): boolean {
  return !kNonNotificationSpecialFolders.has(folder.specialFolder);
}

/** Запускает фоновую синхронизацию только для явно настроенных папок.
 * Для остальных сохраняется обычное поведение опроса ящика. */
export function syncMailFolderNotificationPolling(
  folder: Folder | null | undefined,
  forceRestart = false,
): void {
  if (!folder || !hasMailFolderNotificationSetting(folder)) {
    stopMailFolderNotificationPolling(folder);
    return;
  }
  let settings = readMailFolderNotificationSettings(
    getMailFolderNotificationSetting(folder).value,
  );
  if (!settings.enabled || !canNotifyMailFolder(folder)) {
    stopMailFolderNotificationPolling(folder);
    return;
  }

  let pollable = folder as Folder & {
    startPolling?: () => void;
    stopPolling?: () => void;
    fetchNewMailQuick?: () => Promise<unknown>;
  };
  if (forceRestart && notificationPollingFolders.has(folder)) {
    if (folder.specialFolder != "inbox") {
      pollable.stopPolling?.();
    }
    let timer = notificationPollingTimers.get(folder);
    if (timer) {
      clearInterval(timer);
      notificationPollingTimers.delete(folder);
    }
    notificationPollingFolders.delete(folder);
  }
  if (!notificationPollingFolders.has(folder)) {
    notificationPollingFolders.add(folder);
    if (folder.account.isLoggedIn !== false) {
      if (pollable.startPolling) {
        pollable.startPolling();
        if (folder.account.protocol != "imap") {
          refreshMailFolder(folder, pollable);
        }
      } else {
        let timer = setInterval(() => refreshMailFolder(folder, pollable),
          kFallbackMailFolderNotificationPollingIntervalMs);
        notificationPollingTimers.set(folder, timer);
        refreshMailFolder(folder, pollable);
      }
    }
  }
}

export function stopMailFolderNotificationPolling(folder: Folder | null | undefined): void {
  if (!folder || !notificationPollingFolders.has(folder)) {
    return;
  }
  let timer = notificationPollingTimers.get(folder);
  if (timer) {
    clearInterval(timer);
    notificationPollingTimers.delete(folder);
  }
  if (folder.specialFolder != "inbox") {
    (folder as Folder & { stopPolling?: () => void }).stopPolling?.();
  }
  notificationPollingFolders.delete(folder);
}

function refreshMailFolder(
  folder: Folder,
  pollable: Folder & { fetchNewMailQuick?: () => Promise<unknown> },
): void {
  if (folder.account.isLoggedIn === false) {
    return;
  }
  try {
    let refresh = pollable.fetchNewMailQuick?.();
    refresh?.catch(folder.account.errorCallback);
  } catch (ex) {
    folder.account.errorCallback(ex);
  }
}

export function hasMailFolderNotificationSetting(folder: Folder | null | undefined): boolean {
  if (!hasFolderStorageKey(folder)) {
    return false;
  }
  let value = getMailFolderNotificationSetting(folder).value;
  return !!value && typeof value == "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0;
}

function hasFolderStorageKey(folder: Folder | null | undefined): boolean {
  return !!folder?.account?.id &&
    (!!folder.id || folder.dbID != null);
}

function settingKey(folder: Folder | null | undefined): string {
  if (!hasFolderStorageKey(folder)) {
    return `${kMailFolderNotificationSettingsPrefix}default`;
  }
  let folderReference = folder.dbID != null
    ? `db:${folder.dbID}`
    : `id:${folder.id}`;
  return `${kMailFolderNotificationSettingsPrefix}${folder.account.id}.${encodeURIComponent(folderReference)}`;
}
