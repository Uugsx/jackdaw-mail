<!--
  Боковая панель письма внутри отчёта: показывает письмо общим просмотрщиком
  почты, не покидая вкладку отчёта. Закрытие — Esc или кнопка, соседние строки
  таблицы — кнопки и Alt+↑/↓.
-->
<aside
  class="report-message-panel"
  role="complementary"
  aria-label={$t`Message`}
  bind:this={panelElement}
  tabindex="-1"
  on:keydown={onKeydown}
>
  <header class="panel-bar">
    <h3 class="panel-title" title={subject}>{subject || $t`(no subject)`}</h3>
    <button
      type="button"
      class="panel-button"
      disabled={!hasPrevious}
      title={$t`Previous message`}
      aria-label={$t`Previous message`}
      on:click={() => dispatch("previous")}
    >
      <ChevronUpIcon size="16px" />
    </button>
    <button
      type="button"
      class="panel-button"
      disabled={!hasNext}
      title={$t`Next message`}
      aria-label={$t`Next message`}
      on:click={() => dispatch("next")}
    >
      <ChevronDownIcon size="16px" />
    </button>
    <button
      type="button"
      class="panel-button open-in-mail"
      disabled={!message}
      on:click={() => dispatch("openInMail")}
    >
      <ExternalLinkIcon size="14px" />
      <span>{$t`Open in Mail`}</span>
    </button>
    <button
      type="button"
      class="panel-button"
      title={$t`Close`}
      aria-label={$t`Close`}
      on:click={() => dispatch("close")}
    >
      <CloseIcon size="16px" />
    </button>
  </header>
  <div class="panel-content">
    {#if loading}
      <div class="panel-state" aria-live="polite">
        <Spinner size="32px" />
        <p>{$t`Loading message…`}</p>
      </div>
    {:else if loadError}
      <div class="panel-state">
        <Notice ex={loadError} onRetry={load} />
      </div>
    {:else if message}
      {#key message}
        <MessageDisplay
          {message}
          onReply={replyInPanel}
          onReplyAll={replyAllInPanel}
        />
      {/key}
    {/if}
  </div>
</aside>

<script lang="ts">
  import { createEventDispatcher, onMount, tick } from "svelte";
  import type { EMail } from "../../logic/Mail/EMail";
  import { loadReportMessage } from "../Mail/openPendingResponse";
  import { mailApp } from "../Mail/MailJackdawApp";
  import MessageDisplay from "../Mail/Message/MessageDisplay.svelte";
  import Notice from "../Shared/Notice.svelte";
  import Spinner from "../Shared/Spinner.svelte";
  import { t } from "../../l10n/l10n";
  import ChevronUpIcon from "lucide-svelte/icons/chevron-up";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ExternalLinkIcon from "lucide-svelte/icons/external-link";
  import CloseIcon from "lucide-svelte/icons/x";

  /** Идентификаторы письма из строки отчёта. */
  export let target: { accountId: number; folderId: number; emailId: number };
  export let subject = "";
  export let hasPrevious = false;
  export let hasNext = false;

  const dispatch = createEventDispatcher<{
    close: void;
    previous: void;
    next: void;
    openInMail: EMail;
  }>();

  let panelElement: HTMLElement;
  let message: EMail | null = null;
  let loading = true;
  let loadError: unknown = null;
  let loadedKey = "";
  let loadToken = 0;

  $: targetKey = `${target.accountId}/${target.folderId}/${target.emailId}`;
  $: if (targetKey != loadedKey) {
    loadedKey = targetKey;
    void load();
  }

  async function load(): Promise<void> {
    const token = ++loadToken;
    loading = true;
    loadError = null;
    message = null;
    try {
      const loaded = await loadReportMessage(target);
      if (token != loadToken) return;
      message = loaded;
    } catch (ex) {
      if (token != loadToken) return;
      loadError = ex;
    } finally {
      if (token == loadToken) loading = false;
    }
  }

  async function replyInPanel(): Promise<void> {
    if (!message) return;
    await message.loadBody();
    mailApp.writeMail(message.compose.replyToAuthor(), { forceMainWindow: true });
  }

  async function replyAllInPanel(): Promise<void> {
    if (!message) return;
    await message.loadBody();
    mailApp.writeMail(message.compose.replyAll(), { forceMainWindow: true });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key == "ArrowDown" && hasNext) {
      event.preventDefault();
      dispatch("next");
    } else if (event.altKey && event.key == "ArrowUp" && hasPrevious) {
      event.preventDefault();
      dispatch("previous");
    }
  }

  /** Передаёт фокус панели, чтобы Esc и Alt+↑/↓ работали сразу после клика по теме. */
  export async function focusPanel(): Promise<void> {
    await tick();
    panelElement?.focus();
  }

  /** Сообщение для кнопки «Открыть в почте»: нужен загруженный объект письма. */
  export function currentMessage(): EMail | null {
    return message;
  }

  onMount(() => {
    void focusPanel();
  });
</script>

<style>
  .report-message-panel {
    position: absolute;
    z-index: 30;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: clamp(420px, 56%, 820px);
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-left: 1px solid var(--border);
    background: var(--main-bg, var(--bg));
    color: var(--main-fg);
    box-shadow: -12px 0 32px color-mix(in srgb, #000 24%, transparent);
  }

  .report-message-panel:focus {
    outline: none;
  }

  .panel-bar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    box-sizing: border-box;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 30px;
    min-height: 30px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    padding: 4px 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
  }

  .panel-button.open-in-mail {
    border-color: var(--border);
    padding: 4px 10px;
  }

  .panel-button:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--reports-accent) 48%, var(--border));
    background: color-mix(in srgb, var(--reports-accent) 12%, transparent);
  }

  .panel-button:focus-visible {
    outline: 2px solid var(--reports-accent);
    outline-offset: 1px;
  }

  .panel-button:disabled {
    opacity: 0.4;
  }

  .panel-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .panel-state {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    text-align: center;
  }

  .panel-state p {
    margin: 0;
  }

  @media (max-width: 720px) {
    .report-message-panel {
      width: 100%;
      min-width: 0;
    }
  }
</style>
