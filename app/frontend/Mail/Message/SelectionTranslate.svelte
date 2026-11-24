{#if selection}
  <hbox class="selection-translate" style:left="{selection.x}px" style:top="{selection.y}px"
    class:error={!!error}>
    <button class="translate" title={error || $t`Translate selected text`} disabled={loading}
      on:mousedown|preventDefault on:click={() => translate(target)}>
      {#if loading}
        <LoaderIcon size="15" class="spin" />
        <span>{$t`Translating…`}</span>
      {:else if error}
        <span class="error-text">{error}</span>
      {:else}
        <LanguagesIcon size="15" />
        <span>{$t`Translate`}</span>
      {/if}
    </button>
    {#if !loading}
      <label class="language" title={$t`Translate into`}>
        <ChevronDownIcon size="14" />
        <select value="" aria-label={$t`Translate into`} on:change={event => pickLanguage(event.currentTarget)}>
          <option value="" disabled>{$t`Translate into`}</option>
          {#each languages as language (language)}
            <option value={language}>{capitalizeLanguageName(translationLanguageName(language, getUILocale()), getUILocale())}</option>
          {/each}
        </select>
      </label>
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import LanguagesIcon from "lucide-svelte/icons/languages";
  import LoaderIcon from "lucide-svelte/icons/loader-circle";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
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
  import { installSelectionTools } from "./selectionReplace";

  /** Окно письма (iframe), в котором выделяют текст */
  export let webview: HTMLIFrameElement | null = null;

  const kMaxChars = 5000;
  let selection: { x: number, y: number, text: string } | null = null;
  let target = translationTargetLanguage();
  let languages: string[] = [target];
  let error = "";
  let loading = false;
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
      if (!loading) {
        selection = null;
      }
      return;
    }
    if (loading) {
      return;
    }
    error = "";
    let host = (webview as HTMLElement).offsetParent?.getBoundingClientRect();
    let width = host?.width ?? 600;
    selection = {
      text: text.slice(0, kMaxChars),
      x: Math.max(4, Math.min(x, width - 180)),
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
    let range = sel.getRangeAt(0);
    (iframeDocument()?.defaultView as any).__jackdawRange = sel.isCollapsed ? null : range.cloneRange();
    let rect = range.getBoundingClientRect();
    let frame = webview.getBoundingClientRect();
    let host = webview.offsetParent?.getBoundingClientRect() ?? frame;
    show(sel.toString(), frame.left - host.left + rect.left, frame.top - host.top + rect.bottom + 6);
  }

  function onIframeMouseDown() {
    if (!loading) {
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
        window.__jackdawRange = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
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

  function pickLanguage(select: HTMLSelectElement) {
    let language = select.value;
    select.value = "";
    if (language) {
      target = language;
      void translate(language);
    }
  }

  /** Перевод выделенного и замена его в письме (оригинал — во всплывающей подсказке) */
  async function translate(language: string) {
    if (!selection || loading) {
      return;
    }
    let id = ++run;
    loading = true;
    error = "";
    try {
      let doc = iframeDocument();
      let guest = webview as GuestWebview;
      let texts: string[];
      let apply: (translations: string[]) => Promise<unknown>;
      if (doc?.defaultView) {
        let win = doc.defaultView as any;
        installSelectionTools(win);
        texts = win.__jackdawSel.collect();
        apply = async translations => win.__jackdawSel.apply(translations);
      } else if (typeof guest?.executeJavaScript == "function") {
        texts = await guest.executeJavaScript(
          `(${installSelectionTools.toString()})(window); window.__jackdawSel.collect()`) as string[];
        apply = translations => guest.executeJavaScript(
          `window.__jackdawSel.apply(${JSON.stringify(translations)})`);
      } else {
        return;
      }
      if (!Array.isArray(texts) || !texts.length) {
        selection = null;
        return;
      }
      let translated = await translateSelection(texts.map(text => text.slice(0, kMaxChars)), language);
      if (id != run) {
        return;
      }
      await apply(translated.texts);
      selection = null;
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
</script>

<style>
  .selection-translate {
    position: absolute;
    z-index: 20;
    align-items: stretch;
    max-width: 320px;
    background: var(--bg, #fff);
    color: var(--fg, #111);
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
    overflow: hidden;
    font-size: 13px;
  }
  button.translate {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }
  button.translate:hover,
  .language:hover {
    background: rgba(128, 128, 128, 0.14);
  }
  .error-text {
    color: var(--error, #c0392b);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .language {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 6px;
    border-left: 1px solid rgba(128, 128, 128, 0.3);
    cursor: pointer;
  }
  .language select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
