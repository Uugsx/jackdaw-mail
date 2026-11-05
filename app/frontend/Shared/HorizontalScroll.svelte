<div class="h-scroll {className}" class:edge-buttons={edgeButtons}
  class:overflowing={overflows} bind:this={rootEl}>
  {#if edgeButtons && overflows}
    <button type="button" class="h-scroll-edge h-scroll-edge-start" title={$t`Scroll left`}
      disabled={!canScrollLeft}
      on:click={() => scrollByAmount(-scrollStep)}>
      ‹
    </button>
  {/if}
  <div class="h-scroll-viewport" bind:this={viewportEl} on:scroll={updateScrollMetrics}
    on:wheel|nonpassive={onWheel}>
    <div class="h-scroll-content" bind:this={contentEl}>
      <slot />
    </div>
  </div>
  {#if edgeButtons && overflows}
    <button type="button" class="h-scroll-edge h-scroll-edge-end" title={$t`Scroll right`}
      disabled={!canScrollRight}
      on:click={() => scrollByAmount(scrollStep)}>
      ›
    </button>
  {/if}
  {#if !edgeButtons && overflows}
    <div class="h-scroll-rail" aria-hidden="true">
      <button type="button" class="h-scroll-btn" title={$t`Scroll left`}
        disabled={!canScrollLeft}
        on:click={() => scrollByAmount(-scrollStep)}>
        ‹
      </button>
      <div class="h-scroll-track" bind:this={trackEl}
        on:pointerdown|stopPropagation={onTrackPointerDown}>
        <div class="h-scroll-thumb"
          style="width: {thumbWidthPct}%; left: {thumbLeftPct}%" />
      </div>
      <button type="button" class="h-scroll-btn" title={$t`Scroll right`}
        disabled={!canScrollRight}
        on:click={() => scrollByAmount(scrollStep)}>
        ›
      </button>
    </div>
  {/if}
</div>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { t } from "../../l10n/l10n";

  /** Outlook-style ‹ › flanking the content; otherwise a track row below. */
  export let edgeButtons = false;
  export let className = "";

  let rootEl: HTMLDivElement;
  let viewportEl: HTMLDivElement;
  let contentEl: HTMLDivElement;
  let trackEl: HTMLDivElement;

  let overflows = false;
  let canScrollLeft = false;
  let canScrollRight = false;
  let thumbWidthPct = 100;
  let thumbLeftPct = 0;

  const scrollStep = 160;
  let resizeObserver: ResizeObserver | null = null;
  let trackDrag: { startX: number; startScrollLeft: number } | null = null;
  let observerAttached = false;

  $: viewportEl, contentEl, attachResizeObserver();

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    observerAttached = false;
    stopTrackDrag();
  });

  export function refresh() {
    updateScrollMetrics();
  }

  function attachResizeObserver() {
    if (!viewportEl || !contentEl || observerAttached) {
      return;
    }
    observerAttached = true;
    resizeObserver = new ResizeObserver(() => {
      updateScrollMetrics();
    });
    resizeObserver.observe(viewportEl);
    resizeObserver.observe(contentEl);
    tick().then(updateScrollMetrics);
  }

  function updateScrollMetrics() {
    if (!viewportEl || !contentEl) {
      return;
    }
    let maxScroll = Math.max(0, viewportEl.scrollWidth - viewportEl.clientWidth);
    overflows = maxScroll > 1;
    canScrollLeft = viewportEl.scrollLeft > 1;
    canScrollRight = viewportEl.scrollLeft < maxScroll - 1;
    if (!overflows || maxScroll <= 0) {
      thumbWidthPct = 100;
      thumbLeftPct = 0;
      return;
    }
    thumbWidthPct = Math.max(12, (viewportEl.clientWidth / viewportEl.scrollWidth) * 100);
    let scrollRatio = viewportEl.scrollLeft / maxScroll;
    thumbLeftPct = scrollRatio * (100 - thumbWidthPct);
  }

  function scrollByAmount(delta: number) {
    if (!viewportEl) {
      return;
    }
    viewportEl.scrollBy({ left: delta, behavior: "smooth" });
  }

  /** Колесо мыши (вертикальное) прокручивает по горизонтали; трекпадный deltaX работает нативно. */
  function onWheel(event: WheelEvent) {
    if (!viewportEl || !overflows || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }
    let delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    let maxScroll = viewportEl.scrollWidth - viewportEl.clientWidth;
    let target = viewportEl.scrollLeft + delta;
    if ((delta < 0 && viewportEl.scrollLeft <= 0) || (delta > 0 && viewportEl.scrollLeft >= maxScroll)) {
      return;
    }
    event.preventDefault();
    viewportEl.scrollLeft = Math.max(0, Math.min(maxScroll, target));
  }

  function onTrackPointerDown(event: PointerEvent) {
    if (!viewportEl || !trackEl || event.button !== 0) {
      return;
    }
    let target = event.target as HTMLElement;
    if (target.classList.contains("h-scroll-thumb")) {
      trackDrag = { startX: event.clientX, startScrollLeft: viewportEl.scrollLeft };
      trackEl.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", onTrackPointerMove);
      window.addEventListener("pointerup", onTrackPointerUp);
      window.addEventListener("pointercancel", onTrackPointerUp);
      return;
    }
    let rect = trackEl.getBoundingClientRect();
    let ratio = (event.clientX - rect.left) / rect.width;
    let maxScroll = viewportEl.scrollWidth - viewportEl.clientWidth;
    viewportEl.scrollLeft = ratio * maxScroll;
    updateScrollMetrics();
  }

  function onTrackPointerMove(event: PointerEvent) {
    if (!trackDrag || !viewportEl || !trackEl) {
      return;
    }
    let rect = trackEl.getBoundingClientRect();
    let maxScroll = viewportEl.scrollWidth - viewportEl.clientWidth;
    let thumbTravel = rect.width * (1 - thumbWidthPct / 100);
    if (thumbTravel <= 0) {
      return;
    }
    let delta = event.clientX - trackDrag.startX;
    viewportEl.scrollLeft = Math.max(0, Math.min(maxScroll,
      trackDrag.startScrollLeft + delta / thumbTravel * maxScroll));
    updateScrollMetrics();
  }

  function onTrackPointerUp() {
    stopTrackDrag();
    updateScrollMetrics();
  }

  function stopTrackDrag() {
    trackDrag = null;
    window.removeEventListener("pointermove", onTrackPointerMove);
    window.removeEventListener("pointerup", onTrackPointerUp);
    window.removeEventListener("pointercancel", onTrackPointerUp);
  }
</script>

<style>
  .h-scroll {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  .h-scroll.edge-buttons {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: stretch;
  }
  .h-scroll.edge-buttons:not(:has(.h-scroll-edge)) {
    grid-template-columns: 1fr;
  }
  .h-scroll-viewport {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
    min-width: 0;
    scrollbar-width: none;
  }
  .h-scroll-viewport::-webkit-scrollbar {
    display: none;
  }
  .h-scroll-content {
    display: inline-flex;
    min-width: 100%;
    width: max-content;
    box-sizing: border-box;
  }
  .h-scroll.content-fit .h-scroll-content {
    min-width: 0;
  }
  .h-scroll-content > :global(*) {
    flex-shrink: 0;
  }
  .h-scroll-edge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    min-width: 22px;
    margin-block: 2px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg, var(--main-bg, var(--bg)));
    color: color-mix(in srgb, var(--main-fg, var(--fg)) 78%, transparent);
    font-size: 16px;
    line-height: 1;
    cursor: default;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .h-scroll-edge-start {
    margin-inline: 4px 2px;
  }
  .h-scroll-edge-end {
    margin-inline: 2px 4px;
  }
  .h-scroll-edge:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .h-scroll-edge:disabled {
    opacity: 0.35;
  }
  .h-scroll-rail {
    display: grid;
    grid-template-columns: 24px 1fr 24px;
    align-items: center;
    gap: 4px;
    padding: 2px 6px 4px;
    border-block-start: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: color-mix(in srgb, var(--main-fg) 4%, var(--main-bg, var(--bg)));
    flex-shrink: 0;
  }
  .h-scroll-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg, var(--main-bg));
    color: color-mix(in srgb, var(--main-fg) 78%, transparent);
    font-size: 14px;
    line-height: 1;
    cursor: default;
    -webkit-app-region: no-drag;
  }
  .h-scroll-btn:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--hover-fg);
  }
  .h-scroll-btn:disabled {
    opacity: 0.35;
  }
  .h-scroll-track {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--main-fg) 12%, var(--main-bg, var(--bg)));
    cursor: default;
    -webkit-app-region: no-drag;
  }
  .h-scroll-thumb {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 4px;
    background: color-mix(in srgb, var(--main-fg) 42%, transparent);
  }
  .h-scroll-thumb:hover {
    background: color-mix(in srgb, var(--main-fg) 58%, transparent);
  }
</style>
