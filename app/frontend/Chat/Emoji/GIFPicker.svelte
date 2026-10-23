<vbox class="gif-picker" flex>
  {#if state == "loading"}
    <vbox class="media-grid skeleton-grid" flex role="status" aria-busy="true" aria-label={$t`Loading GIFs…`}>
      {#each skeletons as _}
        <hbox class="media-skeleton" aria-hidden="true" />
      {/each}
    </vbox>
  {:else if state == "unavailable"}
    <vbox class="picker-state" flex role="status">
      <hbox class="state-title">{$t`GIFs are not available`}</hbox>
      <hbox class="state-copy">
        {#if errorKind == "server-unconfigured"}
          {$t`GIF search is not set up on the Jackdaw server yet.`}
        {:else if errorKind == "server-outdated"}
          {$t`The Jackdaw server does not support GIF search yet.`}
        {:else if errorKind == "no-license"}
          {$t`GIF search needs an active Jackdaw Pro license or trial.`}
        {:else}
          {$t`No connection to the Jackdaw server. GIFs will be available when the connection is restored.`}
        {/if}
      </hbox>
      {#if errorKind == "offline"}
        <Button label={$t`Retry`} onClick={retry} />
      {/if}
    </vbox>
  {:else if state == "error"}
    <vbox class="picker-state" flex role="alert">
      {#if errorKind == "rate-limited"}
        <hbox class="state-title">{$t`Too many GIF searches`}</hbox>
        <hbox class="state-copy">{$t`Wait a minute and try again.`}</hbox>
      {:else}
        <hbox class="state-title">{$t`Could not load GIFs`}</hbox>
        <hbox class="state-copy">{$t`Check your connection and try again.`}</hbox>
      {/if}
      <Button label={$t`Retry`} onClick={retry} />
    </vbox>
  {:else if !visibleGIFs.length}
    <vbox class="picker-state" flex role="status">
      <hbox class="state-title">{$t`No GIFs found`}</hbox>
      <hbox class="state-copy">{$t`Try another search or clear the search field.`}</hbox>
      {#if normalizedQuery}
        <Button label={$t`Clear search`} onClick={() => searchTerm = null} />
      {/if}
    </vbox>
  {:else}
    <Scroll>
      <vbox class="media-grid">
        {#each visibleGIFs as gif (gif.id)}
          <button
            type="button"
            class="media-button"
            class:busy={!!loadingID}
            title={gif.title}
            aria-label={$t`Insert GIF ${gif.title}`}
            aria-disabled={!!loadingID}
            on:click={() => selectGIF(gif)}
            >
            <span class="media-preview">
              <span class="media-placeholder" aria-hidden="true">GIF</span>
              {#if !failedThumbnailIDs.has(gif.id)}
                <img
                  class:media-image-visible={loadedThumbnailIDs.has(gif.id)}
                  src={getGIFThumbnailURL(gif, fallbackThumbnailIDs.has(gif.id))}
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  on:load={() => onThumbnailLoad(gif)}
                  on:error={() => onThumbnailError(gif)}
                  />
              {/if}
            </span>
            {#if loadingID == gif.id}
              <span class="media-loading">{$t`Loading…`}</span>
            {/if}
          </button>
        {/each}
      </vbox>
    </Scroll>
  {/if}
  {#if selectionError}
    <hbox class="selection-error" role="alert">{$t`Could not add this GIF. Try another one.`}</hbox>
  {/if}
  {#if state == "ready" || state == "loading"}
    <hbox class="attribution">{$t`Powered by ${kGIFProviderName}`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createEventDispatcher } from "svelte";
  import Button from "../../Shared/Button.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import {
    downloadGIF,
    getGIFThumbnailURL,
    GIFSearchError,
    kGIFDisplayWidth,
    kGIFProviderName,
    searchGIFs,
    toGIFSearchError,
    type GIFSearchErrorKind,
    type GraphicSelection,
    type PickerGIF,
  } from "./media";
  import { t } from "../../../l10n/l10n";

  export let searchTerm: string | null;

  const kSearchDebounceMS = 300;
  /** Скелетоны не вечные: клиент ждёт сервер 12 с, а это — запас на случай, если ответ потерялся совсем */
  const kSearchWatchdogMS = 20_000;
  const skeletons = Array(9);
  const dispatchEvent = createEventDispatcher<{ select: GraphicSelection }>();

  let state: "loading" | "ready" | "error" | "unavailable" = "loading";
  let errorKind: GIFSearchErrorKind | null = null;
  let gifs: PickerGIF[] = [];
  let visibleGIFs: PickerGIF[] = [];
  let selectionError = false;
  let loadingID: string | null = null;
  let fallbackThumbnailIDs = new Set<string>();
  let failedThumbnailIDs = new Set<string>();
  let loadedThumbnailIDs = new Set<string>();
  let normalizedQuery = "";
  let scheduledQuery = "";
  let requestID = 0;
  let isMounted = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  $: normalizedQuery = searchTerm?.trim() ?? "";
  $: visibleGIFs = gifs;
  $: if (isMounted && normalizedQuery != scheduledQuery) {
    scheduleSearch(normalizedQuery);
  }

  onMount(() => {
    isMounted = true;
    scheduleSearch(normalizedQuery);
  });

  onDestroy(() => {
    requestID++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  });

  function retry() {
    scheduleSearch(normalizedQuery);
  }

  function scheduleSearch(query: string) {
    requestID++;
    scheduledQuery = query;
    state = "loading";
    errorKind = null;
    selectionError = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void loadGIFs(query);
    }, kSearchDebounceMS);
  }

  async function loadGIFs(query: string) {
    let currentRequestID = ++requestID;
    state = "loading";
    gifs = [];
    fallbackThumbnailIDs = new Set();
    failedThumbnailIDs = new Set();
    loadedThumbnailIDs = new Set();
    loadingID = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    try {
      let result = await Promise.race([
        searchGIFs(query),
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => reject(new GIFSearchError("failed", "timeout")), kSearchWatchdogMS);
        }),
      ]);
      if (currentRequestID != requestID) {
        return;
      }
      gifs = result;
      state = "ready";
    } catch (ex) {
      if (currentRequestID != requestID) {
        return;
      }
      let error = toGIFSearchError(ex);
      errorKind = error.kind;
      // Без ключа на сервере, на старом сервере и без лицензии повтор не поможет — только пояснение.
      // «Нет связи» показываем так же, но с кнопкой повтора.
      state = error.kind == "failed" || error.kind == "rate-limited" ? "error" : "unavailable";
    } finally {
      if (watchdog) {
        clearTimeout(watchdog);
      }
    }
  }

  async function selectGIF(gif: PickerGIF) {
    if (loadingID) {
      return;
    }
    loadingID = gif.id;
    selectionError = false;
    try {
      let file = await downloadGIF(gif);
      dispatchEvent("select", { emoji: null, file, width: kGIFDisplayWidth });
    } catch (ex) {
      selectionError = true;
    } finally {
      loadingID = null;
    }
  }

  function onThumbnailError(gif: PickerGIF) {
    loadedThumbnailIDs = new Set(loadedThumbnailIDs);
    loadedThumbnailIDs.delete(gif.id);
    if (!fallbackThumbnailIDs.has(gif.id) && gif.thumbnail != gif.url) {
      fallbackThumbnailIDs = new Set(fallbackThumbnailIDs).add(gif.id);
      return;
    }
    failedThumbnailIDs = new Set(failedThumbnailIDs).add(gif.id);
  }

  function onThumbnailLoad(gif: PickerGIF) {
    loadedThumbnailIDs = new Set(loadedThumbnailIDs).add(gif.id);
  }
</script>

<style>
  .gif-picker {
    min-height: 0;
    min-width: 0;
  }
  .media-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .media-button {
    position: relative;
    min-width: 0;
    min-height: 72px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    cursor: pointer;
  }
  .media-button:hover:not(.busy) {
    border-color: var(--selected-bg);
  }
  .media-button:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 2px;
  }
  .media-button:active:not(.busy) {
    transform: scale(0.98);
  }
  .media-button.busy {
    cursor: wait;
    opacity: 70%;
  }
  .media-button img {
    display: block;
    position: relative;
    z-index: 1;
    width: 100%;
    height: 96px;
    object-fit: cover;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .media-button img.media-image-visible {
    opacity: 1;
  }
  .media-preview {
    position: relative;
    display: block;
    height: 96px;
    background-color: var(--hover-bg);
  }
  .media-placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 8px;
    box-sizing: border-box;
    background-color: var(--hover-bg);
    color: var(--main-fg);
    font-size: 12px;
    font-weight: 600;
  }
  .media-loading {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    background-color: rgba(0, 0, 0, 35%);
    color: white;
    font-size: 12px;
  }
  .media-skeleton {
    min-height: 96px;
    border-radius: 8px;
    background-color: var(--hover-bg);
    animation: pulse 1.2s ease-in-out infinite alternate;
  }
  .picker-state {
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
  }
  .state-title {
    font-weight: bold;
  }
  .state-copy {
    max-width: 260px;
    color: var(--input-placeholder);
    text-align: center;
  }
  .selection-error {
    flex: 0 0 auto;
    padding: 4px 8px;
    color: var(--error-fg, #b00020);
    font-size: 12px;
  }
  .attribution {
    flex: 0 0 auto;
    justify-content: flex-end;
    padding: 2px 8px 6px;
    color: var(--input-placeholder);
    font-size: 11px;
  }
  @keyframes pulse {
    from { opacity: 55%; }
    to { opacity: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .media-skeleton {
      animation: none;
    }
    .media-button img {
      transition: none;
    }
  }
</style>
