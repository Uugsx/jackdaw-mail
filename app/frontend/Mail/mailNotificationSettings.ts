import type { MailAccount } from "../../logic/Mail/MailAccount";
import {
  getNotificationSound,
  isNotificationSoundId,
  type NotificationSoundId,
  type NotificationSoundSelection,
} from "../Shared/NotificationSound";
import { getLocalStorage } from "../Util/LocalStorage";

export type MailAccountNotificationSound =
  "global" | "custom" | NotificationSoundId;

export interface MailAccountNotificationSettings {
  enabled: boolean;
  sound: MailAccountNotificationSound;
  customSoundDataURL: string | null;
  customSoundName: string | null;
}

type StoredMailAccountNotificationSettings =
  Partial<MailAccountNotificationSettings>;

export const kMaxCustomNotificationSoundBytes = 2 * 1024 * 1024;
const kMaxCustomNotificationSoundDataURLLength =
  Math.ceil((kMaxCustomNotificationSoundBytes * 4) / 3) + 128;
const kMailAccountNotificationSettingsPrefix = "notifications.mail.account.";

const defaultMailAccountNotificationSettings: MailAccountNotificationSettings =
  {
    enabled: true,
    sound: "global",
    customSoundDataURL: null,
    customSoundName: null,
  };

/** Raw observable setting for one mailbox. It is intentionally separate from
 * the global notification channels in `notifications.mail`. */
export function getMailAccountNotificationSetting(
  account: MailAccount | null | undefined,
) {
  return getLocalStorage<StoredMailAccountNotificationSettings>(
    settingKey(account),
    {},
  );
}

export function readMailAccountNotificationSettings(
  value: unknown,
): MailAccountNotificationSettings {
  let stored =
    value && typeof value == "object"
      ? (value as StoredMailAccountNotificationSettings)
      : {};
  let sound: MailAccountNotificationSound = "global";
  if (
    stored.sound == "global" ||
    stored.sound == "custom" ||
    isNotificationSoundId(stored.sound)
  ) {
    sound = stored.sound;
  }
  let customSoundDataURL = normalizeCustomNotificationSoundDataURL(
    stored.customSoundDataURL,
  );
  if (sound == "custom" && !customSoundDataURL) {
    sound = "global";
  }
  return {
    enabled:
      typeof stored.enabled == "boolean"
        ? stored.enabled
        : defaultMailAccountNotificationSettings.enabled,
    sound,
    customSoundDataURL,
    customSoundName: customSoundDataURL
      ? normalizeCustomNotificationSoundName(stored.customSoundName)
      : null,
  };
}

export function updateMailAccountNotificationSettings(
  account: MailAccount | null | undefined,
  patch: Partial<MailAccountNotificationSettings>,
): void {
  if (!account?.id) {
    return;
  }
  let setting = getMailAccountNotificationSetting(account);
  setting.value = readMailAccountNotificationSettings({
    ...readMailAccountNotificationSettings(setting.value),
    ...patch,
  });
}

export function getMailNotificationSound(
  account: MailAccount | null | undefined,
): NotificationSoundSelection {
  let settings = readMailAccountNotificationSettings(
    getMailAccountNotificationSetting(account).value,
  );
  if (settings.sound == "global") {
    return getNotificationSound("mail-incoming");
  }
  if (settings.sound == "custom") {
    if (settings.customSoundDataURL) {
      return {
        id: "custom",
        dataURL: settings.customSoundDataURL,
        name: settings.customSoundName ?? undefined,
      };
    }
    return getNotificationSound("mail-incoming");
  }
  return settings.sound;
}

function settingKey(account: MailAccount | null | undefined): string {
  return `${kMailAccountNotificationSettingsPrefix}${account?.id ?? "default"}`;
}

export function normalizeCustomNotificationSoundDataURL(value: unknown): string | null {
  return typeof value == "string" &&
    value.startsWith("data:audio/") &&
    value.length <= kMaxCustomNotificationSoundDataURLLength
    ? value
    : null;
}

export function normalizeCustomNotificationSoundName(value: unknown): string | null {
  return typeof value == "string" && value ? value.slice(0, 120) : null;
}
