{#if $mailUndoToast}
  <hbox class="mail-undo-toast" role="status">
    <Trash2Icon size="16px" aria-hidden="true" />
    <span class="label" title={$mailUndoToast.label}>{$mailUndoToast.label}</span>
    <button type="button" class="undo" on:click={() => catchErrors(onUndo)}>
      {$t`Undo`}
    </button>
  </hbox>
{/if}

<script lang="ts">
  import Trash2Icon from "lucide-svelte/icons/trash-2";
  import { mailUndoToast } from "./mailDeleteUndo";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";

  async function onUndo() {
    let toast = $mailUndoToast;
    if (!toast) {
      return;
    }
    await toast.undo();
  }
</script>

<style>
  .mail-undo-toast {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 16px;
    margin-inline: auto;
    width: fit-content;
    max-width: calc(100% - 32px);
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--border-radius);
    background: color-mix(in srgb, var(--main-fg) 88%, black);
    color: var(--main-bg);
    box-shadow: 0 8px 28px rgb(0 0 0 / 28%);
    z-index: 6;
    pointer-events: auto;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .undo {
    margin-inline-start: 4px;
    padding: 0;
    border: none;
    background: transparent;
    color: color-mix(in srgb, var(--main-bg) 72%, var(--icon-primary, #7eb8ff));
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .undo:hover,
  .undo:focus-visible {
    color: var(--main-bg);
    text-decoration: underline;
  }
</style>
