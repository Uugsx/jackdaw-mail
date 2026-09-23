<!-- Outlook-style Home ribbon — classic 3-pane layout only -->
<hbox class="classic-ribbon font-smallest"
  class:compact={ribbonSize == "compact"}
  class:normal={ribbonSize == "normal"}
  class:large={ribbonSize == "large"}>
  {#if showNew}
    <vbox class="group new-group" class:hidden={ribbonHidden.new} style:order={ribbonOrders.new}>
      <button type="button" class="ribbon-btn primary new-action" disabled={!account}
        title={$t`Write new email`}
        on:click={() => catchErrors(newMail)}>
        <MailPlusIcon size="22px" />
        <span>{$t`New email`}</span>
      </button>
    </vbox>

    <hbox class="divider" aria-hidden="true" />
  {/if}

  <vbox class="group separated" class:hidden={ribbonHidden.delete} style:order={ribbonOrders.delete}>
    {#if folder?.specialFolder == SpecialFolder.Trash || folder?.specialFolder == SpecialFolder.Spam}
      <button type="button" class="ribbon-btn primary" disabled={!hasSelection}
        title={$t`Restore`}
        on:click={() => catchErrors(restoreSelected)}>
        <UndoIcon size="20px" />
        <span>{$t`Restore`}</span>
      </button>
    {/if}
    <button type="button" class="ribbon-btn danger delete-action" disabled={!hasSelection}
      title={$t`Delete`}
      on:click={() => catchErrors(deleteSelected)}>
      <TrashIcon size="20px" />
      <span>{$t`Delete`}</span>
    </button>
  </vbox>

  <hbox class="divider" aria-hidden="true" />

  <vbox class="group row separated" class:hidden={ribbonHidden.reply} style:order={ribbonOrders.reply}>
    <button type="button" class="ribbon-btn reply-action" disabled={!message}
      title={$t`Reply to author`}
      on:click={() => catchErrors(reply)}>
      <ReplyIcon size="20px" />
      <span>{$t`Reply`}</span>
    </button>
    <button type="button" class="ribbon-btn reply-all-action" disabled={!canReplyAll}
      title={$t`Reply to all`}
      on:click={() => catchErrors(replyAll)}>
      <ReplyAllIcon size="20px" />
      <span>{$t`Reply all`}</span>
    </button>
    <button type="button" class="ribbon-btn forward-action" disabled={!message}
      title={$t`Forward`}
      on:click={() => catchErrors(forward)}>
      <ForwardIcon size="20px" />
      <span>{$t`Forward`}</span>
    </button>
  </vbox>

  <hbox class="divider" aria-hidden="true" />

  <vbox class="group row separated" class:hidden={ribbonHidden.organize} style:order={ribbonOrders.organize}>
    <button type="button" class="ribbon-btn move-action" disabled={!hasSelection}
      bind:this={moveAnchor}
      title={$t`Move`}
      on:click|stopPropagation={() => catchErrors(toggleMove)}>
      <span class="ribbon-icon ribbon-icon-default" aria-hidden="true">
        <FolderInputIcon size="20px" />
      </span>
      <span class="ribbon-icon ribbon-icon-hover" aria-hidden="true">
        <FolderOpenIcon size="20px" />
      </span>
      <span>{$t`Move`}</span>
    </button>
    <button type="button" class="ribbon-btn archive-action" disabled={!hasSelection}
      title={$t`Archive`}
      on:click={() => catchErrors(archiveSelected)}>
      <ArchiveIcon size="20px" />
      <span>{$t`Archive`}</span>
    </button>
    <button type="button" class="ribbon-btn spam-action" disabled={!hasSelection}
      title={messageSpam ? $t`Mark as not spam` : $t`Mark as spam`}
      on:click={() => catchErrors(toggleSpam)}>
      <svelte:component this={messageSpam ? NotSpamIcon : SpamIcon} size="20px" />
      <span>{messageSpam ? $t`Not spam` : $t`Junk`}</span>
    </button>
  </vbox>

  <hbox class="divider" aria-hidden="true" />

  <vbox class="group row separated" class:hidden={ribbonHidden.status} style:order={ribbonOrders.status}>
    <button type="button" class="ribbon-btn read-action" disabled={!hasSelection}
      aria-pressed={!!messageRead}
      title={messageRead ? $t`Mark as unread` : $t`Mark as read`}
      on:click={() => catchErrors(toggleRead)}>
      {#if messageRead}
        <span class="ribbon-icon ribbon-icon-default" aria-hidden="true">
          <MailOpenIcon size="20px" />
        </span>
        <span class="ribbon-icon ribbon-icon-hover" aria-hidden="true">
          <MailIcon size="20px" />
        </span>
      {:else}
        <span class="ribbon-icon ribbon-icon-default" aria-hidden="true">
          <MailIcon size="20px" />
        </span>
        <span class="ribbon-icon ribbon-icon-hover" aria-hidden="true">
          <MailOpenIcon size="20px" />
        </span>
      {/if}
      <span>{messageRead ? $t`Unread` : $t`Mark as read`}</span>
    </button>
    <button type="button" class="ribbon-btn flag-action" class:on={messageStarred}
      aria-pressed={!!messageStarred} disabled={!hasSelection}
      title={messageStarred ? $t`Flagged` : $t`Flag`}
      on:click={() => catchErrors(toggleStar)}>
      <FlagIcon size="20px" />
      <span>{$t`Flag`}</span>
    </button>
    <button type="button" class="ribbon-btn important-action" class:on={messageImportant}
      aria-pressed={!!messageImportant} disabled={!hasSelection}
      title={messageImportant ? $t`Mark as not important` : $t`Mark as important`}
      on:click={() => catchErrors(toggleImportant)}>
      <ImportantIcon size="20px" />
      <span>{$t`Important`}</span>
    </button>
    {#if $availableTags.hasItems}
      <button type="button" class="ribbon-btn categories-action" class:on={anySelectedHasTags}
        aria-haspopup="menu" aria-expanded={catMenuOpen} disabled={!hasSelection}
        bind:this={catAnchor}
        title={$t`Set categories`}
        on:click|stopPropagation={onCategoriesClick}>
        <TagsIcon size="20px" />
        <span>{$t`Categories`}</span>
      </button>
      {#if catAnchor}
        <Menu bind:isMenuOpen={catMenuOpen} anchor={catAnchor} placement="bottom-start">
          <MenuItem
            onClick={clearTags}
            label={$t`Clear all`}
            disabled={!anySelectedHasTags}
            closeOnClick={false} />
          <MenuDivider />
          {#if usableTagCombinations($tagCombinations.contents).length}
            {#each usableTagCombinations($tagCombinations.contents) as combination (combination.id)}
              <MenuItem
                label={combination.name}
                onClick={() => applyCombination(combination)}
                closeOnClick={false}>
                <hbox slot="icon" class="combo-dots">
                  {#each resolveCombinationTags(combination) as tag (tag.name)}
                    <span class="tag-dot" style="--tag-color: {tag.color}" />
                  {/each}
                </hbox>
              </MenuItem>
            {/each}
            <MenuDivider />
          {/if}
          {#each sortedTagList($availableTags.contents) as tag (tag.name)}
            <MenuItem
              label={tag.name}
              selected={majorityHasTag(tag)}
              onClick={() => toggleTag(tag)}
              closeOnClick={false}>
              <hbox slot="icon" class="tag-dot" style="--tag-color: {tag.color}" />
            </MenuItem>
          {/each}
        </Menu>
      {/if}
    {/if}
  </vbox>

  <hbox class="divider" aria-hidden="true" />

  <vbox class="group separated" class:hidden={ribbonHidden.more} style:order={ribbonOrders.more}>
      <ButtonMenu label={$t`More`}>
      {#if message}
        <MessageMenu {message} {printE} onMove={toggleMove} />
        <MenuDivider />
      {/if}
      <MenuItem
        onClick={getMail}
        label={$t`Get mail`}
        icon={RefreshIcon}
        disabled={!folder} />
      </ButtonMenu>
  </vbox>

</hbox>

<Print {message} bind:this={printE} />

{#if moveAnchor}
  <Popup bind:popupOpen={moveOpen} popupAnchor={moveAnchor} placement="bottom-start" boundaryElSel="body">
    {#if moveMessages.hasItems}
      <MessageMovePopup messages={moveMessages} on:close={() => moveOpen = false} />
    {/if}
  </Popup>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { availableTags, sortedTagList, type Tag } from "../../../logic/Abstract/Tag";
  import {
    applyTagCombinationToEmails,
    resolveCombinationTags,
    sortedTagCombinations,
    tagCombinations,
    usableTagCombinations,
    type TagCombination,
  } from "../../../logic/Abstract/TagCombination";
  import { mailApp } from "../MailJackdawApp";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import { openEMailMessage } from "../open";
  import Popup from "../../Shared/Popup.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import Print from "../Message/MessagePrint.svelte";
  import MailPlusIcon from "lucide-svelte/icons/mail-plus";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import FolderInputIcon from "lucide-svelte/icons/folder-input";
  import FolderOpenIcon from "lucide-svelte/icons/folder-open";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import MailIcon from "lucide-svelte/icons/mail";
  import MailOpenIcon from "lucide-svelte/icons/mail-open";
  import FlagIcon from "lucide-svelte/icons/flag";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import TagsIcon from "lucide-svelte/icons/tags";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import { ArrayColl } from "svelte-collections";
  import { catchErrors } from "../../Util/error";
  import { deleteMessagesFromUI } from "../mailDeleteUndo";
  import { runMailActions } from "../mailBulkActions";
  import { moveMessagesToArchive } from "../mailArchiveActions";
  import { markMessagesRead, messagesRepresentSameMail } from "../mailReadActions";
  import { assert } from "../../../logic/util/util";
  import { get } from "svelte/store";
  import { selectedMessages as selectedMessagesStore } from "../Selected";
  import { t, gt } from "../../../l10n/l10n";
  import { computeCanReplyAll, subscribeCanReplyAll } from "../canReplyAll";
  import {
    ribbonPreferences,
    type RibbonGroupId,
  } from "./ribbonPreferences";

  export let account: MailAccount;
  export let folder: Folder;
  export let message: EMail;
  export let selectedMessages: ArrayColl<EMail>;
  export let showNew = true;

  $: currentRibbonPreferences = $ribbonPreferences;
  $: ribbonSize = currentRibbonPreferences.size;
  $: ribbonOrders = currentRibbonPreferences.order.reduce((orders, group, index) => {
    if (!currentRibbonPreferences.hidden.includes(group)) {
      orders[group] = index;
    }
    return orders;
  }, {} as Record<RibbonGroupId, number>);
  $: ribbonHidden = {
    new: currentRibbonPreferences.hidden.includes("new"),
    delete: currentRibbonPreferences.hidden.includes("delete"),
    reply: currentRibbonPreferences.hidden.includes("reply"),
    organize: currentRibbonPreferences.hidden.includes("organize"),
    status: currentRibbonPreferences.hidden.includes("status"),
    more: currentRibbonPreferences.hidden.includes("more"),
  };

  let printE: Print;

  // `get()` reads a store without subscribing, so it must not be the only way
  // a reactive statement sees the selection - the buttons would then keep a
  // stale enabled state after a selection change. It stays in the click
  // handlers below, where a point-in-time snapshot is what we want.
  $: hasSelection = !!(message || selectedMessages?.hasItems || $selectedMessagesStore?.hasItems);
  // Bump after message mutations so state icons refresh without a $message store sub.
  let flagsEpoch = 0;
  let replyAllRev = 0;
  let replyAllUnsub: (() => void) | null = null;
  function onMessageChange() {
    replyAllRev++;
    flagsEpoch++;
  }
  $: {
    replyAllUnsub?.();
    replyAllUnsub = subscribeCanReplyAll(message, onMessageChange);
  }
  $: canReplyAll = replyAllRev >= 0 && computeCanReplyAll(message);
  $: messageSpam = flagsEpoch >= 0 && message?.isSpam;
  $: messageRead = flagsEpoch >= 0 && message?.isRead;
  $: messageStarred = flagsEpoch >= 0 && message?.isStarred;
  $: messageImportant = flagsEpoch >= 0 && message?.isImportant;
  $: anySelectedHasTags = flagsEpoch >= 0 && !!(
    ($selectedMessagesStore?.contents?.some(m => m.tags?.hasItems)) ||
    (selectedMessages?.contents?.some(m => m.tags?.hasItems)) ||
    message?.tags?.hasItems
  );

  let moveAnchor: HTMLElement;
  let moveOpen = false;
  let moveMessages = new ArrayColl<EMail>();
  let catAnchor: HTMLElement;
  let catMenuOpen = false;

  function newMail() {
    assert(account, gt`Please select a mail account first`);
    mailApp.writeMail(account.newEMailFrom());
  }

  /**
   * Snapshot at click time from the shared store (same ArrayColl FastList mutates).
   */
  function selectionSnapshot(): ArrayColl<EMail> {
    let selected = get(selectedMessagesStore) ?? selectedMessages;
    if (selected?.hasItems) {
      return new ArrayColl(selected.contents.slice());
    }
    if (message) {
      return new ArrayColl([message]);
    }
    return new ArrayColl<EMail>();
  }

  async function deleteSelected() {
    await deleteMessagesFromUI(selectionSnapshot().contents);
  }

  async function restoreSelected() {
    let list = selectionSnapshot().contents;
    let last = list.at(-1) ?? null;
    await runMailActions(list, m => m.restoreFromTrash());
    if (last) {
      await openEMailMessage(last);
    }
  }

  async function archiveSelected() {
    await moveMessagesToArchive(selectionSnapshot().contents);
  }

  async function reply() {
    await message.loadForDisplay();
    mailApp.writeMail(message.compose.replyToAuthor());
  }

  async function replyAll() {
    await message.loadForDisplay();
    mailApp.writeMail(message.compose.replyAll());
  }

  async function forward() {
    await message.loadForDisplay();
    let setting = (await import("../../Util/LocalStorage")).getLocalStorage("mail.send.forward", "inline").value;
    let fwd = setting == "attachment"
      ? await message.compose.forwardAsAttachment()
      : await message.compose.forwardInline();
    mailApp.writeMail(fwd);
  }

  function toggleMove() {
    moveMessages = selectionSnapshot();
    setTimeout(() => { moveOpen = !moveOpen; }, 0);
  }

  async function toggleSpam() {
    let list = selectionSnapshot().contents;
    let toSpam = !list[0]?.isSpam;
    await runMailActions(list, m => m.treatSpam(toSpam));
    flagsEpoch++;
  }

  async function toggleRead() {
    let list = selectionSnapshot().contents;
    if (message && list.some(target => target !== message && messagesRepresentSameMail(target, message))) {
      list.push(message);
    }
    let toRead = !list[0]?.isRead;
    await markMessagesRead(list, toRead);
    flagsEpoch++;
  }

  async function toggleStar() {
    let list = selectionSnapshot().contents;
    let toStar = !list[0]?.isStarred;
    await runMailActions(list, m => m.markStarred(toStar));
    flagsEpoch++;
  }

  async function toggleImportant() {
    let list = selectionSnapshot().contents;
    let toImportant = !list[0]?.isImportant;
    await runMailActions(list, m => m.markImportant(toImportant));
    flagsEpoch++;
  }

  function onCategoriesClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setTimeout(() => { catMenuOpen = !catMenuOpen; }, 0);
  }

  function majorityHasTag(tag: Tag): boolean {
    let list = selectionSnapshot().contents;
    if (!list.length) {
      return false;
    }
    return list.filter(m => m.tags?.contains(tag)).length / list.length > 0.5;
  }

  async function applyCombination(combination: TagCombination) {
    try {
      await applyTagCombinationToEmails(selectionSnapshot().contents, combination);
    } finally {
      flagsEpoch++;
    }
  }

  async function toggleTag(tag: Tag) {
    let list = selectionSnapshot().contents;
    let remove = majorityHasTag(tag);
    let targets = remove
      ? list.filter(m => m.tags.contains(tag))
      : list.filter(m => !m.tags.contains(tag));
    try {
      await runMailActions(targets, m => remove ? m.removeTag(tag) : m.addTag(tag));
    } finally {
      flagsEpoch++;
    }
  }

  async function clearTags() {
    try {
      await runMailActions(selectionSnapshot().contents, m => m.clearTags());
    } finally {
      flagsEpoch++;
    }
  }

  async function getMail() {
    assert(folder, gt`Please select a folder first`);
    let acc = folder.account;
    if (!acc.isLoggedIn) {
      await acc.login(true);
    }
    await folder.fetchNewMailQuick();
  }
</script>

<style>
  .classic-ribbon {
    align-items: center;
    gap: 2px;
    padding: 0;
    background: transparent;
    border: none;
    flex-shrink: 0;
    overflow: visible;
  }
  .group {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding-inline: 0;
  }
  .group.row {
    flex-direction: row;
    align-items: center;
  }
  .group.separated {
    border-inline-start: 1px solid var(--border);
    padding-inline-start: 3px;
  }
  .group.hidden {
    display: none;
  }
  .divider {
    display: none;
  }
  .ribbon-btn {
    --ribbon-hover-color: var(--hover-fg);
    --ribbon-icon-hover-filter: none;
    --ribbon-icon-hover-transform: none;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    min-width: 32px;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--main-fg);
    font: inherit;
    font-size: 0;
    line-height: 0;
    cursor: default;
    flex-shrink: 0;
    transition:
      background-color 160ms ease,
      color 160ms ease,
      outline-color 160ms ease,
      transform var(--button-motion-duration) var(--button-motion-ease),
      box-shadow 180ms ease;
  }
  .ribbon-btn :global(svg) {
    display: block;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    transform-origin: center;
    transition:
      transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
      color 160ms ease,
      fill 160ms ease,
      filter 160ms ease;
  }
  .ribbon-btn > span:not(.ribbon-icon) {
    display: none;
  }
  .ribbon-btn .ribbon-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  .ribbon-btn .ribbon-icon-hover {
    display: none;
  }
  .ribbon-btn:hover:not(:disabled),
  .ribbon-btn:focus-visible:not(:disabled) {
    background-color: var(--hover-bg);
    color: var(--ribbon-hover-color);
    transform: translateY(var(--button-motion-lift));
    box-shadow: 0 4px 12px rgba(var(--shadow-color), 0.09);
  }
  .ribbon-btn:active:not(:disabled) {
    transform: translateY(0) scale(var(--button-motion-press-scale));
  }
  .ribbon-btn:focus-visible:not(:disabled) {
    outline: 2px solid color-mix(in srgb, var(--icon-primary) 72%, transparent);
    outline-offset: 2px;
  }
  .ribbon-btn:hover:not(:disabled) :global(svg),
  .ribbon-btn:focus-visible:not(:disabled) :global(svg) {
    color: inherit;
    filter: var(--ribbon-icon-hover-filter);
    transform: var(--ribbon-icon-hover-transform);
  }
  .ribbon-btn:hover:not(:disabled) .ribbon-icon-default,
  .ribbon-btn:focus-visible:not(:disabled) .ribbon-icon-default {
    display: none;
  }
  .ribbon-btn:hover:not(:disabled) .ribbon-icon-hover,
  .ribbon-btn:focus-visible:not(:disabled) .ribbon-icon-hover {
    display: inline-flex;
  }
  .ribbon-btn:disabled {
    opacity: 0.35;
  }
  .ribbon-btn.primary:not(:disabled) {
    color: var(--toolbar-control-fg);
  }
  .ribbon-btn.danger:not(:disabled) {
    color: var(--danger-fg);
  }
  .ribbon-btn.on :global(svg) {
    fill: var(--icon-primary);
    color: var(--icon-primary);
  }
  .ribbon-btn.new-action {
    --ribbon-icon-hover-transform: translateY(-1px) scale(1.04);
  }
  .ribbon-btn.reply-action {
    --ribbon-icon-hover-transform: translateX(-2px);
  }
  .ribbon-btn.reply-all-action {
    --ribbon-icon-hover-transform: translateX(-2px) scale(1.04);
  }
  .ribbon-btn.forward-action {
    --ribbon-icon-hover-transform: translateX(2px);
  }
  .ribbon-btn.move-action,
  .ribbon-btn.archive-action {
    --ribbon-icon-hover-transform: translateY(-1px) scale(1.04);
  }
  .ribbon-btn.spam-action {
    --ribbon-icon-hover-transform: rotate(-4deg) scale(1.04);
  }
  .ribbon-btn.flag-action {
    --ribbon-hover-color: var(--danger-fg);
    --ribbon-icon-hover-transform: rotate(-5deg) scale(1.04);
  }
  .ribbon-btn.flag-action:hover:not(:disabled) :global(svg),
  .ribbon-btn.flag-action:focus-visible:not(:disabled) :global(svg) {
    fill: color-mix(in srgb, var(--danger-fg) 22%, transparent);
  }
  .ribbon-btn.important-action {
    --ribbon-hover-color: color-mix(in srgb, var(--danger-fg) 76%, var(--icon-primary));
    --ribbon-icon-hover-filter: drop-shadow(0 0 3px currentColor);
    --ribbon-icon-hover-transform: scale(1.08);
  }
  .ribbon-btn.categories-action {
    --ribbon-hover-color: color-mix(in srgb, #3f8f58 88%, var(--main-fg));
    --ribbon-icon-hover-transform: rotate(-4deg) scale(1.04);
  }
  .ribbon-btn.delete-action {
    --ribbon-hover-color: var(--danger-fg);
  }
  .ribbon-btn.delete-action :global(svg path:nth-of-type(4)),
  .ribbon-btn.delete-action :global(svg path:nth-of-type(5)) {
    transform-box: view-box;
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .ribbon-btn.delete-action :global(svg path:nth-of-type(4)) {
    transform-origin: 21px 6px;
  }
  .ribbon-btn.delete-action :global(svg path:nth-of-type(5)) {
    transform-origin: 16px 4px;
  }
  .ribbon-btn.delete-action:hover:not(:disabled) :global(svg path:nth-of-type(4)),
  .ribbon-btn.delete-action:focus-visible:not(:disabled) :global(svg path:nth-of-type(4)) {
    transform: translateY(-2px) rotate(8deg);
  }
  .ribbon-btn.delete-action:hover:not(:disabled) :global(svg path:nth-of-type(5)),
  .ribbon-btn.delete-action:focus-visible:not(:disabled) :global(svg path:nth-of-type(5)) {
    transform: translateY(-2px) rotate(8deg);
  }
  .tag-dot {
    width: 10px;
    height: 10px;
    border-radius: 1000px;
    background-color: var(--tag-color);
  }
  .combo-dots {
    gap: 3px;
    align-items: center;
  }
  .classic-ribbon :global(.menu) {
    align-items: center;
  }
  .classic-ribbon :global(.menu-button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    color: var(--main-fg);
  }
  .classic-ribbon :global(.menu-button:hover:not(.disabled)) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .classic-ribbon.large .ribbon-btn {
    width: 66px;
    min-width: 66px;
    height: 54px;
    gap: 4px;
    padding: 4px 6px;
    font-size: 10px;
    line-height: 1.15;
  }
  .classic-ribbon.large .ribbon-btn :global(svg) {
    width: 22px;
    height: 22px;
  }
  .classic-ribbon.large .ribbon-btn > span:not(.ribbon-icon) {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .classic-ribbon.large .ribbon-btn .ribbon-icon {
    width: 22px;
    height: 22px;
  }
  .classic-ribbon.compact .ribbon-btn {
    width: 28px;
    min-width: 28px;
    height: 28px;
  }
  @media (prefers-reduced-motion: reduce) {
    .ribbon-btn {
      transition: none;
    }
    .ribbon-btn :global(svg),
    .ribbon-btn.delete-action :global(svg path) {
      transition: none;
      transform: none !important;
    }
    .ribbon-btn.important-action:hover:not(:disabled) :global(svg),
    .ribbon-btn.important-action:focus-visible:not(:disabled) :global(svg) {
      filter: none;
    }
  }
</style>
