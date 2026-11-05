<vbox class="account-group">
  <AccountListItem
    {account}
    {selected}
    accountActive={folderSelected}
    {expanded}
    on:select={forwardSelect}
    on:toggleExpand={forwardToggleExpand}
    />
  {#if expanded}
    <vbox class="folders">
      <FolderList
        folders={account.rootFolders}
        embedded
        selectedFolder={selectedFolder}
        selectedFolders={selectedFolders}
        on:selectFolder={onSelectFolder}
        >
        <svelte:fragment slot="buttons" let:folder>
          <slot name="folder-buttons" {folder} />
        </svelte:fragment>
      </FolderList>
      {#if archiveMailboxRoot}
        <hbox class="archive-mailbox-label" title={archiveMailboxRoot.name}>
          <ArchiveIcon size="14px" />
          <span>{$t`Online archive`}</span>
        </hbox>
        <FolderList
          folders={archiveMailboxRoot.subFolders}
          embedded
          selectedFolder={selectedFolder}
          selectedFolders={selectedFolders}
          on:selectFolder={onSelectFolder}
          >
          <svelte:fragment slot="buttons" let:folder>
            <slot name="folder-buttons" {folder} />
          </svelte:fragment>
        </FolderList>
      {/if}
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { ExchangeMailAccount } from "../../../logic/Mail/EWS/ExchangeMailAccount";
  import AccountListItem from "./AccountListItem.svelte";
  import FolderList from "./FolderList.svelte";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import { t } from "../../../l10n/l10n";
  import { ArrayColl } from "svelte-collections";
  import { createEventDispatcher } from "svelte";

  export let account: MailAccount;
  export let selected = false;
  export let folderSelected = false;
  export let expanded = false;
  export let selectedFolder: Folder;
  let selectedFolders = new ArrayColl<Folder>();

  const dispatch = createEventDispatcher<{ select: MailAccount; toggleExpand: MailAccount; selectFolder: Folder }>();

  /** Повторно проверять архив Exchange после его обнаружения. */
  $: _account = $account;
  $: archiveMailboxRoot = _account instanceof ExchangeMailAccount
    ? _account.archiveMailboxRoot
    : null;

  function forwardSelect(event: CustomEvent<MailAccount>) {
    dispatch("select", event.detail);
  }

  function forwardToggleExpand(event: CustomEvent<MailAccount>) {
    dispatch("toggleExpand", event.detail);
  }

  function onSelectFolder(event: CustomEvent<Folder>) {
    dispatch("selectFolder", event.detail);
  }
</script>

<style>
  .account-group {
    flex: 0 0 auto;
  }
  .folders {
    padding-block-end: 4px;
  }
  .archive-mailbox-label {
    align-items: center;
    gap: 6px;
    padding: 8px 8px 4px 30px;
    border-block-start: 1px solid var(--border);
    color: var(--leftbar-fg);
    font-size: 0.9em;
    font-weight: 500;
    min-width: 0;
  }
  .archive-mailbox-label :global(svg) {
    flex: 0 0 auto;
  }
  .archive-mailbox-label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
