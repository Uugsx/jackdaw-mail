<vbox flex class="persons" class:mobile={appGlobal.isMobile}>
  {#if showSearch}
    <SearchField bind:searchTerm
      placeholder={$t`Search directory or contacts`}
      autofocus={doSearch} />
    <slot name="below-search" {searchTerm} />
    {#if searchTerm && $sortedPersons?.isEmpty && directoryHint}
      <hbox class="gal-hint">{$t`Type a name to search the company directory.`}</hbox>
    {/if}
  {/if}
  <FastList
    items={sortedPersons}
    bind:selectedItem={selected}
    bind:selectedItems={selectedPersons}
    on:init={ev => ev.detail.scrollToItem(selected)}
    on:selected
    columns="auto">
    <vbox class="person" slot="row" let:item={person}>
      {#if $$slots["picture-badge"]}
        <PersonLine {person} isSelected={person == selected} {pictureSize} {picturePlaceholder} on:click>
          <slot name="picture-badge" slot="picture-badge" {person} />
          <slot name="top-right" slot="top-right" {person} />
          <slot name="second-row" slot="second-row" {person} />
        </PersonLine>
      {:else}
        <PersonLine {person} isSelected={person == selected} {pictureSize} {picturePlaceholder} on:click>
          <slot name="top-right" slot="top-right" {person} />
          <slot name="second-row" slot="second-row" {person} />
        </PersonLine>
      {/if}
    </vbox>
  </FastList>
</vbox>

<script lang="ts">
  import { Person } from "../../../logic/Abstract/Person";
  import type { PersonOrGroup } from "./PersonOrGroup";
  import { selectedPerson } from "./Selected";
  import { appGlobal } from "../../../logic/app";
  import { ArrayColl, type Collection } from "svelte-collections";
  import PersonLine from "./PersonLine.svelte";
  import SearchField from "../../Shared/SearchField.svelte";
  import FastList from "../../Shared/FastList.svelte";
  import { t } from "../../../l10n/l10n";
  import { mergeColls } from "svelte-collections";

  export let persons: Collection<PersonOrGroup>;
  export let selected: PersonOrGroup = $selectedPerson;
  export let selectedPersons: ArrayColl<PersonOrGroup>;
  export let pictureSize = appGlobal.isMobile ? 32 : 20;
  /** Что показать вместо фото — in */
  export let picturePlaceholder: "none" | "empty" | "icon" | "slot" | "initials" = "none";
  /** Подсказка «Введите имя для поиска в каталоге», когда ничего не нашлось — in */
  export let directoryHint = true;
  /** in/out */
  export let searchTerm: string | null = null;
  /* Show or entirely remove the search field -- in */
  export let showSearch = true;
  /** focus the search field when this component loads -- in */
  export let doSearch = false;
  export let sortBy = (person: PersonOrGroup) => person.name.toLowerCase();
  /** Своя выдача поиска — in. null: поиск по адресным книгам (как в «Контактах»). */
  export let search: ((term: string) => Collection<PersonOrGroup>) | null = null;

  let searchAddressbooks = appGlobal.addressbooks.merge(appGlobal.searchOnlyAddressbooks);
  $: filteredPersons = searchTerm
    ? (search ? search(searchTerm) : mergeColls(searchAddressbooks.map(ab => ab.quickSearch(searchTerm, true))))
    : persons;
  $: sortedPersons = filteredPersons.sortBy(sortBy);

  $: searchTerm && adaptSelected();
  function adaptSelected() {
    if (!sortedPersons.contains(selected)) {
      selected = sortedPersons.first;
    }
  }

  $: selected && setSelectedPerson();
  function setSelectedPerson() {
    if (selected instanceof Person) {
      $selectedPerson = selected;
    }
  }
</script>

<style>
  .persons :global(.row > *) {
    padding: 0;
  }
  .persons :global(.search) {
    margin: 0px 12px 8px 12px;
  }
  .persons.mobile :global(.search) {
    order: 1;
    margin-block-start: 8px;
  }
  .gal-hint {
    margin: 0 12px 8px 12px;
    opacity: 0.65;
    font-size: 0.9em;
  }
  /** Overridden in Meet/Participantsbar/Sidebar.svelte */
  .persons :global(.row.odd:not(.selected):not(:hover) hbox.person) {
    background-color: var(--main-bg);
    color: var(--fg);
  }
</style>
