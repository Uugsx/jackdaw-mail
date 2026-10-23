<div class="follow-up-backdrop">
  <div
    class="follow-up-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{title ?? $t`Remind me if nobody replies by`}</h2>
    <label class="field">
      <span>{$t`Date and time`}</span>
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
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={submitLabel ?? $t`Set reminder`}
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

  /** Срок по умолчанию: завтра в это же время. */
  export let initial: Date;
  export let onDone: (dueAt: Date | null) => void;
  /** Окно используется и для «Отправить позже»: свои заголовок, кнопка и проверка */
  export let title: string | null = null;
  export let submitLabel: string | null = null;
  /** Своя проверка времени: текст ошибки или null */
  export let validate: ((dueAt: Date) => string | null) | null = null;

  const titleId = `follow-up-date-title-${++nextDialogId}`;
  const minValue = toLocalInputValue(new Date());
  let value = toLocalInputValue(initial);
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
    let dueAt = value ? new Date(value) : null;
    if (!dueAt || !Number.isFinite(dueAt.getTime())) {
      error = $t`Please enter a date and time.`;
      return;
    }
    if (validate) {
      let problem = validate(dueAt);
      if (problem) {
        error = problem;
        return;
      }
    } else if (dueAt.getTime() <= Date.now()) {
      error = $t`The reminder time has already passed. Pick a later time.`;
      return;
    }
    onDone(dueAt);
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
  .follow-up-backdrop {
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
  .follow-up-dialog {
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
    .follow-up-backdrop {
      padding: 16px;
    }
    .follow-up-dialog {
      padding: 16px;
    }
  }
</style>
