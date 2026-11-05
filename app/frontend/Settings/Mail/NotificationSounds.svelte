<vbox class="sound-settings">
  <hbox class="sound-list" role="list">
    {#each events as event}
      <hbox class="sound-row" role="listitem">
        <vbox flex class="sound-copy">
          <label for="notification-sound-{event}">{eventLabel(event)}</label>
          <span class="hint">{eventHint(event)}</span>
        </vbox>
        <select
          id="notification-sound-{event}"
          value={selectedSound(event)}
          on:change={changeEvent => onSoundChange(event, changeEvent.currentTarget.value)}>
          {#each notificationSoundOptions as sound}
            <option value={sound}>{soundLabel(sound)}</option>
          {/each}
        </select>
        <button
          class="preview-button"
          type="button"
          aria-label={$t`Preview ${soundLabel(selectedSound(event))}`}
          title={$t`Preview`}
          disabled={selectedSound(event) === "none"}
          on:click={() => preview(event)}>
          <Volume2 size="16" />
        </button>
      </hbox>
    {/each}
  </hbox>
</vbox>

<script lang="ts">
  import Volume2 from "lucide-svelte/icons/volume-2";
  import { t } from "../../../l10n/l10n";
  import {
    getNotificationSound,
    notificationSoundOptions,
    playNotificationSound,
    setNotificationSound,
    type NotificationSoundEvent,
    type NotificationSoundId,
  } from "../../Shared/NotificationSound";

  export let events: NotificationSoundEvent[];
  let selectedSounds: Partial<Record<NotificationSoundEvent, NotificationSoundId>> = {};

  function selectedSound(event: NotificationSoundEvent): NotificationSoundId {
    return selectedSounds[event] ?? getNotificationSound(event);
  }

  function eventLabel(event: NotificationSoundEvent): string {
    switch (event) {
      case "mail-incoming": return $t`Incoming mail`;
      case "mail-outgoing": return $t`Outgoing mail`;
      case "calendar": return $t`Calendar reminders`;
      case "chat": return $t`Chat messages`;
      case "sla-overdue": return $t`SLA overdue`;
      case "sla-taken-in-work": return $t`Request taken into work`;
      case "other": return $t`Other notifications`;
    }
  }

  function eventHint(event: NotificationSoundEvent): string {
    switch (event) {
      case "mail-incoming": return $t`When a new message arrives`;
      case "mail-outgoing": return $t`After a message was sent successfully`;
      case "calendar": return $t`When a calendar reminder is due`;
      case "chat": return $t`For chat events that support notifications`;
      case "sla-overdue": return $t`When an unanswered request becomes overdue`;
      case "sla-taken-in-work": return $t`When a message is read or assigned to an employee`;
      case "other": return $t`For other system events`;
    }
  }

  function soundLabel(sound: NotificationSoundId): string {
    switch (sound) {
      case "none": return $t`Off`;
      case "default": return $t`Classic`;
      case "chime": return $t`Chime`;
      case "pop": return $t`Pop`;
      case "bell": return $t`Bell`;
      case "alarm": return $t`Alarm`;
    }
  }

  function onSoundChange(event: NotificationSoundEvent, value: string): void {
    let sound = value as NotificationSoundId;
    selectedSounds = { ...selectedSounds, [event]: sound };
    setNotificationSound(event, sound);
  }

  function preview(event: NotificationSoundEvent): void {
    void playNotificationSound(event, { preview: true });
  }
</script>

<style>
  .sound-list {
    flex-direction: column;
    gap: 10px;
  }
  .sound-row {
    align-items: center;
    border-block-end: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
    gap: 12px;
    min-height: 48px;
    padding-block: 4px 10px;
  }
  .sound-row:last-child {
    border-block-end: 0;
    padding-block-end: 0;
  }
  .sound-copy {
    min-width: 180px;
  }
  .sound-copy label {
    font-weight: 500;
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
    margin-block-start: 2px;
  }
  select {
    min-width: 128px;
  }
  .preview-button {
    align-items: center;
    background: transparent;
    border: 1px solid var(--button-border);
    border-radius: 50%;
    color: var(--button-fg);
    display: flex;
    height: 30px;
    justify-content: center;
    padding: 0;
    width: 30px;
  }
  .preview-button:hover:not(:disabled) {
    background: var(--hover-bg);
  }
  .preview-button:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 2px;
  }
  .preview-button:disabled {
    opacity: 0.4;
  }
  @media (max-width: 600px) {
    .sound-row {
      flex-wrap: wrap;
    }
    .sound-copy {
      flex-basis: 100%;
    }
  }
  /* Справа от списка разделов настроек места меньше, чем ширина окна. */
  @container settings-page (max-width: 600px) {
    .sound-row {
      flex-wrap: wrap;
    }
    .sound-copy {
      flex-basis: 100%;
    }
  }
</style>
