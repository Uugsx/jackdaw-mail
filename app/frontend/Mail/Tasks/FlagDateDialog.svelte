<div class="flag-date-backdrop">
  <div
    class="flag-date-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{$t`Flag with a due date`}</h2>
    <label class="field">
      <span>{$t`Due date`}</span>
      <input
        type="date"
        bind:this={inputElement}
        bind:value={value}
        aria-invalid={!!error} />
    </label>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={$t`Set`}
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
  import { t } from "../../../l10n/l10n";
  import { sanitizeDay, type DayString } from "../../../logic/Mail/Tasks/ExchangeTask";

  /** Срок по умолчанию */
  export let initial: DayString;
  export let onDone: (dueDay: DayString | null) => void;

  const titleId = `flag-date-title-${++nextDialogId}`;
  let value = initial;
  let error = "";
  let inputElement: HTMLInputElement;
  let previouslyFocused: HTMLElement | null = null;

  onMount(() => {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    void tick().then(() => inputElement?.focus());
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  });

  function submit() {
    let dueDay = sanitizeDay(value);
    if (!dueDay) {
      error = $t`Please enter a date.`;
      return;
    }
    onDone(dueDay);
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
</script>

<style>
  .flag-date-backdrop {
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
  .flag-date-dialog {
    width: min(100%, 380px);
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
    overflow-wrap: anywhere;
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
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .flag-date-backdrop {
      padding: 16px;
    }
    .flag-date-dialog {
      padding: 16px;
    }
  }
</style>
