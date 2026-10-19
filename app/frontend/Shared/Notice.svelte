<!--
  Единое сообщение об ошибке, предупреждении или успехе.
  Показывает понятный текст и подсказку, а исходную ошибку — свёрнуто
  в «Подробности» (для поддержки). Ошибки объявляются экранному диктору сразу,
  остальное — вежливо.
-->
<div class="notice {shownTone}" class:compact
  role={shownTone == "error" ? "alert" : "status"}
  aria-live={shownTone == "error" ? "assertive" : "polite"}
  aria-atomic="true"
  >
  <span class="icon" aria-hidden="true">
    <svelte:component this={iconFor(shownTone)} size="18px" />
  </span>
  <div class="body">
    {#if text}
      <p class="message value">{text}</p>
    {/if}
    {#if hintText}
      <p class="hint">{hintText}</p>
    {/if}
    <slot />
    {#if onRetry || technical}
      <div class="actions">
        {#if onRetry}
          <Button classes="secondary" label={retryLabel ?? $t`Try again`}
            onClick={onRetry} errorCallback={onRetryFailed} />
        {/if}
      </div>
    {/if}
    {#if technical}
      <details class="details" bind:open={detailsOpen}>
        <summary>{$t`Details for support`}</summary>
        <pre class="technical" tabindex="-1" bind:this={technicalEl}>{technical}</pre>
        <button type="button" class="copy" on:click={copyDetails}>
          {copied ? $t`Copied` : $t`Copy details`}
        </button>
      </details>
    {/if}
  </div>
  {#if onClose}
    <span class="close">
      <RoundButton label={$t`Close`} icon={CloseIcon} iconSize="16px" classes="plain small" border={false}
        onClick={onClose} />
    </span>
  {/if}
</div>

<script lang="ts" context="module">
  export type NoticeTone = "error" | "warning" | "success" | "info";
</script>

<script lang="ts">
  import { describeError } from "../../logic/util/friendlyError";
  import Button from "./Button.svelte";
  import RoundButton from "./RoundButton.svelte";
  import ErrorIcon from "lucide-svelte/icons/circle-alert";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import SuccessIcon from "lucide-svelte/icons/circle-check";
  import InfoIcon from "lucide-svelte/icons/info";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../l10n/l10n";

  /** Исходная ошибка. Из неё берутся понятный текст, подсказка и подробности. */
  export let ex: unknown = null;
  /** Свой текст. Если задан, заменяет текст из `ex`; подробности из `ex` остаются. */
  export let message: string | null = null;
  /** Своя подсказка «что делать». По умолчанию — из `ex`. */
  export let hint: string | null = null;
  export let tone: NoticeTone = null;
  /** Если задано — кнопка «Повторить». */
  export let onRetry: (() => void | Promise<void>) | null = null;
  export let retryLabel: string | null = null;
  /** Если задано — кнопка закрытия. */
  export let onClose: (() => void) | null = null;
  /** Без отступов снаружи и с меньшими полями — для строк в списках и форм. */
  export let compact = false;

  let detailsOpen = false;
  let copied = false;
  let technicalEl: HTMLPreElement;
  let retryError: unknown = null;

  $: shownEx = retryError ?? ex;
  $: described = shownEx ? describeError(shownEx) : null;
  $: shownTone = tone ?? (shownEx ? "error" : "info");
  $: text = (retryError ? null : message) ?? described?.message ?? "";
  $: hintText = hint ?? described?.hint ?? null;
  $: technical = described?.technical ?? "";
  $: if (ex) {
    // Новая ошибка снаружи: прошлый неудачный повтор больше не актуален
    resetRetry(ex);
  }

  let lastEx: unknown = null;
  function resetRetry(current: unknown) {
    if (current !== lastEx) {
      lastEx = current;
      retryError = null;
      copied = false;
    }
  }

  function onRetryFailed(error: unknown) {
    retryError = error;
  }

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(technical);
      copied = true;
    } catch {
      // Буфер обмена недоступен: выделяем текст, чтобы его можно было скопировать вручную
      if (technicalEl) {
        window.getSelection()?.selectAllChildren(technicalEl);
        technicalEl.focus();
      }
    }
  }

  function iconFor(tone: NoticeTone) {
    switch (tone) {
    case "error":
      return ErrorIcon;
    case "warning":
      return WarningIcon;
    case "success":
      return SuccessIcon;
    default:
      return InfoIcon;
    }
  }
</script>

<style>
  .notice {
    --notice-tone: var(--info-fg, #3C6E91);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    box-sizing: border-box;
    max-width: 40em;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--notice-tone) 38%, var(--border));
    border-radius: var(--border-radius, 6px);
    background-color: color-mix(in srgb, var(--notice-tone) 7%, var(--main-bg, Canvas));
    color: var(--main-fg, CanvasText);
    font-size: 13px;
    line-height: 1.45;
    text-align: start;
  }
  .notice.compact {
    margin: 0;
    padding: 6px 10px;
  }
  .notice.error {
    --notice-tone: var(--danger-fg, #B84E3B);
  }
  .notice.warning {
    --notice-tone: var(--warning-fg, #8A5A00);
  }
  .notice.success {
    --notice-tone: var(--success-fg, #2F7A3E);
  }
  .icon {
    display: flex;
    flex: none;
    margin-block-start: 1px;
    color: var(--notice-tone);
  }
  .body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    gap: 4px;
  }
  p {
    margin: 0;
  }
  .message {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg, CanvasText) 78%, transparent);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-block-start: 4px;
  }
  .actions:empty {
    display: none;
  }
  .details {
    margin-block-start: 2px;
  }
  summary {
    width: fit-content;
    cursor: pointer;
    border-radius: 3px;
    color: color-mix(in srgb, var(--main-fg, CanvasText) 72%, transparent);
    font-size: 12px;
  }
  summary:hover {
    color: var(--main-fg, CanvasText);
  }
  summary:focus-visible,
  .copy:focus-visible {
    outline: 2px solid var(--input-focus, Highlight);
    outline-offset: 2px;
  }
  .technical {
    max-height: 10em;
    overflow: auto;
    margin: 6px 0 4px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius, 6px);
    background-color: var(--main-bg, Canvas);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .copy {
    padding: 0;
    border: none;
    background: none;
    color: var(--link-fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .copy:hover {
    color: var(--link-hover-fg, var(--link-fg));
    text-decoration: underline;
  }
  .close {
    flex: none;
    margin: -4px -6px -4px 0;
  }
</style>
