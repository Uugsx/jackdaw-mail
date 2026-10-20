<hbox class="account-row"
  class:selected={selected}
  class:account-active={accountActive}
  role="button"
  tabindex="0"
  aria-expanded={expanded}
  title={connectionDetails || (!$account.isLoggedIn ? errorMsg : "")}
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
  {#if connectionProblem}
    <hbox class="icon connection-problem">
      <OfflineIcon size={iconSize} aria-hidden="true" />
    </hbox>
  {:else if $account.isLoggedIn}
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
  <vbox class="label-box">
    <hbox class="label font-small">{$account.name}</hbox>
    {#if connectionProblem}
      <hbox class="connection-status font-smallest">{connectionLine}</hbox>
    {/if}
  </vbox>
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
  import { friendlyErrorMessage } from "../../../logic/util/friendlyError";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
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
  import OfflineIcon from "lucide-svelte/icons/cloud-off";
  import { connectionProblemDetails, connectionProblemLine, newestMessageTime } from "../connectionProblemNotice";
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

  $: accountIcon = typeof $account.icon == "string" ? $account.icon : null;
  $: if (failedAccountIcon && failedAccountIcon != accountIcon) {
    failedAccountIcon = null;
  }
  /* Счётчики и папки передаются аргументами: в legacy-режиме `$:` пересчитывается
   * только по переменным, упомянутым в самом выражении. Раньше `$mailUnreadEpoch`
   * стоял отдельной строкой, и число на строке ящика оставалось старым, пока не
   * менялся выбор папки. */
  $: inboxFolder = inboxAtEpoch($mailUnreadEpoch, $account);
  $: inboxBadge = inboxBadgeAtEpoch($mailUnreadEpoch, $account, $selectedAccount, $selectedFolder);

  function inboxAtEpoch(_epoch: number, mailAccount: MailAccount) {
    return findInboxFolder(mailAccount);
  }

  function inboxBadgeAtEpoch(_epoch: number, mailAccount: MailAccount, activeAccount: MailAccount, activeFolder: Folder): number {
    let inbox = findInboxFolder(mailAccount);
    if (!inbox) {
      return 0;
    }
    return accountInboxBadgeCount(mailAccount, activeAccount, activeFolder, {
      countUnread: inbox.countUnread,
      countNewArrived: inbox.countNewArrived,
    });
  }

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
    ? friendlyErrorMessage(account.fatalError)
    : $errors.hasItems
      ? friendlyErrorMessage(errors.first)
      : "";
  /* Общий ящик OWA ходит на сервер через основной аккаунт: его состояние и показываем */
  $: connectionAccount = account.connectionStatusSource;
  $: connectionProblem = $connectionAccount.connectionStatus.problem;
  $: connectionLine = connectionProblem
    ? connectionProblemLine($connectionAccount.connectionStatus.lastSuccessAt)
    : "";
  $: connectionDetails = connectionProblem
    ? connectionProblemDetails(connectionProblem, $connectionAccount.connectionStatus.lastSuccessAt,
        newestMessageTime($account.inbox))
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
  .label-box {
    grid-column: 3;
    margin-inline-start: 4px;
    min-width: 0;
  }
  .label {
    /* Многоточие работает только у блочного элемента, не у flex. */
    display: block;
    font-weight: 400;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .connection-status {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--warning-fg, #8A5A00);
  }
  .icon.connection-problem {
    color: var(--warning-fg, #8A5A00);
  }
  /* Перекрывает общий цвет обводки иконок строки выше */
  .icon.connection-problem :global(path),
  .icon.connection-problem :global(line) {
    stroke: currentColor;
  }
  /* На десктопе цвет предупреждения одинаков у выбранной и обычной строки
     (контраст на фоне выбора ≥ 4.5:1 в обеих темах). На мобильном фон выбора
     янтарный, предупреждение на нём не читается — там цвет строки. */
  :global(.main-window.mobile) .account-row.selected .connection-status,
  :global(.main-window.mobile) .account-row.selected .icon.connection-problem {
    color: inherit;
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
