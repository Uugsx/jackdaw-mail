{#if $sendToast}
  {@const toast = $sendToast}
  <hbox class="send-toast" class:error={toast.type == "failed"}
    role={toast.type == "failed" ? "alert" : "status"} aria-live="polite">
    {#if toast.type == "sending"}
      <span class="spinner" aria-hidden="true" />
    {:else if toast.type == "failed"}
      <AlertIcon size="16px" aria-hidden="true" />
    {:else if toast.type == "sent"}
      <CheckIcon size="16px" aria-hidden="true" />
    {:else if toast.type == "retry"}
      <OfflineIcon size="16px" aria-hidden="true" />
    {:else}
      <SendIcon size="16px" aria-hidden="true" />
    {/if}
    <vbox class="text">
      <span class="label">{label(toast, now)}</span>
      {#if toast.subject && toast.type != "sent"}
        <span class="subject" title={toast.subject}>{toast.subject}</span>
      {/if}
      {#if toast.type == "failed" || toast.type == "retry"}
        <span class="detail" title={toast.error}>{toast.error}</span>
      {/if}
    </vbox>
    {#if toast.type == "undo" || toast.type == "scheduled"}
      <button type="button" class="action" disabled={busy}
        on:click={() => run(() => undoSend(toast.queueID))}>
        {$t`Undo`}
      </button>
    {:else if toast.type == "failed"}
      <button type="button" class="action" disabled={busy}
        on:click={() => run(() => editScheduledSend(toast.queueID))}>
        {$t`Open`}
      </button>
    {:else if toast.type == "retry"}
      <button type="button" class="action" disabled={busy}
        on:click={() => run(() => sendScheduledNow(toast.queueID))}>
        {$t`Retry now`}
      </button>
    {/if}
    {#if toast.type != "sending" && toast.type != "undo"}
      <button type="button" class="close" aria-label={$t`Close`} title={$t`Close`}
        on:click={dismissSendToast}>
        <CloseIcon size="14px" />
      </button>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import { onMount } from "svelte";
  import {
    dismissSendToast, editScheduledSend, sendScheduledNow, sendToast, undoSend, type SendToastState,
  } from "./sendQueue";
  import { formatSendLaterTime } from "./pickSendLaterDate";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import SendIcon from "lucide-svelte/icons/send";
  import CheckIcon from "lucide-svelte/icons/check";
  import AlertIcon from "lucide-svelte/icons/circle-alert";
  import OfflineIcon from "lucide-svelte/icons/wifi-off";
  import CloseIcon from "lucide-svelte/icons/x";

  let now = Date.now();
  let busy = false;

  onMount(() => {
    // Обратный отсчёт «Отправка через 5 с»
    let interval = setInterval(() => now = Date.now(), 250);
    return () => clearInterval(interval);
  });

  function label(toast: SendToastState, at: number): string {
    switch (toast.type) {
      case "undo": {
        let seconds = Math.max(0, Math.ceil((toast.sendAt.getTime() - at) / 1000));
        return seconds > 0 ? $t`Sending in ${seconds} s…` : $t`Sending…`;
      }
      case "scheduled":
        return $t`Will be sent ${formatSendLaterTime(toast.sendAt)}`;
      case "sending":
        return $t`Sending…`;
      case "sent":
        return $t`Message sent`;
      case "retry":
        return $t`No connection. Will retry at ${formatSendLaterTime(toast.sendAt)}`;
      case "failed":
        return $t`Could not send the message`;
    }
  }

  async function run(action: () => Promise<void>) {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await catchErrors(action);
    } finally {
      busy = false;
    }
  }
</script>

<style>
  .send-toast {
    position: fixed;
    inset-inline: 0;
    inset-block-end: 20px;
    margin-inline: auto;
    width: fit-content;
    min-width: 260px;
    max-width: min(560px, calc(100% - 32px));
    box-sizing: border-box;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 10px 14px;
    border-radius: var(--border-radius);
    background: color-mix(in srgb, var(--main-fg) 88%, black);
    color: var(--main-bg);
    box-shadow: 0 8px 28px rgb(0 0 0 / 28%);
    z-index: 11000;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    animation: toast-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .send-toast.error {
    background: color-mix(in srgb, var(--danger-fg, #c62828) 78%, black);
    color: white;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .send-toast {
      animation: none;
    }
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    gap: 1px;
  }
  .label {
    font-weight: 600;
  }
  .subject,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    opacity: 0.8;
  }
  .action,
  .close {
    flex: 0 0 auto;
    padding: 4px 6px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .action {
    font-weight: 600;
    color: color-mix(in srgb, currentColor 72%, var(--icon-primary, #7eb8ff));
    white-space: nowrap;
  }
  .error .action {
    color: inherit;
    text-decoration: underline;
  }
  .action:hover,
  .action:focus-visible,
  .close:hover,
  .close:focus-visible {
    background: rgb(255 255 255 / 14%);
    outline: none;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .close {
    display: flex;
    align-items: center;
    opacity: 0.8;
  }
  .spinner {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-inline-end-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
