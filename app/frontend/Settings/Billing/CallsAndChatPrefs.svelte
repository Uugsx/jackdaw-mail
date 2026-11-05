<HeaderGroupBox>
  <hbox slot="header">{$t`Your status`}</hbox>
  <vbox class="group">
    <hbox class="row">
      <MyStatusButton />
    </hbox>
    <p class="hint">{$t`Your status is shared by all your devices. Busy: calls still ring and the caller sees that you are busy. Do not disturb: calls are declined and chat messages arrive without sound or pop-ups.`}</p>
  </vbox>
</HeaderGroupBox>

<HeaderGroupBox>
  <hbox slot="header">{$t`Call sounds`}</hbox>
  <vbox class="group">
    <label class="row" for="call-ringtone">
      <span class="name">{$t`Ringtone`}</span>
      <select id="call-ringtone" bind:value={$ringtoneSetting.value}>
        {#each callRingtones as ringtone}
          <option value={ringtone}>{callRingtoneLabel(ringtone)}</option>
        {/each}
      </select>
      <Button label={previewing ? $t`Stop` : $t`Listen`} classes="secondary small"
        disabled={$ringtoneSetting.value == "none"}
        onClick={togglePreview} />
    </label>
    <label class="row" for="call-volume">
      <span class="name">{$t`Call volume`}</span>
      <input id="call-volume" type="range" min="0" max="1" step="0.05" bind:value={$volumeSetting.value} />
      <span class="value">{Math.round(Number($volumeSetting.value) * 100)} %</span>
    </label>
    <p class="hint">{$t`The ringtone and the other person's voice play on the speaker chosen in Meet → Devices.`}</p>
  </vbox>
</HeaderGroupBox>

<ChatNotifications />

<HeaderGroupBox>
  <hbox slot="header">{$t`Notification volume`}</hbox>
  <vbox class="group">
    <label class="row" for="notification-volume">
      <span class="name">{$t`Volume`}</span>
      <input id="notification-volume" type="range" min="0" max="1" step="0.05" bind:value={$notificationVolume.value} />
      <span class="value">{Math.round(Number($notificationVolume.value) * 100)} %</span>
      <Button label={$t`Listen`} classes="secondary small"
        onClick={() => playNotificationSound("chat", { preview: true })} />
    </label>
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  /** Статус, звуки звонка и уведомления чата Jackdaw */
  import { onDestroy } from "svelte";
  import { callRingtoneLabel, callRingtones, callRingtoneSetting, callVolumeSetting, playIncomingRingtone, type CallSoundHandle } from "../../Meet/callSounds";
  import { notificationVolumeSetting, playNotificationSound } from "../../Shared/NotificationSound";
  import MyStatusButton from "../../Chat/Status/MyStatusButton.svelte";
  import ChatNotifications from "../Chat/Notifications.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import { t } from "../../../l10n/l10n";

  /** Прослушивание мелодии останавливается само через несколько секунд */
  const kPreviewSeconds = 6;
  const ringtoneSetting = callRingtoneSetting;
  const volumeSetting = callVolumeSetting;
  const notificationVolume = notificationVolumeSetting;

  let preview: CallSoundHandle | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let previewing = false;

  function togglePreview() {
    if (previewing) {
      stopPreview();
      return;
    }
    preview = playIncomingRingtone();
    previewing = true;
    previewTimer = setTimeout(stopPreview, kPreviewSeconds * 1000);
  }

  function stopPreview() {
    preview?.stop();
    preview = null;
    previewing = false;
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  // Новая мелодия или громкость — прослушивание начинается заново
  $: $ringtoneSetting.value, $volumeSetting.value, previewing && restartPreview();
  function restartPreview() {
    stopPreview();
    togglePreview();
  }

  onDestroy(stopPreview);
</script>

<style>
  .group {
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .name {
    min-width: 10em;
  }
  .value {
    min-width: 3.5em;
    font-variant-numeric: tabular-nums;
  }
  input[type="range"] {
    width: 200px;
    max-width: 100%;
  }
  .hint {
    margin: 0;
    max-width: 44em;
    line-height: 1.45;
    opacity: 0.8;
  }
</style>
