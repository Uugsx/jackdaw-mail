<button type="button" class="settings-category" class:selected
  aria-current={selected ? "page" : undefined}
  aria-expanded={isSectionOpen}
  on:click={onSelect}
  title={category.name}>
  <span class="label font-small" class:main={category.isMain}>
    {category.name}
  </span>
</button>
{#if isSectionOpen}
  <SubCategoriesList subCategories={category.subCategories} mainCategory={category} />
  <AccountsList {category} />
{/if}

<script lang="ts">
  import type { SettingsCategory } from "../SettingsCategory";
  import { selectedCategory, selectedAccount } from "./selected";
  import { openSettingsCategory } from "./CategoriesUtils";
  import SubCategoriesList from "./SubCategoriesList.svelte";
  import AccountsList from "./AccountsList.svelte";
  import { appGlobal } from "../../../logic/app";

  /** in */
  export let category: SettingsCategory;

  $: selected = category == $selectedCategory;
  $: isSectionOpen = selected || category.subCategories.contains($selectedCategory) || category.accounts.contains($selectedAccount);

  function onSelect() {
    if (appGlobal.isMobile && (category.subCategories.hasItems || category.accounts.hasItems)) {
      isSectionOpen = !isSectionOpen;
    } else {
      openSettingsCategory(category);
    }
  }
</script>

<style>
  .settings-category {
    display: flex;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    align-items: start;
    padding: 0px 0px 2px 18px;
    cursor: pointer;
  }
  .settings-category:focus-visible {
    outline: 2px solid var(--selected-bg);
    outline-offset: -2px;
  }
  .settings-category:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .selected {
    background-color: var(--selected-bg);
    color:  var(--selected-fg);
  }
  .label {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-block-start: 4px;
    margin-inline-start: 4px;
    margin-inline-end: 4px;
  }
</style>
