<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<vbox class="message"
  class:unread={!$message.isRead}
  draggable="true" on:dragstart={(event) => catchErrors(() => onDragStartMail(event, message))}
  style="--account-color: {$message.folder.account.color};"
  on:contextmenu={contextMenu.onContextMenu}
  on:click
  on:swiperight={() => catchErrors(deleteMessage)}
  on:swipeleft={() => catchErrors(markAsSpam)}
  bind:this={popupAnchor}
  >
  <hbox class="top-row">
    <hbox class="direction" title={actionTitle}>
      {#if $message.isReplied}
        <ReplyIcon size={16} class="reply" />
      {:else if $message.isForwarded}
        <ForwardIcon size={16} class="forward" />
      {:else if $message.isImportant}
        <ImportantIcon size={16} class="important" />
      {/if}
      {#if actionDate}
        <hbox class="action-date font-smallest">{actionDate}</hbox>
      {/if}
    </hbox>
    <hbox class="contact font-small">{contactName}</hbox>
    <hbox flex />
    <hbox class="date font-smallest">{getDateTimeString($message.listDisplayDate())}</hbox>
    <hbox class="unread-dot button" class:unread={!$message.isRead}>
      <Button
        icon={CircleIcon}
        iconSize="7px"
        iconOnly
        label={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
        onClick={toggleRead}
        plain
        />
    </hbox>
  </hbox>
  <hbox class="bottom-row">
    <hbox class="subject font-small">{$message.subject}</hbox>
    <MessageTags tags={$tags} />
    {#if !isMobile}
      <hbox class="move button">
        <Button
          icon={FolderActionsIcon}
          iconSize="16px"
          iconOnly
          label={$t`Move, tag, or delete`}
          onClick={onPopupToggle}
          plain
          />
      </hbox>
    {/if}
    <hbox class="star button" class:starred={$message.isStarred}>
      <Button
        icon={StarIcon}
        iconSize="16px"
        iconOnly
        label={$t`Remember this message`}
        onClick={toggleStar}
        plain
        />
    </hbox>
    <hbox class="attachments">
      {#if $message.hasVisibleAttachments}
        <AttachmentIcon size="14px" />
      {/if}
    </hbox>
  </hbox>
</vbox>
<ContextMenu bind:this={contextMenu}>
  <MessageMenu {message} onMove={onPopupToggle} />
</ContextMenu>
<Popup bind:popupOpen {popupAnchor} placement="bottom-end" boundaryElSel=".message-list-pane">
  {#if $selectedMessages?.length > 1 && $selectedMessages?.contains(message)}
    <MessageMovePopup messages={new ArrayColl($selectedMessages)} on:close={onPopupClose} />
  {:else}
    <MessageMovePopup messages={new ArrayColl([message])} on:close={onPopupClose} />
  {/if}
</Popup>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { onDragStartMail } from "../Message/drag";
  import { selectedMessage, selectedMessages } from "../Selected";
  import MessageTags from "../../Shared/Tag/MessageTags.svelte";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
  import { isMobile } from "../../../logic/build";
  import { getDateTimeString } from "../../Util/date";
  import { catchErrors } from "../../Util/error";
  import { deleteMessagesFromUI } from "../mailDeleteUndo";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  $: tags = message.tags;
  $: contactName = personDisplayName($message.contact);
  let lastVerbAt: Date | null;
  $: lastVerbAt = $message.lastVerbAt;
  $: actionDate = lastVerbAt && ($message.isReplied || $message.isForwarded)
    ? getDateTimeString(lastVerbAt)
    : "";
  $: actionTitle = $message.isReplied
    ? actionDate ? $t`Replied: ${actionDate}` : $t`Replied`
    : $message.isForwarded
      ? actionDate ? $t`Forwarded: ${actionDate}` : $t`Forwarded`
      : "";

  async function toggleRead() {
    await message.markRead(!message.isRead);
  }
  async function toggleStar() {
    await message.markStarred(!message.isStarred);
  }
  async function toggleSpam() {
    await message.treatSpam(!message.isSpam);
  }
  async function markAsSpam() {
    await message.treatSpam(true);
  }
  async function deleteMessage() {
    let list = ($selectedMessages?.hasItems && $selectedMessages.contains(message)
      ? $selectedMessages.contents
      : [message]).slice();
    await deleteMessagesFromUI(list);
  }

  let contextMenu: ContextMenu;

  // Popup
  let popupAnchor: HTMLElement;
  let popupOpen = false;
  function onPopupToggle() {
    popupOpen = !popupOpen;
  }
  function onPopupClose() {
    popupOpen = false;
  }
</script>

<style>
  .message {
    padding: 4px 12px 4px 8px !important;
    justify-content: baseline;
    align-items: baseline;
    position: relative;
  }
  :global(.mobile) .message {
    padding: 8px 12px 8px 12px !important;
  }

  /* account color bar */
  .message::before {
    position: absolute;
    top: 18%;
    content: "";
    height: 64%;
    border-left: 3px solid var(--account-color);
    border-radius: 10px;
  }

  .top-row,
  .bottom-row {
    width: 100%;
    overflow: hidden;
    padding-inline-start: 14px;
  }
  .top-row {
    height: 1.5em;
  }
  .bottom-row {
    height: 1.3em;
    align-items: center;
  }
  .contact {
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--msg-list-fs, inherit);
  }
  .subject,
  .date {
    font-weight: 300;
  }
  .subject {
    color: color-mix(in srgb, var(--main-fg, var(--fg)) 76%, transparent);
  }
  .unread .contact,
  .unread .subject,
  .unread .date {
    font-weight: 700;
  }
  .unread .subject {
    color: var(--icon-primary);
  }
  :global(.row.selected) .subject {
    color: inherit;
  }
  .date {
    min-width: 0;
    flex-shrink: 0;
    justify-content: end;
    font-family: inherit;
    padding-top: 2px;
    font-size: var(--msg-list-fs-sm, 12px);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .subject {
    line-height: 1.3;
    flex: 0 1 auto;
    min-width: 0;
    margin-inline-end: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--msg-list-fs, inherit);
  }
  .attachments {
    align-self: center;
    justify-self: center;
    opacity: 60%;
  }
  .star {
    margin-inline-end: 1px; /* for alignment with unread button */
  }
  .attachments :global(> *) {
    margin-inline-end: 3px; /* for alignment with unread button */
  }
  /*
  :global(.row:not(:hover)) .buttons.hover {
    display: none;
  }
  :global(.row:hover) .date {
    display: none;
  }
  */
  .button {
    width: 20px;
    vertical-align: bottom;
  }
  .direction > :global(*) {
    margin-inline-end: 4px;
  }
  .action-date {
    max-width: 7rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    opacity: 0.68;
  }
  :global(.row.selected) .action-date {
    opacity: 0.82;
  }

  /* <copied from="TableMessageListItem.svelte"> */
  .button:hover {
    background-color: transparent;
  }
  .button:hover :global(svg) {
    color: var(--icon-primary);
    stroke: var(--icon-primary);
    fill: none;
  }
  .star.starred.button:hover :global(svg) {
    fill: var(--icon-primary);
    stroke: var(--icon-primary);
  }
  .button :global(button) {
    background-color: unset !important;
    color: unset !important;
  }
  .button :global(button:hover:not(.disabled)),
  .button :global(button:focus-visible:not(.disabled)) {
    background-color: transparent !important;
  }
  .direction {
    align-items: center;
  }
  .direction :global(svg.outgoing) {
    stroke-width: 1px;
  }
  .direction :global(svg.important) {
    color: crimson;
  }
  @media (prefers-color-scheme: light) {
    .direction :global(svg.outgoing) {
      color: darkred;
    }
    .direction :global(svg.reply),
    .direction :global(svg.forward) {
      color: grey;
    }
  }
  .direction :global(svg.reply),
  .direction :global(svg.forward) {
    stroke-width: 1px;
  }
  :global(.row.selected) .direction :global(svg.reply),
  :global(.row.selected) .direction :global(svg.forward),
  :global(.row.selected) .direction :global(svg.important) {
    color: var(--selected-fg);
  }
  .star :global(svg) {
    stroke-width: 1px;
  }
  .buttons.hover .button :global(svg) {
    color: color-mix(in srgb, currentColor 78%, transparent);
    transition: color 0.12s ease, stroke 0.12s ease, fill 0.12s ease;
  }
  :global(.row.selected) .buttons.hover .button :global(svg) {
    color: var(--selected-fg);
  }
  .buttons.hover :global(svg),
  .unread-dot :global(svg) {
    stroke-width: 1.5px;
  }
  :global(.row:not(:hover)) .unread-dot :global(svg),
  :global(.row:not(:hover)) .star :global(svg) {
    stroke: none;
  }
  :global(.row:not(:hover)) .star:not(.starred) {
    display: none;
  }
  :global(.row:not(:hover)) .unread-dot:not(.unread) :global(svg) {
    display: none;
  }
  .star.starred :global(svg) {
    fill: var(--selected-hover-bg);
    stroke: var(--selected-hover-bg);
  }
  :global(.row.selected) .star.starred :global(svg) {
    fill: var(--selected-fg);
    stroke: var(--selected-fg);
  }
  :global(.row.selected:hover) .star.starred :global(svg) {
    fill: var(--selected-hover-fg);
    stroke: var(--selected-hover-fg);
  }
  .unread-dot.unread :global(svg) {
    fill: green;
  }
  /* </copied> */
  .move.button {
    margin-inline-end: 8px;
  }
  .move.button :global(svg) {
    stroke-width: 1px;
  }
  :global(.row:not(:hover)) .move.button {
    display: none;
  }

  /* Однострочный режим списка для дополнительной плотности интерфейса. */
  :global(.desktop.main-window.ui-density-extra-compact) .message {
    display: grid;
    grid-template-columns: 22px minmax(0, 23%) minmax(4rem, 1fr) minmax(0, 22%) auto 18px 18px auto auto;
    grid-template-rows: 24px;
    grid-auto-rows: 24px;
    align-items: center;
    box-sizing: border-box;
    min-height: 24px;
    height: 24px;
    padding: 0 8px 0 6px !important;
    column-gap: 6px;
    grid-auto-flow: dense;
    min-width: 0;
    overflow: hidden;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .top-row,
  :global(.desktop.main-window.ui-density-extra-compact) .bottom-row {
    display: contents;
    width: auto;
    height: auto;
    padding: 0;
    overflow: visible;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .top-row > hbox[flex] {
    display: none;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .direction {
    grid-column: 1;
    grid-row: 1;
    width: 22px;
    min-width: 22px;
    max-width: 22px;
    min-height: 16px;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    gap: 0;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .direction :global(svg) {
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .action-date {
    display: none;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .contact {
    grid-column: 2;
    grid-row: 1;
    width: 100%;
    min-width: 0;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .subject {
    grid-column: 3;
    grid-row: 1;
    width: 100%;
    min-width: 4rem;
    margin-inline-end: 0;
    line-height: 1.15;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .date {
    grid-column: 5;
    grid-row: 1;
    padding-top: 0;
  }
  :global(.desktop.main-window.ui-density-extra-compact) :global(.message-tags) {
    grid-column: 4;
    grid-row: 1;
    width: 100%;
    min-width: 0;
    font-size: 10px;
  }
  :global(.desktop.main-window.ui-density-extra-compact) :global(.message-tags .tag) {
    border-radius: 6px;
    padding-inline: 4px;
    line-height: 1.25;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .attachments {
    grid-column: 6;
    grid-row: 1;
    width: 18px;
    min-width: 18px;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .unread-dot {
    grid-column: 7;
    grid-row: 1;
    width: 18px;
    min-width: 18px;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .move {
    grid-column: 8;
    grid-row: 1;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .star {
    grid-column: 9;
    grid-row: 1;
  }
  :global(.desktop.main-window.ui-density-extra-compact) .message::before {
    inset-inline-start: 5px;
    top: 10%;
    height: 80%;
  }
</style>
