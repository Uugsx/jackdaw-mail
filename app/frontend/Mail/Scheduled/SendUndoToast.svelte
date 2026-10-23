{#if $sendUndoToast}
  <hbox class="send-undo-toast" role="status" aria-live="polite">
    <SendIcon size="16px" aria-hidden="true" />
    <span class="label" title={$sendUndoToast.subject}>
      {$t`Sending in ${left} s`}
    </span>
    <button type="button" class="undo" disabled={undoing} on:click={() => catchErrors(onUndo)}>
      {$t`Undo`}
    </button>
  </hbox>
{/if}

<script lang="ts">
  import SendIcon from "lucide-svelte/icons/send";
  import { secondsLeft, sendUndoToast, undoSend } from "./scheduledSend";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onDestroy } from "svelte";

  /** Обратный отсчёт: перерисовываем несколько раз в секунду, чтобы цифра не запаздывала */
  const kTickMs = 250;
  let now = Date.now();
  let undoing = false;
  let ticker = setInterval(() => now = Date.now(), kTickMs);
  onDestroy(() => clearInterval(ticker));

  $: left = secondsLeft($sendUndoToast, now);

  async function onUndo() {
    let toast = $sendUndoToast;
    if (!toast || undoing) {
      return;
    }
    undoing = true;
    try {
      await undoSend(toast.scheduleID);
    } finally {
      undoing = false;
    }
  }
</script>

<style>
  .send-undo-toast {
    position: fixed;
    inset-inline: 0;
    inset-block-end: 24px;
    margin-inline: auto;
    width: fit-content;
    max-width: calc(100% - 32px);
    box-sizing: border-box;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--border-radius);
    background: color-mix(in srgb, var(--main-fg) 88%, black);
    color: var(--main-bg);
    box-shadow: 0 8px 28px rgb(0 0 0 / 28%);
    z-index: 11000;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .undo {
    margin-inline-start: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: color-mix(in srgb, var(--main-bg) 72%, var(--icon-primary, #7eb8ff));
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .undo:hover,
  .undo:focus-visible {
    color: var(--main-bg);
    text-decoration: underline;
  }
  .undo:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
