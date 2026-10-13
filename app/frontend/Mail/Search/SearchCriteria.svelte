<vbox flex class="search-criteria" class:compact>
  {#if showSearchTerm}
    <hbox class="term font-normal">
      <SearchField bind:searchTerm={search.bodyText}
        placeholder={$t`Mail content or subject`} />
    </hbox>
  {/if}
  <Checkbox bind:checked={search.isOutgoing} allowIndetermined={true}
    on:change={notifyCriteriaChanged}
    label={$t`Sent by me`}>
    <OutgoingIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={isUnread} allowIndetermined={true}
    on:change={updateUnread}
    label={isUnread === false ? $t`Read *=> State of the message that has been read` : $t`Unread *=> State of the message that has not been read`}
    classes="unread {isUnread ? "is-unread" : ""}">
    <CircleIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={search.isStarred} allowIndetermined={true}
    on:change={notifyCriteriaChanged}
    label={$t`Starred`}
    classes="star {search.isStarred ? "starred" : ""}">
    <StarIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={search.hasAttachment} allowIndetermined={true}
    on:change={updateAttachment}
    label={$t`Attachment`}>
    <AttachmentIcon size="16px" slot="icon" />
  </Checkbox>
  {#if search.hasAttachment}
    <vbox flex class="listbox">
      <GenericFileTypesList bind:selectedMIMETypes={search.hasAttachmentMIMETypes}
        on:change={notifyCriteriaChanged} />
    </vbox>
    <!-- TODO use Slider --
    <grid class="size">
      <Checkbox bind:checked={isMinSize}
        on:change={updateSizeMin}
        label="At least " />
      <input type="number" bind:value={minSizeMB}
        min={1} max={20} disabled={!isMinSize} />
      MB
      <Checkbox bind:checked={isMaxSize}
        on:change={updateSizeMax}
        label="Less than " />
      <input type="number" bind:value={maxSizeMB}
        min={1} max={20} maxlength="2" disabled={!isMaxSize} />
      MB
    </grid>
    -->
  {/if}
  <Checkbox bind:checked={hasPerson} allowFalse={false} allowIndetermined={true}
    on:change={updatePerson}
    label="{hasPerson ? search.includesPerson?.name ?? $t`Person` : $t`Person`}">
    <PersonIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasPerson}
    <vbox flex class="listbox">
      <!-- showSearch=false is a workaround for:
       1. Enter name that is not in results ->
       2. PersonsList clears `search.includesPerson` ->
       3. `search` changes ->
       4. `loadSearch()` triggers (it should not) ->
       5. `hasPerson = false` ->
       6. PersonsList disappears ->
       7. User cannot correct search -->
      <PersonsList persons={availablePersons} bind:selected={search.includesPerson} bind:selectedPersons
        showSearch={false}
        on:selected={notifyCriteriaChanged} />
    </vbox>
  {/if}
  <Checkbox bind:checked={hasTag} allowFalse={false} allowIndetermined={true}
    on:change={updateTag}
    label={$t`Tags`}>
    <TagIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasTag}
    <vbox class="tags">
      <TagSelector tags={availableTags} selectedTags={search.tags} canAdd={false}
        on:select={onTagSelectionChanged} on:unselect={onTagSelectionChanged} />
    </vbox>
  {/if}
  {#if showAccount && appGlobal.emailAccounts.length > 1}
    <Checkbox bind:checked={hasAccount} allowFalse={false} allowIndetermined={true}
      on:change={updateAccount}
      label={search.account ? $t`${search.account.name} account only` : $t`All accounts`}>
      <AccountIcon size="16px" slot="icon" />
    </Checkbox>
    {#if search.account || search.folder}
      <vbox class="listbox">
        <AccountList accounts={appGlobal.emailAccounts} bind:selectedAccount={search.account}
          on:select={onAccountSelected} />
      </vbox>
    {/if}
  {/if}
  {#if search.account}
    <Checkbox bind:checked={hasFolder} allowFalse={false} allowIndetermined={true}
      on:change={updateFolder}
      label={search.folder ? $t`${search.folder.name} folder only` : $t`Folder`}>
      <FolderIcon size="16px" slot="icon" />
    </Checkbox>
    {#if hasFolder}
      <vbox flex class="listbox">
        <FolderList folders={search.account.rootFolders} bind:selectedFolder={search.folder} bind:selectedFolders
          on:selectFolder={notifyCriteriaChanged} />
      </vbox>
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { personsInEMails } from "../../../logic/Mail/Person";
  import { Folder } from "../../../logic/Mail/Folder";
  import { EMail } from "../../../logic/Mail/EMail";
  import { selectedAccount, selectedFolder } from "../Selected";
  import { appGlobal } from "../../../logic/app";
  import SearchField from "../../Shared/SearchField.svelte";
  import GenericFileTypesList from "../../Files/GenericFileTypesList.svelte";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import type { PersonOrGroup } from "../../Contacts/Person/PersonOrGroup";
  import AccountList from "../LeftPane/AccountList.svelte";
  import FolderList from "../LeftPane/FolderList.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import OutgoingIcon from "lucide-svelte/icons/arrow-big-left";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import AccountIcon from "lucide-svelte/icons/mail";
  import FolderIcon from "lucide-svelte/icons/folder";
  import TagIcon from "lucide-svelte/icons/tag";
  import PersonIcon from "lucide-svelte/icons/user-round";
  import { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";

  const dispatchEvent = createEventDispatcher<{ change: void }>();
  type CheckboxChangeEvent = CustomEvent<boolean | null | undefined>;

  /** The search criteria
   * in/out */
  export let search: SearchEMail;

  export let showSearchTerm = true;
  export let showAccount = true;
  export let searchMessages: Collection<EMail> = null;
  /** Компактная раскладка для popup-фильтра на панели писем. */
  export let compact = false;

  // enable/disable fine-grained controls
  let hasAccount: boolean | null = null;
  let hasFolder: boolean | null = null;
  let hasTag: boolean | null = null;
  let hasSizeMin: boolean | null = null;
  let hasSizeMax: boolean | null = null;
  let hasPerson: boolean | null = null;

  // Translate values from `SearchEMail` to how the UI controls show it
  let isUnread: boolean | null = null;
  let sizeMinMB: number;
  let sizeMaxMB: number;

  // Should trigger *only* when a different search is loaded, *not* `$search` when its contents change,
  // but it actually triggers for all changes to `search`, which causes bugs, see e.g. PersonList below.
  $: search, loadSearch()
  function loadSearch() {
    // Enable/disable: `SearchEmail` to controls
    hasAccount = search.account ? true : null;
    hasFolder = search.folder ? true : null;
    hasPerson = search.includesPerson ? true : null;
    hasTag = search.tags.hasItems ? true : null;
    hasSizeMax = search.sizeMax ? true : null;
    hasSizeMin = search.sizeMin ? true : null;

    // Translate values from `SearchEMail` to UI controls
    isUnread = search.isRead === false ? true : (search.isRead === true ? false : null);
    sizeMinMB = search.sizeMin / 1048576;
    sizeMaxMB = search.sizeMax / 1048576;
  }

  // Translate values from UI controls to `SearchEMail`
  function updateUnread(event: CheckboxChangeEvent) {
    isUnread = event.detail;
    search.isRead = event.detail === false ? true : (event.detail === true ? false : null);
    notifyCriteriaChanged();
  }
  $: sizeMinMB, updateSizeMin();
  function updateSizeMin() {
    search.sizeMin = hasSizeMin ? sizeMinMB * 1048576 : null;
  }
  $: sizeMaxMB, updateSizeMax();
  function updateSizeMax() {
    search.sizeMax = hasSizeMax ? sizeMaxMB * 1048576 : null;
  }

  // Enable/disable: From UI controls to `SearchEMail`
  let selectedFolders: ArrayColl<Folder>;
  let selectedPersons = new ArrayColl<PersonOrGroup>();
  function updateAccount(event: CheckboxChangeEvent) {
    hasAccount = event.detail === true;
    let account = $selectedFolder?.account ?? $selectedAccount;
    if (account?.protocol == "all") {
      account = appGlobal.emailAccounts.first ?? null;
    }
    search.account = hasAccount ? account : null;
    if (!search.account) {
      search.folder = null;
    }
    notifyCriteriaChanged();
  }
  function updateFolder(event: CheckboxChangeEvent) {
    hasFolder = event.detail === true;
    let folder = $selectedFolder;
    if (folder?.account?.protocol == "all") {
      folder = null;
    }
    search.folder = hasFolder ? folder : null;
    notifyCriteriaChanged();
  }
  function onAccountSelected(event: CustomEvent<MailAccount>) {
    let account = event.detail;
    if (account) {
      search.account = account;
      hasAccount = true;
    }
    if (search.folder && search.folder.account != search.account) {
      search.folder = null;
      hasFolder = null;
    }
    notifyCriteriaChanged();
  }
  $: availablePersons = hasPerson && searchMessages ? personsInEMails(searchMessages) : appGlobal.personalAddressbook?.persons;
  function updatePerson(event: CheckboxChangeEvent) {
    hasPerson = event.detail === true;
    if (!hasPerson) {
      search.includesPerson = null;
    }
    notifyCriteriaChanged();
  }
  function updateTag(event: CheckboxChangeEvent) {
    hasTag = event.detail === true;
    if (!hasTag) {
      search.tags?.clear();
    }
    notifyCriteriaChanged();
  }
  function onTagSelectionChanged() {
    // В компактном фильтре выбранные теги означают «любой из них».
    // Полный поиск и правила сохраняют прежнюю семантику «все теги».
    search.tagsMatchAny = compact && search.tags.hasItems;
    notifyCriteriaChanged();
  }
  function updateAttachment(event: CheckboxChangeEvent) {
    // Checkbox отдаёт `undefined`, когда возвращается из отрицательного
    // состояния в «не учитывать фильтр». Не превращаем это состояние в
    // `false`, иначе минус на вложениях невозможно снять.
    search.hasAttachment = event.detail === true
      ? true
      : event.detail === false
        ? false
        : null;
    if (search.hasAttachment !== true) {
      search.hasAttachmentMIMETypes.clear();
    }
    notifyCriteriaChanged();
  }
  function notifyCriteriaChanged() {
    dispatchEvent("change");
  }
</script>

<style>
  .term {
    margin-block-start: 8px;
    margin-block-end: 24px;
    align-items: center;
  }
  .term :global(.search) {
    margin: 0px 8px;
  }
  .term :global(input) {
    font-size: 16px;
  }
  .search-criteria :global(.star.starred svg) {
    fill: orange;
  }
  .search-criteria :global(.unread.is-unread svg) {
    fill: green;
  }
  .listbox {
    margin-block-start: 4px;
    margin-block-end: 16px;
    min-height: 200px;
  }
  .tags {
    margin-block-start: 8px;
    margin-block-end: 16px;
    margin-inline-start: 8px;
  }
  .search-criteria.compact {
    gap: 2px;
    min-width: 0;
    min-height: 0;
    overflow: visible;
  }
  .search-criteria.compact :global(.checkbox) {
    min-height: 30px;
    padding: 3px 6px;
    border-radius: 8px;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }
  .search-criteria.compact :global(.checkbox:hover) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .search-criteria.compact :global(.checkbox.on) {
    background: color-mix(in srgb, var(--selected-bg) 14%, transparent);
  }
  .search-criteria.compact :global(.checkbox label) {
    min-width: 0;
    line-height: 1.25;
    font-size: 13px;
  }
  .search-criteria.compact :global(.checkbox input) {
    width: 18px;
    height: 18px;
    min-width: 18px;
    border-radius: 5px;
  }
  .search-criteria.compact :global(.checkbox input:focus-visible) {
    outline: 2px solid var(--input-focus);
    outline-offset: 2px;
  }
  .search-criteria.compact :global(.checkbox input.indetermined) {
    background: var(--button-bg);
    border: 1px solid var(--button-border);
  }
  .search-criteria.compact :global(.checkbox .state-icon-wrapper) {
    color: var(--button-fg);
  }
  .search-criteria.compact .listbox {
    flex: 0 1 auto;
    height: min(176px, 24vh);
    min-height: 0;
    max-height: 176px;
    margin: 2px 0 6px 28px;
    overflow: hidden;
    border: 1px solid var(--glass-border-subtle);
    border-radius: 10px;
    background: var(--glass-bg-subtle);
  }
  .search-criteria.compact .listbox :global(.fast-list) {
    min-height: 0;
  }
  .search-criteria.compact .tags {
    max-height: min(184px, 26vh);
    margin: 2px 0 6px 28px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--glass-border-subtle);
    border-radius: 10px;
    background: var(--glass-bg-subtle);
  }
  .search-criteria.compact .tags :global(.tag) {
    min-height: 26px;
    margin: 2px;
    padding-inline: 8px;
    border-radius: 999px;
    color: var(--main-fg);
    font-size: 12px;
  }
  .search-criteria.compact .tags :global(.tag.unselected) {
    color: var(--main-fg);
  }
  .search-criteria.compact .tags :global(.tag.selected) {
    border: 2px solid var(--input-focus);
    padding-inline: 7px;
  }
  @media (prefers-reduced-motion: reduce) {
    .search-criteria.compact :global(.checkbox) {
      transition: none;
    }
  }
  /*
  grid.size {
    margin: 4px 0px 8px 32px;
    grid-template-columns: max-content max-content max-content;
  }
  input {
    text-align: center;
    width: unset;
    margin: 0px 8px;
  }
  input[disabled] {
    background-color: unset;
    border-bottom: unset;
  }
  */
</style>
