<hbox class="buttons">
  {#if message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts }
    <hbox class="draft">
      <Button
        icon={WriteIcon}
        iconSize={$appGlobal.isSmall ? "32px" : "24px" }
        iconOnly={$appGlobal.isSmall}
        label={$t`Edit draft`}
        onClick={editDraft}
        classes="primary draft-action"
        />
    </hbox>
  {/if}
  <hbox class="reply">
    <Button
      icon={ReplyIcon}
      iconSize="22px"
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
        iconSize="22px"
        iconOnly
        label={$t`Reply to all`}
        onClick={replyAll}
        plain
        />
    </hbox>
  {/if}
  <hbox class="forward">
    <Button
      icon={ForwardIcon}
      iconSize="22px"
      iconOnly
      label={$t`Forward`}
      onClick={forward}
      plain
      />
  </hbox>
  <hbox class="archive">
    <Button
      icon={ArchiveIcon}
      iconSize="16px"
      iconOnly
      label={$t`Archive`}
      onClick={archiveMessage}
      disabled={!message}
      plain
      />
  </hbox>
  {#if message.folder?.specialFolder == SpecialFolder.Trash || message.folder?.specialFolder == SpecialFolder.Spam}
    <hbox class="restore">
      <Button
        icon={UndoIcon}
        iconSize="16px"
        iconOnly
        label={$t`Restore`}
        onClick={restoreMessage}
        disabled={!message}
        plain
        />
    </hbox>
  {/if}
  <hbox class="trash">
    <Button
      icon={TrashIcon}
      iconSize="16px"
      iconOnly
      label={$t`Delete this message`}
      onClick={deleteMessage}
      disabled={!message}
      plain
      />
  </hbox>
  <hbox class="spam" class:notspam={$message.isSpam}>
    <Button
      icon={$message.isSpam ? NotSpamIcon : SpamIcon}
      iconSize="16px"
      iconOnly
      label={$message.isSpam ? $t`This email is *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
      onClick={toggleSpam}
      disabled={!message}
      plain
      />
  </hbox>
  <hbox class="unread" class:read={$message.isRead}>
    <Button
      icon={CircleIcon}
      iconSize={$appGlobal.isSmall ? "20px" : "16px" }
      iconOnly
      label={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
      onClick={toggleRead}
      plain
      />
  </hbox>
  <hbox class="star" class:starred={$message.isStarred}>
    <Button
      icon={StarIcon}
      iconSize={$appGlobal.isSmall ? "28px" : "18px" }
      iconOnly
      label={$t`Remember this message`}
      onClick={toggleStar}
      plain
      />
  </hbox>
  <hbox class="move button" bind:this={popupAnchorE}>
    <Button
      icon={FolderActionsIcon}
      iconSize="16px"
      iconOnly
      label={$t`Move to folder, or add tag`}
      onClick={onPopupToggle}
      plain
      />
  </hbox>
  <hbox class="menu button">
    <ButtonMenu bind:isMenuOpen>
      <MessageMenu {message} {printE} onMove={onPopupToggle} />
    </ButtonMenu>
  </hbox>
</hbox>
  <Popup bind:popupOpen popupAnchor={popupAnchorE} placement="bottom" boundaryElSel=".message-list-pane">
  <MessageMovePopup
    messages={new ArrayColl(actionTargets())}
    on:close={onPopupClose} />
</Popup>

<Print {message} bind:this={printE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { mailApp } from "../MailJackdawApp";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { selectedMessage, selectedMessages } from "../Selected";
  import { openEMailMessage } from "../open";
  import MessageMenu from "./MessageMenu.svelte";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import Print from "./MessagePrint.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Button from "../../Shared/Button.svelte";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import WriteIcon from "lucide-svelte/icons/pencil";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { catchErrors } from "../../Util/error";
  import { deleteMessagesFromUI } from "../mailDeleteUndo";
  import { markMessagesRead, messagesRepresentSameMail } from "../mailReadActions";
  import { appGlobal } from "../../../logic/app";
  import { computeCanReplyAll, subscribeCanReplyAll } from "../canReplyAll";

  export let message: EMail;

  let replyAllRev = 0;
  let replyAllUnsub: (() => void) | null = null;
  let canReplyAll = false;
  $: {
    replyAllUnsub?.();
    replyAllUnsub = subscribeCanReplyAll(message, () => replyAllRev++);
  }
  $: {
    replyAllRev;
    canReplyAll = computeCanReplyAll(message);
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
  function forward() {
    catchErrors(async () => {
      await message.loadForDisplay();
      let setting = (await import("../../Util/LocalStorage")).getLocalStorage("mail.send.forward", "inline").value;
      let fwd = setting == "attachment"
        ? await message.compose.forwardAsAttachment()
        : await message.compose.forwardInline();
      mailApp.writeMail(fwd);
    });
  }
  function actionTargets(): EMail[] {
    return ($selectedMessages?.hasItems && message && $selectedMessages.contents.some(target => messagesRepresentSameMail(target, message))
      ? $selectedMessages.contents
      : (message ? [message] : [])).slice();
  }
  function selectNextAfterAction(list: EMail[]) {
    let anchor = list[0] ?? message;
    let next = anchor?.nextMessage();
    $selectedMessages.replaceAll(next ? [next] : []);
    $selectedMessage = next ?? null;
  }
  async function deleteMessage() {
    let list = actionTargets();
    await deleteMessagesFromUI(list, () => selectNextAfterAction(list));
  }
  async function archiveMessage() {
    let list = actionTargets();
    selectNextAfterAction(list);
    for (let m of list) {
      await m.moveToArchive();
    }
  }
  async function restoreMessage() {
    let list = actionTargets();
    let last: EMail | null = null;
    for (let m of list) {
      await m.restoreFromTrash();
      last = m;
    }
    if (last) {
      await openEMailMessage(last);
    }
  }
  async function toggleSpam() {
    let list = actionTargets();
    let toSpam = !list[0]?.isSpam;
    selectNextAfterAction(list);
    for (let m of list) {
      await m.treatSpam(toSpam);
    }
  }
  async function toggleRead() {
    let list = actionTargets();
    if (message && list.some(target => target !== message && messagesRepresentSameMail(target, message))) {
      list.push(message);
    }
    let toRead = !list[0]?.isRead;
    await markMessagesRead(list, toRead);
  }
  async function toggleStar() {
    let list = actionTargets();
    let toStar = !list[0]?.isStarred;
    for (let m of list) {
      await m.markStarred(toStar);
    }
  }
  async function editDraft() {
    await message.loadMIME();
    mailApp.writeMail(message);
  }

  let isMenuOpen = false;
  let printE: Print;

  // Folder Popup
  let popupAnchorE: HTMLElement;
  let popupOpen = false;
  function onPopupToggle() {
    popupOpen = !popupOpen;
  }
  function onPopupClose() {
    popupOpen = false;
  }
</script>

<style>
  .buttons {
    justify-content: end;
    align-items: center;
    gap: 1px;
    margin-block-end: 0;
  }
  .buttons > * {
    margin-inline-start: 0;
    border-radius: 8px;
  }
  .draft {
    flex-shrink: 0;
  }
  .buttons :global(button) {
    width: var(--message-toolbar-control-size, 30px);
    height: var(--message-toolbar-control-size, 30px);
    padding: var(--message-toolbar-control-padding, 5px);
    color: var(--main-fg);
    transition:
      background-color 160ms ease,
      color 160ms ease,
      transform var(--button-motion-duration) var(--button-motion-ease),
      box-shadow 180ms ease;
  }
  .buttons :global(button.draft-action) {
    width: auto;
    height: auto;
    min-width: 0;
    padding: 6px 8px;
    border-radius: 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .buttons :global(button:hover:not(.disabled)) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
    transform: translateY(var(--button-motion-lift));
    box-shadow: 0 4px 12px rgba(var(--shadow-color), 0.09);
  }
  .buttons :global(button:active:not(.disabled)) {
    transform: translateY(0) scale(0.96);
  }
  .buttons :global(svg) {
    stroke-width: 1.3px;
  }
  .star.starred :global(svg) {
    fill: var(--icon-primary);
    color: var(--icon-primary);
  }
  .unread:not(.read) :global(svg) {
    fill: color-mix(in srgb, var(--icon-primary) 30%, transparent);
    color: var(--icon-primary);
  }
  hbox.draft {
    margin-right: 32px;
  }
  @media (max-width: 600px)  {
    .reply, .reply-all, .spam, .trash, .move, .menu {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .buttons :global(button) {
      transition: background-color 160ms ease, color 160ms ease;
    }
    .buttons :global(button:active:not(.disabled)) {
      transform: none;
    }
  }
</style>
