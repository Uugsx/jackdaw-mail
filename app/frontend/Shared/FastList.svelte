<hbox class="fast-list" class:auto-height={autoHeight}
  on:scroll={onScrollThrottled}
  on:keydown={event => onKey(event)}
  tabindex={0}
  bind:this={listE}>
  <vbox class="canvas"
    style={autoHeight
      ? `--fast-list-row-height: ${rowHeight}px;`
      : `height: ${heightY}px; --fast-list-row-height: ${rowHeight}px;`}>
    <grid style="grid-template-columns: {columns};{autoHeight ? '' : ` top: ${renderStartPosY}px;`}">
      <div class="header" bind:this={headerE}>
        <slot name="header" />
      </div>
      <div class="content" bind:this={contentE}>
        {#each renderItems as item, i}
          <div class="row"
            class:selected={useExternalHighlight ? item === highlightItem : $selectedItems.includes(item)}
            class:odd={(renderStartPos + i) % 2 == 1}
            on:click={event => onSelectElement(item, event)}>
            <slot name="row" {item} />
          </div>
        {/each}
      </div>
    </grid>
  </vbox>
</hbox>

<script lang="ts">
  /**
  There are many HTML tree widget implementations out there, but most fail when you start
  pushing 100000 entries in there. The problem is that most create a DOM nodes for
  every line and cell, and once you get to a million DOM nodes, that's a noticeable
  load time and costs RAM. For email, we need to render folders with tens of thousands
  and a hundred thousand emails.

  This is a "fast list". The demo is loading 100000 entries on load, and you can add 100000
  more in fractions of a second. You will notice that the addition is very fast. Millions of rows work.
  Scrolling is very fast. Scrolling should work both using the scroll bar and using the mouse wheel.

  We don't create DOM nodes for every row, but only for the visible rows, e.g. only 10 or so.
  The data is in a pure data array. When the user scrolls, we do not move or destroy DOM nodes,
  but merely replace their text content and leave the nodes in place.

  We listen to mouse wheel scroll events, and scroll correspondingly.
  The scroll bar at the right is a dummy element, and we set the inner height of it to the
  calculated height in px that the rows would have, if all rows would be DOM nodes.
  Then we listen to scroll events, and translate them to corresponding row content changes.

  You're not limited to a single line per row, and you can have rich HTML content in each cell.
  However, the number of columns must be the same for every row / entry.

  Try it out at https://benbucksch.github.io/trex/fastlist-test.html (non-Svelte DOM version)

  TODO:
  * alignment
  */

  import { Collection, CollectionObserver, ArrayColl } from "svelte-collections"
  import { catchErrors } from "../Util/error";
  import throttle from "lodash/throttle";
  import { onMount, tick } from "svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{
    init: { scrollToIndex: (index: number) => void, scrollToItem: (item: T) => void },
    selected: T,
  }>();

  type T = $$Generic;

  /**
   * The items to display in the list.
   */
  export let items: Collection<T> = new ArrayColl<T>();

  /** grid-template-columns: */
  export let columns: string = "auto";

  /**
   * The list items that the user selected,
   * e.g. by clicking on them.
   * This is usually just one element,
   * unless the user used multiple selection, e.g. using the SHIFT key.
   *
   * Prefer passing a shared ArrayColl from the parent (e.g. selectedMessages store)
   * so toolbars/drag-drop see the same selection the list mutates.
   *
   * @see also selectedItem
   *
   * in/out
   */
  export let selectedItems: ArrayColl<T> = new ArrayColl<T>();

  /**
   * The list item that the user selected,
   * e.g. by clicking on it.
   * Unlike selecteditems, this is always returns just one element.
   *
   * in/out
   */
  export let selectedItem: T = null;

  /** When the `selectedItems` are removed from `items`,
   * select the items which was in their place in the list. */
  export let ensureSelection = true;

  /** Render all rows at natural height (for embedded folder trees inside a parent scroll area). */
  export let autoHeight = false;

  /** Row highlight driven by parent (embedded folder trees). */
  export let highlightItem: T | null = null;
  export let useExternalHighlight = false;

  const embeddedRowHeight = 32;

  /** Return false to ignore clicks/keyboard on section headers etc. */
  export let isSelectable: (item: T) => boolean = () => true;

  /** Whether the list is scrolled all the way to the top
   * out only */
  export let isAtTop = false;

  let listE: HTMLDivElement;
  let headerE: HTMLDivElement;
  let contentE: HTMLDivElement;
  /** The `items` that the `init` event was dispatched for */
  let initDoneForItems: Collection<T> = null;

  /** `$items` alone does not always invalidate when the collection mutates in place. */
  let itemsChangeVersion = 0;
  class ItemsChangeObserver extends CollectionObserver<T> {
    added() { itemsChangeVersion++; }
    removed() { itemsChangeVersion++; }
  }
  const itemsChangeObserver = new ItemsChangeObserver();
  let observedItems: Collection<T> | null = null;
  $: {
    if (items !== observedItems) {
      observedItems?.unregisterObserver(itemsChangeObserver);
      items?.registerObserver(itemsChangeObserver);
      observedItems = items;
      itemsChangeVersion++;
    }
  }

  $: headerHeight = headerE?.firstChild?.offsetHeight ?? 10;

  /**
   * Height of the DOM elements for a single row.
   * {integer} in px
   */
  let rowHeight = 10;

  /** First visible row
   * Set by `onScroll()`
   * {integer} index position in entries */
  let showStartPos = 0;
  let scrollFrame: number | null = null;

  /** How many rows are actually visible on the screen, without scroll */
  let showRows = 1;

  /** How many invisible rows to create DOM cells for. Avoids empty lines while scrolling.
   * 1 = 100% overdraw in each direction, i.e.
   * renders 3 times as many rows as are visible: 100% above, and 100% below. */
  const overdrawFactor = 1;

  /** First row to create DOM cells for.
   * {integer} index position in entries */
  $: renderStartPos = autoHeight ? 0 : Math.max(showStartPos - showRows * overdrawFactor, 0);
  $: if (autoHeight) {
    showRows = Math.max($items.length, 1);
  }
  $: renderItems = getRenderItems(itemsChangeVersion, renderStartPos, showRows);
  /** Number of pixels *above* the first rendered row
   * {integer} px */
  $: renderStartPosY = Math.max(Math.floor(renderStartPos * rowHeight), 0);
  $: isAtTop = showStartPos == 0;

  /**
   * Number of pixels of all rows, including invisible ones.
   * {integer} px
   */
  $: heightY = getHeightY(itemsChangeVersion, rowHeight, headerHeight);

  /* `_version` is only there to make the reactive statements above re-run
   * when the collection mutates in place. */
  function getRenderItems(_version: number, start: number, rows: number): T[] {
    if (autoHeight) {
      return $items.contents as T[];
    }
    return $items.getIndexRange(start, rows + rows * overdrawFactor * 2) as T[];
  }

  function getHeightY(_version: number, rowH: number, headerH: number): number {
    return $items.length * rowH + headerH || 100;
  }

  $: if (!autoHeight && $items.hasItems && listE) {
    catchErrors(updateSize);
  } else if (autoHeight && $items.hasItems) {
    rowHeight = embeddedRowHeight;
    showRows = Math.max($items.length, 1);
  }

  //$: console.log("items", $items.length, "header height", headerHeight, "rowHeight", rowHeight, "heightY", heightY, "startPosY", startPosY, "startPos", startPos);

  /**
   * All rows must have the same height, otherwise the scroll geometry drifts.
   * Group headers and other non-selectable rows are laid out to `rowHeight`
   * via the `--fast-list-row-height` variable, so we must not measure one of
   * them - that would feed their placeholder height back into itself.
   */
  function firstRegularRowElement(): HTMLElement | null {
    let rowIndex = renderItems.findIndex(item => isSelectable(item));
    let rowE = contentE?.children[Math.max(rowIndex, 0)];
    return (rowE?.firstElementChild as HTMLElement) ?? null;
  }

  let observedContentRow: HTMLElement | null = null;

  /**
   * Call this when either the number of entries changes,
   * or the DOM size of <fastlist> changes.
   * Updates the DOM elements with the rows.
   */
  async function updateSize() {
    try {
      if (items.isEmpty) {
        return;
      }
      await tick();
      let contentRow = firstRegularRowElement();
      if (!contentRow) {
        return;
      }
      // Density changes resize the row without resizing the list viewport.
      // Observe the rendered row so virtualization recalculates its geometry.
      if (observedContentRow !== contentRow) {
        if (observedContentRow) {
          resizeObserver.unobserve(observedContentRow);
        }
        observedContentRow = contentRow;
        resizeObserver.observe(contentRow);
      }
      //console.log("size", "contentrow", contentRow.offsetHeight, "list", listE.offsetHeight, "header", headerE.offsetHeight);
      rowHeight = contentRow.offsetHeight;
      if (autoHeight) {
        showRows = Math.max($items.length, 1);
        if (initDoneForItems != items) {
          initDoneForItems = items;
          dispatchEvent("init", { scrollToIndex: scrollIntoView, scrollToItem: scrollItemIntoView });
        }
        return;
      }
      let availableHeight = listE.offsetHeight - headerE.offsetHeight;

      showRows = Math.ceil(availableHeight / rowHeight);
      //console.log("size", "contentrow", contentRow.offsetHeight, "list", listE.offsetHeight, "header", headerE.offsetHeight, "rowheight", rowHeight, "available", availableHeight, " showrows", showRows);
      if (initDoneForItems != items) {
        // Dispatching on every item change would yank the view back to the selected row
        initDoneForItems = items;
        dispatchEvent("init", { scrollToIndex: scrollIntoView, scrollToItem: scrollItemIntoView });
      }
    } catch (ex) {
      console.error(ex);
    }
  }

  const updateSizeThrottled = throttle(updateSize, 30);
  const resizeObserver = new ResizeObserver(updateSizeThrottled);

  /** The caller may hand us a different collection later, e.g. when the
   * selection is reset by replacing it rather than clearing it. */
  let observedSelectedItems: ArrayColl<T> | null = null;
  $: {
    if (selectedItems !== observedSelectedItems) {
      observedSelectedItems?.unregisterObserver(singleSelectionObserver);
      selectedItems?.registerObserver(singleSelectionObserver);
      observedSelectedItems = selectedItems;
    }
  }

  onMount(() => {
    if (!useExternalHighlight && selectedItem && !selectedItems.contains(selectedItem)) {
      selectedItems.add(selectedItem);
    }

    if (!autoHeight) {
      resizeObserver.observe(listE);
    } else {
      rowHeight = embeddedRowHeight;
      showRows = Math.max($items.length, 1);
    }
    return onDestroy;
  });

  function onDestroy() {
    observedSelectedItems?.unregisterObserver(singleSelectionObserver);
    observedItems?.unregisterObserver(itemsChangeObserver);
    resizeObserver.disconnect();
    updateSizeThrottled.cancel();
    cancelScrollFrame();
  }

  function onKey(event: KeyboardEvent) {
    // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
    // Do allow Ctrl/Shift, so that we can expand selection with keyboard
    if (event.key == "ArrowDown" || event.key == "ArrowUp" ||
        event.key == "PageDown" || event.key == "PageUp" ||
        event.key == "Home" || event.key == "End") {
      event.stopPropagation();
      event.preventDefault();
      let lastItem = selectedItems.last || selectedItem;
      let oldIndex = lastItem ? items.contents.findIndex(item => item == lastItem) : 0;
      let newIndex = oldIndex;
      if (event.key == "ArrowDown") {
        newIndex = nextSelectableIndex(oldIndex, 1);
      } else if (event.key == "ArrowUp") {
        newIndex = nextSelectableIndex(oldIndex, -1);
      } else if (event.key == "PageDown") {
        newIndex = nextSelectableIndex(oldIndex, showRows);
      } else if (event.key == "PageUp") {
        newIndex = nextSelectableIndex(oldIndex, -showRows);
      } else if (event.key == "Home") {
        newIndex = firstSelectableIndex();
      } else if (event.key == "End") {
        newIndex = lastSelectableIndex();
      }
      if (newIndex < 0) {
        newIndex = 0;
      } else if (newIndex >= items.length) {
        newIndex = items.length - 1;
      }
      let newElement = items.getIndex(newIndex);
      if (!newElement || !isSelectable(newElement)) {
        return;
      }
      /*if (event.shiftKey) {
        let startIndex = oldIndex < newIndex ? oldIndex : newIndex;
        let length = Math.abs(newIndex - oldIndex) + 1;
        console.log("from", startIndex, "len", length);
        selectedItems.addAll(items.getIndexRange(startIndex, length));
      } else */ if (event.ctrlKey || event.metaKey || event.shiftKey) {
        selectedItems.add(newElement);
      } else {
        selectedItems.clear();
        selectedItems.add(newElement);
      }
      scrollIntoView(newIndex);
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      if (event.key == "a") {
        selectedItems.clear();
        selectedItems.addAll(items.contents.filter(item => isSelectable(item)));
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  function scrollIntoView(index: number) {
    let indexMinY = index * rowHeight + headerHeight;
    let indexMaxY = indexMinY + rowHeight - listE.clientHeight;
    if (indexMinY < listE.scrollTop) {
      listE.scrollTop = indexMinY;
    } else if (indexMaxY > listE.scrollTop) {
      listE.scrollTop = indexMaxY;
    }
  }

  function scrollItemIntoView(item: T) {
    if (!item) {
      return;
    }
    let index = items.contents.indexOf(item);
    if (index < 0) {
      return;
    }
    scrollIntoView(index);
  }

  function firstSelectableIndex(): number {
    for (let i = 0; i < items.length; i++) {
      let item = items.getIndex(i);
      if (item && isSelectable(item)) {
        return i;
      }
    }
    return 0;
  }

  function lastSelectableIndex(): number {
    for (let i = items.length - 1; i >= 0; i--) {
      let item = items.getIndex(i);
      if (item && isSelectable(item)) {
        return i;
      }
    }
    return Math.max(items.length - 1, 0);
  }

  function nextSelectableIndex(fromIndex: number, delta: number): number {
    if (!items.length) {
      return 0;
    }
    let index = fromIndex;
    for (let step = 0; step < items.length; step++) {
      index += delta;
      if (index < 0) {
        return firstSelectableIndex();
      }
      if (index >= items.length) {
        return lastSelectableIndex();
      }
      let item = items.getIndex(index);
      if (item && isSelectable(item)) {
        return index;
      }
    }
    return Math.max(Math.min(fromIndex, items.length - 1), 0);
  }

  function onScrollThrottled() {
    if (scrollFrame != null) {
      return;
    }
    if (typeof requestAnimationFrame != "function") {
      onScroll();
      return;
    }
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      onScroll();
    });
  }

  function cancelScrollFrame() {
    if (scrollFrame == null) {
      return;
    }
    if (typeof cancelAnimationFrame == "function") {
      cancelAnimationFrame(scrollFrame);
    }
    scrollFrame = null;
  }

  function onScroll() {
    let topY = listE.scrollTop - headerHeight;
    let startPosCalc = Math.floor(topY / rowHeight);
    showStartPos = Math.max(Math.min(startPosCalc, items.length - showRows), 0);
    //console.log("startpos", showStartPos, "top y", topY, "scrolltop", listE.scrollTop, "rowheight", rowHeight);
  }

  function selectableRange(itemsArray: ArrayColl<T>, start: number, length: number): T[] {
    if (length <= 0 || start < 0) {
      return [];
    }
    return (itemsArray.getIndexRange(start, length) as T[]).filter(item => !!item && isSelectable(item));
  }

  function indexOfItem(itemsArray: ArrayColl<T>, item: T | null | undefined): number {
    if (!item) {
      return -1;
    }
    let index = itemsArray.getKeyForValue(item);
    return typeof index == "number" && index >= 0 ? index : -1;
  }

  function setSingleSelection(item: T) {
    selectedItems.clear();
    selectedItems.add(item);
    if (!useExternalHighlight) {
      dispatchEvent("selected", item);
    }
  }

  function onSelectElement(clickedItem: T, event: MouseEvent) {
    if (!isSelectable(clickedItem)) {
      return;
    }
    if (event.shiftKey) { // select whole range
      let anchorItem = selectedItems.first ?? selectedItem;
      if (!anchorItem || !isSelectable(anchorItem)) {
        setSingleSelection(clickedItem);
        return;
      }
      let itemsArray = items instanceof ArrayColl ? items : new ArrayColl(items.contents);
      let firstItemIndex = indexOfItem(itemsArray, anchorItem);
      let lastItemIndex = indexOfItem(itemsArray, clickedItem);
      if (firstItemIndex < 0 &&
          lastSelectedIndex >= 0 && lastSelectedIndex < itemsArray.length) {
        let fallback = itemsArray.getIndex(lastSelectedIndex);
        if (fallback && isSelectable(fallback)) {
          anchorItem = fallback;
          firstItemIndex = lastSelectedIndex;
        }
      }
      if (firstItemIndex < 0 || lastItemIndex < 0) {
        setSingleSelection(clickedItem);
        return;
      }
      selectedItems.clear();
      selectedItems.add(anchorItem); // anchor for later shift-select
      if (firstItemIndex == lastItemIndex) {
        // Only this
      } else if (firstItemIndex < lastItemIndex) {
        selectedItems.addAll(selectableRange(itemsArray, firstItemIndex + 1, lastItemIndex - firstItemIndex));
      } else { // User selected bottom -> top
        selectedItems.addAll(selectableRange(itemsArray, lastItemIndex, firstItemIndex - lastItemIndex));
      }
    } else if (event.ctrlKey || event.metaKey) { // add to current selection
      if (selectedItems.contains(clickedItem)) {
        selectedItems.remove(clickedItem);
      } else {
        selectedItems.add(clickedItem);
      }
    } else { // no modifier, i.e. a simple single-selection click
      if (useExternalHighlight) {
        dispatchEvent("selected", clickedItem);
      } else {
        selectedItems.clear();
        selectedItems.add(clickedItem);
        dispatchEvent("selected", clickedItem);
      }
    }
  }

  /** If the selected items were removed from the list,
   * adapt the selectedItems and implicitly selectedItem. */
  $: ensureSelection && !useExternalHighlight && itemsChangeVersion && replaceSelectedItem();
  function replaceSelectedItem() {
    if (selectedItems.isEmpty) {
      return;
    }
    selectedItems.removeAll(selectedItems.filterOnce(a => !items.includes(a) || !isSelectable(a)));
    if (selectedItems.isEmpty) {
      let newItem = nearestSelectableItem(lastSelectedIndex);
      if (!newItem) {
        return;
      }
      selectedItems.add(newItem);
    }
  }

  /** After the selected row was deleted, move to the row that took its place,
   * the way a mail client does - not back to the top of the list. */
  function nearestSelectableItem(index: number): T | null {
    let contents = items.contents;
    let start = Math.max(Math.min(index, contents.length - 1), 0);
    for (let i = start; i < contents.length; i++) {
      if (isSelectable(contents[i])) {
        return contents[i];
      }
    }
    for (let i = start - 1; i >= 0; i--) {
      if (isSelectable(contents[i])) {
        return contents[i];
      }
    }
    return null;
  }

  /** Index the selection was at, remembered so that `replaceSelectedItem()`
   * still knows where the user was after the row is gone from `items`. */
  let lastSelectedIndex = -1;

  /**
   * Convenience class which returns just the first selected item
   */
  class SingleSelectionObserver<T> extends CollectionObserver<T> {
    added(_items: T[], selectedItems: Collection<T>) {
      this.onSelectedItem(selectedItems.first);
    }
    removed(_items: T[], selectedItems: Collection<T>) {
      this.onSelectedItem(selectedItems.isEmpty ? null : selectedItems.first);
    }
    /**
     * Called when the selected item changed
     * @param selectedItem
     *      null, if no item is selected
     */
    onSelectedItem(selectedItem?: T) {
      throw "implement this";
    }
  }

  const singleSelectionObserver = new SingleSelectionObserver<T>();
  singleSelectionObserver.onSelectedItem = (item: T) => {
    selectedItem = item;
    if (item) {
      lastSelectedIndex = items?.contents.indexOf(item) ?? -1;
    }
  };
</script>

<style>
  .fast-list {
    position: relative;
    flex: 1 0 0;
    min-width: 0;
    min-height: 0;
    overflow-y: scroll;
    overflow-x: hidden;
  }
  .fast-list.auto-height {
    flex: none;
    overflow: visible;
  }
  .fast-list.auto-height .canvas {
    height: auto;
  }
  .fast-list.auto-height grid {
    position: relative;
    top: 0;
  }
  grid {
    width: 100%;
    height: auto;
    position: absolute;
    top: 0px; /* overridden by scrolling code */
    left: 0px;
  }
  .header {
    display: contents;
  }
  .header :global(> *) {
    padding: 2px 5px;
  }
  .content {
    display: contents;
  }
  .row {
    display: contents;
  }
  .row :global(> *) {
    overflow: hidden;
    padding: 0px 5px; /* TODO vertical padding triggers a bug in the size calculation */
  }
  .fast-list::-webkit-scrollbar-thumb {
    min-height: 60px;
  }
  /* 3D style
  .header :global(> *) {
    border-top: 1px solid white;
    border-left: 1px solid white;
    border-right: 1px solid #8E8EA1;
    border-bottom: 1px solid #8E8EA1;
    background-color: #D2D2DC;
  }
  .header :global(> *:hover) {
    background-color: #E5E5F7;
  }
  */
</style>
