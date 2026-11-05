<!-- Люди и рассылки из каталога Exchange: имя (открывает контакт, если он есть), адрес, «Написать» -->
<vbox class="directory-entries">
  {#each shown as entry (entry.emailAddress || entry.name)}
    <hbox class="entry">
      {#if entry.kind == "group"}
        <UsersIcon size="14px" class="kind" />
      {:else}
        <UserIcon size="14px" class="kind" />
      {/if}
      <vbox class="text" flex>
        {#if findPerson(entry.emailAddress)}
          <Clickable onClick={() => openPerson(entry)}>
            <hbox class="name known">{entry.name}</hbox>
          </Clickable>
        {:else}
          <hbox class="name">{entry.name}</hbox>
        {/if}
        {#if entry.emailAddress && entry.emailAddress != entry.name}
          <hbox class="email font-smallest">{entry.emailAddress}</hbox>
        {/if}
      </vbox>
      {#if entry.emailAddress}
        <a href="mailto:{entry.emailAddress}" class="write">
          <Button icon={MailIcon} label={$t`Write mail`} iconOnly plain iconSize="14px" />
        </a>
      {/if}
    </hbox>
  {/each}
  {#if entries.length > limit && !showAll}
    <Button plain classes="show-all font-small"
      label={$t`Show all ${entries.length}`}
      onClick={() => showAll = true} />
  {/if}
</vbox>

<script lang="ts">
  import type { DirectoryEntry } from "../../../logic/Contacts/EWS/ExchangeDirectory";
  import { findPerson } from "../../../logic/Abstract/PersonUID";
  import { openPersonFromOtherApp } from "../open";
  import Button from "../../Shared/Button.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import UserIcon from "lucide-svelte/icons/user";
  import UsersIcon from "lucide-svelte/icons/users";
  import MailIcon from "lucide-svelte/icons/mail";
  import { t } from "../../../l10n/l10n";

  export let entries: DirectoryEntry[];
  /** Сколько показывать до «Показать все» */
  export let limit = 20;

  let showAll = false;
  $: shown = showAll ? entries : entries.slice(0, limit);

  function openPerson(entry: DirectoryEntry) {
    let person = findPerson(entry.emailAddress);
    if (person) {
      openPersonFromOtherApp(person);
    }
  }
</script>

<style>
  .entry {
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .entry :global(.kind) {
    flex: 0 0 auto;
    opacity: 0.6;
  }
  .text {
    min-width: 0;
  }
  .name,
  .email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.known {
    cursor: pointer;
    color: var(--link-fg);
  }
  .name.known:hover {
    color: var(--link-hover-fg);
  }
  .email {
    opacity: 0.65;
  }
  .write {
    flex: 0 0 auto;
  }
  .directory-entries :global(.show-all) {
    align-self: start;
    padding: 4px 0px;
  }
</style>
