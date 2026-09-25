import type { NotificationSoundId } from "../Shared/NotificationSound";

export type NotificationSoundPickerSound =
  | "global"
  | "account"
  | "custom"
  | NotificationSoundId;

export type NotificationSoundPickerChange = {
  sound?: NotificationSoundPickerSound;
  customSoundDataURL?: string | null;
  customSoundName?: string | null;
};
