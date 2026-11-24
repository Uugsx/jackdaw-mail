{#if selection && !popupOpen}
  <button class="selection-translate-button" style:left="{selection.x}px" style:top="{selection.y}px"
    title={$t`Translate selected text`} on:mousedown|preventDefault on:click={openPopup}>
    <LanguagesIcon size="16" />
    <span>{$t`Translate`}</span>
  </button>
{/if}
{#if selection && popupOpen}
  <vbox class="selection-translate-popup" style:left="{selection.x}px" style:top="{selection.y}px" on:mousedown|stopPropagation>
    <hbox class="head">
      <select value={target} on:change={event => changeTarget(event.currentTarget.value)} aria-label={$t`Translate into`}>
        {#each languages as language (language)}
          <option value={language}>{capitalizeLanguageName(translationLanguageName(language, getUILocale()), getUILocale())}</option>
        {/each}
      </select>
      <button class="close" aria-label={$t`Close`} on:click={close}><CloseIcon size="14" /></button>
    </hbox>
    <div class="result" class:error={!!error}>
      {#if loading}
        <LoaderIcon size="16" class="spin" /> {$t`Translating…`}
      {:else if error}
        {error}
      {:else}
        {result}
      {/if}
    </div>
    {#if result && !loading && !error}
      <button class="copy" on:click={copy}>{copied ? $t`Copied` : $t`Copy`}</button>
    {/if}
  </vbox>
{/if}

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import LanguagesIcon from "lucide-svelte/icons/languages";
  import LoaderIcon from "lucide-svelte/icons/loader-circle";
  import CloseIcon from "lucide-svelte/icons/x";
  import { getUILocale, t } from "../../../l10n/l10n";
  import {
    capitalizeLanguageName,
    translationLanguageName,
  } from "../../../logic/Mail/Translate/translationEngine";
  import {
    translateSelection,
    translationLanguages,
    translationTargetLanguage,
  } from "./messageTranslation";

  /** Окно письма (iframe), в котором выделяют текст */
  export let webview: HTMLIFrameElement | null = null;

  const kMaxChars = 5000;
  let selection: { x: number, y: number, text: string } | null = null;
  let popupOpen = false;
  let target = translationTargetLanguage();
  let languages: string[] = [target];
  let result = "";
  let error = "";
  let loading = false;
  let copied = false;
  let run = 0;
  let attachedDoc: Document | null = null;

  type GuestWebview = HTMLElement & {
    executeJavaScript?: (code: string) => Promise<unknown>;
    contentDocument?: Document | null;
  };
  let listenedWebview: GuestWebview | null = null;

  function iframeDocument(): Document | null {
    try {
      return (webview as GuestWebview)?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  function show(text: string, x: number, y: number) {
    text = text.trim();
    if (text.length < 2) {
      if (!popupOpen) {
        selection = null;
      }
      return;
    }
    if (popupOpen) {
      return;
    }
    let host = (webview as HTMLElement).offsetParent?.getBoundingClientRect();
    let width = host?.width ?? 600;
    selection = {
      text: text.slice(0, kMaxChars),
      x: Math.max(4, Math.min(x, width - 350)),
      y,
    };
  }

  /** Выделение в iframe (веб-версия и мобильная) */
  function onIframeSelectionEnd() {
    let sel = iframeDocument()?.getSelection();
    if (!sel || sel.rangeCount == 0) {
      show("", 0, 0);
      return;
    }
    let rect = sel.getRangeAt(0).getBoundingClientRect();
    let frame = webview.getBoundingClientRect();
    let host = webview.offsetParent?.getBoundingClientRect() ?? frame;
    show(sel.toString(), frame.left - host.left + rect.left, frame.top - host.top + rect.bottom + 6);
  }

  function onIframeMouseDown() {
    if (!popupOpen) {
      selection = null;
    }
  }

  /** Выделение в Electron `<webview>`: страница сообщает о нём через console.log */
  function onGuestMessage(event: Event) {
    let message = (event as unknown as { message?: string }).message ?? "";
    if (!message.startsWith(kGuestPrefix)) {
      return;
    }
    try {
      let data = JSON.parse(message.slice(kGuestPrefix.length));
      if (typeof data?.text == "string") {
        show(data.text, Number(data.x) || 0, (Number(data.y) || 0) + 6);
      }
    } catch {
      // Чужое сообщение в консоли страницы
    }
  }

  const kGuestPrefix = "jackdaw-selection:";
  const kGuestScript = `
    (function () {
      if (window.__jackdawSelection) {
        return;
      }
      window.__jackdawSelection = true;
      function report() {
        var sel = window.getSelection();
        var text = sel ? sel.toString() : "";
        var x = 0, y = 0;
        if (sel && sel.rangeCount) {
          var rect = sel.getRangeAt(0).getBoundingClientRect();
          x = rect.left;
          y = rect.bottom;
        }
        console.log("${kGuestPrefix}" + JSON.stringify({ text: text.slice(0, ${kMaxChars}), x: x, y: y }));
      }
      document.addEventListener("mouseup", function () { setTimeout(report, 0); });
      document.addEventListener("keyup", function (event) { if (event.shiftKey) { report(); } });
      document.addEventListener("mousedown", function () {
        console.log("${kGuestPrefix}" + JSON.stringify({ text: "", x: 0, y: 0 }));
      });
    })()
  `;

  function injectGuest() {
    let guest = webview as GuestWebview;
    try {
      void guest.executeJavaScript?.(kGuestScript)?.catch?.(() => {});
    } catch {
      // Страница ещё не готова: скрипт вставится по dom-ready
    }
  }

  function attach() {
    if (!webview) {
      return;
    }
    let doc = iframeDocument();
    if (doc) {
      if (doc == attachedDoc) {
        return;
      }
      detach();
      attachedDoc = doc;
      doc.addEventListener("mouseup", onIframeSelectionEnd);
      doc.addEventListener("keyup", onIframeSelectionEnd);
      doc.addEventListener("mousedown", onIframeMouseDown);
      return;
    }
    if (typeof (webview as GuestWebview).executeJavaScript == "function" && listenedWebview != webview) {
      listenedWebview = webview as GuestWebview;
      listenedWebview.addEventListener("console-message", onGuestMessage);
      listenedWebview.addEventListener("dom-ready", injectGuest);
      injectGuest();
    }
  }

  function detach() {
    attachedDoc?.removeEventListener("mouseup", onIframeSelectionEnd);
    attachedDoc?.removeEventListener("keyup", onIframeSelectionEnd);
    attachedDoc?.removeEventListener("mousedown", onIframeMouseDown);
    attachedDoc = null;
    listenedWebview?.removeEventListener("console-message", onGuestMessage);
    listenedWebview?.removeEventListener("dom-ready", injectGuest);
    listenedWebview = null;
  }

  $: if (webview) {
    webview.addEventListener("load", attach);
    attach();
  }

  onMount(async () => {
    try {
      let all = await translationLanguages();
      languages = [...all.to].sort((a, b) =>
        translationLanguageName(a, getUILocale()).localeCompare(translationLanguageName(b, getUILocale())));
    } catch {
      // Список языков не загрузился: остаётся язык по умолчанию
    }
  });
  onDestroy(() => {
    webview?.removeEventListener("load", attach);
    detach();
  });

  async function openPopup() {
    popupOpen = true;
    await translate();
  }

  async function changeTarget(language: string) {
    target = language;
    await translate();
  }

  async function translate() {
    if (!selection) {
      return;
    }
    let id = ++run;
    loading = true;
    error = "";
    result = "";
    copied = false;
    try {
      let translated = await translateSelection(selection.text, target);
      if (id == run) {
        result = translated.text;
      }
    } catch (ex) {
      if (id == run) {
        error = (ex as Error)?.message ?? String(ex);
      }
    } finally {
      if (id == run) {
        loading = false;
      }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      copied = true;
    } catch {
      // Буфер обмена недоступен
    }
  }

  function close() {
    run++;
    popupOpen = false;
    selection = null;
  }
</script>

<style>
  .selection-translate-button,
  .selection-translate-popup {
    position: absolute;
    z-index: 20;
    background: var(--bg, #fff);
    color: var(--fg, #111);
    border: 1px solid rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .selection-translate-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .selection-translate-popup {
    width: 340px;
    max-width: calc(100% - 8px);
    padding: 8px;
    gap: 8px;
  }
  .head {
    justify-content: space-between;
    gap: 8px;
  }
  .result {
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    user-select: text;
  }
  .result.error {
    color: var(--error, #c0392b);
  }
  .close,
  .copy {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
  }
  .copy {
    align-self: flex-end;
    opacity: 0.8;
  }
</style>
