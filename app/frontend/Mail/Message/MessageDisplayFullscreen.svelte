<vbox flex class="message-page" on:keydown={onKeydown} tabindex={-1}>
  <hbox class="message-page-bar">
    <RoundButton
      icon={ArrowLeftIcon}
      iconSize="18px"
      label={$t`Back to message list`}
      classes="plain"
      onClick={goBackToList}
      />
    <hbox flex />
  </hbox>
  <vbox flex class="message-page-content">
    <MessageDisplay
      {message}
      onReply={replyInCurrentWindow}
      onReplyAll={replyAllInCurrentWindow}
      />
  </vbox>
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { goBack } from "../../AppsBar/selectedApp";
  import { mailApp } from "../MailJackdawApp";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import MessageDisplay from "./MessageDisplay.svelte";
  import ArrowLeftIcon from "lucide-svelte/icons/arrow-left";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  function goBackToList() {
    goBack();
  }

  async function replyInCurrentWindow(): Promise<void> {
    // Ответу нужен текст цитаты, но не повторная загрузка MIME-заголовков.
    // loadForDisplay() мог ждать/падать на MIME даже после открытия письма,
    // поэтому клик по «Ответить» внешне ничего не делал.
    await message.loadBody();
    mailApp.writeMail(message.compose.replyToAuthor(), { forceMainWindow: true });
  }

  async function replyAllInCurrentWindow(): Promise<void> {
    await message.loadBody();
    mailApp.writeMail(message.compose.replyAll(), { forceMainWindow: true });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key != "Escape") {
      return;
    }
    event.preventDefault();
    goBackToList();
  }
</script>

<style>
  .message-page {
    min-width: 0;
    min-height: 0;
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-page-bar {
    flex: 0 0 auto;
    min-height: 42px;
    align-items: center;
    padding: 5px 12px;
    border-block-end: 1px solid var(--border);
    background-color: var(--main-bg);
  }
  .message-page-content {
    min-width: 0;
    min-height: 0;
  }
</style>
