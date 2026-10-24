<!-- Карточка контакта: место в организации по каталогу Exchange — руководитель, подчинённые,
  участники рассылки. Пока нет ответа, без ящика Exchange или без записи в каталоге не видна:
  иначе мигала бы у каждого контакта. -->
{#if directory && emailAddress && hasContent}
  <GroupBox classes="org-chart" headerName={info?.kind == "group" ? $t`Distribution list` : $t`Organization`}>
    <svelte:fragment slot="icon">
      {#if info?.kind == "group"}
        <UsersIcon size="16px" />
      {:else}
        <OrgIcon size="16px" />
      {/if}
    </svelte:fragment>
    <vbox class="org" slot="content">
      {#if info}
        {#if info.jobTitle || info.department || info.office}
          <hbox class="position font-small">
            {[info.jobTitle, info.department, info.office].filter(Boolean).join(" · ")}
          </hbox>
        {/if}
        {#if info.manager}
          <h4 class="font-small">{$t`Manager`}</h4>
          <DirectoryEntries entries={[info.manager]} />
        {/if}
        {#if info.directReports.length}
          <h4 class="font-small">{$t`Direct reports`}{" "}({info.directReports.length})</h4>
          <DirectoryEntries entries={info.directReports} />
        {/if}
        {#if info.kind == "group"}
          <h4 class="font-small">
            {$t`Members`}{#if members}{" "}({members.length}){/if}
          </h4>
          {#if members}
            {#if members.length}
              <DirectoryEntries entries={members} />
            {:else}
              <hbox class="status font-small">{$t`The list has no members`}</hbox>
            {/if}
          {:else if membersError}
            <hbox class="status error font-small" title={membersError}>{$t`Could not load the members`}</hbox>
          {:else}
            <hbox class="status font-small">{$t`Loading…`}</hbox>
          {/if}
        {/if}
      {/if}
    </vbox>
  </GroupBox>
{/if}

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import { getExchangeDirectory, type DirectoryEntry, type DirectoryInfo } from "../../../logic/Contacts/EWS/ExchangeDirectory";
  import { appGlobal } from "../../../logic/app";
  import GroupBox from "../PersonPage/GroupBox.svelte";
  import DirectoryEntries from "./DirectoryEntries.svelte";
  import OrgIcon from "lucide-svelte/icons/network";
  import UsersIcon from "lucide-svelte/icons/users";
  import { logError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  $: emailAddress = person?.emailAddresses.first?.value;
  $: directory = getExchangeDirectory(appGlobal.emailAccounts, emailAddress);

  let info: DirectoryInfo | null = null;
  let members: DirectoryEntry[] | null = null;
  let membersError: string | null = null;
  let loadedFor: string | null = null;

  $: hasContent = !!info && (info.kind == "group" || !!info.manager || info.directReports.length > 0 ||
    !!info.jobTitle || !!info.department || !!info.office);

  $: load(emailAddress);
  async function load(address: string) {
    let key = address?.toLowerCase() ?? null;
    if (key == loadedFor) {
      return;
    }
    loadedFor = key;
    info = null;
    members = null;
    membersError = null;
    if (!directory || !address) {
      return;
    }
    try {
      let result = await directory.getInfo(address);
      if (loadedFor != key) {
        return;
      }
      info = result;
      if (result?.kind == "group") {
        try {
          let list = await directory.expandGroup(address);
          if (loadedFor == key) {
            members = list;
          }
        } catch (ex) {
          if (loadedFor == key) {
            membersError = ex?.message ?? String(ex);
          }
        }
      }
    } catch (ex) {
      // Каталог недоступен (нет сети, нет прав) — карточка остаётся без блока
      logError(ex);
    }
  }
</script>

<style>
  .org {
    gap: 2px;
    max-width: 32em;
  }
  h4 {
    margin: 10px 0px 2px 0px;
    font-weight: 600;
    opacity: 0.75;
  }
  .position {
    color: grey;
  }
  .status {
    opacity: 0.65;
  }
  .status.error {
    color: var(--error-fg, inherit);
  }
</style>
