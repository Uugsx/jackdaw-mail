<svelte:window on:keydown={onKeydown} />

<vbox flex class="standalone-message standalone-window">
  {#if loading}
    <vbox flex class="message-state" aria-live="polite">
      <Spinner size="36px" />
      <p>{$t`Loading message…`}</p>
    </vbox>
  {:else if errorMessage}
    <vbox flex class="message-state">
      <!-- Свой заголовок: внутренние тексты загрузки окна не для пользователя;
           причина и подсказка — из ошибки, исходник — в «Подробностях» -->
      <Notice ex={loadError} message={errorMessage} onRetry={load} />
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
  import Notice from "../../Shared/Notice.svelte";
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
  let loadError: unknown = null;
  let startObjectsPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    loading = true;
    errorMessage = null;
    loadError = null;
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
      if (payload.bodyDeferred) {
        // Сложное тело догружается уже внутри того же окна просмотра.
        void message.loadBody().catch(() => undefined);
      }
    } catch (ex) {
      errorMessage = $t`Could not load the message window`;
      loadError = ex;
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
</style>
