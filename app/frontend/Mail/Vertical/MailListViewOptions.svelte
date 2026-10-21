<!-- Пункты меню вида списка писем: в меню над списком и по правому щелчку на заголовках -->
<hbox class="menu-heading">{$t`Message list layout`}</hbox>
{#each layouts as option (option.id)}
  <MenuItem label={option.label()} onClick={() => setLayout(option.id)}>
    <svelte:fragment slot="icon">
      {#if layout == option.id}
        <CheckIcon size="16px" aria-hidden="true" />
      {:else}
        <span class="icon-space" />
      {/if}
    </svelte:fragment>
  </MenuItem>
{/each}
<MenuDivider />
<MenuItem label={$t`Lines between messages`} closeOnClick={false} onClick={toggleDividers}>
  <svelte:fragment slot="icon">
    {#if dividers}
      <CheckIcon size="16px" aria-hidden="true" />
    {:else}
      <span class="icon-space" />
    {/if}
  </svelte:fragment>
</MenuItem>
<MenuDivider />
<hbox class="menu-heading">{$t`Columns`}</hbox>
{#each prefs.order as id (id)}
  <MenuItem
    label={mailListColumnDefs[id].label()}
    disabled={mailListColumnDefs[id].required ? $t`This column is always shown` : false}
    closeOnClick={false}
    onClick={() => toggleColumn(id)}>
    <svelte:fragment slot="icon">
      {#if !prefs.hidden.includes(id)}
        <CheckIcon size="16px" aria-hidden="true" />
      {:else}
        <span class="icon-space" />
      {/if}
    </svelte:fragment>
  </MenuItem>
{/each}
<MenuDivider />
<MenuItem label={$t`Reset columns`} icon={ResetIcon} onClick={resetMailListColumns} />

<script lang="ts">
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import CheckIcon from "lucide-svelte/icons/check";
  import ResetIcon from "lucide-svelte/icons/rotate-ccw";
  import {
    mailListColumnDefs,
    mailListColumnsSetting,
    mailListDividersSetting,
    mailListLayoutSetting,
    normalizeMailListColumnPrefs,
    normalizeMailListDividers,
    normalizeMailListLayout,
    resetMailListColumns,
    setMailListColumnVisible,
    updateMailListColumns,
    type MailListColumnId,
    type MailListLayout,
  } from "../mailListColumns";
  import { gt, t } from "../../../l10n/l10n";

  const layouts: { id: MailListLayout, label: () => string }[] = [
    { id: "auto", label: () => gt`Automatic` },
    { id: "table", label: () => gt`Table with columns` },
    { id: "cards", label: () => gt`Two-line cards` },
  ];

  $: prefs = normalizeMailListColumnPrefs($mailListColumnsSetting.value);
  $: dividers = normalizeMailListDividers($mailListDividersSetting.value);
  $: layout = normalizeMailListLayout($mailListLayoutSetting.value);

  function setLayout(value: MailListLayout) {
    mailListLayoutSetting.value = value;
  }

  function toggleDividers() {
    mailListDividersSetting.value = !dividers;
  }

  function toggleColumn(id: MailListColumnId) {
    updateMailListColumns(current => setMailListColumnVisible(current, id, current.hidden.includes(id)));
  }
</script>

<style>
  .menu-heading {
    padding: 6px 14px 4px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    font-weight: 650;
  }
  .icon-space {
    display: inline-block;
    width: 16px;
    height: 16px;
  }
</style>
