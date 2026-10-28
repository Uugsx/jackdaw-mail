<!-- Окно предпросмотра вложения поверх приложения: заголовок с действиями и содержимое.
  Картинки одного сообщения листаются стрелками. -->
<svelte:window on:keydown|capture={onKeydown} />
<div class="preview-backdrop" on:click|self={close}>
  <vbox class="preview-dialog" role="dialog" aria-modal="true" aria-label={attachment.filename}
    tabindex="-1" bind:this={dialogElement}>
    <hbox class="header">
      <hbox class="filename font-normal" flex title={attachment.filename}>{attachment.filename}</hbox>
      {#if gallery.length > 1}
        <Button plain iconOnly icon={PreviousIcon} iconSize="16px" label={$t`Previous image`} onClick={() => go(-1)} />
        <hbox class="counter font-small">{index + 1} / {gallery.length}</hbox>
        <Button plain iconOnly icon={NextIcon} iconSize="16px" label={$t`Next image`} onClick={() => go(1)} />
      {/if}
      <Button plain icon={OpenIcon} iconSize="16px" label={$t`Open in external app`} onClick={openExternal} />
      <Button plain icon={SaveIcon} iconSize="16px" label={$t`Save as`} onClick={save} />
      <Button plain iconOnly icon={CloseIcon} iconSize="16px" label={$t`Close`} onClick={close} />
    </hbox>
    <vbox class="content" flex>
      {#if loading}
        <hbox class="message font-small">{$t`Loading…`}</hbox>
      {:else if !blobURL}
        <vbox class="message font-small">
          <hbox>{$t`This file cannot be shown here.`}</hbox>
        </vbox>
      {:else if kind == "pdf"}
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
  import { loadAttachmentContent, previewHTML, previewKind, type PreviewKind } from "./attachmentPreview";
  import Button from "../../Shared/Button.svelte";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import SaveIcon from "lucide-svelte/icons/save";
  import CloseIcon from "lucide-svelte/icons/x";
  import PreviousIcon from "lucide-svelte/icons/chevron-left";
  import NextIcon from "lucide-svelte/icons/chevron-right";
  import { backgroundError, catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, onMount, tick } from "svelte";

  export let attachment: Attachment;
  export let kind: PreviewKind;
  /** Вложения, между которыми листаем; `attachment` среди них */
  export let gallery: Attachment[] = [attachment];
  export let onClose: () => void;

  let dialogElement: HTMLElement;
  let previouslyFocused: HTMLElement | null = null;
  let index = Math.max(0, gallery.indexOf(attachment));
  let loading = false;
  let blobURL: string | null = null;
  $: setBlobURL(attachment, kind);

  // Свой адрес: у PDF указываем тип, иначе Chromium предложит скачать файл
  function setBlobURL(current: Attachment, currentKind: PreviewKind) {
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
    blobURL = !current?.content ? null : URL.createObjectURL(currentKind == "pdf" && current.content.type != "application/pdf"
      ? new Blob([current.content], { type: "application/pdf" })
      : current.content);
  }

  /** Соседнее вложение по кругу; байты догружаются при переходе */
  async function go(step: number) {
    if (gallery.length < 2) {
      return;
    }
    index = (index + step + gallery.length) % gallery.length;
    let wanted = index;
    loading = true;
    try {
      let loaded = await loadAttachmentContent(gallery[wanted]);
      if (wanted != index) {
        return; // уже листнули дальше
      }
      gallery[wanted] = loaded;
      kind = previewKind(loaded.filename, loaded.mimeType) ?? "image";
      attachment = loaded;
    } catch (ex) {
      backgroundError(ex);
      attachment = gallery[wanted];
    } finally {
      if (wanted == index) {
        loading = false;
      }
    }
  }

  onMount(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    dialogElement?.focus();
  });
  onDestroy(() => blobURL && URL.revokeObjectURL(blobURL));

  function close() {
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
    onClose();
  }

  /** Перехватываем до остальных обработчиков окна: Esc закрывает только просмотр, а не панель под ним */
  function onKeydown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (gallery.length > 1 && (event.key == "ArrowLeft" || event.key == "ArrowRight")) {
      event.preventDefault();
      event.stopPropagation();
      void go(event.key == "ArrowLeft" ? -1 : 1);
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
  .counter {
    min-width: 40px;
    justify-content: center;
    color: var(--main-fg);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
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
