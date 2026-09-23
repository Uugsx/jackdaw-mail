<svelte:window on:keydown={onFolderCreationKeydown} />

<vbox flex class="folder-pane" id="mail-folders-pane">
  <hbox class="brand-bar">
    <button type="button" class="folder-pane-toggle"
      title={$mailFolderPaneExpandedSetting.value ? $t`Hide folders` : $t`Show folders`}
      aria-label={$mailFolderPaneExpandedSetting.value ? $t`Hide folders` : $t`Show folders`}
      aria-pressed={$mailFolderPaneExpandedSetting.value}
      aria-controls="mail-folders-pane"
      on:click={toggleMailFolderPane}>
      {#if $mailFolderPaneExpandedSetting.value}
        <PanelLeftCloseIcon size="16px" />
      {:else}
        <PanelLeftOpenIcon size="16px" />
      {/if}
    </button>
    {#if $appGlobal.isMobile}
      <WorkspaceHeader selectedApp={mailApp} />
    {/if}
    <hbox flex />
    {#if activeTab == SearchView.Folder}
      <GetMailButton folder={selectedFolder ?? selectedAccount?.inbox} iconSize="16px" showProgress />
    {/if}
  </hbox>

  {#if activeTab != SearchView.Folder}
    <hbox class="mode-switcher">
      <SearchSwitcher bind:active={activeTab} />
    </hbox>
  {/if}

  {#if activeTab == SearchView.Folder}
    {#if quickAccessAccount}
      <QuickAccessFolders
        {accounts}
        account={quickAccessAccount}
        bind:selectedFolder
        on:select={event => selectedFolder = event.detail} />
    {/if}
    <SmartViews folder={selectedFolder} bind:searchMessages />
  {/if}

  <hbox class="section-label font-smallest">
    <span>{$t`Folders`}</span>
    <hbox flex />
    <Button
      bind:buttonEl={folderCreationAnchor}
      label={$t`Create folder`}
      icon={PlusIcon}
      iconOnly
      plain
      classes="folders-add"
      disabled={!selectedAccount?.isLoggedIn || selectedAccount?.protocol == "all"}
      onClick={openFolderCreation} />
  </hbox>

  <HiddenFolders {accounts} />

  <Popup bind:popupOpen={folderCreationOpen} popupAnchor={folderCreationAnchor}
    placement="bottom-end" boundaryElSel="body">
    {#if folderCreationParent}
      <CreateFolder
        parentFolder={folderCreationParent}
        location="toplevel"
        on:created={event => selectedFolder = event.detail}
        on:close={() => folderCreationOpen = false} />
    {/if}
  </Popup>

  {#if activeTab == SearchView.Person}
    <PersonsList
      persons={appGlobal.persons}
      bind:selected={$selectedPerson}
      selectedPersons={new ArrayColl()}
      on:selected={ev => showPerson(ev.detail as Person)}
      />
  {:else if activeTab == SearchView.Search}
    <SearchPane bind:searchMessages on:clear={endSearchMode} />
  {:else}
    <AccountFolderTree {accounts} bind:selectedAccount bind:selectedFolder bind:selectedFolders>
      <svelte:fragment slot="folder-buttons" let:folder>
        <GetMailButton {folder} />
        <Button label={$t`Folder properties`} icon={MoreIcon} iconOnly plain
          onClick={() => onFolderSettings(folder)} />
      </svelte:fragment>
    </AccountFolderTree>
  {/if}

  <hbox class="sidebar-footer">
    <button type="button" class="profile-avatar"
      title={$t`Account settings`}
      aria-label={$t`Account settings`}
      on:click={openAccountSettings}>
      {profileLetter}
    </button>
    <hbox flex />
    <ViewSwitcher />
  </hbox>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { type Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { Person } from "../../../logic/Abstract/Person";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import { globalSearchTerm } from "../../AppsBar/selectedApp";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { openFolderProperties } from '../FolderPropertiesPage.svelte';
  import { appGlobal } from "../../../logic/app";
  import CreateFolder from "../../Settings/Mail/Account/CreateFolder.svelte";
  import AccountFolderTree from "./AccountFolderTree.svelte";
  import SearchPane from "../Search/SearchPane.svelte";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import GetMailButton from "./GetMailButton.svelte";
  import Button from '../../Shared/Button.svelte';
  import ViewSwitcher from "./ViewSwitcher.svelte";
  import SmartViews from "./SmartViews.svelte";
  import QuickAccessFolders from "./QuickAccessFolders.svelte";
  import SearchSwitcher, { SearchView } from "./SearchSwitcher.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import { ArrayColl, type Collection } from 'svelte-collections';
  import { t } from '../../../l10n/l10n';
  import { ensureAccountExpanded } from "../mailSidebarState";
  import { openSettingsCategoryByID, openSettingsCategoryForAccount } from "../../Settings/Window/CategoriesUtils";
  import WorkspaceHeader from "../../MainWindow/WorkspaceHeader.svelte";
  import { mailApp } from "../MailJackdawApp";
  import HiddenFolders from "./HiddenFolders.svelte";
  import { mailFolderPaneExpandedSetting, toggleMailFolderPane } from "../mailFolderPaneState";
  import PanelLeftCloseIcon from "lucide-svelte/icons/panel-left-close";
  import PanelLeftOpenIcon from "lucide-svelte/icons/panel-left-open";

  export let accounts: Collection<MailAccount>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  export let selectedFolders: ArrayColl<Folder>;
  export let activeTab: SearchView;

  let quickAccessAccount: MailAccount;
  let folderCreationOpen = false;
  let folderCreationAnchor: HTMLButtonElement;
  let folderCreationParent: Folder;

  $: activeTab, changeTab();
  function changeTab() {
    lastPerson = null;
    if (activeTab != SearchView.Search) {
      if (!$globalSearchTerm) {
        searchMessages = null;
      }
    }
  }
  function endSearchMode() {
    activeTab = SearchView.Folder;
  }

  let lastPerson: Person;
  async function showPerson(person: Person) {
    if (lastPerson == person || !person || !(person instanceof Person)) {
      return;
    }
    lastPerson = person;

    let search = newSearchEMail();
    search.includesPerson = person;
    let messages = await search.startSearch();

    if (lastPerson != person) { // User already clicked elsewhere.
      return;
    }
    searchMessages = messages;
  }

  $: if (selectedFolder?.account && selectedFolder.account !== selectedAccount) {
    selectedAccount = selectedFolder.account;
    ensureAccountExpanded(selectedAccount);
  }
  $: quickAccessAccount = selectedFolder?.account ?? selectedAccount ?? accounts?.first;

  $: profileLetter = selectedAccount?.name?.trim()?.charAt(0)?.toUpperCase() || "N";

  function openGlobalSettings() {
    openSettingsCategoryByID("global-appearance");
  }

  function openAccountSettings() {
    if (selectedAccount) {
      openSettingsCategoryForAccount(selectedAccount);
    } else {
      openGlobalSettings();
    }
  }

  function onFolderSettings(folder: Folder) {
    selectedFolder = folder;
    $openFolderProperties = true;
  }

  function openFolderCreation() {
    if (!selectedAccount?.isLoggedIn || selectedAccount.protocol == "all") {
      return;
    }
    let parent = selectedFolder?.account == selectedAccount
      ? selectedFolder
      : selectedAccount.inbox;
    if (!parent) {
      return;
    }
    folderCreationParent = parent;
    folderCreationOpen = true;
  }

  function onFolderCreationKeydown(event: KeyboardEvent) {
    if (folderCreationOpen && event.key == "Escape") {
      event.preventDefault();
      folderCreationOpen = false;
    }
  }

</script>

<style>
  .folder-pane {
    position: relative;
    z-index: 2;
    min-width: 0;
    overflow: hidden;
    background: var(--leftbar-bg);
    color: var(--leftbar-fg);
    border-inline-end: 1px solid var(--glass-border-subtle);
    box-shadow: var(--glass-highlight);
  }

  .folder-pane :global(.persons) {
    margin-block-start: 8px;
  }
  .folder-pane :global(.account-list) {
    margin-block-start: -4px;
  }
  .folder-pane :global(.search) {
    margin-block-start: -2px;
  }
  .separator {
    margin-block-start: 20px;
  }
  .brand-bar {
    align-items: center;
    height: 56px;
    min-height: 56px;
    padding: 0 12px;
    box-sizing: border-box;
    border-block-end: 1px solid var(--glass-border-subtle);
  }
  :global(.main-window.ui-density-large) .brand-bar {
    height: 74px;
    min-height: 74px;
  }
  .folder-pane-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--leftbar-fg);
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease,
      transform 0.18s cubic-bezier(0.34, 1.35, 0.64, 1);
  }
  .folder-pane-toggle:hover {
    background-color: var(--hover-bg);
    border-color: var(--border);
    color: var(--hover-fg);
  }
  .folder-pane-toggle:active {
    transform: scale(0.96);
  }
  .folder-pane-toggle:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: reduce) {
    .folder-pane-toggle {
      transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
    }
    .folder-pane-toggle:active {
      transform: none;
    }
  }
  .brand-bar :global(.workspace) {
    color: var(--leftbar-fg);
  }
  .brand-bar :global(.workspace:hover) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .brand-bar :global(.get-mail button) {
    width: 30px;
    height: 30px;
    padding: 5px;
    border-color: transparent;
    color: var(--leftbar-fg);
  }
  .mode-switcher {
    padding: 0 12px 8px;
  }
  .mode-switcher :global(.island) {
    width: 100%;
    justify-content: space-between;
  }
  .section-label {
    align-items: center;
    min-height: 24px;
    padding: 8px 16px 2px;
    box-sizing: border-box;
    color: color-mix(in srgb, var(--leftbar-fg) 58%, transparent);
    font-weight: 650;
    letter-spacing: 0.01em;
  }
  .section-label .folders-add {
    width: 24px;
    height: 24px;
    padding: 4px;
    border-radius: var(--border-radius);
    color: var(--leftbar-fg);
  }
  .section-label .folders-add:hover:not(.disabled) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .folder-pane :global(.account-folder-tree) {
    margin-block-start: 0;
  }
  .folder-pane :global(.account-folder-tree > .scroll) {
    padding-block-end: 8px;
  }
  .folder-pane :global(.account-row) {
    margin-inline: 8px;
    border-radius: var(--border-radius);
    min-height: 30px;
    padding-block: 3px;
  }
  .folder-pane :global(.account-row:hover:not(.selected)) {
    background-color: var(--hover-bg);
  }
  .folder-pane :global(.account-row.selected) {
    background-color: var(--offset-bg);
    color: var(--offset-fg);
  }
  .folder-pane :global(.account-row.selected .mail-folder-count) {
    background-color: color-mix(in srgb, var(--selected-fg) 14%, transparent);
    color: var(--selected-fg);
  }
  .folder-pane :global(.account-row .mail-folder-count),
  .folder-pane :global(.folder .mail-folder-count) {
    background-color: color-mix(in srgb, var(--icon-primary) 20%, transparent);
    color: var(--icon-primary);
  }
  .folder-pane :global(.folder) {
    margin-inline-end: 8px;
    border-radius: var(--border-radius);
    min-height: 30px;
    padding-block: 3px;
    padding-inline: 8px 6px;
  }
  .folder-pane :global(.folder-list.embedded .fast-list .row.selected > *:not(.folder)),
  .folder-pane :global(.folder-list.embedded .fast-list .row:not(.selected):hover > *:not(.folder)),
  .folder-pane :global(.folder-list.embedded .fast-list .row.selected:hover > *:not(.folder)) {
    background-color: transparent;
    color: inherit;
  }
  .folder-pane :global(.folder:hover:not(.selected)) {
    background-color: var(--hover-bg);
  }
  .folder-pane :global(.folder.selected) {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
    border-color: color-mix(in srgb, var(--icon-primary) 38%, transparent);
  }
  .folder-pane :global(.folder.selected:hover) {
    background-color: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  .folder-pane :global(.folder.selected .mail-folder-count) {
    background-color: color-mix(in srgb, var(--selected-fg) 14%, transparent);
    color: var(--selected-fg);
  }
  .buttons {
    align-items: center;
  }
  .sidebar-footer {
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 8px 12px 10px;
    box-sizing: border-box;
    border-block-start: 1px solid var(--border);
  }
  .sidebar-footer :global(.settings-button) {
    width: 30px;
    height: 30px;
    padding: 6px;
    color: var(--leftbar-fg);
  }
  .sidebar-footer :global(.settings-button:hover:not(.disabled)) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .profile-avatar {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--icon-primary);
    border-radius: 50%;
    background-color: transparent;
    color: var(--leftbar-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: default;
  }
  .profile-avatar:hover {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .sidebar-footer :global(.switcher) {
    margin: 0;
  }
  .sidebar-footer :global(.island) {
    border-color: var(--border);
  }
  .sidebar-footer :global(.island button) {
    width: 26px;
    height: 26px;
    padding: 5px;
  }
</style>
