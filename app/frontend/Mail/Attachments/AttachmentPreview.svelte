<!-- Окно предпросмотра вложения поверх приложения: заголовок с действиями и содержимое -->
<div class="preview-backdrop" on:click|self={close}>
  <vbox class="preview-dialog" role="dialog" aria-modal="true" aria-label={attachment.filename}
    tabindex="-1" bind:this={dialogElement} on:keydown={onKeydown}>
    <hbox class="header">
      <hbox class="filename font-normal" flex title={attachment.filename}>{attachment.filename}</hbox>
      <Button plain icon={OpenIcon} iconSize="16px" label={$t`Open in external app`} onClick={openExternal} />
      <Button plain icon={SaveIcon} iconSize="16px" label={$t`Save as`} onClick={save} />
      <Button plain iconOnly icon={CloseIcon} iconSize="16px" label={$t`Close`} onClick={close} />
    </hbox>
    <vbox class="content" flex>
      {#if kind == "pdf"}
        <iframe src={blobURL} title={attachment.filename} />
      {:else if kind == "image"}
        <hbox class="image" flex><img src={blobURL} alt={attachment.filename} /></hbox>
      {:else}
        {#await previewHTML(kind, attachment.filename, attachment.content)}
          <hbox class="message font-small">{$t`Loading…`}</hbox>
        {:then html}
          <!-- Без allow-scripts: в документе не выполняется ничего -->
          <iframe srcdoc={html} sandbox="" title={attachment.filename} />
        {:catch ex}
          <vbox class="message font-small">
            <hbox>{$t`This file cannot be shown here.`}</hbox>
            <hbox class="error">{ex?.message ?? ex}</hbox>
          </vbox>
        {/await}
      {/if}
    </vbox>
  </vbox>
</div>

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { previewHTML, type PreviewKind } from "./attachmentPreview";
  import Button from "../../Shared/Button.svelte";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import SaveIcon from "lucide-svelte/icons/save";
  import CloseIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, onMount, tick } from "svelte";

  export let attachment: Attachment;
  export let kind: PreviewKind;
  export let onClose: () => void;

  let dialogElement: HTMLElement;
  let previouslyFocused: HTMLElement | null = null;
  // Свой адрес: у PDF указываем тип, иначе Chromium предложит скачать файл
  const blobURL = URL.createObjectURL(kind == "pdf" && attachment.content.type != "application/pdf"
    ? new Blob([attachment.content], { type: "application/pdf" })
    : attachment.content);

  onMount(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    dialogElement?.focus();
  });
  onDestroy(() => URL.revokeObjectURL(blobURL));

  function close() {
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
    onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      close();
    }
  }

  function openExternal() {
    catchErrors(() => attachment.openOSApp());
  }

  function save() {
    catchErrors(() => attachment.saveFile());
  }
</script>

<style>
  .preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .preview-dialog {
    width: min(1100px, calc(100vw - 64px));
    height: calc(100vh - 64px);
    background: var(--main-bg);
    color: var(--main-fg);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    outline: none;
  }
  .header {
    align-items: center;
    gap: 4px;
    padding: 6px 8px 6px 16px;
    border-bottom: 1px solid var(--border);
  }
  .filename {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .content {
    min-height: 0;
    background: #fff;
  }
  iframe {
    border: none;
    width: 100%;
    height: 100%;
    flex: 1 1 auto;
  }
  .image {
    align-items: center;
    justify-content: center;
    overflow: auto;
    background: var(--main-bg);
  }
  .image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .message {
    padding: 24px;
    gap: 8px;
    color: #333;
  }
  .error {
    color: var(--error-fg, #c62828);
  }
</style>
