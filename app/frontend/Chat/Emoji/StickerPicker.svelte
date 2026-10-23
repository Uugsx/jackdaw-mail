<vbox class="sticker-picker" flex>
  <Scroll>
    {#if visibleStickers.length}
      <vbox class="sticker-grid">
        {#each visibleStickers as sticker (sticker.id)}
          <button
            type="button"
            class="sticker-button"
            title={stickerTitle(sticker)}
            aria-label={$t`Insert sticker ${stickerTitle(sticker)}`}
            on:click={() => selectSticker(sticker)}
            >
            <span class="sticker-art" style={`--sticker-bg: ${sticker.background}`}>{sticker.emoji}</span>
          </button>
        {/each}
      </vbox>
    {:else}
      <vbox class="picker-state" flex>
        <hbox class="state-title">{$t`No stickers found`}</hbox>
        <hbox class="state-copy">{$t`Try another search or clear the search field.`}</hbox>
        <RoundButton label={$t`Clear search`} onClick={() => searchTerm = null} />
      </vbox>
    {/if}
  </Scroll>
  {#if selectionError}
    <hbox class="selection-error" role="status">{$t`Could not add this sticker. Try another one.`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { createStickerFile, filterStickers, kStickerDisplayWidth, stickerTitle, type StickerDefinition } from "./stickers";
  import type { GraphicSelection } from "./media";
  import { t } from "../../../l10n/l10n";

  export let searchTerm: string | null;

  const dispatchEvent = createEventDispatcher<{ select: GraphicSelection }>();
  let visibleStickers: StickerDefinition[] = [];
  let selectionError = false;

  $: visibleStickers = filterStickers(searchTerm);

  function selectSticker(sticker: StickerDefinition) {
    selectionError = false;
    try {
      let file = createStickerFile(sticker);
      dispatchEvent("select", { emoji: null, file, width: kStickerDisplayWidth });
    } catch (ex) {
      selectionError = true;
    }
  }
</script>

<style>
  .sticker-picker {
    min-height: 0;
    min-width: 0;
  }
  .sticker-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .sticker-button {
    display: grid;
    min-width: 0;
    min-height: 72px;
    padding: 4px;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }
  .sticker-button:hover {
    border-color: var(--selected-bg);
  }
  .sticker-button:focus-visible {
    outline: 2px solid var(--input-focus);
    outline-offset: 2px;
  }
  .sticker-button:active {
    transform: scale(0.98);
  }
  .sticker-art {
    display: grid;
    width: 64px;
    height: 64px;
    place-items: center;
    border-radius: 16px;
    background-color: var(--sticker-bg);
    font-size: 40px;
    line-height: 1;
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
</style>
