<PersonsAutocomplete persons={addresses} {placeholder} {tabindex} {autofocus}
  searchFunction={searchFunction}
  {collapseAfter} bind:this={personsEl}>
  <slot name="end" slot="end" />
  <vbox slot="person-popup-bottom" let:person>
    <RecipientDirectory {person} recipients={addresses} {otherRecipients} />
    <hbox class="addressbooks" class:top-border={person?.person?.emailAddresses.length > 1}>
      {#if person?.person}
        <AddressbookChanger person={person.person} />
      {/if}
    </hbox>
  </vbox>
 <slot name="person-popup-buttons" slot="person-popup-buttons" let:person {person} />
</PersonsAutocomplete>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import PersonsAutocomplete from "../../Contacts/PersonAutocomplete/PersonsAutocomplete.svelte";
  import AddressbookChanger from "../../Contacts/AddressbookChanger.svelte";
  import RecipientDirectory from "../../Contacts/Directory/RecipientDirectory.svelte";
  import type { ArrayColl } from "svelte-collections";

  /** E.g. to, cc or bcc list
   * in/out */
  export let addresses: ArrayColl<PersonUID>;
  export let placeholder: string;
  export let tabindex = null;
  export let autofocus = false;
  export let collapseAfter: number | null = null;
  /** Остальные поля получателей: при раскрытии рассылки их адреса не дублируются */
  export let otherRecipients: ArrayColl<PersonUID>[] = [];
  export let searchFunction: (
    (searchText: string, skip: (person: PersonUID) => boolean) => Promise<PersonUID[]>
  ) | null = null;

  let personsEl: PersonsAutocomplete;

  export async function commitPendingInput(): Promise<boolean> {
    return personsEl?.commitPendingInput() ?? false;
  }

  export function focusInput() {
    personsEl?.focusInput();
  }
</script>

<style>
  .addressbooks {
    padding: 12px;
    max-width: 280px;
  }
  .addressbooks.top-border {
    border-top: 1px solid var(--border);
  }
  .addressbooks:not(.top-border) {
    margin-block-start: -6px;
    padding-block-start: 0px;
  }
</style>
