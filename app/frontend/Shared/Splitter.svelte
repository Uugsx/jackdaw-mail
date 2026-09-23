{#if hasLeft && hasRight}
  <hbox class="splitter" bind:clientWidth={containerWidth}
    class:mobile={appGlobal.isMobile}>
    <hbox class="left" style="min-width: {leftMinWidth}px" bind:clientWidth={currentLeftWidth}>
      <ErrorBoundary>
        <slot name="left" />
      </ErrorBoundary>
    </hbox>
    <hbox class="splitter-bar"
      class:bar-hidden={hideBar}
      class:dragging={isMouseDown}
      on:pointerdown={onPointerDown}
      style="width: {barWidth}px;"
      />
    <hbox class="right" style={
      rightFixedWidth
      ? `flex: 0 0 ${rightFixedWidth}px; width: ${rightFixedWidth}px; min-width: ${rightFixedWidth}px; max-width: ${rightFixedWidth}px;`
      : `flex: ${rightRatio} 0 0; min-width: ${rightMinWidth}px;`
      }>
      <ErrorBoundary>
        <slot name="right" />
      </ErrorBoundary>
    </hbox>
  </hbox>
{:else if hasLeft}
  <ErrorBoundary>
    <slot name="left" />
  </ErrorBoundary>
{:else if hasRight}
  <ErrorBoundary>
    <slot name="right" />
  </ErrorBoundary>
{:else}
  <vbox class="splitter" />
{/if}

<svelte:window
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  />

<script lang="ts">
	import { appGlobal } from "../../logic/app";
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";
  import ErrorBoundary from "./ErrorBoundary.svelte";

  /** Left pane cannot be made smaller than this
   * in px */
  export let leftMinWidth = 30;
  /** Right pane cannot be made smaller than this
   * in px */
  export let rightMinWidth = 30;
  /** Initial size of right pane compared to left pane */
  export let initialRightRatio = 1;
  /** If false, will hide the left part and remove the splitter */
  export let hasLeft = true;
  /** If false, will hide the right part and remove the splitter */
  export let hasRight = true;
  /** Override right width
   * Make the right bar exactly this width, not changable
   * null = normal mode */
  export let rightFixedWidth: number | null = null;
  /** If set, will save the ratio in localStorage as preference and restore it */
  export let name: string = null;
  /** Called after the user finishes dragging the splitter bar. */
  export let onResize: (() => void) | null = null;
  /** Keep the splitter draggable while removing its visual divider. */
  export let hideBar = false;

	const barWidth = appGlobal.isMobile ? 6 : 2;
  let rightRatio = JSON.parse(sanitize.nonemptystring(localStorage?.getItem("ui.splitter." + name), null)) ?? initialRightRatio;

  let isMouseDown = false;
  let activePointerId: number | null = null;
  let captureEl: HTMLElement | null = null;
  let previousMousePosX: number;
  let mouseMoveX: number;
  let containerWidth: number;
  let currentLeftWidth: number;
  let previousLeftWidth: number;

  function onPointerMove(event: PointerEvent) {
    if (!isMouseDown || activePointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    let availableWidth = containerWidth - barWidth;
    mouseMoveX = previousMousePosX - event.clientX;
    let newLeftWidth = Math.max(
      Math.min(
        previousLeftWidth - mouseMoveX,
        availableWidth - rightMinWidth),
      leftMinWidth);
    let newRightWidth = availableWidth - newLeftWidth;
    let right = newRightWidth / availableWidth;
    let left = newLeftWidth / availableWidth;
    // const leftRatio = 1, so that we have to save only 1 value
    rightRatio = right / left;

    if (name) {
      localStorage.setItem("ui.splitter." + name, JSON.stringify(rightRatio));
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (rightFixedWidth || event.button !== 0) {
      return;
    }
    event.preventDefault();
    previousLeftWidth = currentLeftWidth;
    previousMousePosX = event.clientX;
    isMouseDown = true;
    activePointerId = event.pointerId;
    document.body.classList.add("splitter-dragging");
    captureEl = event.currentTarget as HTMLElement;
    captureEl.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: PointerEvent) {
    if (!isMouseDown) {
      return;
    }
    if (activePointerId !== null && event.pointerId !== activePointerId) {
      return;
    }
    isMouseDown = false;
    activePointerId = null;
    document.body.classList.remove("splitter-dragging");
    if (captureEl?.hasPointerCapture?.(event.pointerId)) {
      captureEl.releasePointerCapture(event.pointerId);
    }
    captureEl = null;
    if (name) {
      onResize?.();
    }
  }

  /** Copied to <SplitterHorizontal> */
</script>

<style>
  .splitter {
    height: 100%;
    flex: 1 0 0;
    min-width: 0;
    min-height: 0;
  }

  .splitter-bar {
    cursor: col-resize;
    touch-action: none;
    z-index: 10;
    /*background: linear-gradient(
      to bottom,
      transparent 48%,
      var(--border) 48%,
      var(--border) 52%,
      transparent 52%
    );*/
  }
	.mobile .splitter-bar {
		background-color: var(--headerbar-bg);
	}
  .splitter-bar:hover {
    background-color: var(--hover-bg);
  }
  .splitter-bar.bar-hidden,
  .splitter-bar.bar-hidden:hover {
    background-color: transparent !important;
  }

  .left {
    flex: 1 0 0; /* by definition, see leftRatio above */
    min-width: 0;
    overflow: hidden;
  }

  .right {
    min-width: 0;
    overflow: hidden;
  }

  .left :global(> *:first-child),
  .right :global(> *:first-child) {
    flex: 1 0 0;
    min-width: 0;
    min-height: 0;
  }

  /*
  .left,
  .right {
    overflow: auto; TODO breaks popups
  }*/

  :global(body.splitter-dragging) {
    user-select: none;
    cursor: col-resize;
  }
  :global(body.splitter-dragging iframe),
  :global(body.splitter-dragging webview) {
    pointer-events: none;
  }
</style>
