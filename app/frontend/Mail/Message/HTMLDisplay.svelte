<vbox class="html-display" bind:this={displayE}>
  <WebView html={displayHtml} {headHTML} {bodyClass} title="" allowServerCalls={allowExternalImages} {allowImageOpen} autoSize={fitContent} enableZoomWheel forwardKeysToMail contentZoom={zoom} on:webview on:zoomwheel />
</vbox>

<script lang="ts">
  import cssContent from "./content.css?inline";
  import cssBody from "./content-body.css?inline";
  import cssBodyDark from "./content-body-dark.css?inline";
  import cssBodyEmbed from "./content-body-embed.css?inline";
  import { adaptEmailHtmlForDarkMode } from "./emailDarkMode";
  import WebView from "../../Shared/WebView.svelte";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import {
    getMessageViewerBackgroundSetting,
    normalizeMessageViewerBackground,
  } from "./messageViewerAppearance";
  import type { MessageViewerBackground } from "./messageViewerAppearance";
  import { onMount } from "svelte";

  /** DANGER Attention: You must sanitize the HTML. It comes from untrusted sources.
   * @see also Chat Message.svelte */
  export let html: string;
  export let allowExternalImages = false;
  /** Size iframe to quoted content (compose reply history). */
  export let fitContent = false;
  /** Одиночный клик или контекстное меню: открыть встроенную картинку */
  export let allowImageOpen = false;
  export let zoom = 100;
  /** out only */
  export let webviewE: HTMLIFrameElement = null;

  let themeSetting = getLocalStorage("appearance.theme", "system");
  let colorsSetting = getLocalStorage("appearance.colors", {});
  let messageBackgroundSetting = getMessageViewerBackgroundSetting();
  let displayE: HTMLElement;
  let displayReady = false;
  const cssScrollableMessage = `
    html {
      width: 100% !important;
      max-width: 100% !important;
      overflow-x: hidden !important;
    }
    body {
      width: 100% !important;
      max-width: 100% !important;
      overflow-x: hidden !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    pre,
    code {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
  `;

  onMount(() => {
    displayReady = true;
  });

  function resolveDarkTheme(theme: string): boolean {
    if (theme == "dark") {
      return true;
    }
    if (theme == "light") {
      return false;
    }
    return typeof window != "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  $: messageBackground = normalizeMessageViewerBackground($messageBackgroundSetting.value);
  $: darkEmail = messageBackground == "dark" ||
    (messageBackground == "theme" && resolveDarkTheme($themeSetting.value));
  $: bodyClass = `jackdaw-email-${darkEmail ? "dark" : "light"} jackdaw-email-background-${messageBackground}`;
  $: displayHtml = darkEmail ? adaptEmailHtmlForDarkMode(html) : html;
  $: displayColors = readDisplayColors(messageBackground, darkEmail, displayReady, $colorsSetting.value);
  $: headHTML = `<style>\n${cssBody}\n${fitContent ? cssBodyEmbed + "\n" : ""}${cssContent}\n${cssBodyDark}\n${cssScrollableMessage}\n${displayColorsCSS(messageBackground, darkEmail, displayColors)}\n</style>`;

  function readDisplayColors(
    backgroundMode: MessageViewerBackground,
    isDark: boolean,
    ready: boolean,
    _colors: unknown,
  ): { background: string; foreground: string } {
    if (backgroundMode == "white") {
      return { background: "#ffffff", foreground: "#111827" };
    }
    if (backgroundMode == "dark") {
      return { background: "#1a1a1c", foreground: "#e5e7eb" };
    }
    if (ready && displayE && typeof getComputedStyle == "function") {
      let styles = getComputedStyle(displayE);
      return {
        background: styles.backgroundColor || "#ffffff",
        foreground: styles.color || "#111827",
      };
    }
    return isDark
      ? { background: "#1a1a1c", foreground: "#e5e7eb" }
      : { background: "#ffffff", foreground: "#111827" };
  }

  function displayColorsCSS(
    backgroundMode: MessageViewerBackground,
    isDark: boolean,
    colors: { background: string; foreground: string },
  ): string {
    let background = backgroundMode == "theme" ? "transparent" : colors.background;
    return `
      html, body {
        background-color: ${background} !important;
        color: ${colors.foreground};
      }
      body.jackdaw-email-background-white {
        color-scheme: light;
      }
      body.jackdaw-email-background-theme {
        color-scheme: ${isDark ? "dark" : "light"};
      }
      body.jackdaw-email-background-dark {
        color-scheme: dark;
      }
    `;
  }
</script>

<style>
  .html-display {
    flex: 1 1 0;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    background-color: var(--message-viewer-bg, var(--main-bg));
    color: var(--message-viewer-fg, var(--main-fg));
  }
  .html-display :global(webview),
  .html-display :global(iframe) {
    background-color: var(--message-viewer-bg, var(--main-bg));
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }
</style>
