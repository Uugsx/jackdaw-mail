<div class="mail-toolbar-container" bind:this={toolbarContainer}>
  <hbox class="mail-toolbar"
    class:toolbar-compact={ribbonSize == "compact"}
    class:toolbar-normal={ribbonSize == "normal"}
    class:toolbar-large={ribbonSize == "large"}
    class:toolbar-stacked={toolbarStacked}
    class:toolbar-narrow={toolbarNarrow}
    class:ribbon-start={ribbonPlacement == "start"}
    class:ribbon-center={ribbonPlacement == "center"}
    class:ribbon-end={ribbonPlacement == "end"}>
    <hbox class="toolbar-left-controls">
      {#if !$mailFolderPaneExpandedSetting.value}
        <button type="button" class="folder-pane-toggle"
          title={$t`Show folders`}
          aria-label={$t`Show folders`}
          aria-pressed="false"
          aria-controls="mail-folders-pane"
          on:click={toggleMailFolderPane}>
          <PanelLeftOpenIcon size="16px" />
        </button>
      {/if}
      <hbox class="search-wrap">
        <SearchField bind:searchTerm={$globalSearchTerm} variant="toolbar" />
        <button type="button" class="search-filters-btn"
          class:active={filtersOpen}
          title={$t`Search filters`}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          bind:this={filtersAnchor}
          on:click|stopPropagation={() => filtersOpen = !filtersOpen}>
          <SlidersIcon size="16px" />
        </button>
      </hbox>
      <CreateItemMenu account={selectedAccount} />
      <QuickFilterBar folder={selectedFolder} bind:searchMessages={filterSearchMessages} />
    </hbox>
    <hbox class="toolbar-command-area">
      <HorizontalScroll edgeButtons className="ribbon-scroll">
        <ClassicRibbon
          account={selectedAccount}
          folder={selectedFolder}
          message={selectedMessage}
          {selectedMessages}
          showNew={false} />
      </HorizontalScroll>
      <hbox class="toolbar-customize">
        <RibbonCustomizeMenu includeNew={false} />
      </hbox>
    </hbox>
  </hbox>
</div>

{#if filtersAnchor}
  <Popup bind:popupOpen={filtersOpen} popupAnchor={filtersAnchor}
    placement="bottom-start" boundaryElSel="body">
    <vbox class="search-filters-popup">
      <hbox class="search-filters-title font-small">{$t`Search filters`}</hbox>
      <SearchCriteria search={globalSearch} showSearchTerm={false}
        on:change={onAdvancedSearchCriteriaChanged} />
      <hbox class="search-filters-actions">
        <Button label={$t`Clear`} plain onClick={clearAdvancedSearch} />
        <hbox flex />
        <Button label={$t`Apply`} classes="primary" onClick={applyAdvancedSearch} />
      </hbox>
    </vbox>
  </Popup>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../logic/Mail/MailAccount";
  import type { Folder } from "../../logic/Mail/Folder";
  import type { EMail } from "../../logic/Mail/EMail";
  import { newSearchEMail } from "../../logic/Mail/Store/setStorage";
  import SearchField from "../Shared/SearchField.svelte";
  import CreateItemMenu from "./CreateItemMenu.svelte";
  import QuickFilterBar from "./LeftPane/QuickFilterBar.svelte";
  import ClassicRibbon from "./3pane/ClassicRibbon.svelte";
  import SearchCriteria from "./Search/SearchCriteria.svelte";
  import Popup from "../Shared/Popup.svelte";
  import Button from "../Shared/Button.svelte";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { selectedMessage as selectedMessageStore } from "./Selected";
  import { ArrayColl } from "svelte-collections";
  import { catchErrors, showError } from "../Util/error";
  import { t } from "../../l10n/l10n";
  import SlidersIcon from "lucide-svelte/icons/sliders-horizontal";
  import HorizontalScroll from "../Shared/HorizontalScroll.svelte";
  import debounce from "lodash/debounce";
  import RibbonCustomizeMenu from "./3pane/RibbonCustomizeMenu.svelte";
  import { ribbonPreferences } from "./3pane/ribbonPreferences";
  import { onDestroy, onMount } from "svelte";
  import { currentMailSearchAccount, syncSearchToCurrentMailbox } from "./Search/searchScope";
  import { mailFolderPaneExpandedSetting, toggleMailFolderPane } from "./mailFolderPaneState";
  import PanelLeftOpenIcon from "lucide-svelte/icons/panel-left-open";

  export let selectedAccount: MailAccount;
  export let selectedFolder: Folder;
  export let selectedMessage: EMail;
  export let selectedMessages: ArrayColl<EMail>;
  export let searchMessages: ArrayColl<EMail> | null;

  let filterSearchMessages: ArrayColl<EMail> | null = null;
  let globalSearchResults: ArrayColl<EMail> | null = null;
  let advancedSearchMessages: ArrayColl<EMail> | null = null;

  function newCurrentMailboxSearch() {
    let search = newSearchEMail();
    search.account = currentMailSearchAccount(selectedAccount, selectedFolder);
    return search;
  }

  let globalSearch = newCurrentMailboxSearch();
  let filtersOpen = false;
  let filtersAnchor: HTMLButtonElement;
  let usingAdvancedSearch = false;
  let searchGeneration = 0;
  const TOOLBAR_STACK_BREAKPOINT_PX = 900;
  const TOOLBAR_NARROW_BREAKPOINT_PX = 560;
  let toolbarContainer: HTMLDivElement;
  let toolbarStacked = false;
  let toolbarNarrow = false;
  let toolbarResizeObserver: ResizeObserver | null = null;
  $: ribbonSize = $ribbonPreferences.size;
  $: ribbonPlacement = $ribbonPreferences.placement;

  $: selectedAccount, selectedFolder, syncSearchScope();
  function syncSearchScope() {
    if (!syncSearchToCurrentMailbox(globalSearch, selectedAccount, selectedFolder)) {
      return;
    }
    searchGeneration++;
    if (usingAdvancedSearch) {
      // Не показываем результаты старого ящика, пока критерии пересчитываются
      // для нового.
      advancedSearchMessages = new ArrayColl<EMail>();
      $selectedMessageStore = null;
      refreshAdvancedSearchDebounced();
      return;
    }
    globalSearch = newCurrentMailboxSearch();
    if ($globalSearchTerm) {
      runGlobalSearchDebounced();
    }
  }

  onMount(() => {
    function updateToolbarLayout() {
      let width = toolbarContainer?.clientWidth ?? Number.POSITIVE_INFINITY;
      toolbarStacked = width <= TOOLBAR_STACK_BREAKPOINT_PX;
      toolbarNarrow = width <= TOOLBAR_NARROW_BREAKPOINT_PX;
    }

    updateToolbarLayout();
    toolbarResizeObserver = new ResizeObserver(updateToolbarLayout);
    toolbarResizeObserver.observe(toolbarContainer);
    return () => toolbarResizeObserver?.disconnect();
  });

  $: searchMessages = usingAdvancedSearch
    ? advancedSearchMessages
    : $globalSearchTerm
      ? globalSearchResults
      : filterSearchMessages;

  $: $globalSearchTerm, onGlobalSearchTermChanged();
  function onGlobalSearchTermChanged() {
    usingAdvancedSearch = false;
    searchGeneration++;
    if ($globalSearchTerm) {
      runGlobalSearchDebounced();
    } else {
      globalSearchResults = null;
    }
  }

  const runGlobalSearchDebounced = debounce(() => catchErrors(runGlobalSearch), 300);
  const refreshAdvancedSearchDebounced = debounce(() => catchErrors(refreshAdvancedSearch), 300);

  function onAdvancedSearchCriteriaChanged() {
    if (usingAdvancedSearch) {
      searchGeneration++;
      refreshAdvancedSearchDebounced();
    }
  }

  async function runGlobalSearch() {
    if (!$globalSearchTerm) {
      globalSearchResults = null;
      return;
    }
    let generation = ++searchGeneration;
    globalSearch = newCurrentMailboxSearch();
    globalSearch.bodyText = $globalSearchTerm;
    let activeSearch = globalSearch;
    try {
      let results = await activeSearch.startSearch(200);
      if (generation != searchGeneration || globalSearch !== activeSearch) {
        return;
      }
      globalSearchResults = results;
      $selectedMessageStore = globalSearchResults?.first ?? null;
    } catch (ex) {
      showError(ex);
    }
  }

  async function refreshAdvancedSearch() {
    if (!usingAdvancedSearch) {
      return;
    }
    try {
      let results = await executeAdvancedSearch();
      if (!usingAdvancedSearch || results === undefined) {
        return;
      }
      advancedSearchMessages = results;
      $selectedMessageStore = results.first ?? null;
    } catch (ex) {
      showError(ex);
    }
  }

  async function executeAdvancedSearch(): Promise<ArrayColl<EMail> | undefined> {
    let generation = ++searchGeneration;
    let activeSearch = globalSearch;
    let results = await activeSearch.startSearch(200);
    if (generation != searchGeneration || globalSearch !== activeSearch) {
      return undefined;
    }
    return results;
  }

  function clearAdvancedSearch() {
    searchGeneration++;
    refreshAdvancedSearchDebounced.cancel();
    globalSearch = newCurrentMailboxSearch();
    advancedSearchMessages = null;
    usingAdvancedSearch = false;
    filtersOpen = false;
  }

  async function applyAdvancedSearch() {
    refreshAdvancedSearchDebounced.cancel();
    try {
      let results = await executeAdvancedSearch();
      if (results === undefined) {
        return;
      }
      advancedSearchMessages = results;
      usingAdvancedSearch = true;
      $globalSearchTerm = globalSearch.bodyText ?? null;
      $selectedMessageStore = results.first ?? null;
      filtersOpen = false;
    } catch (ex) {
      showError(ex);
    }
  }

  onDestroy(() => {
    runGlobalSearchDebounced.cancel();
    refreshAdvancedSearchDebounced.cancel();
  });
</script>

<style>
  .mail-toolbar-container {
    width: 100%;
    min-width: 0;
    container-type: inline-size;
    container-name: mail-toolbar;
  }
  .mail-toolbar {
    width: 100%;
    align-items: center;
    gap: 8px;
    height: 56px;
    min-height: 56px;
    padding: 10px 16px 8px;
    box-sizing: border-box;
    background: var(--headerbar-bg);
    border-block-end: 1px solid var(--glass-border-subtle);
    box-shadow: var(--glass-highlight);
    min-width: 0;
    overflow: hidden;
  }
  .toolbar-left-controls {
    align-items: center;
    flex: 0 1 auto;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }
  .folder-pane-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid var(--toolbar-control-border);
    border-radius: var(--border-radius);
    background: var(--toolbar-control-bg);
    color: var(--toolbar-control-fg);
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease,
      transform 0.18s cubic-bezier(0.34, 1.35, 0.64, 1);
  }
  .folder-pane-toggle:hover {
    background: var(--hover-bg);
    border-color: var(--border);
    color: var(--hover-fg);
  }
  .folder-pane-toggle:active {
    transform: scale(0.96);
  }
  .folder-pane-toggle:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: reduce) {
    .folder-pane-toggle {
      transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
    }
    .folder-pane-toggle:active {
      transform: none;
    }
  }
  .toolbar-command-area {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    align-items: center;
    gap: 4px;
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 1 220px;
    min-width: 140px;
  }
  .search-wrap :global(.search) {
    width: 100%;
    height: 34px;
    box-sizing: border-box;
  }
  .search-wrap :global(input[type="search"]) {
    font-size: 13px;
    box-sizing: border-box;
  }
  .search-filters-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    border: 1px solid var(--toolbar-control-border);
    border-radius: var(--border-radius);
    background: var(--toolbar-control-bg);
    color: var(--toolbar-control-fg);
    cursor: default;
  }
  .search-filters-btn:hover,
  .search-filters-btn.active {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .search-filters-popup {
    min-width: 18em;
    max-width: 24em;
    padding: 12px 14px;
    gap: 10px;
    background: var(--main-bg);
    color: var(--main-fg);
  }
  .search-filters-title {
    font-weight: 600;
  }
  .search-filters-actions {
    align-items: center;
    gap: 8px;
    margin-block-start: 4px;
  }
  .mail-toolbar :global(.create),
  .mail-toolbar :global(.mail-create-item-menu .menu-button) {
    flex: 0 0 34px;
    width: 34px;
    height: 34px;
    padding: 7px;
    box-sizing: border-box;
    border-radius: var(--border-radius);
    background-color: var(--toolbar-control-bg);
    color: var(--toolbar-control-fg);
    border: 1px solid var(--toolbar-control-border);
  }
  .mail-toolbar :global(.create.filled:not(:hover):not(.disabled)),
  .mail-toolbar :global(.mail-create-item-menu .menu-button:not(:hover)) {
    background-color: var(--toolbar-control-bg);
    color: var(--toolbar-control-fg);
    border: 1px solid var(--toolbar-control-border);
    padding: 7px;
  }
  .mail-toolbar :global(.create:hover:not(.disabled)),
  .mail-toolbar :global(.mail-create-item-menu .menu-button:hover:not(:disabled)) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .mail-toolbar :global(.quick-filters-scroll) {
    flex: 0 1 auto;
    width: max-content;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }
  .mail-toolbar :global(.quick-filters) {
    flex: 0 0 auto;
    min-width: 0;
    min-height: 34px;
    padding: 0;
    gap: 6px;
    border: none;
    background-color: transparent;
    flex-wrap: nowrap;
  }
  .mail-toolbar :global(.quick-filters .pill) {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 5px 10px;
    border-color: var(--toolbar-control-border);
    background-color: var(--toolbar-control-bg);
    font-size: 11px;
  }
  .mail-toolbar :global(.quick-filters .pill.sort),
  .mail-toolbar :global(.quick-filters .pill.add) {
    flex: 0 0 34px;
    width: 34px;
    min-width: 34px;
    height: 34px;
    min-height: 34px;
    padding: 0;
  }
  .mail-toolbar :global(.quick-filters .pill.active) {
    background-color: var(--selected-bg);
    border-color: transparent;
    color: var(--selected-fg);
  }
  .mail-toolbar :global(.ribbon-scroll) {
    /* The command area owns all remaining toolbar space, like an Outlook ribbon. */
    flex: 1 1 0;
    width: auto;
    min-width: 0;
    max-width: 100%;
    margin: 0;
    overflow: hidden;
    grid-column: 1;
  }
  .mail-toolbar.ribbon-start :global(.ribbon-scroll .h-scroll-content),
  .mail-toolbar.ribbon-center :global(.ribbon-scroll:not(.overflowing) .h-scroll-content),
  .mail-toolbar.ribbon-end :global(.ribbon-scroll:not(.overflowing) .h-scroll-content) {
    justify-content: flex-start;
  }
  .mail-toolbar.ribbon-center :global(.ribbon-scroll:not(.overflowing) .h-scroll-content) {
    justify-content: center;
  }
  .mail-toolbar.ribbon-end :global(.ribbon-scroll:not(.overflowing) .h-scroll-content) {
    justify-content: flex-end;
  }
  .mail-toolbar :global(.mail-create-item-menu .menu.button) {
    flex: 0 0 34px;
    width: 34px;
    min-width: 34px;
    max-width: 34px;
    height: 34px;
    box-sizing: border-box;
    padding: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
    align-items: center;
    justify-content: center;
  }
  .toolbar-customize {
    position: relative;
    z-index: 1;
    align-items: center;
    grid-column: 2;
    width: 34px;
    min-width: 34px;
    box-sizing: border-box;
    justify-content: center;
    background: transparent;
  }
  .toolbar-customize :global(.menu.button) {
    flex: 0 0 34px;
    width: 34px;
    min-width: 34px;
    max-width: 34px;
    box-sizing: border-box;
    padding: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
  }
  .toolbar-customize :global(.menu-button) {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    padding: 5px;
    border-radius: 8px;
    color: var(--main-fg);
    background: transparent;
    border: 0;
    box-shadow: none;
  }
  .toolbar-customize :global(.menu-button:hover:not(.disabled)) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .mail-toolbar :global(.classic-ribbon) {
    flex: 0 0 auto;
  }
  .mail-toolbar.toolbar-compact .search-filters-btn,
  .mail-toolbar.toolbar-compact .folder-pane-toggle,
  .mail-toolbar.toolbar-compact :global(.create),
  .mail-toolbar.toolbar-compact :global(.mail-create-item-menu .menu-button),
  .mail-toolbar.toolbar-compact :global(.quick-filters .pill) {
    min-height: 28px;
    width: 28px;
    height: 28px;
    padding: 5px;
  }
  .mail-toolbar.toolbar-compact .search-wrap :global(.search) {
    height: 28px;
  }
  .mail-toolbar.toolbar-compact :global(.quick-filters .pill.sort),
  .mail-toolbar.toolbar-compact :global(.quick-filters .pill.add) {
    flex-basis: 28px;
    width: 28px;
    min-width: 28px;
    height: 28px;
    min-height: 28px;
    padding: 0;
  }
  .mail-toolbar.toolbar-compact :global(.mail-create-item-menu .menu.button) {
    flex-basis: 28px;
    width: 28px;
    min-width: 28px;
    max-width: 28px;
    height: 28px;
    padding: 0;
  }
  .mail-toolbar.toolbar-large .search-filters-btn,
  .mail-toolbar.toolbar-large .folder-pane-toggle,
  .mail-toolbar.toolbar-large :global(.create),
  .mail-toolbar.toolbar-large :global(.mail-create-item-menu .menu-button),
  .mail-toolbar.toolbar-large :global(.quick-filters .pill) {
    min-height: 44px;
    height: 44px;
    padding: 8px;
  }
  .mail-toolbar.toolbar-large .search-wrap :global(.search) {
    height: 44px;
  }
  .mail-toolbar.toolbar-large :global(.mail-create-item-menu .menu.button) {
    flex-basis: 44px;
    width: 44px;
    min-width: 44px;
    max-width: 44px;
    height: 44px;
    padding: 0;
  }
  .mail-toolbar.toolbar-large .search-filters-btn,
  .mail-toolbar.toolbar-large .folder-pane-toggle,
  .mail-toolbar.toolbar-large :global(.create),
  .mail-toolbar.toolbar-large :global(.mail-create-item-menu .menu-button) {
    width: 44px;
  }
  .mail-toolbar.toolbar-large:not(.toolbar-stacked) {
    height: 74px;
    min-height: 74px;
  }
  .mail-toolbar.toolbar-large :global(.quick-filters .pill) {
    width: auto;
    padding-inline: 12px;
  }
  .mail-toolbar.toolbar-large :global(.quick-filters .pill.sort),
  .mail-toolbar.toolbar-large :global(.quick-filters .pill.add) {
    flex: 0 0 44px;
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
  }

  .mail-toolbar.toolbar-stacked {
    height: auto;
    flex-wrap: wrap;
    align-content: flex-start;
    row-gap: 4px;
    padding-block: 6px;
  }
  .mail-toolbar.toolbar-stacked .toolbar-left-controls {
    flex: 1 1 100%;
    max-width: 100%;
  }
  .mail-toolbar.toolbar-stacked .toolbar-command-area {
    flex: 1 1 100%;
    order: 3;
    min-height: 34px;
  }
  .mail-toolbar.toolbar-stacked .toolbar-customize {
    order: 2;
  }

  .mail-toolbar.toolbar-narrow {
    gap: 4px;
    padding-inline: 8px;
  }
  .mail-toolbar.toolbar-narrow .search-wrap {
    flex-basis: 160px;
    min-width: 120px;
  }
  .mail-toolbar.toolbar-narrow :global(.quick-filters-scroll) {
    flex: 1 1 80px;
    width: auto;
  }

  /* Keep a CSS fallback for non-Electron builds while ResizeObserver updates the class. */
  @container mail-toolbar (max-width: 900px) {
    .mail-toolbar {
      flex-wrap: wrap;
      align-content: flex-start;
      row-gap: 4px;
      padding-block: 6px;
    }
    .toolbar-left-controls {
      flex: 1 1 100%;
      max-width: 100%;
    }
    .toolbar-command-area {
      flex: 1 1 100%;
      order: 3;
      min-height: 34px;
    }
    .toolbar-customize {
      order: 2;
    }
  }

  @container mail-toolbar (max-width: 560px) {
    .mail-toolbar {
      gap: 4px;
      padding-inline: 8px;
    }
    .search-wrap {
      flex-basis: 160px;
      min-width: 120px;
    }
    .mail-toolbar :global(.quick-filters-scroll) {
      flex: 1 1 80px;
      width: auto;
    }
  }
</style>
