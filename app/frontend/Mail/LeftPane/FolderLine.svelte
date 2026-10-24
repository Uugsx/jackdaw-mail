<hbox class="folder" flex
  class:selected={selected}
  class:drop-before={dropMode == "before"}
  class:drop-after={dropMode == "after"}
  class:drop-inside={dropMode == "inside"}
  bind:this={folderElement}
  draggable={canDragFolder}
  role="button"
  tabindex="0"
  aria-pressed={selected}
  on:dragstart={onFolderDragStart}
  on:dragend={onFolderDragEnd}
  on:drop={onDrop}
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
  on:contextmenu={contextMenu.onContextMenu}
  on:click
  on:click={() => { tasksViewOpen.set(false); notesViewOpen.set(false); }}
  on:keydown={onKeyDown}
  title={tooltip}
  >
  <hbox class="icon">
    <FolderIcon {folder} size={$appGlobal.isMobile ? "20px" : "14px"} />
  </hbox>
  <hbox class="label font-small">
    {#if !folder.specialFolder || folder.specialFolder == SpecialFolder.Normal || folder.specialFolder == SpecialFolder.Search}
      {$folder.name}
    {:else}
      {specialFolderNames[folder.specialFolder]}
    {/if}
  </hbox>
  <hbox class="trailing">
    <hbox class="buttons">
      <slot name="buttons" {folder} />
    </hbox>
    {#if $folder.clearProgress}
      <hbox
        class="clear-progress-count mail-folder-count"
        role="status"
        aria-live="polite"
        aria-busy="true"
        title={$t`Deleting ${$folder.clearProgress.completed} of ${$folder.clearProgress.total}`}>
        {$folder.clearProgress.completed}/{$folder.clearProgress.total}
      </hbox>
    {:else if $folder.countUnread}
      <hbox class="count mail-folder-count">
        {$folder.countUnread}
      </hbox>
    {:else if $folder.countNewArrived}
      <hbox class="count mail-folder-count">
        {$folder.countNewArrived}
      </hbox>
    {/if}
  </hbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  <FolderMenu
    {folder}
    on:requestCreateFolder={openCreateFolderDialog}
    on:requestRenameFolder={openRenameFolderDialog}
    on:requestClearFolder={openClearFolderConfirmation}
    on:requestDeleteFolder={openDeleteFolderConfirmation} />
</ContextMenu>
<ConfirmDialog
  bind:open={folderConfirmationOpen}
  title={folderConfirmationTitle}
  message={folderConfirmationMessage}
  confirmLabel={folderConfirmationConfirmLabel}
  on:confirm={confirmFolderAction}
  on:cancel={cancelFolderAction} />
<Popup
  bind:popupOpen={folderDialogOpen}
  popupAnchor={folderElement}
  placement="bottom-start"
  boundaryElSel="body">
  {#if folderDialogMode == "create"}
    <FolderNameDialog
      title={$t`New folder`}
      submitLabel={$t`Create folder`}
      on:submit={onFolderNameSubmit}
      on:close={closeFolderNameDialog} />
  {:else if folderDialogMode == "rename"}
    <FolderNameDialog
      title={$t`Rename folder`}
      initialName={folder.name}
      submitLabel={$t`Rename folder`}
      on:submit={onFolderNameSubmit}
      on:close={closeFolderNameDialog} />
  {/if}
</Popup>

<script lang="ts">
  import { type Folder, SpecialFolder, specialFolderNames } from '../../../logic/Mail/Folder';
  import { onDropMail, onDragOverMail } from '../Message/drag';
  import FolderIcon from './FolderIcon.svelte';
  import { selectedFolder } from '../Selected';
  import FolderMenu from './FolderMenu.svelte';
  import FolderNameDialog from './FolderNameDialog.svelte';
  import ConfirmDialog from '../../Shared/ConfirmDialog.svelte';
  import ContextMenu from '../../Shared/Menu/ContextMenu.svelte';
  import Popup from '../../Shared/Popup.svelte';
  import { catchErrors } from '../../Util/error';
  import { t, gt } from '../../../l10n/l10n';
  import { appGlobal } from '../../../logic/app';
  // Щелчок и по уже выбранной папке возвращает от страницы задач к письмам
  import { tasksViewOpen } from '../Tasks/tasksStore';
  import { notesViewOpen } from '../Notes/notesStore';
  import { getContext } from 'svelte';
  import {
    clearFolderDrag, getDraggedFolder, kFolderDragMIME, startFolderDrag
  } from './folderDrag';

  export let folder: Folder;
  export let selected = false;

  $: tooltip = gt`${folder.name}\n\n${$folder.countNewArrived} new, ${folder.countUnread} unread, ${folder.countTotal} total`;
  $: canDragFolder = !!folder.id && folder.specialFolder == SpecialFolder.Normal &&
    folder.account.isLoggedIn && folder.account.protocol != "all";

  let contextMenu: ContextMenu;
  let folderElement: HTMLElement;
  let dropMode: "before" | "after" | "inside" | null = null;
  let folderDialogOpen = false;
  let folderDialogMode: "create" | "rename" | null = null;
  let folderConfirmationOpen = false;
  let folderConfirmationAction: "clear" | "delete" | null = null;
  let treeRefresh = getContext("treeRefresh") as (() => void) | undefined;

  $: permanentlyClearsFolder =
    folder.specialFolder == SpecialFolder.Trash || folder.specialFolder == SpecialFolder.Spam;
  $: folderConfirmationTitle = folderConfirmationAction == "delete"
    ? $t`Delete folder`
    : permanentlyClearsFolder
      ? $t`Delete all messages`
      : $t`Clear folder`;
  $: folderConfirmationMessage = folderConfirmationAction == "delete"
    ? $t`Delete folder “${folder.name}” and all messages in it? This cannot be undone.`
    : permanentlyClearsFolder
      ? $t`Permanently delete all messages in “${folder.name}”? This cannot be undone.`
      : $t`Move all messages in “${folder.name}” to Trash?`;
  $: folderConfirmationConfirmLabel = folderConfirmationAction == "delete" || permanentlyClearsFolder
    ? $t`Delete`
    : $t`Move`;

  function openCreateFolderDialog() {
    folderDialogMode = "create";
    folderDialogOpen = true;
  }

  function openRenameFolderDialog() {
    folderDialogMode = "rename";
    folderDialogOpen = true;
  }

  function openClearFolderConfirmation() {
    folderConfirmationAction = "clear";
    folderConfirmationOpen = true;
  }

  function openDeleteFolderConfirmation() {
    folderConfirmationAction = "delete";
    folderConfirmationOpen = true;
  }

  function cancelFolderAction() {
    folderConfirmationOpen = false;
    folderConfirmationAction = null;
  }

  async function confirmFolderAction() {
    let action = folderConfirmationAction;
    cancelFolderAction();
    if (action == "clear") {
      await catchErrors(() => folder.clearFolder());
    } else if (action == "delete") {
      let next = folder.parent ?? folder.account.inbox;
      await catchErrors(async () => {
        await folder.deleteIt();
        if ($selectedFolder == folder) {
          $selectedFolder = next;
        }
      });
    }
  }

  function closeFolderNameDialog() {
    folderDialogOpen = false;
    folderDialogMode = null;
  }

  async function onFolderNameSubmit(event: CustomEvent<string>) {
    let name = event.detail;
    let mode = folderDialogMode;
    closeFolderNameDialog();
    await catchErrors(async () => {
      if (mode == "create") {
        let created = await folder.createSubFolder(name);
        await created.save();
      } else if (mode == "rename" && name != folder.name) {
        await folder.rename(name);
        await folder.save();
      }
      treeRefresh?.();
    });
  }

  function isFolderDrag(event: DragEvent): boolean {
    return !!getDraggedFolder() &&
      Array.from(event.dataTransfer?.types ?? []).includes(kFolderDragMIME);
  }

  function getFolderDropMode(event: DragEvent): "before" | "after" | "inside" {
    let bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    let relativeY = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
    if (relativeY < 0.25) {
      return "before";
    }
    if (relativeY > 0.75) {
      return "after";
    }
    return "inside";
  }

  function canDropFolder(source: Folder | null, mode: "before" | "after" | "inside"): boolean {
    if (!source || source == folder || source.account != folder.account ||
        source.specialFolder != SpecialFolder.Normal || !source.id) {
      return false;
    }
    if (mode == "inside") {
      return !folder.disableSubfolders() && !source.getInclusiveDescendants().contains(folder);
    }
    return folder.specialFolder == SpecialFolder.Normal && source.parent == folder.parent;
  }

  function onFolderDragStart(event: DragEvent) {
    if (!canDragFolder || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    startFolderDrag(folder);
    event.dataTransfer.setData(kFolderDragMIME, folder.id);
    event.dataTransfer.setData("text/plain", folder.name);
    event.dataTransfer.effectAllowed = "move";
  }

  function onFolderDragEnd() {
    dropMode = null;
    clearFolderDrag(folder);
  }

  function onDragOver(event: DragEvent) {
    if (!isFolderDrag(event)) {
      dropMode = null;
      void catchErrors(() => onDragOverMail(event, folder));
      return;
    }
    let source = getDraggedFolder();
    let mode = getFolderDropMode(event);
    if (!event.dataTransfer || !canDropFolder(source, mode)) {
      dropMode = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    dropMode = mode;
  }

  function onDragLeave(event: DragEvent) {
    let relatedTarget = event.relatedTarget as Node | null;
    if (!relatedTarget || !folderElement?.contains(relatedTarget)) {
      dropMode = null;
    }
  }

  async function onDrop(event: DragEvent) {
    if (!isFolderDrag(event)) {
      dropMode = null;
      await catchErrors(() => onDropMail(event, folder));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    let source = getDraggedFolder();
    let mode = getFolderDropMode(event);
    if (!canDropFolder(source, mode)) {
      dropMode = null;
      return;
    }
    try {
      await catchErrors(async () => {
        if (mode == "inside") {
          await folder.moveFolderHere(source);
          folder.expanded = true;
        } else {
          await source.moveRelativeTo(folder, mode == "after");
        }
        treeRefresh?.();
      });
    } finally {
      dropMode = null;
      clearFolderDrag(source ?? undefined);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || (event.key != "Enter" && event.key != " ")) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).click();
  }
</script>

<style>
  .folder {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(3.5rem, max-content);
    align-items: center;
    padding-block: 4px;
    padding-inline: 8px 6px;
    min-height: 32px;
    box-sizing: border-box;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
  }

  .clear-progress-count {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .folder:hover:not(.selected) {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .folder.selected {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
    border-color: transparent;
  }
  .folder.selected:hover {
    background-color: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  .folder.drop-before {
    box-shadow: inset 0 2px 0 var(--input-focus);
  }
  .folder.drop-after {
    box-shadow: inset 0 -2px 0 var(--input-focus);
  }
  .folder.drop-inside {
    outline: 2px solid var(--input-focus);
    outline-offset: -2px;
  }
  .selected .label {
    font-weight: 500;
  }
  .selected .icon :global(path),
  .selected .icon :global(.cls-2) {
    stroke: var(--selected-fg);
  }
  .icon :global(.cls-2) {
    stroke: var(--leftbar-fg);
  }
  .icon {
    grid-column: 1;
    flex-shrink: 0;
  }
  .label {
    grid-column: 2;
    padding-inline-start: 8px;
    font-weight: 300;
    height: 20px; /* avoid line break */
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.mobile) .label {
    height: 40px;
    align-items: center;
  }
  .trailing {
    grid-column: 3;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .buttons {
    justify-content: end;
    flex-shrink: 0;
  }
  .folder:not(:hover) .buttons {
    display: none;
  }
  .buttons :global(button:hover) {
    background: inherit !important;
  }
  .buttons :global(button) {
    color: unset;
    background-color: unset;
  }
  .buttons :global(.get-mail button) {
    padding: 3px;
    border: 1px solid transparent;
  }
</style>
