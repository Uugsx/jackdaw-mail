<!-- Editable quoted thread — controlled text input preserves the original HTML; not TipTap. -->
<div
  bind:this={rootEl}
  class="compose-quote-html"
  contenteditable="true"
  spellcheck={false}
  tabindex={0}
  role="textbox"
  aria-multiline="true"
  use:quoteEditable={{ html, onChange }}
  on:beforeinput={onBeforeInput}
  on:click={onClick}
  on:dblclick={onDoubleClick}
  on:touchend={onTouchEnd}
  on:keydown={onKeyDown}
/>

<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { openMailImageFromElement } from "../Message/openMailImage";
  import { catchErrors, showUserError } from "../../Util/error";
  import {
    applyQuoteCommand,
    captureQuoteSelection,
    type QuoteEditorCommand,
  } from "./quoteEditorCommands";
  import { applyQuoteTextInput } from "./quoteEditorInput";

  /** Sanitized HTML (original message body or forward quote). */
  export let html: string;

  let rootEl: HTMLDivElement;

  const dispatch = createEventDispatcher<{ change: string }>();
  const kImageDoubleClickDelay = 220;

  function onChange(bodyHtml: string) {
    dispatch("change", bodyHtml);
  }

  function onBeforeInput(event: InputEvent) {
    if (event.defaultPrevented || !rootEl || !applyQuoteTextInput(rootEl, event)) {
      return;
    }
    event.preventDefault();
    rootEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Return the native selection when it belongs to the quoted message. */
  export function captureSelection(): Range | null {
    return rootEl ? captureQuoteSelection(rootEl) : null;
  }

  /** Apply formatting in the quote without moving the caret to the reply area. */
  export function applyCommand(
    command: QuoteEditorCommand,
    value?: string | null,
    range?: Range | null,
  ): boolean {
    return rootEl ? applyQuoteCommand(rootEl, command, value, range) : false;
  }

  function openImage(img: HTMLImageElement) {
    catchErrors(async () => {
      try {
        await openMailImageFromElement(img);
      } catch (ex) {
        showUserError(ex);
      }
    });
  }

  function onDoubleClick(event: MouseEvent) {
    let img = (event.target as Element | null)?.closest("img");
    if (!img || !(img instanceof HTMLImageElement)) {
      return;
    }
    event.preventDefault();
    clearPendingImageClick();
    openImage(img);
  }

  let pendingImageClick: ReturnType<typeof setTimeout> | null = null;
  function clearPendingImageClick() {
    if (pendingImageClick) {
      clearTimeout(pendingImageClick);
      pendingImageClick = null;
    }
  }

  function onClick(event: MouseEvent) {
    if (event.detail != 1) {
      return;
    }
    let img = (event.target as Element | null)?.closest("img");
    if (!img || !(img instanceof HTMLImageElement)) {
      return;
    }
    event.preventDefault();
    clearPendingImageClick();
    pendingImageClick = setTimeout(() => {
      pendingImageClick = null;
      openImage(img);
    }, kImageDoubleClickDelay);
  }

  onDestroy(clearPendingImageClick);

  let lastTouchEnd = 0;
  function onTouchEnd(event: TouchEvent) {
    let touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    let now = Date.now();
    if (now - lastTouchEnd > 350) {
      lastTouchEnd = now;
      return;
    }
    lastTouchEnd = 0;
    let img = (document.elementFromPoint(touch.clientX, touch.clientY) as Element | null)?.closest("img");
    if (!img || !(img instanceof HTMLImageElement)) {
      return;
    }
    event.preventDefault();
    openImage(img);
  }

  /** Keep Tab in the quote; do not focus-trap the compose window. */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Tab") {
      event.stopPropagation();
    }
  }

  type QuoteEditableParams = {
    html: string;
    onChange: (html: string) => void;
  };

  function quoteEditable(node: HTMLElement, params: QuoteEditableParams) {
    let lastHtml = "";
    let syncing = false;

    function setHtml(nextHtml: string) {
      syncing = true;
      node.innerHTML = nextHtml;
      lastHtml = nextHtml;
      syncing = false;
    }

    function onInput() {
      if (syncing) {
        return;
      }
      lastHtml = node.innerHTML;
      params.onChange(lastHtml);
    }

    function update(next: QuoteEditableParams) {
      params = next;
      if (next.html !== lastHtml && !node.contains(document.activeElement)) {
        setHtml(next.html);
      }
    }

    setHtml(params.html);
    node.addEventListener("input", onInput);

    return {
      update,
      destroy() {
        node.removeEventListener("input", onInput);
      },
    };
  }
</script>

<style>
  .compose-quote-html {
    margin: 0;
    padding: 16px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
    overflow-x: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-family:
      -apple-system, BlinkMacSystemFont,
      "Segoe UI", system-ui,
      "Helvetica Neue", Helvetica, Arial, sans-serif;
    line-height: 1.45;
    font-size: 16px;
    font-weight: 400;
    color: inherit;
    font-synthesis: none;
    text-rendering: auto;
    -webkit-font-smoothing: auto;
    -moz-osx-font-smoothing: auto;
    -webkit-text-size-adjust: 100%;
    user-select: text;
    cursor: text;
  }
  .compose-quote-html:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 2px;
    border-radius: 4px;
  }
  .compose-quote-html :global(table) {
    border-collapse: collapse;
  }
  .compose-quote-html :global(td),
  .compose-quote-html :global(th) {
    vertical-align: top;
  }
  .compose-quote-html :global(hr) {
    border: none;
    border-top: 1px solid currentColor;
    margin: 8px 0;
    width: 100%;
    height: 0;
  }
  .compose-quote-html :global(a) {
    color: #0563c1;
    text-decoration: underline;
  }
  .compose-quote-html :global(blockquote) {
    border-inline-start: 3px solid #0078d4;
    padding-inline-start: 20px;
    margin-inline-start: 0;
  }
  .compose-quote-html :global(img) {
    max-width: 100%;
    height: auto;
    cursor: zoom-in;
  }
  .compose-quote-html :global(img[src=""]) {
    visibility: hidden;
    max-height: 0;
  }
  .compose-quote-html :global(img[src=""][data-jackdaw-image-src]) {
    visibility: visible;
    display: inline-block;
    min-width: 24px;
    min-height: 24px;
    max-height: none;
    border: 1px dashed var(--button-border, currentColor);
    background: var(--input-bg, transparent);
  }
  .compose-quote-html :global(footer.signature),
  .compose-quote-html :global(.signature) {
    margin-block-start: 1em;
  }
  .compose-quote-html :global(footer.signature) {
    line-height: 1;
  }
  .compose-quote-html :global(footer.signature p),
  .compose-quote-html :global(.signature p) {
    margin-block: 0;
  }
</style>
