<HeaderGroupBox>
  <hbox slot="header">{$t`Notifications`}</hbox>
  <label class="checkbox-row">
    <input
      type="checkbox"
      checked={notificationSettings.enabled}
      on:change={onEnabledChange} />
    {$t`Notify me about new mail in this folder`}
  </label>
  <span class="hint">
    {$t`These settings apply only to this folder and override the mailbox sound.`}
  </span>
  <MailNotificationSoundPicker
    sound={notificationSettings.sound}
    customSoundDataURL={notificationSettings.customSoundDataURL}
    customSoundName={notificationSettings.customSoundName}
    fallbackSound="account"
    fallbackLabel={$t`Use account mail sound`}
    previewSelection={previewSound}
    selectId="mail-folder-notification-sound"
    on:change={onSoundChange} />
</HeaderGroupBox>

<script lang="ts">
  import type { Folder } from "../../../../logic/Mail/Folder";
  import { t } from "../../../../l10n/l10n";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import MailNotificationSoundPicker from "../../../Mail/MailNotificationSoundPicker.svelte";
  import type { NotificationSoundPickerChange } from "../../../Mail/mailNotificationSoundPicker";
  import {
    getMailFolderNotificationSetting,
    getMailFolderNotificationSound,
    readMailFolderNotificationSettings,
    updateMailFolderNotificationSettings,
  } from "../../../Mail/mailFolderNotificationSettings";
  import { isNotificationSoundId } from "../../../Shared/NotificationSound";

  export let folder: Folder;

  let setting = getMailFolderNotificationSetting(folder);
  $: setting = getMailFolderNotificationSetting(folder);
  $: notificationSettings = readMailFolderNotificationSettings($setting.value);
  $: previewSound = getMailFolderNotificationSound(folder);

  function onEnabledChange(event: Event): void {
    updateMailFolderNotificationSettings(folder, {
      enabled: (event.currentTarget as HTMLInputElement).checked,
    });
  }

  function onSoundChange(event: CustomEvent<NotificationSoundPickerChange>): void {
    let value = event.detail.sound;
    if (value == "account" || value == "custom" || isNotificationSoundId(value)) {
      updateMailFolderNotificationSettings(folder, {
        ...event.detail,
        sound: value,
      });
    }
  }
</script>

<style>
  .checkbox-row {
    align-items: center;
    gap: 8px;
  }
  .hint {
    color: var(--input-placeholder);
    display: block;
    font-size: 13px;
    line-height: 1.4;
    margin-block: 8px 16px;
  }
</style>
