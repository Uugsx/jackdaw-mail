<vbox class="message-popup">
  <hbox class="top buttons">
    <Button plain
      label={$t`Delete`}
      onClick={onDelete}
      icon={DeleteIcon}
      />
    {#if messages.first?.folder?.specialFolder == SpecialFolder.Trash || messages.first?.folder?.specialFolder == SpecialFolder.Spam}
      <Button plain
        label={$t`Restore`}
        tooltip={$t`Move this message back to the Inbox`}
        onClick={onRestore}
        icon={UndoIcon}
        />
    {/if}
    <Button plain
      label={$messages.first.isSpam ? $t`Not spam` : $t`Spam`}
      tooltip={$messages.first.isSpam ? $t`Treat this email as *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
      onClick={toggleSpam}
      icon={$messages.first.isSpam ? NotSpamIcon : SpamIcon}
      />
    <Button plain
      label={$t`Archive`}
      tooltip={$t`Move this email to the archive folder`}
      onClick={onArchive}
      icon={ArchiveIcon}
      iconOnly
      />
    <slot name="buttons" {messages} />
    <Button plain
      label={$t`Close`}
      onClick={onClose}
      iconOnly
      icon={CloseIcon}
      classes="close-button"
      />
  </hbox>
  {#if showAccounts}
    <vbox class="accounts">
      <AccountList accounts={appGlobal.emailAccounts} bind:selectedAccount />
    </vbox>
  {/if}
  <vbox class="folders">
    <FolderList folders={selectedAccount.rootFolders} bind:selectedFolder bind:selectedFolders>
      <svelte:fragment slot="buttons" let:folder>
        {#if folder != sourceFolder}
          <Button plain
            label={$t`Copy`}
            tooltip={$t`Copy this email to folder ${folder.name}`}
            onClick={() => onCopyTo(folder)}
            icon={CopyIcon}
            iconOnly
            />
          <Button plain
            label={$t`Move`}
            tooltip={$t`Move this email to folder ${folder.name}`}
            onClick={() => onMoveTo(folder)}
            icon={MoveIcon}
            />
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="header">
        <hbox class="folders-header" flex>
          {$t`Folder`}
          <hbox flex />
          <Button
            label={$t`Move to other mail account`}
            icon={AccountsIcon}
            iconOnly
            plain
            selected={showAccounts}
            onClick={() => showAccounts = !showAccounts}
           />
        </hbox>
      </svelte:fragment>
    </FolderList>
    {#if archiveMailboxRoot}
      <vbox class="archive-folders">
        <hbox class="archive-mailbox-label" title={archiveMailboxRoot.name}>
          <ArchiveIcon size="14px" />
          <span>Сетевой архив</span>
        </hbox>
        <FolderList
          folders={archiveMailboxRoot.subFolders}
          embedded
          selectedFolder={selectedFolder}
          on:selectFolder={onSelectFolder}
          >
          <svelte:fragment slot="buttons" let:folder>
            {#if folder != sourceFolder}
              <Button plain
                label={$t`Copy`}
                tooltip={$t`Copy this email to folder ${folder.name}`}
                onClick={() => onCopyTo(folder)}
                icon={CopyIcon}
                iconOnly
                />
              <Button plain
                label={$t`Move`}
                tooltip={$t`Move this email to folder ${folder.name}`}
                onClick={() => onMoveTo(folder)}
                icon={MoveIcon}
                />
            {/if}
          </svelte:fragment>
        </FolderList>
      </vbox>
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
  import { ExchangeMailAccount } from "../../../logic/Mail/EWS/ExchangeMailAccount";
  import { selectedMessage, selectedMessages } from "../Selected";
  import { openEMailMessage } from "../open";
  import { appGlobal } from "../../../logic/app";
  import AccountList from "../LeftPane/AccountList.svelte";
  import FolderList from "../LeftPane/FolderList.svelte";
  import Button from "../../Shared/Button.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import UndoIcon from "lucide-svelte/icons/undo-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/mails";
  import AccountsIcon from "lucide-svelte/icons/share";
  import CloseIcon from "lucide-svelte/icons/x";
  import { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { withMailTransferProgress } from "../mailTransferProgress";
  import { runMailActions } from "../mailBulkActions";
  import { moveMessagesToArchive } from "../mailArchiveActions";
  import { createEventDispatcher, onDestroy } from 'svelte';
  const dispatch = createEventDispatcher<{ close: void }>();

  /** Attention
   * Always pass in a copy of the array, not the live `selectedMessages` array from the UI.
   * If the user deletes or moves messages, they will be removed from the UI
   * instantly, which changes the current selection, so the wrong emails get deleted. */
  export let messages: Collection<EMail>;

  let sourceFolder = messages.first.folder;
  let selectedFolder = sourceFolder;
  let selectedFolders = new ArrayColl<Folder>();
  let selectedAccount = sourceFolder.account;
  let archiveMailboxRoot: Folder | null = null;
  let observedSelectedAccount: MailAccount | null = null;
  let selectedAccountUnsubscribe: (() => void) | undefined;
  let selectedAccountEpoch = 0;
  let selectedMessageIndex = sourceFolder.messages.getKeyForValue(messages.first);
  let wasSelected = $selectedMessage == messages.first; // just safety measure
  let showAccounts = false;

  /** Обновлять список архивных папок после асинхронной загрузки аккаунта. */
  $: if (selectedAccount !== observedSelectedAccount) {
    selectedAccountUnsubscribe?.();
    observedSelectedAccount = selectedAccount;
    selectedAccountUnsubscribe = selectedAccount.subscribe(() => selectedAccountEpoch++);
  }
  $: {
    selectedAccountEpoch;
    archiveMailboxRoot = selectedAccount instanceof ExchangeMailAccount
      ? selectedAccount.archiveMailboxRoot
      : null;
  }

  onDestroy(() => selectedAccountUnsubscribe?.());

  function onClose() {
    dispatch("close");
  }

  async function onDelete() {
    onClose();
    await runMailActions(messages.contents, message => message.deleteMessage());
    goToNextMessage();
  }
  async function onRestore() {
    onClose();
    let last = messages.contents.at(-1) ?? null;
    await runMailActions(messages.contents, message => message.restoreFromTrash());
    if (last) {
      await openEMailMessage(last);
    }
  }
  async function toggleSpam() {
    let spam = !messages.first.isSpam;
    onClose();
    await runMailActions(messages.contents, message => message.treatSpam(spam));
    goToNextMessage();
  }

  async function onArchive() {
    onClose();
    await withMailTransferProgress(sourceFolder, "move", messages.length, $t`Archive`, async update => {
      await moveMessagesToArchive(messages.contents, update);
    });
    goToNextMessage();
  }
  async function onMoveTo(folder: Folder) {
    onClose();
    await withMailTransferProgress(sourceFolder, "move", messages.length, folder.name,
      update => folder.moveMessagesHere(messages, update));
    goToNextMessage();
  }
  async function onCopyTo(folder: Folder) {
    onClose();
    await withMailTransferProgress(sourceFolder, "copy", messages.length, folder.name,
      update => folder.copyMessagesHere(messages, update));
  }

  function onSelectFolder(event: CustomEvent<Folder>) {
    selectedFolder = event.detail;
  }

  function goToNextMessage() {
    if (!wasSelected) {
      return;
    }
    $selectedMessage =
      sourceFolder.messages.getIndex(selectedMessageIndex) ??
      sourceFolder.messages.first ??
      sourceFolder.account.inbox.messages.first ??
      null;
    $selectedMessages.replaceAll($selectedMessage ? [$selectedMessage] : []);
  }
</script>

<style>
  .message-popup {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    width: min(32rem, calc(100vw - 16px));
    max-width: calc(100vw - 16px);
    min-width: 0;
    box-sizing: border-box;
    max-height: var(--popup-max-height, calc(100dvh - 16px));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .message-popup :global(.header) {
    display: flex !important;
    height: unset !important;
  }
  .message-popup :global(grid > .header) {
    margin-block-start: 0px;
    margin-block-end: 4px;
  }
  .accounts {
    height: min(10em, 25dvh);
    min-height: 0;
    min-width: 0;
  }
  .accounts :global(.account-list) {
    flex: 1;
    min-width: 0;
  }
  .folders {
    width: 100%;
    height: min(22em, 50dvh);
    min-height: 0;
    min-width: 0;
  }
  .folders > :global(.folder-list) {
    min-height: 0;
    min-width: 0;
  }
  .archive-folders {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
  }
  .archive-mailbox-label {
    align-items: center;
    gap: 6px;
    padding: 8px 8px 4px;
    border-block-start: 1px solid var(--border);
    color: var(--leftbar-fg);
    font-size: 0.9em;
    font-weight: 500;
  }
  .archive-mailbox-label :global(svg) {
    flex: 0 0 auto;
  }
  .buttons {
    align-self: stretch;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    border-top: 1px solid var(--border);
  }
  .buttons > :global(button:not(:first-child)) {
    border-left: 1px solid var(--border);
  }
  .buttons > :global(button) {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
    padding: 8px 12px;
    border-radius: 0px;
  }
  .buttons > :global(button.close-button) {
    flex: 0 0 48px;
  }
  .buttons :global(.icon) {
    flex: 0 0 auto;
  }
  .buttons :global(.label) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* TODO fix colors on hover
  .buttons > :global(.selected button:hover:not(.disabled)) {
    background-color: unset;
    color: green;
  }*/
</style>
