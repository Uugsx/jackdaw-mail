<!-- Appears below the msg list -->
 {#if folder}
  <hbox class="folder-header font-smallest">
    {#if showGetMail && $account?.isLoggedIn}
      <GetMailButton {folder} />
    {/if}
    {#if !isShowSearchField}
      <hbox class="show-search button">
      <RoundButton
          icon={SearchIcon}
          iconSize={$appGlobal.isMobile ? "24px" : "16px"}
          label={$t`Search only the currently displayed folder for a keyword`}
          onClick={toggleShowSearchField}
          border={false}
          />
      </hbox>
    {/if}
    {#if isShowSearchField}
      <SearchField bind:searchTerm={quickSearch.bodyText}
        on:clear={toggleShowSearchField}
        placeholder={$t`Search only this folder`}
        showX={true}
        autofocus={true} />
      <hbox class="result-msg-count">
        {#if searchMessages}
          {$searchMessages.length}
        {/if}
      </hbox>
    {:else if !appGlobal.isMobile}
      <Clickable onClick={toggleShowSearchField}>
        <hbox flex class="no-search" />
      </Clickable>
      <FolderMsgCount {folder} {searchMessages} />
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from '../../../logic/Mail/Folder';
  import type { EMail } from '../../../logic/Mail/EMail';
  import { quickSearch } from '../Selected';
  import { appGlobal } from '../../../logic/app';
  import FolderMsgCount from './FolderMsgCount.svelte';
  import SearchField from '../../Shared/SearchField.svelte';
  import GetMailButton from './GetMailButton.svelte';
  import RoundButton from '../../Shared/RoundButton.svelte';
  import Clickable from "../../Shared/Clickable.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import { catchErrors, showError } from '../../Util/error';
  import type { ArrayColl } from 'svelte-collections';
  import { t } from '../../../l10n/l10n';

  export let folder: Folder;
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let showGetMail = true;

  $: account = folder?.account;

  let isShowSearchField = !!quickSearch.bodyText;
  function toggleShowSearchField() {
    isShowSearchField = !isShowSearchField;
    if (!isShowSearchField) {
      quickSearch.bodyText = null;
    }
  }

  $: quickSearch.folder = folder;
  $: if (folder && $quickSearch) {
    // Нулевой countNewArrived не должен блокировать локальный поиск папки.
    $folder.countUnread;
    $folder.countTotal;
    $folder.countNewArrived;
    catchErrors(startSearch, showError);
  }

  /** Filters the folder.messages array */
  async function startSearch() {
    searchMessages = await quickSearch.startSearch();
  }
</script>

<style>
  .folder-header {
    align-items: center;
    justify-content: center;
    max-height: 32px;
    padding-block-start: 2px;
    padding-block-end: 2px;
    padding-inline-start: 4px;
    padding-inline-end: 4px;
    overflow: hidden;
  }
  :global(.mobile) .folder-header {
    height: 32px;
    max-height: 32px;
    font-size: 16px;
  }
  .folder-header :global(button) {
    background-color: unset;
    color: unset;
    margin-inline-start: -2px;
  }
  .folder-header :global(button:hover) {
    z-index: 1;
  }
  .folder-header :global(.get-mail button) {
    height: 20px;
    width: 20px;
    border: none;
    margin-inline-end: 8px;
  }
  :global(.mobile) .folder-header :global(.get-mail button) {
    height: 32px;
    width: 32px;
  }
  .folder-header :global(.search) {
    flex: 1 0 0;
    height: 100%;
    margin-inline-start: 8px;
    margin-inline-end: 8px;
  }
  .folder-header :global(input[type="search"]) {
    font-size: 15px;
  }
  :global(.mobile) .folder-header :global(.search),
  :global(.mobile) .folder-header :global(input[type="search"]) {
    height: 32px;
  }
  .result-msg-count {
    align-items: center;
    justify-content: end;
    padding-inline-start: 4px;
    padding-inline-end: 8px;
    opacity: 70%;
    min-width: 1.5em;
  }
  .no-search {
    height: 100%;
  }
</style>
