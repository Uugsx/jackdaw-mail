{#if request && (showAsk || error)}
  <hbox class="read-receipt font-small" role="status">
    <hbox class="icon"><ReceiptIcon size="16px" /></hbox>
    <vbox class="text" flex>
      <span>{$t`${senderName} asked for a read receipt.`}</span>
      {#if request.suspicious}
        <span class="warning">{$t`The receipt will go to ${request.to.emailAddress}, not to the sender.`}</span>
      {/if}
      {#if error}
        <span class="error" role="alert">{error}</span>
      {/if}
    </vbox>
    <hbox class="actions">
      <Button
        label={error ? $t`Try again` : $t`Send receipt`}
        classes="small"
        disabled={busy}
        onClick={() => send("manual")} />
      <Button
        label={$t`Don't send`}
        classes="small"
        plain
        disabled={busy}
        onClick={decline} />
    </hbox>
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import {
    declineReadReceipt, getReadReceiptRequest, normalizeReadReceiptPolicy, readReceiptPolicySetting,
    sendReadReceipt, type MDNSendingMode, type ReadReceiptRequest,
  } from "../../../logic/Mail/ReadReceipt/ReadReceipt";
  import Button from "../../Shared/Button.svelte";
  import ReceiptIcon from "lucide-svelte/icons/mail-check";
  import { backgroundError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  const policySetting = readReceiptPolicySetting();
  $: policy = normalizeReadReceiptPolicy($policySetting.value);

  let request: ReadReceiptRequest | null = null;
  let busy = false;
  let error = "";
  let checkedFor: EMail | null = null;

  // Адрес появляется после разбора MIME, поэтому следим и за `readReceiptTo`
  $: $message, refresh(message);
  function refresh(current: EMail) {
    if (checkedFor != current) {
      checkedFor = current;
      error = "";
      busy = false;
    }
    request = getReadReceiptRequest(current);
  }

  $: senderName = message.from?.name || message.from?.emailAddress || "";
  /** «Всегда» с подозрительным адресом — всё равно спрашиваем (RFC 8098) */
  $: showAsk = !!request && (policy == "ask" || (policy == "always" && request.suspicious));

  // «Всегда» / «Никогда» срабатывают, когда письмо отмечено прочитанным, как в Outlook
  $: if (request && !busy && !error && $message.isRead) {
    if (policy == "always" && !request.suspicious) {
      void send("automatic");
    } else if (policy == "never") {
      void decline();
    }
  }

  async function send(mode: MDNSendingMode) {
    let current = message;
    let currentRequest = request;
    if (!currentRequest || busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await sendReadReceipt(current, currentRequest, mode);
      if (current == message) {
        request = null;
      }
    } catch (ex) {
      if (current == message) {
        error = ex?.message || String(ex);
      } else {
        backgroundError(ex);
      }
    } finally {
      if (current == message) {
        busy = false;
      }
    }
  }

  async function decline() {
    let current = message;
    if (busy) {
      return;
    }
    request = null;
    error = "";
    try {
      await declineReadReceipt(current);
    } catch (ex) {
      // Отказ уже запомнен локально; сбой отметки на сервере не мешает работе
      backgroundError(ex);
    }
  }
</script>

<style>
  .read-receipt {
    align-items: center;
    gap: 0.5rem;
    margin-block: 0.5rem 0.25rem;
    padding: 0.375rem 0.625rem;
    border-radius: 6px;
    background-color: var(--surface-subtle, color-mix(in srgb, var(--border) 18%, transparent));
    border: 1px solid var(--border);
    max-width: 100%;
  }
  .icon {
    flex: none;
    opacity: 0.75;
  }
  .text {
    min-width: 0;
    gap: 0.125rem;
  }
  .warning {
    color: var(--warning-fg, var(--fg));
    opacity: 0.85;
  }
  .error {
    color: var(--danger-fg);
  }
  .actions {
    flex: none;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
</style>
