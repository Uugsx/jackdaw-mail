<hbox class="account-row"
  class:selected={selected}
  class:account-active={accountActive}
  role="button"
  tabindex="0"
  aria-expanded={expanded}
  title={!$account.isLoggedIn ? errorMsg : ""}
  on:contextmenu={contextMenu.onContextMenu}
  on:click={onRowClick}
  on:keydown={onRowKeyDown}
  >
  <hbox class="expand">
    {#if showExpand}
      <Button
        classes="expand-btn"
        label={expanded ? $t`Collapse folders` : $t`Expand folders`}
        icon={expanded ? CollapseIcon : ExpandIcon}
        iconOnly plain
        iconSize="14px"
        onClick={onToggleExpand}
        />
    {:else}
      <hbox class="expand-placeholder" />
    {/if}
  </hbox>
  {#if $account.isLoggedIn}
    <hbox class="icon">
      {#if accountIcon && failedAccountIcon != accountIcon}
        <img src={accountIcon} width={iconLogoSize} height={iconLogoSize} alt="" class="logo" on:error={onAccountIconError} />
      {:else}
        <Icon data={MailIcon} size={iconSize} />
      {/if}
    </hbox>
  {:else}
    <hbox class="icon">
      <Icon data={MailXIcon} size={iconSize} />
    </hbox>
  {/if}
  <hbox class="label font-small">{$account.name}</hbox>
  <hbox class="trailing">
    {#if inboxBadge}
      <hbox class="count mail-folder-count">{inboxBadge}</hbox>
    {/if}
    <hbox class="buttons">
      {#if $account.isLoggedIn}
        <GetMailButton folder={inboxFolder} iconSize="14px" />
      {:else}
        <Button label={$t`Login`} icon={DisconnectedIcon} onClick={login} iconSize="16px" plain iconOnly />
      {/if}
      {#if account.protocol != "all"}
        <Button label={$t`Account settings`} icon={SettingsIcon} onClick={openSettings} iconSize="16px" plain iconOnly />
      {/if}
    </hbox>
  </hbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  <AccountMenu {account} />
</ContextMenu>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { openSettingsCategoryForAccount } from "../../Settings/Window/CategoriesUtils";
  import { appGlobal } from "../../../logic/app";
  import Icon from "svelte-icon/Icon.svelte";
  import GetMailButton from "./GetMailButton.svelte";
  import AccountMenu from "./AccountMenu.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import MailIcon from "../../asset/icon/appBar/mail.svg?raw";
  import MailXIcon from "../../asset/icon/mail/mail-question.svg?raw";
  import DisconnectedIcon from "lucide-svelte/icons/unplug";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import ExpandIcon from "lucide-svelte/icons/chevron-right";
  import CollapseIcon from "lucide-svelte/icons/chevron-down";
  import { t } from "../../../l10n/l10n";
  import { selectedAccount, selectedFolder } from "../Selected";
  import { accountInboxBadgeCount, findInboxFolder, mailUnreadEpoch } from "../mailUnreadCounts";
  import { createEventDispatcher } from "svelte";

  export let account: MailAccount;
  export let selected = false;
  export let accountActive = false;
  export let expanded = false;
  export let showExpand = true;

  const dispatch = createEventDispatcher<{ select: MailAccount; toggleExpand: MailAccount }>();
  let failedAccountIcon: string | null = null;

  /** Re-run when folders load, counts change, or selection moves. */
  $: _epoch = $mailUnreadEpoch;
  $: _account = $account;
  $: accountIcon = typeof $account.icon == "string" ? $account.icon : null;
  $: if (failedAccountIcon && failedAccountIcon != accountIcon) {
    failedAccountIcon = null;
  }
  $: inboxFolder = findInboxFolder(account);
  $: inboxBadge = (() => {
    let inbox = findInboxFolder(account);
    if (!inbox) {
      return 0;
    }
    return accountInboxBadgeCount(account, $selectedAccount, $selectedFolder, {
      countUnread: inbox.countUnread,
      countNewArrived: inbox.countNewArrived,
    });
  })();

  async function login() {
    await account.login(true);
  }

  async function openSettings(event: MouseEvent) {
    event.stopPropagation();
    openSettingsCategoryForAccount(account);
  }

  function onRowClick() {
    dispatch("select", account);
  }

  function onRowKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || (event.key != "Enter" && event.key != " ")) {
      return;
    }
    event.preventDefault();
    onRowClick();
  }

  function onToggleExpand(event: MouseEvent) {
    event.stopPropagation();
    dispatch("toggleExpand", account);
  }

  function onAccountIconError() {
    failedAccountIcon = accountIcon;
  }

  let contextMenu: ContextMenu;

  $: errors = $account.errors;
  $: errorMsg = $account.fatalError
    ? account.fatalError.message
    : $errors.hasItems
      ? errors.first.message
      : "";
  $: iconSize = $appGlobal.isMobile ? "24px" : "16px";
  $: iconLogoSize = $appGlobal.isMobile ? "24px" : "18px";
</script>

<style>
  .account-row {
    display: grid;
    grid-template-columns: 22px 20px minmax(0, 1fr) minmax(3.5rem, max-content);
    align-items: center;
    padding-inline-end: 8px;
    padding-block: 4px;
    min-height: 32px;
    box-sizing: border-box;
    min-width: 0;
    cursor: pointer;
  }
  .account-row.selected {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .account-row.account-active {
    background-color: color-mix(in srgb, var(--selected-bg) 35%, transparent);
    color: var(--leftbar-fg);
  }
  .expand {
    grid-column: 1;
    width: 22px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }
  .expand-placeholder {
    width: 14px;
  }
  .expand :global(.expand-btn) {
    padding: 0;
  }
  .icon {
    grid-column: 2;
    height: 20px;
    width: 20px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }
  .icon :global(path),
  .icon :global(.cls-2) {
    stroke: var(--leftbar-fg);
  }
  .selected .icon :global(path),
  .selected .icon :global(.cls-2) {
    stroke: var(--selected-fg);
  }
  .logo {
    border-radius: 2px;
  }
  .label {
    /* Многоточие работает только у блочного элемента, не у flex. */
    display: block;
    grid-column: 3;
    margin-inline-start: 4px;
    font-weight: 400;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trailing {
    grid-column: 4;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .account-row:not(:hover) .buttons {
    display: none;
  }
  .buttons {
    flex-shrink: 0;
    justify-content: end;
  }
  .buttons :global(button) {
    color: unset;
    background-color: unset;
    border: none;
  }
  .buttons :global(.get-mail button) {
    padding: 2px;
  }
</style>
