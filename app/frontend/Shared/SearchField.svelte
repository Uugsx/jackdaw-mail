<hbox class="search" class:has-search={searchInput} class:toolbar={variant == "toolbar"}>
  {#if busy}
    <hbox class="busy" title={$t`Searching…`}><Loader size={14} stroke={2} /></hbox>
  {:else}
    <SearchIcon size="16px" />
  {/if}
  <input type="search"
    aria-busy={busy}
    bind:value={searchInput}
    on:input={onInput}
    on:keydown={onKeyPress}
    placeholder={placeholder ?? $t`Search`}
    class="font-normal"
    bind:this={inputEl}
    {autofocus}
    spellcheck={false} />
  {#if showX || searchInput && showX === null }
    <RoundButton label={$t`Clear search`} icon={XIcon} iconSize="16px" padding="2px" border={false}
      onClick={onClear} />
  {/if}
</hbox>

<script lang="ts">
  import RoundButton from "./RoundButton.svelte";
  import Loader from "./Loader.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import XIcon from "lucide-svelte/icons/x";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../l10n/l10n";
  const dispatchEvent = createEventDispatcher<{ input: string, clear: void }>();

  /** out only */
  export let searchTerm: string;
  /** Text to show in the empty search field.
   * Default "Search" */
  export let placeholder: string = null;
  export let autofocus: boolean = false;
  export let showX: boolean | null = null; /** null = only when text entered */
  /** toolbar: matches mail toolbar controls; default: generic field style */
  export let variant: "default" | "toolbar" = "default";
  /** Идёт поиск: вместо лупы крутится индикатор */
  export let busy = false;

  let searchInput: string;
  $: searchInput = searchTerm;
  function onInput() {
    let searchInputLower = searchInput?.toLowerCase();
    if (searchTerm == searchInputLower) {
      return;
    }
    searchTerm = searchInputLower;
    dispatchEvent("input", searchTerm);
  }
  function onClear() {
    searchTerm = null;
    dispatchEvent("clear");
  }

  $: autofocus && inputEl && focus();
  let inputEl: HTMLInputElement;
  export function focus() {
    inputEl.focus();
  }

  function onKeyPress(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClear();
    }
  }
</script>

<style>
  .busy {
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    color: var(--icon-primary, currentColor);
  }
  .search {
    align-items: center;
    border: 1px solid var(--border);
    padding-inline-start: 8px;
    padding-inline-end: 4px;
    border-radius: var(--border-radius);
    background-color: var(--input-bg, field);
    color: var(--input-fg, fieldtext);
  }
  .search.toolbar {
    border-color: var(--toolbar-control-border, var(--border));
    background-color: var(--toolbar-control-bg, var(--input-bg));
    color: var(--toolbar-control-fg, var(--input-fg));
  }
  .search:has(input:focus) {
    border-color: var(--input-focus);
  }
  .search.has-search {
    background-color: var(--input-bg, field);
    color: var(--input-fg, fieldtext);
  }
  .search.toolbar.has-search {
    background-color: var(--toolbar-control-bg, var(--input-bg));
    color: var(--toolbar-control-fg, var(--input-fg));
  }
  .search :global(svg) {
    color: #808080;
  }
  .search.toolbar:not(.has-search)::after {
    content: "⌘ K";
    flex-shrink: 0;
    margin-inline: 4px 6px;
    color: var(--input-placeholder);
    font-size: 10px;
    letter-spacing: 0.02em;
    pointer-events: none;
    font-feature-settings: "tnum";
  }
  .search.toolbar input[type="search"] {
    padding-inline-end: 4px;
  }
  input[type="search"] {
    width: 100%;
    height: 24px;
    padding: 1px 2px;
    border: none;
    box-shadow: none;
    margin-inline-start: 4px;
    border-radius: var(--border-radius);
    background-color: inherit;
    color: inherit;
  }
  :global(.mobile) input[type="search"] {
    height: 40px;
  }
  input::placeholder {
    color: #808080;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }

  .search :global(.button) {
    background-color: transparent;
  }
</style>
