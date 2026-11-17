<Popup
  bind:popupOpen={isMenuOpen}
  popupAnchor={anchor}
  {placement}
  {boundaryElSel}
  {disableReferenceHide}
  dismissOnPointerLeave={dismissOnPointerLeave}
  dismissDelayMs={dismissDelayMs}>
  <vbox class="menu"
    on:keydown={onKeyPress}>
    <slot />
  </vbox>
</Popup>
<svelte:window on:keydown={onWindowKeyPress} />

<script lang="ts">
  import Popup from "../Popup.svelte";
  import type { Placement } from "@popperjs/core";
  import { setContext } from "svelte";

  function createSubmenuRegistry() {
    let closers = new Set<() => void>();
    return {
      register(fn: () => void) {
        closers.add(fn);
        return () => closers.delete(fn);
      },
      closeAll() {
        for (let fn of closers) {
          fn();
        }
      },
      /** Одновременно открыто одно подменю: остальные закрываются сразу */
      closeOthers(except: () => void) {
        for (let fn of closers) {
          if (fn !== except) {
            fn();
          }
        }
      },
    };
  }

  /** in/out */
  export let isMenuOpen: boolean = false;
  /** Under/above which element the popup window should appear.
   * The popup will not cover this element, but be just above/below it.
   * in */
  export let anchor: HTMLElement | { getBoundingClientRect(): DOMRect };
  /** Where the popup should appear in relation to the anchor.
   * above/below ("top"/"bottom") and left/right ("start"/"end")
   * in */
  export let placement: Placement = "bottom-end";
  /**
   * In which area the popup may appear. Much larger than the anchor.
   * Typically the entire page,  or just a part of it.
   * Should be large enough to contain the entire popup window
   * in any situation, e.g. if the anchor is in the middle of this area.
   * The popup window will be entirely within this area, and
   * be cut off larger.
   * Document element selector, e.g. '.mail-composer-window'
   * in */
  export let boundaryElSel: string = "body";
  /** Close when the pointer leaves the menu surface (needed beside webviews). */
  export let dismissOnPointerLeave = false;
  /** Delay before closing after pointer leave (ms). */
  export let dismissDelayMs = 350;
  export let disableReferenceHide = false;

  function onKeyPress(event: KeyboardEvent) {
    if (event.key == "Escape") {
      onMenuClose();
    }
  }

  function onWindowKeyPress(event: KeyboardEvent) {
    if (!isMenuOpen || event.key != "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onMenuClose();
  }

  const submenuRegistry = createSubmenuRegistry();
  setContext("submenuRegistry", submenuRegistry);

  function onMenuClose() {
    submenuRegistry.closeAll();
    isMenuOpen = false;
  }
  $: if (!isMenuOpen) {
    submenuRegistry.closeAll();
  }
  setContext("onMenuClose", onMenuClose);
</script>

<style>
  .menu {
    background-color: var(--main-bg, var(--bg));
    color: var(--main-fg, var(--fg));
    padding: 4px 0px;
    outline: 0px;
    display: block;
    text-decoration: none;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
    border-radius: var(--border-radius);
    min-width: 12em;
    pointer-events: auto;
  }
</style>
