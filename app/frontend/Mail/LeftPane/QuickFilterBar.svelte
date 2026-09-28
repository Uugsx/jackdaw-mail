<!-- Меню сортировки и фильтров над списком писем в стиле Outlook -->
{#if folder}
  <hbox class="quick-filters font-smallest">
    <button type="button"
      class="pill sort sort-menu-trigger"
      class:active={true}
      aria-haspopup="menu"
      aria-expanded={sortMenuOpen}
      title={sortTooltip}
      aria-label={sortTooltip}
      bind:this={sortAnchor}
      on:click|stopPropagation={onSortClick}>
      <ChevronDownIcon size="14px" strokeWidth={2.25} aria-hidden="true" />
    </button>

    <button type="button"
      class="pill filter-menu-trigger"
      class:active={anyActive}
      aria-haspopup="menu"
      aria-expanded={filterMenuOpen}
      aria-pressed={anyActive}
      title={filterTooltip}
      aria-label={filterTooltip}
      bind:this={filterAnchor}
      on:click|stopPropagation={onFilterClick}>
      <ListFilterIcon size="16px" strokeWidth={1.9} aria-hidden="true" />
      {#if anyActive}
        <span class="active-count" aria-hidden="true">{activeFilterCount}</span>
      {/if}
    </button>

    {#if anyActive}
      <button type="button" class="pill clear" title={$t`Clear filters`}
        on:click={() => catchErrors(clearFilters)}>
        {$t`Clear`}
      </button>
    {/if}

    <!-- Оба меню монтируются заранее, чтобы открытие не конфликтовало с autoClose. -->
    <Menu bind:isMenuOpen={sortMenuOpen} anchor={sortAnchor} placement="bottom-start">
      {#each sortDefs as sort (sort.id)}
        <MenuItem
          label={sort.label()}
          selected={$mailListSort == sort.sort}
          onClick={() => selectSort(sort.sort)} />
      {/each}
    </Menu>

    <Menu bind:isMenuOpen={filterMenuOpen} anchor={filterAnchor} placement="bottom-start">
      {#each filterDefs as filter (filter.id)}
        <MenuItem
          label={filter.label()}
          selected={isActive(filter.id, $quickSearch)}
          closeOnClick={false}
          onClick={() => catchErrors(() => toggleFilter(filter.id))} />
      {/each}
      <MenuDivider />
      <MenuItem
        label={$t`Reset filters`}
        disabled={!anyActive}
        onClick={() => catchErrors(clearFilters)} />
    </Menu>
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { quickSearch } from "../Selected";
  import {
    type QuickFilterId,
    type MailListSort,
    activateMailListSort,
    allQuickFilters,
    mailListSort,
    setMailListSort,
  } from "./quickFilters";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import { catchErrors } from "../../Util/error";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ListFilterIcon from "lucide-svelte/icons/list-filter";
  import { hideTooltips } from "../../Shared/tooltip";

  export let folder: Folder;
  export let searchMessages: ArrayColl<EMail> | null; /** out */

  let sortMenuOpen = false;
  let sortAnchor: HTMLElement;
  let filterMenuOpen = false;
  let filterAnchor: HTMLElement;

  $: filterDefs = allQuickFilters.filter(f => f.kind == "filter");
  $: sortDefs = allQuickFilters.filter(f => f.kind == "sort");
  $: activateMailListSort(folder);
  $: currentSortDef = sortDefs.find(s => s.sort === $mailListSort) ?? sortDefs[0];
  $: currentSortLabel = currentSortDef?.label() ?? $t`Newest`;
  $: sortTooltip = `${$t`Sort messages`}: ${currentSortLabel}`;
  $: activeFilterCount = [
    $quickSearch.isRead === false,
    $quickSearch.isStarred === true,
    $quickSearch.isImportant === true,
    $quickSearch.hasAttachment === true,
    $quickSearch.isOutgoing === true || $quickSearch.isOutgoing === false,
    $quickSearch.isReplied === true,
  ].filter(Boolean).length;
  $: anyActive = activeFilterCount > 0;
  $: filterTooltip = anyActive
    ? `${$t`Search filters`}: ${activeFilterCount}`
    : $t`Search filters`;

  $: localMsgCount = folder?.messages ? $folder.messages.length : 0;
  $: quickSearch.folder = folder;
  $: folder && ($folder.countUnread, $folder.countTotal, $folder.countNewArrived, localMsgCount) &&
    $quickSearch && catchErrors(runSearch);

  function isActive(id: QuickFilterId, search = quickSearch): boolean {
    switch (id) {
      case "unread": return search.isRead === false;
      case "starred": return search.isStarred === true;
      case "important": return search.isImportant === true;
      case "attachments": return search.hasAttachment === true;
      case "fromMe": return search.isOutgoing === true;
      case "toMe": return search.isOutgoing === false;
      case "replied": return search.isReplied === true;
    }
  }

  function toggleFilter(id: QuickFilterId) {
    switch (id) {
      case "unread":
        quickSearch.isRead = quickSearch.isRead === false ? null : false;
        break;
      case "starred":
        quickSearch.isStarred = quickSearch.isStarred ? null : true;
        break;
      case "important":
        quickSearch.isImportant = quickSearch.isImportant ? null : true;
        break;
      case "attachments":
        quickSearch.hasAttachment = quickSearch.hasAttachment ? null : true;
        break;
      case "fromMe":
        quickSearch.isOutgoing = quickSearch.isOutgoing === true ? null : true;
        break;
      case "toMe":
        quickSearch.isOutgoing = quickSearch.isOutgoing === false ? null : false;
        break;
      case "replied":
        quickSearch.isReplied = quickSearch.isReplied ? null : true;
        break;
    }
    hideTooltips();
  }

  function onSortClick(event: MouseEvent) {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    sortAnchor = event.currentTarget;
    hideTooltips();
    filterMenuOpen = false;
    setTimeout(() => {
      sortMenuOpen = !sortMenuOpen;
    }, 0);
  }

  function onFilterClick(event: MouseEvent) {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    filterAnchor = event.currentTarget;
    hideTooltips();
    sortMenuOpen = false;
    setTimeout(() => {
      filterMenuOpen = !filterMenuOpen;
    }, 0);
  }

  function selectSort(sort: MailListSort) {
    setMailListSort(folder, sort);
    hideTooltips();
    sortMenuOpen = false;
  }

  function clearFilters() {
    quickSearch.isRead = null;
    quickSearch.isStarred = null;
    quickSearch.isImportant = null;
    quickSearch.hasAttachment = null;
    quickSearch.isOutgoing = null;
    quickSearch.isReplied = null;
    filterMenuOpen = false;
    hideTooltips();
  }

  async function runSearch() {
    searchMessages = await quickSearch.startSearch();
  }

</script>

<style>
  .quick-filters {
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
    flex-wrap: nowrap;
    min-height: 36px;
    box-sizing: border-box;
    background-color: transparent;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    background-color: transparent;
    color: var(--main-fg);
    border-radius: var(--border-radius);
    padding: 3px 10px;
    font: inherit;
    font-size: 11px;
    letter-spacing: -0.01em;
    cursor: pointer;
    line-height: 1.2;
    flex-shrink: 0;
    transition:
      background-color 0.16s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.16s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.16s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .pill:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .pill.active {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
    border-color: transparent;
  }
  .pill.sort:not(.active) {
    border-style: dashed;
  }
  .pill.sort,
  .pill.filter-menu-trigger {
    width: 34px;
    min-width: 34px;
    height: 34px;
    min-height: 34px;
    padding: 0;
    justify-content: center;
    box-sizing: border-box;
  }
  .sort-menu-trigger,
  .filter-menu-trigger {
    cursor: pointer;
  }
  .sort-menu-trigger :global(svg) {
    flex-shrink: 0;
    display: block;
  }
  .active-count {
    min-width: 1.15em;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pill.clear {
    border-style: dashed;
    opacity: 0.75;
  }
  .pill:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }
  .pill:active {
    transform: translateY(1px) scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .pill {
      transition: none;
    }
    .pill:active {
      transform: none;
    }
  }
</style>
