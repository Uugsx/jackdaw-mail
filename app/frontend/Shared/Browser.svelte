{#if withURLbar}
  <hbox class="toolbar">
    <slot name="urlbar-left" />
    <hbox class="urlbar" flex>
      {getDomain(currentURL)}
    </hbox>
    <hbox class="buttons right">
      <hbox class="loading">
        {#if isLoading}
          <Loader />
        {/if}
      </hbox>
      <RoundButton
        label={$t`Close`}
        icon={CloseIcon}
        onClick={onClose}
        classes="small"
        />
    </hbox>
  </hbox>
{/if}

<vbox class="page">
// #if [!WEBMAIL && !MOBILE]
  <webview bind:this={webviewE} src={url} {title} {partition} />
// #else
  <iframe bind:this={webviewE} src={url} {title} sandbox="allow-scripts allow-forms" />
// #endif
  {#if loadError}
    <!-- Без этого при недоступном сервере остаётся пустая белая страница -->
    <vbox class="load-error" role="alert">
      <div class="load-error-title">{$t`The page could not be opened.`}</div>
      <div>{loadError.message}</div>
      {#if loadError.hint}
        <div class="load-error-hint">{loadError.hint}</div>
      {/if}
      <hbox class="load-error-buttons">
        <Button label={$t`Try again`} onClick={onRetry} />
      </hbox>
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import RoundButton from './RoundButton.svelte';
  import Button from './Button.svelte';
  import { describeError, type FriendlyError } from '../../logic/util/friendlyError';
  import Loader from './Loader.svelte';
  import CloseIcon from "lucide-svelte/icons/x";
  import { getBaseDomainFromHost } from '../../logic/util/netUtil';
  import type { URLString } from '../../logic/util/util';
  import { t } from '../../l10n/l10n';
  const dispatch = createEventDispatcher();

  /**
   * Displays untrusted HTML in a sandboxed iframe which does not allow any JavaScript.
   */

  /** The start webpage to show. */
  export let url: URLString = "";
  /** Tooltip when hovering */
  export let title: string;
  /** The cookie storage. For `<webview partition="persist:...">` */
  export let sessionID: string;
  export let withURLbar = true;
  export let autofill: string;

  $: partition = sessionID ? "persist:" + sessionID : undefined;

  function getDomain(url: URLString) {
    if (!url) {
      return "";
    }
    return getBaseDomainFromHost(new URL(url).hostname);
  }

  /** Chromium `net::ERR_ABORTED`: загрузку прервал переход на другую страницу. */
  const kAbortedErrorCode = -3;

  let isLoading = true;
  /** Страница не загрузилась: сервер не ответил, не найден и т.п. */
  let loadError: FriendlyError | null = null;
  let currentURL: URLString = url;

  let webviewE: HTMLIFrameElement = null;
  $: webviewE && haveWebView();
  function notifyPageChange(url: URLString) {
    if (!url) {
      return;
    }
    currentURL = url;
    dispatch("page-change", url);
  }
  function haveWebView () {
    // OAuth redirects (e.g. Google → localhost/login-success) fire did-navigate,
    // not dom-ready — without this the embedded login never completes.
    webviewE.addEventListener("did-navigate", (e: any) => {
      notifyPageChange(e.url);
    });
    webviewE.addEventListener("did-navigate-in-page", (e: any) => {
      if (e.isMainFrame !== false) {
        notifyPageChange(e.url);
      }
    });
    webviewE.addEventListener("will-navigate", (e: any) => {
      notifyPageChange(e.url);
    });
    webviewE.addEventListener("dom-ready", () => {
      let url = (webviewE as any).getURL?.() ?? webviewE.src;
      notifyPageChange(url);
    });
    webviewE.addEventListener("did-start-loading", () => {
      isLoading = true;
      loadError = null;
    });
    webviewE.addEventListener("did-fail-load", (e: any) => {
      // Прерванная загрузка (переход по редиректу) — не ошибка; сбой картинки или фрейма страницу не ломает
      if (e.isMainFrame === false || e.errorCode == kAbortedErrorCode) {
        return;
      }
      loadError = describeError(new Error(`net::${e.errorDescription} (${e.errorCode}) ${e.validatedURL ?? ""}`.trim()));
      isLoading = false;
    });
    webviewE.addEventListener("did-stop-loading", () => {
      isLoading = false;
      if (autofill) {
        webviewE.executeJavaScript(autofill);
      }
    });
  }

  function onRetry() {
    loadError = null;
    (webviewE as any).reload?.();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .page {
    flex: 1 0 0;
    position: relative;
  }
  webview,
  iframe {
    flex: 1 0 0;
  }
  .load-error {
    position: absolute;
    inset: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    background-color: var(--bg);
    color: var(--fg);
  }
  .load-error-title {
    font-weight: 600;
    font-size: 1.15em;
  }
  .load-error-hint {
    max-width: 480px;
    opacity: 0.8;
  }
  .load-error-buttons {
    margin-block-start: 8px;
  }
  .toolbar {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    border-bottom: 1px solid var(--border);
    align-items: center;
    padding: 2px 12px;
  }
  .urlbar {
    justify-content: center;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-overflow: ellipsis;
    height: 24px;
    padding: 2px 12px;
  }
  .buttons {
    align-items: center;
    justify-content: center;
    margin: 2px;
  }
  .buttons :global(> *) {
    margin-inline-start: 6px;
  }
  .loading {
    width: 24px;
  }
</style>
