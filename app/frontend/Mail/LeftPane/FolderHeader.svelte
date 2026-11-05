<!-- Appears above the msg list; height matches the account row so lists line up -->
<hbox class="folder-header font-small">
  {#if $mailSearchInProgress}
    <hbox class="folder-name searching" role="status">
      <Loader size={12} stroke={2} />
      <span>{$t`Searching…`}</span>
    </hbox>
  {:else if searchMessages}
    <hbox class="folder-name">{$t`Search results`}</hbox>
  {:else if folder}
    <hbox class="folder-name" title={folder.name}>{folder.name}</hbox>
  {/if}
  <hbox flex />
  {#if searchMessages && !$mailSearchInProgress && $mailServerSearch}
    <hbox class="server-search" role="status" aria-live="polite">
      {#if $mailServerSearch.failed && !$mailServerSearch.loading}
        <span class="server-search-failed" role="img"
          title={$t`Some folders could not be searched on the server`}
          aria-label={$t`Some folders could not be searched on the server`}>
          <AlertIcon size="14px" aria-hidden="true" />
        </span>
      {/if}
      {#if $mailServerSearch.loading}
        <Loader size={12} stroke={2} />
        <span>{$t`Searching the server…`}</span>
      {:else if $mailServerSearch.hasMore}
        <Button plain
          label={$t`More from server`}
          tooltip={$t`Search the server for messages that are not on this device`}
          onClick={$mailServerSearch.loadMore} />
      {/if}
    </hbox>
  {/if}
  {#if account && !$account.isLoggedIn}
    <Button plain
      label={$t`Login`}
      icon={DisconnectedIcon}
      onClick={login}
      iconSize="16px" />
  {:else if folder}
    <FolderMsgCount {folder} {searchMessages} />
  {/if}
  {#if folder || searchMessages}
    <hbox class="list-view-menu">
      <ButtonMenu label={$t`Message list view`} buttonIcon={ListViewIcon} placement="bottom-end"
        dismissOnPointerLeave={false}>
        <MailListViewOptions />
      </ButtonMenu>
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { Folder } from '../../../logic/Mail/Folder';
  import type { EMail } from '../../../logic/Mail/EMail';
  import FolderMsgCount from './FolderMsgCount.svelte';
  import Button from '../../Shared/Button.svelte';
  import DisconnectedIcon from "lucide-svelte/icons/unplug";
  import ListViewIcon from "lucide-svelte/icons/table-properties";
  import ButtonMenu from '../../Shared/Menu/ButtonMenu.svelte';
  import MailListViewOptions from '../Vertical/MailListViewOptions.svelte';
  import Loader from '../../Shared/Loader.svelte';
  import { mailSearchInProgress, mailServerSearch } from '../Search/searchProgress';
  import AlertIcon from "lucide-svelte/icons/circle-alert";
  import { t } from '../../../l10n/l10n';
  import type { ArrayColl } from 'svelte-collections';

  export let folder: Folder;
  export let searchMessages: ArrayColl<EMail> | null; /** in */

  $: account = folder?.account;

  async function login() {
    await account.login(true);
  }
</script>

<style>
  .folder-name.searching {
    align-items: center;
    gap: 6px;
    color: var(--icon-primary, currentColor);
  }
  .folder-name.searching span {
    color: var(--main-fg, var(--fg));
  }
  .server-search {
    flex: 0 1 auto;
    min-width: 0;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .server-search > span:not(.server-search-failed) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .server-search-failed {
    display: inline-flex;
    color: var(--warning-fg);
  }
  .folder-header {
    align-items: center;
    min-height: 40px;
    padding-block: 8px;
    padding-inline: 14px;
    box-sizing: border-box;
    color: var(--main-fg);
    background-color: var(--main-bg);
    border-block-end: 1px solid var(--border);
  }
  .folder-header :global(button) {
    margin-inline-end: 8px;
  }
  .list-view-menu {
    flex: 0 0 auto;
    align-items: center;
  }
  .list-view-menu :global(.menu button.menuitem) {
    margin-inline-end: 0;
  }
  .folder-name {
    font-weight: 600;
    letter-spacing: -0.01em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
