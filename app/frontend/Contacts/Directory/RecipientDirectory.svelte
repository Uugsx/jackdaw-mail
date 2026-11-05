<!-- Всплывающее окно получателя в редакторе: должность и руководитель из каталога Exchange,
  для рассылки — число участников и «Раскрыть список» (как «+» у рассылки в Outlook). -->
{#if info}
  <vbox class="recipient-directory font-small" class:in-menu={inMenu}>
    {#if info.kind == "group"}
      <hbox class="line">
        <UsersIcon size="14px" />
        <span>
          {$t`Distribution list`}{#if members}{" · "}{$t`Members`}: {members.length}{/if}
        </span>
      </hbox>
      {#if canExpand}
        <hbox class="expand">
          <Button plain classes="expand-list"
            icon={ExpandIcon} iconSize="14px"
            label={$t`Expand list`}
            tooltip={$t`Replace the list by its members`}
            disabled={members?.length === 0}
            onClick={expand} />
        </hbox>
      {/if}
    {:else}
      {#if info.jobTitle || info.department}
        <hbox class="line">{[info.jobTitle, info.department].filter(Boolean).join(" · ")}</hbox>
      {/if}
      {#if info.manager}
        <hbox class="line manager">{$t`Manager`}: {info.manager.name}</hbox>
      {/if}
    {/if}
  </vbox>
{/if}

<script lang="ts">
  import { findOrCreatePersonUID, type PersonUID } from "../../../logic/Abstract/PersonUID";
  import { getExchangeDirectory, type DirectoryEntry, type DirectoryInfo } from "../../../logic/Contacts/EWS/ExchangeDirectory";
  import { appGlobal } from "../../../logic/app";
  import Button from "../../Shared/Button.svelte";
  import UsersIcon from "lucide-svelte/icons/users";
  import ExpandIcon from "lucide-svelte/icons/list-plus";
  import { logError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import type { ArrayColl } from "svelte-collections";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ expanded: void }>();

  export let person: PersonUID;
  /** Список получателей, где стоит `person`. Без него раскрыть рассылку нельзя.
   * in/out */
  export let recipients: ArrayColl<PersonUID> | null = null;
  /** Другие поля письма (Кому, Копия, Скрытая): участник, который уже там есть, не добавляется */
  export let otherRecipients: ArrayColl<PersonUID>[] = [];
  /** В меню получателя письма, а не во всплывающем окне редактора */
  export let inMenu = false;

  let info: DirectoryInfo | null = null;
  let members: DirectoryEntry[] | null = null;
  let loadedFor: string | null = null;

  $: emailAddress = person?.emailAddress;
  $: directory = getExchangeDirectory(appGlobal.emailAccounts, emailAddress);
  $: canExpand = !!recipients && recipients.contents.includes(person);

  $: load(emailAddress);
  async function load(address: string) {
    let key = address?.toLowerCase() ?? null;
    if (key == loadedFor) {
      return;
    }
    loadedFor = key;
    info = null;
    members = null;
    if (!directory || !address?.includes("@")) {
      return;
    }
    try {
      let result = await directory.getInfo(address);
      if (loadedFor != key) {
        return;
      }
      info = result;
      if (result?.kind == "group") {
        let list = await directory.expandGroup(address);
        if (loadedFor == key) {
          members = list;
        }
      }
    } catch (ex) {
      logError(ex);
    }
  }

  async function expand() {
    let list = members ?? await directory.expandGroup(emailAddress);
    let contents = recipients.contents;
    let index = contents.indexOf(person);
    if (index < 0) {
      return;
    }
    let others = [...contents.filter(other => other != person), ...otherRecipients.flatMap(coll => coll.contents)];
    let added = list
      .filter(entry => entry.emailAddress &&
        !others.some(other => other.emailAddress?.toLowerCase() == entry.emailAddress.toLowerCase()))
      .map(entry => findOrCreatePersonUID(entry.emailAddress, entry.name));
    recipients.replaceAll([...contents.slice(0, index), ...added, ...contents.slice(index + 1)]);
    dispatch("expanded");
  }
</script>

<style>
  .recipient-directory {
    margin: 0px 12px 10px 68px;
    gap: 4px;
    max-width: 260px;
  }
  .recipient-directory.in-menu {
    margin: 6px 12px;
    max-width: 320px;
  }
  .line {
    align-items: center;
    gap: 6px;
    opacity: 0.8;
  }
  .expand :global(.expand-list) {
    padding: 2px 0px;
  }
</style>
