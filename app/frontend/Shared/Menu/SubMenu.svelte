<button type="button" class="submenu-item"
  class:open={isOpen}
  bind:this={anchorE}
  on:mouseenter={onEnterTrigger}
  on:mouseleave={onLeaveTrigger}
  on:click|stopPropagation={onClickTrigger}>
  <hbox class="icon">
    {#if typeof(icon) == "string"}
      <Icon data={icon} size={iconSize} />
    {:else if icon}
      <svelte:component this={icon} size={iconSize} />
    {:else}
      <slot name="icon" />
    {/if}
  </hbox>
  {#if hasIcon}
    <hbox class="gap" />
  {/if}
  <hbox class="label font-small">{label}</hbox>
  <hbox flex />
  <hbox class="chevron">
    <ChevronRightIcon size="14px" />
  </hbox>
</button>

{#if isOpen}
  <!-- Portal to body: parent menu popup uses transform, which would clip fixed children -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <vbox class="submenu-flyout"
    class:opens-left={opensLeft}
    class:opens-right={!opensLeft}
    bind:this={flyoutE}
    use:portalToBody
    style="top: {flyoutTop}px; left: {flyoutLeft}px"
    on:mouseenter={onEnterFlyout}
    on:mouseleave={onLeaveFlyout}
    on:click|stopPropagation
    on:wheel|stopPropagation
    on:mousedown|stopPropagation>
    <vbox class="submenu-scroll">
      <slot />
    </vbox>
  </vbox>
{/if}

<script lang="ts">
  import Icon from "svelte-icon/Icon.svelte";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import type { ConstructorOfATypedSvelteComponent } from "svelte";
  import { getContext, onDestroy, onMount, tick } from "svelte";

  export let label: string;
  export let icon: ConstructorOfATypedSvelteComponent | string = null;
  export let iconSize = "16px";
  /** Kept for API compat; not used as native tooltip (blocks flyout UX). */
  export let tooltip: string = label;

  let isOpen = false;
  let anchorE: HTMLButtonElement;
  let flyoutE: HTMLElement;
  let flyoutTop = 0;
  let flyoutLeft = 0;
  let opensLeft = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const FLYOUT_OVERLAP_PX = 12;

  type SubmenuRegistry = { register: (fn: () => void) => () => void, closeOthers?: (except: () => void) => void };
  let submenuRegistry = getContext<SubmenuRegistry | undefined>("submenuRegistry");

  $: hasIcon = !!icon || $$slots.icon;

  onMount(() => submenuRegistry?.register(close) ?? (() => {}));

  function portalToBody(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function measureFlyoutWidth(): number {
    if (flyoutE?.offsetWidth) {
      return flyoutE.offsetWidth;
    }
    let menuEl = anchorE?.closest(".menu") as HTMLElement | null;
    if (menuEl?.offsetWidth) {
      return menuEl.offsetWidth;
    }
    return 220;
  }

  function positionFlyout() {
    if (!anchorE) {
      return;
    }
    let rect = anchorE.getBoundingClientRect();
    let width = measureFlyoutWidth();
    let maxH = Math.min(window.innerHeight * 0.5, 360);
    flyoutTop = Math.min(Math.max(8, rect.top), window.innerHeight - maxH - 8);

    opensLeft = rect.right + width - FLYOUT_OVERLAP_PX > window.innerWidth - 8;
    if (opensLeft) {
      flyoutLeft = rect.left - width + FLYOUT_OVERLAP_PX;
    } else {
      flyoutLeft = rect.right - FLYOUT_OVERLAP_PX;
    }
    flyoutLeft = Math.max(8, Math.min(flyoutLeft, window.innerWidth - width - 8));
  }

  async function open() {
    clearCloseTimer();
    submenuRegistry?.closeOthers?.(close);
    positionFlyout();
    isOpen = true;
    await tick();
    positionFlyout();
  }

  function close() {
    clearCloseTimer();
    isOpen = false;
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      isOpen = false;
      closeTimer = null;
    }, 400);
  }

  function isMovingToPeer(related: EventTarget | null, peer: HTMLElement | null): boolean {
    if (!(related instanceof Node) || !peer) {
      return false;
    }
    return peer === related || peer.contains(related);
  }

  function onEnterTrigger() {
    open();
  }

  function onLeaveTrigger(event: MouseEvent) {
    if (isMovingToPeer(event.relatedTarget, flyoutE)) {
      return;
    }
    scheduleClose();
  }

  function onEnterFlyout() {
    clearCloseTimer();
  }

  function onLeaveFlyout(event: MouseEvent) {
    if (isMovingToPeer(event.relatedTarget, anchorE)) {
      return;
    }
    scheduleClose();
  }

  function onClickTrigger(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen) {
      close();
      return;
    }
    open();
  }

  function onDocPointerDown(event: PointerEvent) {
    if (!isOpen) {
      return;
    }
    let t = event.target;
    if (!(t instanceof Node)) {
      return;
    }
    if (anchorE?.contains(t) || flyoutE?.contains(t)) {
      return;
    }
    close();
  }

  function onDocKey(event: KeyboardEvent) {
    if (event.key == "Escape" && isOpen) {
      close();
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKey, true);
  }

  onDestroy(() => {
    clearCloseTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKey, true);
    }
  });
</script>

<style>
  .submenu-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    padding: 7px 14px;
    border: none;
    background-color: transparent;
    color: inherit;
    text-align: start;
    cursor: default;
  }
  .submenu-item:hover,
  .submenu-item.open {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .icon {
    justify-content: center;
    align-items: center;
  }
  .gap {
    width: 8px;
  }
  .label {
    white-space: nowrap;
  }
  .chevron {
    margin-inline-start: 12px;
    opacity: 0.55;
    flex-shrink: 0;
    align-items: center;
  }
  .submenu-flyout {
    position: fixed;
    z-index: 10001;
    min-width: 12em;
    max-width: min(20em, 90vw);
    max-height: min(50vh, 360px);
    background-color: var(--main-bg, #FFFFFF);
    color: var(--main-fg, var(--fg));
    border-radius: 8px;
    box-shadow:
      0 0 0 1px rgba(var(--shadow-color), 0.08),
      0 12px 28px rgba(var(--shadow-color), 0.22);
    padding: 4px 0;
    pointer-events: auto;
    overflow: visible;
  }
  /* Invisible bridge so the pointer can reach the flyout without closing the menu. */
  .submenu-flyout.opens-left::after,
  .submenu-flyout.opens-right::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 14px;
  }
  .submenu-flyout.opens-left::after {
    inset-inline-end: -14px;
  }
  .submenu-flyout.opens-right::before {
    inset-inline-start: -14px;
  }
  .submenu-scroll {
    max-height: min(50vh, 360px);
    overflow-y: auto;
    border-radius: inherit;
  }
</style>
