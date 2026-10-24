<!-- Заголовки столбцов табличного списка писем, как в Outlook:
  щелчок сортирует, повторный — меняет направление, край — ширина,
  перетаскивание — порядок, правый щелчок — выбор столбцов. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="mail-list-header font-smallest" role="row"
  on:contextmenu={contextMenu.onContextMenu}>
  {#each columns as id (id)}
    {@const def = mailListColumnDefs[id]}
    {@const active = sortState.column == id}
    <div class="cell"
      class:icon={def.icon}
      class:active
      class:drop-before={dropTarget == id && dropSide == "before"}
      class:drop-after={dropTarget == id && dropSide == "after"}
      role="columnheader"
      aria-sort={active ? (sortState.direction == "asc" ? "ascending" : "descending") : "none"}
      on:dragover={event => onDragOver(event, id)}
      on:dragleave={() => onDragLeave(id)}
      on:drop={event => onDrop(event, id)}>
      <button type="button" class="label-button"
        class:sortable={isMailListSortColumn(id)}
        draggable="true"
        title={cellTooltip(id, active, sortState.direction)}
        aria-label={cellTooltip(id, active, sortState.direction)}
        on:dragstart={event => onDragStart(event, id)}
        on:dragend={clearDrag}
        on:click={() => onHeaderClick(id)}>
        {#if def.icon}
          <svelte:component this={columnIcon(id)} size="13px" strokeWidth={2} aria-hidden="true" />
        {:else}
          <span class="label">{columnLabel(id)}</span>
        {/if}
        {#if active}
          <svelte:component this={sortState.direction == "asc" ? SortAscIcon : SortDescIcon}
            class="sort-arrow" size={def.icon ? "9px" : "12px"} strokeWidth={2.5} aria-hidden="true" />
        {/if}
      </button>
      {#if !def.icon && !def.flexible}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="resize-handle"
          title={$t`Drag to change the column width. Double-click to reset.`}
          on:pointerdown={event => onResizeStart(event, id)}
          on:dblclick|stopPropagation={() => resetWidth(id)}
          on:click|stopPropagation />
      {/if}
    </div>
  {/each}
</div>
<ContextMenu bind:this={contextMenu}>
  <MailListViewOptions />
</ContextMenu>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import type { MailListSort } from "../LeftPane/quickFilters";
  import {
    isMailListSortColumn,
    mailListColumnDefs,
    mailListSortColumn,
    moveMailListColumnBefore,
    setMailListColumnWidth,
    updateMailListColumns,
    type MailListColumnId,
    type MailListSortColumn,
    type MailListSortDirection,
  } from "../mailListColumns";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MailListViewOptions from "./MailListViewOptions.svelte";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import StatusIcon from "lucide-svelte/icons/mail-open";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import FlagIcon from "lucide-svelte/icons/flag";
  import SortAscIcon from "lucide-svelte/icons/arrow-up";
  import SortDescIcon from "lucide-svelte/icons/arrow-down";
  import { hideTooltips } from "../../Shared/tooltip";
  import { gt, t } from "../../../l10n/l10n";

  export let columns: MailListColumnId[];
  export let sort: MailListSort;
  export let folder: Folder | null = null;
  export let onSort: (column: MailListSortColumn) => void;

  const kColumnDragType = "application/x-jackdaw-mail-list-column";

  let contextMenu: ContextMenu;
  let draggedColumn: MailListColumnId | null = null;
  let dropTarget: MailListColumnId | null = null;
  let dropSide: "before" | "after" = "before";
  let resizing = false;

  $: sortState = mailListSortColumn(sort);
  $: sentFolder = folder?.specialFolder == SpecialFolder.Sent ||
    folder?.specialFolder == SpecialFolder.Drafts || folder?.specialFolder == SpecialFolder.Outbox;

  function columnLabel(id: MailListColumnId): string {
    // В отправленных в столбце — получатель и дата отправки
    if (sentFolder && id == "from") {
      return gt`To *=> Message list column: recipients`;
    }
    if (sentFolder && id == "received") {
      return gt`Sent *=> Message list column: date sent`;
    }
    return mailListColumnDefs[id].label();
  }

  function columnIcon(id: MailListColumnId) {
    switch (id) {
      case "importance": return ImportantIcon;
      case "attachment": return AttachmentIcon;
      case "flag": return FlagIcon;
      default: return StatusIcon;
    }
  }

  function cellTooltip(id: MailListColumnId, active: boolean, direction: MailListSortDirection): string {
    let label = columnLabel(id);
    if (!isMailListSortColumn(id)) {
      return label;
    }
    if (active) {
      return direction == "asc"
        ? $t`${label}: ascending. Click to sort descending`
        : $t`${label}: descending. Click to sort ascending`;
    }
    return $t`Sort by ${label}`;
  }

  function onHeaderClick(id: MailListColumnId) {
    if (resizing || !isMailListSortColumn(id)) {
      return;
    }
    hideTooltips();
    onSort(id);
  }

  function onDragStart(event: DragEvent, id: MailListColumnId) {
    if (resizing || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    draggedColumn = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(kColumnDragType, id);
    hideTooltips();
  }

  function onDragOver(event: DragEvent, id: MailListColumnId) {
    if (!draggedColumn || !event.dataTransfer?.types.includes(kColumnDragType)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    let cell = event.currentTarget as HTMLElement;
    let rect = cell.getBoundingClientRect();
    let rtl = getComputedStyle(cell).direction == "rtl";
    let beforeHalf = (event.clientX - rect.left < rect.width / 2) != rtl;
    dropTarget = id;
    dropSide = beforeHalf ? "before" : "after";
  }

  function onDragLeave(id: MailListColumnId) {
    if (dropTarget == id) {
      dropTarget = null;
    }
  }

  function onDrop(event: DragEvent, id: MailListColumnId) {
    if (!draggedColumn || !event.dataTransfer?.types.includes(kColumnDragType)) {
      return;
    }
    event.preventDefault();
    let moved = draggedColumn;
    let side = dropSide;
    clearDrag();
    if (moved == id) {
      return;
    }
    updateMailListColumns(prefs => {
      let index = prefs.order.indexOf(id);
      let before = side == "before" ? id : prefs.order.slice(index + 1).find(next => next != moved) ?? null;
      return moveMailListColumnBefore(prefs, moved, before);
    });
  }

  function clearDrag() {
    draggedColumn = null;
    dropTarget = null;
  }

  function onResizeStart(event: PointerEvent, id: MailListColumnId) {
    if (event.button != 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    let handle = event.currentTarget as HTMLElement;
    let cell = handle.parentElement;
    if (!cell) {
      return;
    }
    let startX = event.clientX;
    let startWidth = cell.getBoundingClientRect().width;
    let rtl = getComputedStyle(cell).direction == "rtl";
    let frame: number | null = null;
    let pendingWidth = startWidth;
    resizing = true;
    hideTooltips();
    handle.setPointerCapture(event.pointerId);
    let apply = () => {
      frame = null;
      updateMailListColumns(prefs => setMailListColumnWidth(prefs, id, pendingWidth));
    };
    let onMove = (moveEvent: PointerEvent) => {
      let delta = moveEvent.clientX - startX;
      pendingWidth = startWidth + (rtl ? -delta : delta);
      frame ??= requestAnimationFrame(apply);
    };
    let onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      if (frame != null) {
        cancelAnimationFrame(frame);
        apply();
      }
      // click после отпускания не должен менять сортировку
      setTimeout(() => {
        resizing = false;
      }, 0);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function resetWidth(id: MailListColumnId) {
    updateMailListColumns(prefs => setMailListColumnWidth(prefs, id, null));
  }
</script>

<style>
  .mail-list-header {
    display: grid;
    grid-template-columns: var(--mail-list-grid);
    column-gap: var(--mail-list-column-gap);
    flex: 0 0 auto;
    min-width: 0;
    height: 26px;
    padding-inline: var(--mail-list-row-padding-start) var(--mail-list-row-padding-end);
    box-sizing: border-box;
    /* Ширина полосы прокрутки списка ниже: иначе столбцы съезжают */
    overflow-x: hidden;
    overflow-y: hidden;
    scrollbar-gutter: stable;
    border-block-end: 1px solid var(--border);
    background-color: color-mix(in srgb, var(--main-fg) 4%, var(--main-bg));
    color: color-mix(in srgb, var(--main-fg) 72%, transparent);
    user-select: none;
  }
  .cell {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: stretch;
  }
  .cell:not(:first-child)::before {
    content: "";
    position: absolute;
    inset-block: 5px;
    inset-inline-start: calc(var(--mail-list-column-gap) / -2);
    border-inline-start: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    pointer-events: none;
  }
  .label-button {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    text-align: start;
    cursor: default;
  }
  .label-button.sortable {
    cursor: pointer;
  }
  .icon .label-button {
    justify-content: center;
    gap: 0;
  }
  .label-button.sortable:hover,
  .label-button:focus-visible {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
    outline: none;
  }
  .label-button:focus-visible {
    box-shadow: inset 0 0 0 2px var(--input-focus);
  }
  .active .label-button {
    color: var(--main-fg);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label-button :global(.sort-arrow) {
    flex: 0 0 auto;
  }
  .resize-handle {
    position: absolute;
    inset-block: 0;
    inset-inline-end: calc(var(--mail-list-column-gap) / -2 - 4px);
    width: 8px;
    cursor: col-resize;
    z-index: 1;
    touch-action: none;
  }
  .resize-handle:hover {
    background: linear-gradient(to right, transparent 3px, var(--selected-bg) 3px, var(--selected-bg) 5px, transparent 5px);
  }
  .drop-before {
    box-shadow: inset 2px 0 0 var(--selected-bg);
  }
  .drop-after {
    box-shadow: inset -2px 0 0 var(--selected-bg);
  }
  :global([dir="rtl"]) .drop-before {
    box-shadow: inset -2px 0 0 var(--selected-bg);
  }
  :global([dir="rtl"]) .drop-after {
    box-shadow: inset 2px 0 0 var(--selected-bg);
  }
</style>
