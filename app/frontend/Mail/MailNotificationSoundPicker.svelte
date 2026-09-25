<vbox class="sound-picker">
  <hbox class="sound-row">
    <label for={selectId}>{$t`Sound`}</label>
    <select
      id={selectId}
      value={sound}
      on:change={onSoundChange}>
      <option value={fallbackSound}>{fallbackLabel}</option>
      {#each notificationSoundOptions as soundOption}
        <option value={soundOption}>{soundLabel(soundOption)}</option>
      {/each}
      {#if customSoundDataURL}
        <option value="custom">{customSoundLabel()}</option>
      {/if}
    </select>
    <Button
      label={$t`Preview`}
      icon={VolumeIcon}
      onClick={previewSelectedSound} />
  </hbox>

  <hbox class="file-actions">
    <input
      bind:this={fileInput}
      class="file-input"
      type="file"
      accept="audio/*"
      aria-label={$t`Choose a custom notification sound`}
      on:change={onFileSelected} />
    <Button
      label={$t`Choose custom sound`}
      icon={UploadIcon}
      onClick={chooseFile} />
    {#if customSoundDataURL}
      <span class="file-name">{customSoundLabel()}</span>
      <Button
        label={$t`Remove custom sound`}
        icon={DeleteIcon}
        plain={true}
        onClick={removeCustomSound} />
    {/if}
  </hbox>
  <span class="hint">{$t`Audio files up to 2 MB are stored locally on this device.`}</span>
  {#if uploadError}
    <p class="error" role="alert">{uploadError}</p>
  {/if}
</vbox>

<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { blobToDataURL } from "../../logic/util/util";
  import { t } from "../../l10n/l10n";
  import Button from "../Shared/Button.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import UploadIcon from "lucide-svelte/icons/upload";
  import VolumeIcon from "lucide-svelte/icons/volume-2";
  import {
    isNotificationSoundId,
    notificationSoundOptions,
    playNotificationSound,
    type NotificationSoundId,
    type NotificationSoundSelection,
  } from "../Shared/NotificationSound";
  import type {
    NotificationSoundPickerChange,
    NotificationSoundPickerSound,
  } from "./mailNotificationSoundPicker";
  import { kMaxCustomNotificationSoundBytes } from "./mailNotificationSettings";

  export let sound: NotificationSoundPickerSound;
  export let customSoundDataURL: string | null = null;
  export let customSoundName: string | null = null;
  export let fallbackSound: "global" | "account" = "global";
  export let fallbackLabel: string;
  export let previewSelection: NotificationSoundSelection = "default";
  export let selectId = "mail-notification-sound";

  const dispatch = createEventDispatcher<{
    change: NotificationSoundPickerChange;
  }>();

  let fileInput: HTMLInputElement;
  let uploadError: string | null = null;

  function onSoundChange(event: Event): void {
    let value = (event.currentTarget as HTMLSelectElement).value;
    if (value == fallbackSound || value == "custom" || isNotificationSoundId(value)) {
      dispatch("change", { sound: value as NotificationSoundPickerSound });
    }
  }

  function chooseFile(): void {
    fileInput?.click();
  }

  async function onFileSelected(event: Event): Promise<void> {
    uploadError = null;
    let input = event.currentTarget as HTMLInputElement;
    let file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("audio/")) {
      uploadError = $t`Please choose an audio file.`;
      return;
    }
    if (!file.size || file.size > kMaxCustomNotificationSoundBytes) {
      uploadError = $t`The audio file must be smaller than 2 MB.`;
      return;
    }
    try {
      let dataURL = await blobToDataURL(file);
      if (!dataURL.startsWith("data:audio/")) {
        throw new Error("Audio data URL has an unsupported format");
      }
      dispatch("change", {
        sound: "custom",
        customSoundDataURL: dataURL,
        customSoundName: file.name.slice(0, 120),
      });
    } catch (_ex) {
      uploadError = $t`Could not read the audio file.`;
    }
  }

  function removeCustomSound(): void {
    dispatch("change", {
      sound: sound == "custom" ? fallbackSound : sound,
      customSoundDataURL: null,
      customSoundName: null,
    });
  }

  function previewSelectedSound(): void {
    void playNotificationSound("mail-incoming", {
      preview: true,
      sound: previewSelection,
    });
  }

  function soundLabel(soundOption: NotificationSoundId): string {
    switch (soundOption) {
      case "none": return $t`Off`;
      case "default": return $t`Classic`;
      case "chime": return $t`Chime`;
      case "pop": return $t`Pop`;
      case "bell": return $t`Bell`;
      case "alarm": return $t`Alarm`;
    }
  }

  function customSoundLabel(): string {
    return $t`Custom: ${customSoundName ?? $t`Audio file`}`;
  }
</script>

<style>
  .sound-picker {
    gap: 12px;
  }
  .sound-row,
  .file-actions {
    align-items: center;
    gap: 8px;
  }
  .sound-row {
    flex-wrap: wrap;
  }
  .sound-row label {
    min-width: 4em;
  }
  select {
    min-width: 200px;
  }
  .file-actions {
    flex-wrap: wrap;
  }
  .file-input {
    height: 1px;
    opacity: 0;
    position: absolute;
    width: 1px;
  }
  .file-name {
    color: var(--input-placeholder);
    max-width: 22em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    color: var(--input-placeholder);
    display: block;
    font-size: 13px;
    line-height: 1.4;
  }
  .error {
    color: var(--error-fg, #c62828);
    margin-block: 0;
  }
</style>
