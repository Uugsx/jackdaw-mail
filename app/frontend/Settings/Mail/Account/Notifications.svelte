<vbox class="page">
  <PageHeader
    title={$t`Notifications`}
    subtitle={$t`Configure notifications for this mailbox`} />

  <HeaderGroupBox>
    <hbox slot="header">{$t`New mail`}</hbox>
    <label class="checkbox-row">
      <input
        type="checkbox"
        checked={notificationSettings.enabled}
        on:change={onEnabledChange}
        />
      {$t`Notify me about new mail in this mailbox`}
    </label>
    <span class="hint">
      {$t`The notification includes this mailbox name, so you can tell which account received the message.`}
    </span>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">{$t`Notification sound`}</hbox>
    <hbox class="subtitle">
      {$t`Choose a sound for incoming mail in this mailbox. This overrides the global mail sound.`}
    </hbox>
    <MailNotificationSoundPicker
      sound={notificationSettings.sound}
      customSoundDataURL={notificationSettings.customSoundDataURL}
      customSoundName={notificationSettings.customSoundName}
      fallbackSound="global"
      fallbackLabel={$t`Use global mail sound`}
      previewSelection={previewSound}
      selectId="mail-account-notification-sound"
      on:change={onSoundChange} />
  </HeaderGroupBox>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { t } from "../../../../l10n/l10n";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import PageHeader from "../../Shared/PageHeader.svelte";
  import MailNotificationSoundPicker from "../../../Mail/MailNotificationSoundPicker.svelte";
  import type { NotificationSoundPickerChange } from "../../../Mail/mailNotificationSoundPicker";
  import {
    getMailAccountNotificationSetting,
    getMailNotificationSound,
    readMailAccountNotificationSettings,
    updateMailAccountNotificationSettings,
  } from "../../../Mail/mailNotificationSettings";
  import {
    isNotificationSoundId,
  } from "../../../Shared/NotificationSound";

  export let account: MailAccount;

  let setting = getMailAccountNotificationSetting(account);
  $: setting = getMailAccountNotificationSetting(account);
  $: notificationSettings = readMailAccountNotificationSettings($setting.value);
  $: previewSound = getMailNotificationSound(account);

  function onEnabledChange(event: Event): void {
    updateMailAccountNotificationSettings(account, {
      enabled: (event.currentTarget as HTMLInputElement).checked,
    });
  }

  function onSoundChange(event: CustomEvent<NotificationSoundPickerChange>): void {
    let value = event.detail.sound;
    if (value == "global" || value == "custom" || isNotificationSoundId(value)) {
      updateMailAccountNotificationSettings(account, {
        ...event.detail,
        sound: value,
      });
    }
  }
</script>

<style>
  .page {
    max-width: 48em;
  }
  .subtitle {
    margin-block-end: 16px;
  }
  .checkbox-row {
    align-items: center;
    gap: 8px;
  }
  .hint {
    color: var(--input-placeholder);
    display: block;
    font-size: 13px;
    line-height: 1.4;
    margin-block-start: 8px;
  }
</style>
