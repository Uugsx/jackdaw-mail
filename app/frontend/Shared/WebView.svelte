// #if [!WEBMAIL && !MOBILE]
<webview bind:this={webviewE} src={url ?? blobURL} {title} class:hidden class:autosize={autoSize} {partition} useragent={userAgent || undefined} allowpopups={!containNavigation} />
// #else
<!-- TODO Security: Test that this <webview> is untrusted and jailed -->
<iframe bind:this={webviewE} src={url ?? blobURL} {title} class:hidden class:autosize={autoSize} />
// #endif

<!--
{#if contextMenuItems && contextMenuItems.hasItems}
  <Menu opened={true} position="bottom" placement="end" on:close={() => contextMenuItems = null}>
    {#each contextMenuItems.each as menuItem}
      <Menu.Item
        on:click={() => catchErrors(() =>menuItem.action)}
        title={menuItem.label}
        icon={menuItem.icon}>
        {menuItem.label}
      </Menu.Item>
    {/each}
  </Menu>
{/if}
-->

<script lang="ts">
  // #if [!WEBMAIL]
  import { buildContextMenu, MenuItem, type ContextInfo } from "./ContextMenu";
  import { newElectronKeyboardEvent, onKeyOnMessage } from "../Mail/Message/MessageKeyboard";
  import { isMailPaneFocused } from "../MainWindow/paneFocus";
  import { appGlobal } from "../../logic/app";
  // import { Menu } from "@svelteuidev/core";
  // #endif
  import { stringToBlobURL } from "../Util/util";
  import type { URLString } from "../../logic/util/util";
  import { backgroundError, catchErrors, showError } from "../Util/error";
  import type { ArrayColl } from "svelte-collections";
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import {
    messageZoomFactor,
    messageZoomReflowCss,
  } from "../Mail/Message/messageZoom";
  const dispatch = createEventDispatcher();

  /**
   * Displays untrusted HTML in a sandboxed iframe which does not allow any JavaScript.
   */

  /** The HTML to display.
   * DANGER Attention: The HTML should already be sanitized using `sanitizeHTML()`
   * Alternative to `url` - set only one of them. */
  export let html: string | null = null;
  /** Insert this into the `<head>` section of the HTML, before display.
   * Optional */
  export let headHTML = "";
  /** Optional class on `<body>` for theme-specific email rendering */
  export let bodyClass = "";
  /** The webpage to show.
   * Alternative to `html` - set only one of them. */
  export let url: string | null = null;
  /** Tooltip when hovering */
  export let title: string;
  /** Size the <WebView> to the size of the content */
  export let autoSize = false;
  export let hidden = false;
  /** The cookie storage. For `<webview partition="persist:...">` */
  export let sessionID: string | null = null;
  /** Keep link clicks and pop-ups inside this webview (widget panel, web apps). */
  export let containNavigation = false;
  /** Override guest user agent; empty = Chromium default */
  export let userAgent: string | null = null;

  /**
   * Which HTTP servers may be called automatically during the HTML load,
   * e.g. for images, stylesheets etc.?
   * true (default) = `*` any HTTP server on any domain
   * false = `none` = No outgoing calls at all
   * `https://proxy.example.com` = Only allow calls to "https://proxy.example.com/*"
   *
   * This does *not* limit user clicks on links like `<a href="https://...">`.
   */
  export let allowServerCalls: boolean | string = true;
  /** Одиночный клик или контекстное меню: открыть встроенную картинку в ОС */
  export let allowImageOpen = false;
  /** ⌘/Ctrl + scroll over email body adjusts zoom */
  export let enableZoomWheel = false;
  /** Forward keyboard shortcuts to the mail reader (not widget webviews). */
  export let forwardKeysToMail = false;
  /** Scale untrusted HTML content (percent, 100 = default). */
  export let contentZoom = 100;

  type GuestWebview = HTMLIFrameElement & {
    executeJavaScript: (code: string) => Promise<unknown>;
  };

  function executeGuestJavaScript<T = unknown>(code: string): Promise<T> {
    return (webviewE as unknown as GuestWebview).executeJavaScript(code) as Promise<T>;
  }

  $: partition = sessionID ? "persist:" + sessionID : undefined;

  /** Electron setZoomFactor requires dom-ready; iframe can zoom on load. */
  let guestDomReady = false;
  $: if (guestDomReady && webviewE) {
    applyGuestContentZoom(contentZoom);
  }

  onMount(() =>{
    if (autoSize) {
      observeMaxWidth();
    }
  });

  let blobURL: URLString;
  $: html, bodyClass, headHTML, allowServerCalls, catchErrors(setURL);
  async function setURL() {
    if (url) {
      return;
    }
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
    blobURL = "";
    const autoSizeCSS = `<style>
      html, body {
        min-height: 0 !important;
        max-height: none !important;
        height: auto !important;
        overflow: visible !important;
      }
      body {
        min-width: 100px !important;
        width: auto !important;
      }
    </style>`;
    let servers = allowServerCalls ? `* 'unsafe-inline'` : `'unsafe-inline'` ;
    const head = `<meta http-equiv="Content-Security-Policy" content="default-src 'none';
      style-src ${servers}; img-src data: blob: ${servers}">\n\n` + headHTML + `\n\n`;
    let displayHTML = html ?? "";
    let headPos = displayHTML.indexOf("<head>");
    headPos = headPos < 0 ? 0 : headPos + 6;
    displayHTML =
      displayHTML.substring(0, headPos) +
      head +
      (autoSize ? autoSizeCSS: "") +
      displayHTML.substring(headPos);
    if (bodyClass) {
      displayHTML = displayHTML.replace(/<body(\s[^>]*)?>/i, (match, attrs = "") => {
        if (/\bclass\s*=/.test(attrs)) {
          return match.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_m, q, classes) =>
            `class=${q}${classes} ${bodyClass}${q}`);
        }
        return `<body class="${bodyClass}"${attrs}>`;
      });
    }
    // console.log("html", displayHTML);
    blobURL = stringToBlobURL("text/html", displayHTML);
    guestDomReady = false;
  }

  onDestroy(() => {
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
  });

  let webviewSetupToken = 0;
  let webviewE: HTMLIFrameElement = null;
  let boundWebview: HTMLIFrameElement = null;
  $: if (webviewE && webviewE !== boundWebview) {
    boundWebview = webviewE;
    guestDomReady = false;
    attachWebviewListeners(webviewE);
  }

  function attachWebviewListeners(el: HTMLIFrameElement) {
    // #if [!WEBMAIL]
    el.addEventListener("context-menu", event =>
      catchErrors(() => onContextMenu((event as any).params)));
    // #endif
    el.addEventListener("dom-ready", () => {
      guestDomReady = true;
      catchErrors(() => setupWebViewContents(++webviewSetupToken));
    });
    el.addEventListener("load", () => {
      guestDomReady = true;
    });
  }

  let listenersAttachedTo: HTMLIFrameElement = null;
  async function setupWebViewContents(setupToken: number) {
    if (!webviewE || setupToken !== webviewSetupToken) {
      return;
    }
    try {
      dispatch("webview", webviewE);
      // #if [!WEBMAIL]
      if (listenersAttachedTo !== webviewE) {
        listenersAttachedTo = webviewE;
        if (forwardKeysToMail) {
          await addInputListener();
        }
        if (containNavigation) {
          addContainedNavigationListeners();
        }
        if (allowImageOpen) {
          await addImageOpenListener();
        }
        if (containNavigation) {
          let id = (webviewE as any).getWebContentsId();
          appGlobal.remoteApp.containWebContentsNavigation(id);
        }
        if (!containNavigation) {
          await addLinkListener();
        }
      }
      if (enableZoomWheel) {
        let webview = webviewE as HTMLElement & { __jackdawZoomWheel?: boolean };
        webview.__jackdawZoomWheel = false;
        await addZoomWheelListener();
      }
      if (autoSize) {
        catchErrors(onLoadResize);
      }
      // #endif
    } catch (ex) {
      backgroundError(ex);
    }
  }

  // #if [!WEBMAIL]
  async function addInputListener() {
    if (!webviewE) {
      return;
    }
    let id = (webviewE as any).getWebContentsId();
    await appGlobal.remoteApp.addEventListenerWebContents(id, "input-event", (event) => {
      if (event.type == "mouseDown" && event.clickCount == 1) {
        webviewE.click();
      } else if (event.type == "rawKeyDown") {
        if (!isMailPaneFocused()) {
          return;
        }
        onKeyOnMessage(newElectronKeyboardEvent(event))
          .catch(showError);
      }
    });
  }

  async function addLinkListener() {
    if (!webviewE || containNavigation) {
      return;
    }
    await executeGuestJavaScript(`
      (() => {
        if (window.__jackdawExternalLinkListener) {
          return;
        }
        window.__jackdawExternalLinkListener = true;
        document.addEventListener("click", event => {
          const target = event.target;
          if (!(target instanceof Element) || target.closest("img")) {
            return;
          }
          const link = target.closest("a[href]");
          const url = link?.href || "";
          if (!/^(?:https?|mailto|tel):/i.test(url)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          window.open(url, "_blank", "noopener,noreferrer");
        }, true);
      })()
    `);
  }

  async function addImageOpenListener() {
    if (!webviewE) {
      return;
    }
    await executeGuestJavaScript(`
      (() => {
        if (window.__jackdawImageOpenListener) {
          return;
        }
        window.__jackdawImageOpenListener = true;
        document.addEventListener("click", event => {
          const target = event.target;
          if (target instanceof Element && target.closest("img")) {
            event.preventDefault();
          }
        }, true);
      })()
    `);
    let id = (webviewE as any).getWebContentsId();
    await appGlobal.remoteApp.addEventListenerWebContents(id, "input-event", async (event) => {
      if (event.type != "mouseDown" || event.button != "left" || event.clickCount != 1) {
        return;
      }
      let onImage = await executeGuestJavaScript(`
        (function () {
          const el = document.elementFromPoint(${event.x}, ${event.y});
          return !!(el && el.closest("img"));
        })()
      `);
      if (!onImage) {
        return;
      }
      const { openMailImageFromContext } = await import("../Mail/Message/openMailImage");
      await openMailImageFromContext(webviewE, event.x, event.y);
    });
  }

  function applyGuestContentZoom(zoom: number) {
    if (!webviewE) {
      return;
    }
    let factor = messageZoomFactor(zoom);
    let webview = webviewE as HTMLElement & { setZoomFactor?: (factor: number) => void };
    if (typeof webview.setZoomFactor == "function") {
      if (!guestDomReady) {
        return;
      }
      try {
        webview.setZoomFactor(factor);
      } catch (ex) {
        backgroundError(ex);
      }
      applyGuestZoomReflowStyles(factor, "text-wrap");
      return;
    }
    if (applyGuestZoomReflowStyles(factor, "css-zoom")) {
      webviewE.style.zoom = "";
      webviewE.style.width = "";
      return;
    }
    webviewE.style.zoom = factor == 1 ? "" : String(factor);
    webviewE.style.width = factor == 1 ? "" : `calc(100% / ${factor})`;
  }

  function applyGuestZoomReflowStyles(
    factor: number,
    mode: "css-zoom" | "text-wrap",
  ): boolean {
    try {
      let doc = webviewE.contentDocument;
      if (!doc?.documentElement) {
        return false;
      }
      let styleEl = doc.getElementById("jackdaw-message-zoom") as HTMLStyleElement | null;
      if (factor == 1) {
        styleEl?.remove();
        doc.documentElement.style.zoom = "";
        if (doc.body) {
          doc.body.style.width = "";
          doc.body.style.maxWidth = "";
          doc.body.style.zoom = "";
        }
        return true;
      }
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = "jackdaw-message-zoom";
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = messageZoomReflowCss(factor, mode);
      doc.documentElement.style.zoom = "";
      if (doc.body) {
        doc.body.style.zoom = "";
        doc.body.style.width = "";
        doc.body.style.maxWidth = "";
      }
      return true;
    } catch {
      // Electron <webview> has no contentDocument
      return false;
    }
  }

  async function addZoomWheelListener() {
    if (!webviewE) {
      return;
    }
    try {
      let doc = webviewE.contentDocument;
      if (doc) {
        attachDocumentZoomWheel(doc);
        return;
      }
    } catch {
      // Electron <webview> has no contentDocument
    }
    let webview = webviewE as unknown as HTMLElement & {
      addEventListener: (type: string, listener: (event: { message?: string }) => void) => void;
      executeJavaScript: (code: string) => Promise<unknown>;
      __zoomConsoleListener?: boolean;
      __jackdawZoomWheel?: boolean;
    };
    if (!webview.__zoomConsoleListener) {
      webview.__zoomConsoleListener = true;
      webview.addEventListener("console-message", (event: { message?: string }) => {
        let message = event.message ?? "";
        if (!message.startsWith("jackdaw-zoom:")) {
          return;
        }
        let direction = Number.parseInt(message.slice("jackdaw-zoom:".length), 10);
        if (direction == 1 || direction == -1) {
          dispatch("zoomwheel", { direction });
        }
      });
    }
    if (webview.__jackdawZoomWheel) {
      return;
    }
    webview.__jackdawZoomWheel = true;
    await webview.executeJavaScript(`
      (function () {
        if (window.__jackdawZoomWheel) {
          return;
        }
        window.__jackdawZoomWheel = true;
        document.addEventListener("wheel", function (event) {
          if (!(event.ctrlKey || event.metaKey)) {
            return;
          }
          event.preventDefault();
          console.log("jackdaw-zoom:" + (event.deltaY > 0 ? -1 : 1));
        }, { passive: false });
      })()
    `);
  }

  function attachDocumentZoomWheel(doc: Document) {
    let marked = doc as Document & { __jackdawZoomWheel?: boolean };
    if (marked.__jackdawZoomWheel) {
      return;
    }
    marked.__jackdawZoomWheel = true;
    doc.addEventListener("wheel", event => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      dispatch("zoomwheel", { direction: (event.deltaY > 0 ? -1 : 1) as 1 | -1 });
    }, { passive: false });
  }

  function addContainedNavigationListeners() {
    if (!webviewE) {
      return;
    }
    webviewE.addEventListener("new-window", (event: Event) => {
      let detail = event as CustomEvent & { url?: string; preventDefault?: () => void };
      let targetUrl = detail.url;
      if (!targetUrl?.startsWith("https://") && !targetUrl?.startsWith("http://")) {
        return;
      }
      detail.preventDefault?.();
      let webview = webviewE as HTMLElement & { loadURL?: (url: string) => void };
      if (webview.loadURL) {
        webview.loadURL(targetUrl);
      } else {
        webviewE.src = targetUrl;
      }
    });
  }

  let contextMenuItems: ArrayColl<MenuItem>;
  async function onContextMenu(contextInfo: ContextInfo) {
    contextMenuItems = await buildContextMenu(contextInfo, webviewE);
    console.log("Context menu items:", contextMenuItems.contents.map(i => i.id).join(", "), contextMenuItems.contents);
    let menuItems = contextMenuItems.contents.map(item => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      click: () => catchErrors(item.action),
    }));
    if (!menuItems.length) {
      return;
    }
    await appGlobal.remoteApp.openMenu(menuItems);
  }

  let size: { width: number; height: number };
  async function getContentSize() {
    try {
      size = await executeGuestJavaScript<{ width: number; height: number }>(`
        (function () {
          const body = document.body;
          const root = document.documentElement;
          const bodyStyles = window.getComputedStyle(body);
          const width = Math.max(
            root.scrollWidth,
            body.scrollWidth,
            body.offsetWidth,
            parseFloat(bodyStyles.width) || 0,
          );
          const height = Math.max(
            root.scrollHeight,
            root.offsetHeight,
            body.scrollHeight,
            body.offsetHeight,
            parseFloat(bodyStyles.height) || 0,
          );
          return { width, height };
        })()
      `);
    } catch (ex) {
      console.error(ex);
    }
  }

  async function waitForImagesAndResize() {
    try {
      await executeGuestJavaScript(`
        Promise.all(Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })))
      `);
    } catch {
    }
    await getContentSize();
    resizeWebview();
  }

  async function onLoadResize() {
    await waitForImagesAndResize();
    for (let delay of [250, 750, 1500, 3000]) {
      setTimeout(() => catchErrors(waitForImagesAndResize), delay);
    }
  }
  // #endif

  const heightBuffer = 32;
  let maxWidth: number;
  $: autoSize && size && resizeWebview();
  function resizeWebview() {
    if (!webviewE || !size) {
      return;
    }
    let parentWidth = webviewE.parentElement?.clientWidth ?? 0;
    if (size.width > parentWidth && (!maxWidth || size.width < maxWidth)) {
      webviewE.style.width = size.width + "px";
    } else if (maxWidth && maxWidth < size.width) {
      webviewE.style.width = maxWidth + "px";
    } else if (parentWidth && size.width < parentWidth) {
      webviewE.style.width = "100%";
    } else if (size.width > 0) {
      webviewE.style.width = size.width + "px";
    }
    webviewE.style.height = (size.height + heightBuffer) + "px";
  };

  function observeMaxWidth() {
    if (!webviewE?.parentElement) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const parent = parentWithMaxWidth(webviewE);
      const maxWidthVal = getComputedStyle(parent).maxWidth;
      if (maxWidthVal && maxWidthVal != "none") {
        if (maxWidthVal.endsWith("%")) {
          maxWidth = parent.clientWidth * (parseInt(maxWidthVal) / 100);
        } else {
          maxWidth = parseInt(maxWidthVal);
        }
      } else {
        maxWidth = webviewE.parentElement.clientWidth;
      }
      if (size) {
        resizeWebview();
      }
    });
    observer.observe(webviewE.parentElement);
  }

  function parentWithMaxWidth(el: HTMLElement) {
    while (el.parentElement &&
      getComputedStyle(el).maxWidth == "none") {
      el = el.parentElement;
    }
    return el;
  }
</script>

<style>
  webview, iframe {
    flex: 1 0 0;
    width: 100%;
    height: auto;
    min-width: 0;
    box-sizing: border-box;
    overflow-x: hidden;
  }
  webview.autosize, iframe.autosize {
    flex: 0 0 auto;
    overflow: hidden;
  }
  iframe {
    border: none;
  }
  .hidden {
    visibility: collapse;
  }
</style>
