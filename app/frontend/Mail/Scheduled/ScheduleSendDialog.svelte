<div class="schedule-backdrop">
  <div
    class="schedule-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    aria-describedby={hintId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{$t`Send later`}</h2>
    <vbox class="presets" role="group" aria-label={$t`Suggested times`}>
      {#each presets as preset, index}
        <button type="button" class="preset"
          bind:this={presetButtons[index]}
          on:click={() => onDone(preset.at)}>
          <span class="preset-label">{presetLabel(preset.key)}</span>
          <span class="preset-time">{formatFollowUpDate(preset.at)}</span>
        </button>
      {/each}
    </vbox>
    <label class="field">
      <span>{$t`Custom date and time`}</span>
      <input
        type="datetime-local"
        bind:this={inputElement}
        bind:value={value}
        min={minValue}
        aria-invalid={!!error} />
    </label>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <p class="hint" id={hintId}>
      {#if mode == "server"}
        {$t`The message waits in the Outbox on the Exchange server and is sent even if this computer is turned off.`}
      {:else}
        {$t`Jackdaw Mail sends the message at this time. If the app is closed then, the message is sent after the next start.`}
      {/if}
    </p>
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={$t`Schedule send`}
        classes="filled"
        disabled={!value}
        onClick={submit} />
    </div>
  </div>
</div>

<script context="module" lang="ts">
  let nextDialogId = 0;
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import Button from "../../Shared/Button.svelte";
  import { formatFollowUpDate } from "../FollowUp/followUpReminders";
  import { scheduleSendPresets } from "./pickScheduleSendTime";
  import type { ScheduledSendMode } from "../../../logic/Mail/Scheduled/ScheduledSendData";
  import { t } from "../../../l10n/l10n";

  export let mode: ScheduledSendMode;
  /** Время для поля «Своё время». null — завтра утром */
  export let initial: Date | null = null;
  export let onDone: (sendAt: Date | null) => void;

  const dialogId = ++nextDialogId;
  const titleId = `schedule-send-title-${dialogId}`;
  const hintId = `schedule-send-hint-${dialogId}`;
  const presets = scheduleSendPresets();
  const minValue = toLocalInputValue(new Date());
  let value = toLocalInputValue(initial ?? presets[0].at);
  let error = "";
  let inputElement: HTMLInputElement;
  let presetButtons: HTMLButtonElement[] = [];
  let previouslyFocused: HTMLElement | null = null;

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    void tick().then(() => presetButtons[0]?.focus());
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  });

  function presetLabel(key: ReturnType<typeof scheduleSendPresets>[number]["key"]): string {
    return key == "tomorrowMorning"
      ? $t`Tomorrow morning`
      : key == "tomorrowAfternoon"
        ? $t`Tomorrow afternoon`
        : $t`Monday morning`;
  }

  function submit() {
    let sendAt = value ? new Date(value) : null;
    if (!sendAt || !Number.isFinite(sendAt.getTime())) {
      error = $t`Please enter a date and time.`;
      return;
    }
    if (sendAt.getTime() <= Date.now() + 60_000) {
      error = $t`The send time has already passed. Pick a later time.`;
      return;
    }
    onDone(sendAt);
  }

  function cancel() {
    onDone(null);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key == "Enter" && event.target == inputElement) {
      event.preventDefault();
      submit();
    }
  }

  /** Значение для `<input type="datetime-local">`: местное время без часового пояса. */
  function toLocalInputValue(date: Date): string {
    let pad = (number: number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
</script>

<style>
  .schedule-backdrop {
    position: fixed;
    inset: 0;
    z-index: 11001;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 24px;
    background: rgba(var(--shadow-color), 0.36);
  }
  .schedule-dialog {
    width: min(100%, 400px);
    max-height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    box-shadow: 0 14px 40px rgba(var(--shadow-color), 0.24);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
  }
  .presets {
    gap: 4px;
    margin-top: 16px;
  }
  .preset {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-height: 36px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-align: start;
    cursor: pointer;
  }
  .preset:hover {
    background: color-mix(in srgb, var(--main-fg) 6%, transparent);
  }
  .preset:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .preset-time {
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  input {
    min-height: 32px;
    padding: 4px 8px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--main-bg);
    color: var(--main-fg);
    font: inherit;
    font-size: 13px;
    color-scheme: light dark;
  }
  input:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
  }
  .error {
    margin: 8px 0 0;
    color: var(--danger-fg, #c62828);
    font-size: 12px;
    line-height: 1.4;
  }
  .hint {
    margin: 12px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--main-fg) 64%, transparent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .schedule-backdrop {
      padding: 16px;
    }
    .schedule-dialog {
      padding: 16px;
    }
  }
</style>
