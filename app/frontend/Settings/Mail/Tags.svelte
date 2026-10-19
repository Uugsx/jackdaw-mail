<vbox class="tags-settings">
  <HeaderGroupBox classes="sync-group">
    <hbox slot="header">
      {$t`Sync from Outlook mailbox`}
    </hbox>
    <hbox class="subtitle sync-intro">
      {$t`Import the Master Category List from a specific OWA mailbox. Local order is kept after sync.`}
    </hbox>
    {#if owaAccounts.length > 0}
      <vbox class="sync-panel">
        <hbox class="sync-row">
          <label class="sync-field">
            <span class="sync-label">{$t`Source mailbox`}</span>
            <select bind:value={syncAccountId} on:change={onSyncAccountChange}>
              {#each owaAccounts as account (account.id)}
                <option value={account.id}>{account.name}</option>
              {/each}
            </select>
          </label>
          <RoundButton
            label={syncing ? $t`Syncing…` : $t`Sync from mailbox`}
            onClick={() => catchErrors(onSync)}
            icon={RefreshIcon}
            disabled={syncing || !syncAccountId}
            />
        </hbox>
        <label class="sync-option">
          <input type="checkbox" bind:checked={removeOthersOnSync} />
          {$t`Remove categories that are not on this mailbox`}
        </label>
        {#if syncMessage}
          <hbox class="sync-status" role="status">{syncMessage}</hbox>
        {/if}
        {#if syncError}
          <hbox class="sync-error" role="alert">{syncError}</hbox>
        {/if}
      </vbox>
    {:else}
      <hbox class="sync-hint">{$t`No logged-in OWA mailboxes found. Open mail first, then return here.`}</hbox>
    {/if}
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Categories`}
    </hbox>
    <hbox class="subtitle">{$t`Drag rows to reorder.`}</hbox>

    <vbox class="tags">
      {#each sortedTagList($availableTags.contents) as tag, index (tag.name)}
        <hbox
          class="tag-row"
          class:drop-before={dropTarget?.name == tag.name && dropMode == "before"}
          class:drop-after={dropTarget?.name == tag.name && dropMode == "after"}
          class:dragging={draggedTag?.name == tag.name}
          on:dragover={(event) => onDragOver(event, tag)}
          on:dragleave={(event) => onDragLeave(event, tag)}
          on:drop={(event) => catchErrors(() => onDrop(event, tag))}
          >
          <button
            type="button"
            class="drag-handle"
            draggable="true"
            aria-label={$t`Drag to reorder`}
            title={$t`Drag to reorder`}
            on:dragstart={(event) => onDragStart(event, tag)}
            on:dragend={() => onDragEnd(tag)}
            >
            <GripIcon size="14px" aria-hidden="true" />
          </button>
          <hbox class="order-buttons">
            <RoundButton
              label={$t`Move up`}
              onClick={() => catchErrors(() => moveTag(tag, -1))}
              icon={UpIcon}
              classes="small plain"
              iconSize="12px"
              padding="2px"
              border={false}
              disabled={index == 0}
              />
            <RoundButton
              label={$t`Move down`}
              onClick={() => catchErrors(() => moveTag(tag, 1))}
              icon={DownIcon}
              classes="small plain"
              iconSize="12px"
              padding="2px"
              border={false}
              disabled={index >= $availableTags.length - 1}
              />
          </hbox>
          <TagBubble {tag} />
          <hbox flex />
          <RoundButton
            label={$t`Remove`}
            onClick={() => onRemove(tag)}
            icon={DeleteIcon}
            classes="small remove"
            iconSize="12px"
            padding="0px"
            border={false}
            />
        </hbox>
      {/each}
      <TagAdd on:add={(event) => catchErrors(() => onAdd(event.detail))} />
    </vbox>
  </HeaderGroupBox>

  <HeaderGroupBox>
    <hbox slot="header">
      {$t`Category combinations`}
    </hbox>
    <hbox class="subtitle">
      {$t`Apply several categories to a message with one click. Click categories below to build each combination.`}
    </hbox>
    <vbox class="combinations">
      {#each sortedTagCombinations($tagCombinations.contents) as combination (combination.id)}
        <TagCombinationRow
          {combination}
          on:remove={() => catchErrors(() => onRemoveCombination(combination))}
          />
      {/each}
      <hbox class="add-combination">
        <RoundButton
          label={$t`Add combination`}
          onClick={() => catchErrors(onAddCombination)}
          icon={AddIcon}
          />
      </hbox>
    </vbox>
  </HeaderGroupBox>

  <CategoryShortcuts />
</vbox>

<script lang="ts">
  import { friendlyErrorMessage } from "../../../logic/util/friendlyError";
  import { onMount } from "svelte";
  import { Tag, addAvailableTag, availableTags, moveTag, reorderTag, saveTagsList, setTagsSyncAccountId, sortedTagList } from "../../../logic/Abstract/Tag";
  import {
    createTagCombination,
    removeTagCombination,
    removeTagFromCombinations,
    saveTagCombinations,
    sortedTagCombinations,
    tagCombinations,
    type TagCombination,
  } from "../../../logic/Abstract/TagCombination";
  import TagCombinationRow from "./TagCombinationRow.svelte";
  import CategoryShortcuts from "./CategoryShortcuts.svelte";
  import { appGlobal } from "../../../logic/app";
  import type { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
  import {
    listOWAAccountsForTagSync,
    resolveOWAAccountForTagSync,
    syncTagsFromOWAAccount,
  } from "../../../logic/Mail/tagSync";
  import { clearCategoryShortcut, pruneCategoryShortcuts } from "../../Mail/CategoryShortcuts";
  import TagBubble from "../../Shared/Tag/TagBubble.svelte";
  import TagAdd from "../../Shared/Tag/TagAdd.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import UpIcon from "lucide-svelte/icons/chevron-up";
  import DownIcon from "lucide-svelte/icons/chevron-down";
  import GripIcon from "lucide-svelte/icons/grip-vertical";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import AddIcon from "lucide-svelte/icons/plus";
  import { catchErrors, showError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import {
    clearTagDrag, getDraggedTag, getTagDropMode, isTagDrag, kTagDragMIME, startTagDrag,
  } from "./tagDrag";

  let draggedTag: Tag | null = null;
  let dropTarget: Tag | null = null;
  let dropMode: "before" | "after" | null = null;
  let owaAccounts: OWAAccount[] = [];
  let syncAccountId = "";
  let removeOthersOnSync = true;
  let syncing = false;
  let syncMessage = "";
  let syncError = "";

  $: mailAccounts = appGlobal.emailAccounts;
  $: owaAccounts = (void mailAccounts.length, listOWAAccountsForTagSync());

  function pickDefaultSyncAccount(accounts: OWAAccount[]): string {
    return resolveOWAAccountForTagSync(accounts.find(account => !account.isDependentAccount) ?? null)?.id ?? "";
  }

  $: if (owaAccounts.length) {
    let nextId = pickDefaultSyncAccount(owaAccounts);
    if (!syncAccountId || !owaAccounts.some(account => account.id == syncAccountId)) {
      syncAccountId = nextId;
    }
  }

  onMount(() => {
    syncAccountId = pickDefaultSyncAccount(owaAccounts);
  });

  function onSyncAccountChange() {
    setTagsSyncAccountId(syncAccountId || null);
    syncMessage = "";
    syncError = "";
  }

  async function onSync() {
    let account = owaAccounts.find(entry => entry.id == syncAccountId);
    if (!account) {
      syncError = $t`Mailbox not found`;
      return;
    }
    syncing = true;
    syncMessage = "";
    syncError = "";
    try {
      let result = await syncTagsFromOWAAccount(account, removeOthersOnSync);
      syncMessage = $t`${result.total} categories synced (${result.added} added, ${result.updated} updated, ${result.removed} removed).`;
    } catch (ex) {
      syncError = friendlyErrorMessage(ex);
    } finally {
      syncing = false;
    }
  }

  async function onAdd(tag: Tag) {
    addAvailableTag(tag);
    await saveTagsList();
  }

  function onRemove(tag: Tag) {
    if (!confirm($t`Do you want to delete this tag entirely?`)) {
      return;
    }
    availableTags.remove(tag);
    clearCategoryShortcut({ type: "tag", id: tag.name });
    removeTagFromCombinations(tag.name)
      .then(pruneCategoryShortcuts)
      .catch(showError);
    saveTagsList().catch(showError);
  }

  async function onAddCombination() {
    createTagCombination($t`New combination`, []);
    await saveTagCombinations();
  }

  async function onRemoveCombination(combination: TagCombination) {
    if (!confirm($t`Delete this category combination?`)) {
      return;
    }
    clearCategoryShortcut({ type: "combination", id: combination.id });
    await removeTagCombination(combination);
  }

  function onDragStart(event: DragEvent, tag: Tag) {
    if (!event.dataTransfer) {
      event.preventDefault();
      return;
    }
    startTagDrag(tag);
    draggedTag = tag;
    event.dataTransfer.setData(kTagDragMIME, tag.name);
    event.dataTransfer.setData("text/plain", tag.name);
    event.dataTransfer.effectAllowed = "move";
  }

  function onDragEnd(tag: Tag) {
    draggedTag = null;
    dropTarget = null;
    dropMode = null;
    clearTagDrag(tag);
  }

  function onDragOver(event: DragEvent, tag: Tag) {
    if (!isTagDrag(event)) {
      return;
    }
    let source = getDraggedTag();
    if (!source || source === tag || !event.dataTransfer) {
      dropTarget = null;
      dropMode = null;
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dropTarget = tag;
    dropMode = getTagDropMode(event);
  }

  function onDragLeave(event: DragEvent, tag: Tag) {
    let rowElement = event.currentTarget as HTMLElement;
    let relatedTarget = event.relatedTarget as Node | null;
    if (dropTarget?.name == tag.name && (!relatedTarget || !rowElement.contains(relatedTarget))) {
      dropTarget = null;
      dropMode = null;
    }
  }

  async function onDrop(event: DragEvent, tag: Tag) {
    if (!isTagDrag(event)) {
      return;
    }
    event.preventDefault();
    let source = getDraggedTag();
    let mode = getTagDropMode(event);
    dropTarget = null;
    dropMode = null;
    if (!source || source === tag) {
      clearTagDrag(source ?? undefined);
      draggedTag = null;
      return;
    }
    try {
      await reorderTag(source, tag, mode);
    } finally {
      clearTagDrag(source);
      draggedTag = null;
    }
  }
</script>

<style>
  .tags-settings {
    max-width: 56em;
  }
  .sync-intro {
    margin-block-end: 12px;
  }
  .subtitle {
    margin-block-end: 16px;
    opacity: 0.8;
  }
  .sync-panel {
    gap: 8px;
    margin-block-end: 16px;
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .sync-row {
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .sync-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 14em;
  }
  .sync-label {
    font-size: 0.85em;
    opacity: 0.75;
  }
  .sync-option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.92em;
  }
  .sync-status {
    font-size: 0.92em;
    color: var(--success, #2e7d32);
  }
  .sync-error {
    font-size: 0.92em;
    color: var(--error, #c62828);
  }
  .sync-hint {
    margin-block-end: 16px;
    opacity: 0.75;
    font-size: 0.92em;
  }
  .tags {
    gap: 8px;
  }
  .tag-row {
    align-items: center;
    gap: 8px;
    min-height: 32px;
    border-radius: 6px;
  }
  .tag-row.dragging {
    opacity: 0.45;
  }
  .tag-row.drop-before {
    box-shadow: inset 0 2px 0 var(--input-focus);
  }
  .tag-row.drop-after {
    box-shadow: inset 0 -2px 0 var(--input-focus);
  }
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 20px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg);
    opacity: 0.55;
    cursor: grab;
  }
  .drag-handle:hover,
  .drag-handle:focus-visible {
    opacity: 1;
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    outline: none;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .order-buttons {
    gap: 2px;
    flex: 0 0 auto;
  }
  .tags :global(.tag) {
    font-size: 14px;
    line-height: 1.25;
    white-space: normal;
  }
  .tags :global(.remove) {
    padding: 2px;
  }
  .combinations {
    gap: 12px;
  }
  .add-combination {
    margin-block-start: 4px;
  }
</style>
