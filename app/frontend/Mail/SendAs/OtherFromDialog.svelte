<div class="send-as-backdrop">
  <div
    class="send-as-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    on:keydown={onKeydown}>
    <h2 id={titleId}>{$t`Send from another address`}</h2>
    <label class="field">
      <span>{$t`Email address of the mailbox`}</span>
      <input
        type="email"
        bind:this={inputElement}
        bind:value={address}
        on:input={() => error = ""}
        spellcheck="false"
        placeholder={$t`For example, office@example.com`}
        aria-invalid={!!error}
        aria-describedby={hintId} />
    </label>
    {#if error}
      <p class="error" role="alert" id={hintId}>{error}</p>
    {:else}
      <p class="hint" id={hintId}>{$t`You need "Send As" or "Send on Behalf" permission for this mailbox. With "Send on Behalf", recipients see "${accountAddress} on behalf of …".`}</p>
    {/if}
    <div class="actions">
      <Button
        label={$t`Cancel`}
        plain
        onClick={cancel} />
      <Button
        label={$t`Use this address`}
        classes="filled"
        disabled={!address.trim()}
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
  import { checkOtherFromAddress } from "./sendAs";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let onDone: (address: string | null) => void;

  const dialogNumber = ++nextDialogId;
  const titleId = `send-as-title-${dialogNumber}`;
  const hintId = `send-as-hint-${dialogNumber}`;
  $: accountAddress = account.emailAddress;
  let address = "";
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
    let result = checkOtherFromAddress(address, account);
    if (result == "invalid") {
      error = $t`Please enter a valid email address.`;
      return;
    }
    if (result == "own") {
      error = $t`This is already your own address. Choose it in the From list.`;
      return;
    }
    onDone(result);
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
  .send-as-backdrop {
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
  .send-as-dialog {
    width: min(100%, 400px);
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
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  input[type="email"] {
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
  input[type="email"]:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg, #c62828);
  }
  .error, .hint {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .error {
    color: var(--danger-fg, #c62828);
  }
  .hint {
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  @media (max-width: 480px) {
    .send-as-backdrop {
      padding: 16px;
    }
    .send-as-dialog {
      padding: 16px;
    }
  }
</style>
