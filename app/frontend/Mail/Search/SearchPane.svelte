<vbox flex class="search">
  <hbox class="header-bar">
    <hbox class="header top font-small">{$t`Advanced search`}</hbox>
    <hbox flex />
    <hbox class="buttons top-right">
      <RoundButton label={$t`Clear search`} icon={XIcon} iconSize="16px" padding="4px" border={false} classes="plain small"
        onClick={onClear} />
    </hbox>
  </hbox>

  <Scroll>
    <hbox class="term font-normal">
      <SearchField bind:searchTerm={$globalSearchTerm}
        placeholder={$t`Mail content or subject`}
        bind:this={searchFieldEl} />
    </hbox>
    <hbox class="search-criteria">
      <SearchCriteria {search} showSearchTerm={false} {searchMessages} />
    </hbox>
  </Scroll>

  <hbox class="results-count font-smallest">
    {#if searchMessages?.length > kLimit}
      {$t`More than ${kLimit} mails`}
    {:else if searchMessages}
      {$t`${searchMessages?.length} mails`}
    {/if}
  </hbox>
  {#if !expandedCreateRule}
    <ExpandSection headerBox={false} bind:expanded={expandedSavedSearch}>
      <hbox class="header font-small" slot="header">
        {$t`Save search as folder`}
      </hbox>
      <SavedSearchUI {search} on:close={onClear} />
    </ExpandSection>
  {/if}
  {#if !expandedSavedSearch}
    <ExpandSection headerBox={false} bind:expanded={expandedCreateRule}>
      <hbox class="header font-small" slot="header">
        {$t`Create rule`}
      </hbox>
      <RulesFromSearchUI {search} on:close={onClear} />
    </ExpandSection>
  {/if}
</vbox>

<script lang="ts">
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import { selectedAccount, selectedFolder, selectedMessage } from "../Selected";
  import { currentMailSearchAccount, syncSearchToCurrentMailbox } from "./searchScope";
  import type { EMail } from "../../../logic/Mail/EMail";
  import SearchCriteria from "./SearchCriteria.svelte";
  import SavedSearchUI from "./SavedSearchUI.svelte";
  import RulesFromSearchUI from "./RulesFromSearchUI.svelte";
  import SearchField from "../../Shared/SearchField.svelte";
  import ExpandSection from "../../Shared/ExpandSection.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import { showError } from "../../Util/error";
  import { ArrayColl } from "svelte-collections";
  import debounce from "lodash/debounce";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ clear: void }>();

  /** The search result
   * in/out */
  export let searchMessages: ArrayColl<EMail> | null = null;

  let isOpen = true;
  const kLimit = 200;

  function newCurrentMailboxSearch() {
    let search = newSearchEMail();
    search.account = currentMailSearchAccount($selectedAccount, $selectedFolder);
    return search;
  }

  let search = newCurrentMailboxSearch();
  let tags = search.tags;
  let attachmentTypes = search.hasAttachmentMIMETypes;
  let searchGeneration = 0;

  $: $selectedAccount, $selectedFolder, syncSearchScope();
  function syncSearchScope() {
    if (syncSearchToCurrentMailbox(search, $selectedAccount, $selectedFolder)) {
      searchGeneration++;
      // Не показываем результаты предыдущего ящика, пока новый запрос
      // пересчитывается.
      searchMessages = new ArrayColl<EMail>();
      $selectedMessage = null;
    }
  }

  $: search.bodyText = $globalSearchTerm;
  $: isOpen && $globalSearchTerm, $search, $tags, $attachmentTypes, startSearchDebounced();
  const startSearchDebounced = debounce(() => startSearch(), 300);
  async function startSearch() {
    let generation = ++searchGeneration;
    let activeSearch = search;
    try {
      $selectedMessage = null;
      if (activeSearch.bodyText == null) { // <==> $globalSearchTerm == null
        searchMessages = null;
        return;
      }
      searchMessages = new ArrayColl<EMail>();

      let result = await activeSearch.startSearch(kLimit + 1);
      if (!isOpen || generation != searchGeneration || activeSearch !== search) {
        return;
      }
      searchMessages = result;
      // Не открываем первый результат сами: он бы помечался прочитанным
      $selectedMessage = null;
    } catch (ex) {
      showError(ex);
    }
  }

  function onClear() {
    isOpen = false;
    $globalSearchTerm = null;
    searchMessages = null;
    dispatchEvent("clear");
  }

  // window title | search field | (x) button
  $: if ($globalSearchTerm == null) dispatchEvent("clear");

  let searchFieldEl: SearchField;
  onMount(() => {
    if (!$globalSearchTerm) {
      searchFieldEl.focus();
    }
  });

  let expandedSavedSearch = false;
  let expandedCreateRule = false;
</script>

<style>
  .search {
    margin: 0;
    padding: 0 8px 12px;
    color: var(--leftbar-fg);
    background-color: transparent;
  }
  .header-bar {
    align-items: center;
    min-height: 36px;
    padding: 4px 4px 0;
  }
  .header.top {
    font-weight: 600;
  }
  .header {
    font-weight: 500;
  }
  .buttons.top-right {
    align-items: start;
  }
  .term {
    margin: 8px 0;
    align-items: center;
  }
  .term :global(.search) {
    margin: 0;
    width: 100%;
    border-color: var(--border);
    background-color: var(--input-bg);
    color: var(--input-fg);
  }
  .term :global(input) {
    font-size: 14px;
  }
  .search-criteria {
    margin: 4px 0 8px;
  }
  .search-criteria :global(.listbox) {
    min-height: 120px;
  }
  .results-count {
    margin: 8px 4px;
    justify-content: end;
    opacity: 0.75;
  }
</style>
