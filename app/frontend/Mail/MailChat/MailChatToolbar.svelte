<hbox class="reply">
  <Button
    icon={ReplyIcon}
    iconSize="24px"
    iconOnly
    label={$t`Reply to author`}
    onClick={reply}
    plain
    />
</hbox>
{#if canReplyAll}
  <hbox class="reply-all">
    <Button
      icon={ReplyAllIcon}
      iconSize="24px"
      iconOnly
      label={$t`Reply to all`}
      onClick={replyAll}
      plain
      />
  </hbox>
{/if}
<hbox class="unread" class:read={$message.isRead}>
  <Button
    icon={CircleIcon}
    iconSize="16px"
    iconOnly
    label={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
    onClick={toggleRead}
    plain
    />
</hbox>
<hbox class="star" class:starred={$message.isStarred}>
  <Button
    icon={StarIcon}
    iconSize="20px"
    iconOnly
    label={$t`Remember this message`}
    onClick={toggleStar}
    plain
    />
</hbox>
{#if translationAvailable}
  <hbox class="translate" class:translated={translatedShown}>
    <Button
      icon={LanguagesIcon}
      iconSize="20px"
      iconOnly
      label={translatedShown ? $t`Show original` : $t`Translate this email`}
      onClick={() => translation.toggle()}
      disabled={$translation.status == "translating"}
      plain
      />
  </hbox>
{/if}
<hbox class="open">
  <Button
    icon={OpenIcon}
    iconSize="20px"
    iconOnly
    label={$t`Open this message alone`}
    onClick={openMessageAlone}
    plain
    />
</hbox>
<hbox class="copy">
  <Button
    icon={hasCopied ? CheckIcon : CopyIcon}
    iconSize="18px"
    iconOnly
    label={$t`Copy`}
    onClick={onCopy}
    plain
    />
</hbox>
<hbox class="menu button">
  <ButtonMenu bind:isMenuOpen>
    <MessageMenu {message} {printE} />
  </ButtonMenu>
</hbox>

<Print {message} bind:this={printE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { mailApp } from "../MailJackdawApp";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import Print from "../Message/MessagePrint.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import OpenIcon from "lucide-svelte/icons/maximize-2";
  import CopyIcon from "lucide-svelte/icons/copy";
  import CheckIcon from "lucide-svelte/icons/check";
  import LanguagesIcon from "lucide-svelte/icons/languages";
  import { getMessageTranslation, getTranslationEngineSetting, isMailTranslationAvailable } from "../Message/messageTranslation";
  import { sleep } from "../../../logic/util/util";
  import { selectedMessage } from "../Selected";
  import { getMessageContentRenderingSetting } from "../Message/messageViewerAppearance";
  import { t } from "../../../l10n/l10n";
  import { catchErrors } from "../../Util/error";

  import { computeCanReplyAll, subscribeCanReplyAll } from "../canReplyAll";
  import { onDestroy } from "svelte";

  export let message: EMail;

  let translationEngineSetting = getTranslationEngineSetting();
  $: translationAvailable = isMailTranslationAvailable($translationEngineSetting.value);
  $: translation = getMessageTranslation(message);
  $: translatedShown = $translation.status == "translated" && !$translation.showOriginal;

  let replyAllRev = 0;
  let replyAllUnsub: (() => void) | null = null;
  onDestroy(() => replyAllUnsub?.());
  let canReplyAll = false;
  $: {
    replyAllUnsub?.();
    replyAllUnsub = subscribeCanReplyAll(message, () => replyAllRev++);
  }
  $: {
    replyAllRev;
    canReplyAll = computeCanReplyAll(message);
  }

  async function toggleRead() {
    await message.markRead(!message.isRead);
  }
  async function toggleStar() {
    await message.markStarred(!message.isStarred);
  }
  function reply() {
    catchErrors(async () => {
      await message.loadForDisplay();
      let reply = message.compose.replyToAuthor();
      mailApp.writeMail(reply);
    });
  }
  function replyAll() {
    catchErrors(async () => {
      await message.loadForDisplay();
      let reply = message.compose.replyAll();
      mailApp.writeMail(reply);
    });
  }
  function openMessageAlone() {
    $selectedMessage = message;
    let modeSetting = getMessageContentRenderingSetting(message.folder?.account);
    modeSetting.value = "html";
  }

  // Копирование текста письма — раньше было в общей панели чата, которую здесь не показываем
  let hasCopied = false;
  async function onCopy() {
    await message.loadBody();
    await navigator.clipboard.writeText(message.text ?? "");
    hasCopied = true;
    await sleep(1);
    hasCopied = false;
  }

  let isMenuOpen = false;
  let printE: Print;
</script>

<style>
  .star.starred :global(svg) {
    fill: orange;
  }
  .unread:not(.read) :global(svg) {
    fill: green;
  }
  .translate.translated :global(svg) {
    color: var(--icon-primary);
  }
  .menu {
    width: 16px;
    height: 16px;
    padding-block-end: 12px;
    padding-inline-end: 12px;
  }
  .menu-inner {
    position: fixed;
  }
</style>
