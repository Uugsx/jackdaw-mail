<vbox class="smart-views">
  <hbox class="smart-views-header">
    <hbox class="section-title">{$t`Smart Views`}</hbox>
    <hbox flex />
    <ButtonMenu
      label={$t`Customize smart views`}
      buttonIcon={MoreIcon}
      placement="bottom-end">
      {#if hiddenSmartViewIds.length}
        <hbox class="menu-heading">{$t`Hidden smart views`}</hbox>
        {#each hiddenSmartViewIds as id (id)}
          <MenuItem
            label={viewById(id)?.label() ?? id}
            icon={EyeIcon}
            onClick={() => showView(id)} />
        {/each}
        <MenuDivider />
      {/if}
      <MenuItem
        label={$t`Reset smart views`}
        icon={ResetIcon}
        onClick={resetSmartViewPreferences} />
    </ButtonMenu>
    <button type="button" class="collapse-button"
      aria-label={expanded ? $t`Collapse smart views` : $t`Expand smart views`}
      title={expanded ? $t`Collapse smart views` : $t`Expand smart views`}
      aria-expanded={expanded}
      on:click={() => expanded = !expanded}>
      <svelte:component this={expanded ? ChevronUpIcon : ChevronDownIcon} size="14px" />
    </button>
  </hbox>

  {#if expanded}
    {#each orderedViews as view (view.id)}
      <button type="button" class="smart-view"
        class:active={isActive(view.id, $quickSearch)}
        title={view.label()}
        aria-pressed={isActive(view.id, $quickSearch)}
        disabled={!folder}
        on:contextmenu={(event) => openViewMenu(event, view.id)}
        on:click={() => catchErrors(() => activate(view.id))}>
        <svelte:component this={view.icon} size="14px" />
        <span>{view.label()}</span>
        <hbox flex />
        {#if isActive(view.id, $quickSearch)}
          <CheckIcon size="13px" />
        {/if}
      </button>
    {/each}
  {/if}
</vbox>

<ContextMenu bind:this={contextMenu}>
  {#if contextViewId}
    <MenuItem
      label={$t`Move up`}
      icon={MoveUpIcon}
      disabled={viewIndex <= 0}
      onClick={() => moveView("up")} />
    <MenuItem
      label={$t`Move down`}
      icon={MoveDownIcon}
      disabled={viewIndex < 0 || viewIndex >= orderedViews.length - 1}
      onClick={() => moveView("down")} />
    <MenuDivider />
    <MenuItem
      label={$t`Hide smart view`}
      icon={EyeOffIcon}
      onClick={() => hideView(contextViewId)} />
  {/if}
</ContextMenu>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { quickSearch, selectedMessage } from "../Selected";
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { ArrayColl } from "svelte-collections";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import MailIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import CheckIcon from "lucide-svelte/icons/check";
  import ChevronUpIcon from "lucide-svelte/icons/chevron-up";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import EyeIcon from "lucide-svelte/icons/eye";
  import EyeOffIcon from "lucide-svelte/icons/eye-off";
  import MoveUpIcon from "lucide-svelte/icons/arrow-up";
  import MoveDownIcon from "lucide-svelte/icons/arrow-down";
  import ResetIcon from "lucide-svelte/icons/rotate-ccw";
  import {
    getHiddenSmartViewIds,
    getVisibleSmartViewIds,
    moveSmartView,
    resetSmartViewPreferences,
    setSmartViewHidden,
    smartViewPreferencesEpoch,
    type SmartViewId,
  } from "./smartViews";

  type SmartView = {
    id: SmartViewId;
    label: () => string;
    icon: typeof MailIcon;
  };

  type UnreadSyncFolder = Folder & {
    syncUnreadMessages?: () => Promise<boolean | void>;
  };

  export let folder: Folder;
  export let searchMessages: ArrayColl<EMail> | null;
  export let expanded = true;

  const views: SmartView[] = [
    { id: "unread", label: () => $t`Unread`, icon: MailIcon },
    { id: "starred", label: () => $t`Flagged`, icon: FlagIcon },
    { id: "attachments", label: () => $t`Attachments`, icon: AttachmentIcon },
  ];

  let contextMenu: ContextMenu;
  let contextViewId: SmartViewId | null = null;
  let searchGeneration = 0;
  let lastFolder: Folder | null = null;

  // Smart view and toolbar write into one parent-owned search result. Invalidating
  // an older activation prevents a slow server sync from putting an empty/stale
  // result over the newer toolbar filter result.
  $: if (folder !== lastFolder) {
    lastFolder = folder;
    searchGeneration++;
  }

  $: $smartViewPreferencesEpoch;
  $: orderedViews = getVisibleSmartViewIds()
    .map(id => views.find(view => view.id == id))
    .filter((view): view is SmartView => !!view);
  $: hiddenSmartViewIds = getHiddenSmartViewIds();
  $: viewIndex = contextViewId == null
    ? -1
    : orderedViews.findIndex(view => view.id == contextViewId);

  function viewById(id: SmartViewId): SmartView | undefined {
    return views.find(view => view.id == id);
  }

  function openViewMenu(event: MouseEvent, id: SmartViewId): void {
    contextViewId = id;
    contextMenu.onContextMenu(event);
  }

  function moveView(direction: "up" | "down"): void {
    if (contextViewId) {
      moveSmartView(contextViewId, direction);
    }
  }

  function hideView(id: SmartViewId | null): void {
    if (id) {
      setSmartViewHidden(id, true);
    }
  }

  function showView(id: SmartViewId): void {
    setSmartViewHidden(id, false);
  }

  function isActive(id: SmartViewId, search: SearchEMail): boolean {
    if (id == "unread") {
      return search.isRead === false &&
        search.isStarred === null &&
        search.isImportant === null &&
        search.hasAttachment === null &&
        search.isOutgoing === null &&
        search.isReplied === null &&
        !search.bodyText;
    }
    if (id == "starred") {
      return search.isStarred === true &&
        search.isRead === null &&
        search.isImportant === null &&
        search.hasAttachment === null &&
        search.isOutgoing === null &&
        search.isReplied === null &&
        !search.bodyText;
    }
    return search.hasAttachment === true &&
      search.isRead === null &&
      search.isStarred === null &&
      search.isImportant === null &&
      search.isOutgoing === null &&
      search.isReplied === null &&
      !search.bodyText;
  }

  async function activate(id: SmartViewId) {
    if (!folder) {
      return;
    }
    let generation = ++searchGeneration;
    let currentFolder = folder;
    if (isActive(id, $quickSearch)) {
      quickSearch.reset();
      quickSearch.folder = currentFolder;
      $selectedMessage = null;
      searchMessages = null;
      return;
    }
    quickSearch.reset();
    quickSearch.folder = currentFolder;
    if (id == "unread") {
      quickSearch.isRead = false;
    } else if (id == "starred") {
      quickSearch.isStarred = true;
    } else {
      quickSearch.hasAttachment = true;
    }
    $selectedMessage = null;
    searchMessages = new ArrayColl<EMail>();
    if (id == "unread") {
      let syncUnreadMessages = (folder as UnreadSyncFolder).syncUnreadMessages;
      if (typeof syncUnreadMessages == "function") {
        await syncUnreadMessages.call(currentFolder);
      }
    }
    if (generation != searchGeneration || currentFolder !== folder) {
      return;
    }
    let result = await quickSearch.startSearch();
    if (generation == searchGeneration && currentFolder === folder) {
      // Не затираем непустой unread-список пустым снимком, если второй
      // параллельный проход ещё не успел опубликовать добавленные заголовки.
      if (quickSearch.isRead !== false || result?.hasItems ||
          !currentFolder.messages.contents.some(message => !message.isRead)) {
        searchMessages = result;
        $selectedMessage = result?.first;
      }
    }
  }
</script>

<style>
  .smart-views {
    flex: 0 0 auto;
    padding: 2px 8px 8px;
    color: var(--leftbar-fg);
  }
  .smart-views-header {
    align-items: center;
    width: 100%;
    min-width: 0;
    min-height: 24px;
    padding: 0 8px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .section-title {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--leftbar-fg) 58%, transparent);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .collapse-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
    width: 24px;
    min-width: 24px;
    max-width: 24px;
    height: 24px;
    padding: 4px;
    box-sizing: border-box;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--leftbar-fg);
    cursor: default;
  }
  .smart-views-header > :global(.menu.button) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
    width: 24px;
    min-width: 24px;
    max-width: 24px;
    height: 24px;
    padding: 0;
    box-sizing: border-box;
    background: transparent;
    border: none;
  }
  .smart-views-header > hbox[flex] {
    min-width: 0;
  }
  .smart-views-header :global(.menu-button) {
    width: 24px;
    height: 24px;
    padding: 4px;
    border-radius: var(--border-radius);
    color: var(--leftbar-fg);
  }
  .smart-views-header :global(.menu-button:hover:not(.disabled)) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .menu-heading {
    padding: 6px 14px 4px;
    color: color-mix(in srgb, var(--main-fg) 58%, transparent);
    font-size: 11px;
    font-weight: 650;
  }
  .collapse-button:hover {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .smart-view {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--leftbar-fg);
    font: inherit;
    font-size: 12px;
    text-align: start;
    cursor: default;
  }
  .smart-view:hover:not(:disabled):not(.active) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .smart-view.active {
    background: var(--selected-bg);
    color: var(--selected-fg);
    border-color: color-mix(in srgb, var(--icon-primary) 38%, transparent);
  }
  .smart-view.active:hover:not(:disabled) {
    background: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  .smart-view:disabled {
    opacity: 0.45;
  }
</style>
