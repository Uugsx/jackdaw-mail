<svelte:window on:keydown={onKeydown} />

<vbox flex class="standalone-message">
  {#if loading}
    <vbox flex class="message-state" aria-live="polite">
      <Spinner size="36px" />
      <p>{$t`Loading message…`}</p>
    </vbox>
  {:else if errorMessage}
    <vbox flex class="message-state" role="alert">
      <p>{errorMessage}</p>
      <button type="button" on:click={load}>{$t`Retry`}</button>
    </vbox>
  {:else if message}
    <MessageDisplay
      {message}
      onReply={requestReply}
      onReplyAll={requestReplyAll}
      />
  {/if}
</vbox>

<script lang="ts">
  import { onMount } from "svelte";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { appGlobal } from "../../../logic/app";
  import { getStartObjects } from "../../../logic/startup";
  import { assert } from "../../../logic/util/util";
  import { deserializeMessageWindowMail } from "./messageWindow";
  import { requestNativeMessageReply } from "./messageNative";
  import MessageDisplay from "./MessageDisplay.svelte";
  import { backgroundError } from "../../Util/error";
  import Spinner from "../../Shared/Spinner.svelte";
  import { t } from "../../../l10n/l10n";

  export let messageWindowID: string;

  let message: EMail | null = null;
  let loading = true;
  let errorMessage: string | null = null;
  let startObjectsPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    loading = true;
    errorMessage = null;
    message = null;
    try {
      let nativeAPI = (window as any).api;
      if (typeof nativeAPI?.getMessageWindowData !== "function") {
        throw new Error("Native message windows are unavailable");
      }
      let payload = await nativeAPI.getMessageWindowData(messageWindowID);
      assert(payload, "Message window data is missing");
      startObjectsPromise ??= getStartObjects();
      try {
        await startObjectsPromise;
      } catch (ex) {
        startObjectsPromise = null;
        throw ex;
      }
      let account = appGlobal.emailAccounts.find(candidate => candidate.id === payload.mail.accountID);
      assert(account, "Message window account is missing");
      await Promise.all([
        account.readFromDB(),
        ...[...appGlobal.addressbooks].map(addressbook => addressbook.readFromDB()),
      ]);
      message = deserializeMessageWindowMail(payload, account);
    } catch (ex) {
      errorMessage = ex instanceof Error ? ex.message : $t`Could not load the message window`;
      backgroundError(ex);
    } finally {
      loading = false;
    }
  }

  function closeWindow(): void {
    let nativeAPI = (window as any).api;
    if (typeof nativeAPI?.closeMessageWindow === "function") {
      nativeAPI.closeMessageWindow(messageWindowID);
    }
  }

  function requestReply(): void {
    requestNativeMessageReply(messageWindowID);
  }

  function requestReplyAll(): void {
    requestNativeMessageReply(messageWindowID, true);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key != "Escape") {
      return;
    }
    event.preventDefault();
    closeWindow();
  }

  onMount(() => {
    void load();
  });
</script>

<style>
  .standalone-message {
    min-width: 0;
    min-height: 100vh;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
    background: var(--main-bg, var(--bg));
    color: var(--main-fg, var(--fg));
  }
  .message-state {
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px;
    text-align: center;
  }
  .message-state p {
    max-width: 560px;
    margin: 0;
  }
  .message-state button {
    min-height: 34px;
    padding: 6px 16px;
    border: 1px solid var(--button-border);
    border-radius: var(--border-radius);
    background: var(--button-bg);
    color: var(--button-fg);
    cursor: default;
  }
  .message-state button:hover,
  .message-state button:focus-visible {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
</style>
