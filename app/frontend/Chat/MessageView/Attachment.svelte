<!-- One attachment in a chat message: images render inline; everything else
  shows as a file chip you can open or drag out. The bytes arrive via a background
  download (WhatsApp/XMPP) or are already present (our own outgoing message), and
  `Attachment` is observable, so this updates when `content`/`size` fill in. -->
{#if viewing && $attachment.blobURL}
  <ImageViewer url={$attachment.blobURL} filename={$attachment.filename}
    onSave={() => attachment.saveFile()} close={() => viewing = false} />
{/if}
{#if isImage}
  <vbox class="image-wrap">
    {#if $attachment.content}
      <Clickable onClick={onOpen}>
        <img class="image" src={$attachment.blobURL} alt={$attachment.filename} title={$t`Open ${$attachment.filename}`} />
      </Clickable>
      {#if uploadProgress != null}
        <vbox class="upload-over">
          <progress class="upload" max="1" value={uploadProgress} aria-label={$t`Uploading ${$attachment.filename}`}></progress>
        </vbox>
      {/if}
      <hbox class="image-menu">
        <AttachmentMenu {attachment} />
      </hbox>
    {:else if downloadError}
      <hbox class="loading download-error font-smallest" role="alert">
        <ErrorMessageInline ex={downloadError} />
        <Button label={$t`Retry`} icon={RetryIcon} iconSize="14px" plain onClick={onRetryDownload} />
      </hbox>
    {:else}
      <hbox class="loading font-smallest">
        {#await attachment.read()}
          {$t`Loading…`}
        {:then}
          <!-- Still no content, so file is not on disk. We assume the protocol downloads it in the background. -->
          {$t`Downloading…`}
        {:catch ex}
          <ErrorMessageInline {ex} />
        {/await}
      </hbox>
    {/if}
  </vbox>
{:else}
  <Clickable onClick={onOpen}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <hbox class="file" draggable="true" on:dragstart={onDragStart}>
      <hbox class="icon">
        <FileIcon ext={$attachment.ext} localFilePath={$attachment.filepathLocal} size={24} />
      </hbox>
      <vbox class="info">
        <hbox class="filename top-row font-normal" title={$attachment.filename}>
          {$attachment.filename}
        </hbox>
        <hbox class="bottom-row font-smallest">
          <hbox class="size">
            {#if uploadProgress != null}
              <hbox class="uploading">
                <progress class="upload" max="1" value={uploadProgress} aria-label={$t`Uploading ${$attachment.filename}`}></progress>
                <span>{Math.round(uploadProgress * 100)} %</span>
              </hbox>
            {:else if downloadError}
              <hbox class="download-error" role="alert" title={downloadError.message}>{$t`Download failed`}</hbox>
              <Button label={$t`Retry`} icon={RetryIcon} iconSize="14px" iconOnly plain onClick={onRetryDownload} />
            {:else if $attachment.size}
              {fileSize($attachment.size)}
            {:else}
              {$t`Downloading…`}
            {/if}
          </hbox>
          <hbox flex />
          <AttachmentMenu {attachment} />
        </hbox>
      </vbox>
    </hbox>
  </Clickable>
{/if}

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { fileSize } from "../../Files/file";
  import { openFileInternallyFromFile, canOpenFileInternally } from "../../Files/open";
  import AttachmentMenu from "../../Mail/Message/AttachmentMenu.svelte";
  import FileIcon from "../../Files/Thumbnail/FileIcon.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Button from "../../Shared/Button.svelte";
  import RetryIcon from "lucide-svelte/icons/rotate-cw";
  import { JackdawChatAttachment } from "../../../logic/Chat/Jackdaw/JackdawChatMessage";
  import ImageViewer from "./ImageViewer.svelte";
  import { t } from "../../../l10n/l10n";

  export let attachment: Attachment;
  let viewing = false;

  $: isImage = $attachment.mimeType?.startsWith("image/");
  /** Файл чата Jackdaw не скачался: показываем ошибку с повтором вместо вечного «Downloading…» */
  $: downloadError = $attachment instanceof JackdawChatAttachment && !$attachment.content ? $attachment.downloadError : null;
  /** Свой файл загружается на сервер: полоса загрузки, 0…1 */
  $: uploadProgress = $attachment instanceof JackdawChatAttachment ? $attachment.uploadProgress : null;

  async function onRetryDownload(event?: Event) {
    event?.stopPropagation(); // не открывать файл по клику на «Повторить»
    if (attachment instanceof JackdawChatAttachment) {
      await attachment.retryDownload();
    }
  }

  async function onOpen() {
    if (!attachment.content) {
      await attachment.read(); // restore the bytes from disk if we have them
    }
    if (!attachment.content) {
      return; // not downloaded yet
    }
    if (isImage) {
      viewing = true; // картинку смотрим здесь же, а не через сохранение файла
      return;
    }
    if (canOpenFileInternally(attachment.mimeType)) {
      await openFileInternallyFromFile(attachment.content);
    } else {
      await attachment.saveFile(); // offer to save the blob to disk
    }
  }

  function onDragStart(event: DragEvent) {
    if (!(attachment.content instanceof File)) {
      return;
    }
    event.dataTransfer.items.clear();
    event.dataTransfer.items.add(attachment.content);
    event.dataTransfer.effectAllowed = "copy";
  }
</script>

<style>
  .image-wrap {
    position: relative;
  }
  /* The attachment menu, over the image's top-right corner; appears on hover. */
  .image-menu {
    position: absolute;
    top: 2px;
    inset-inline-end: 2px;
    padding: 0 2px;
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 80%);
    opacity: 0;
  }
  .image-wrap:hover .image-menu {
    opacity: 1;
  }
  /* Превью, а не картинка во всю ленту: полный размер открывается по клику */
  .image {
    display: block;
    max-width: 240px;
    max-height: 200px;
    border-radius: 8px;
    border: 1px solid var(--border);
    object-fit: contain;
    cursor: zoom-in;
  }
  .upload-over {
    position: absolute;
    inset-inline: 8px;
    bottom: 8px;
  }
  .upload {
    width: 100%;
    min-width: 80px;
    height: 4px;
    accent-color: var(--selected-border, var(--icon-primary));
  }
  .uploading {
    flex: 1 1 auto;
    align-items: center;
    gap: 6px;
  }
  .loading {
    padding: 24px;
    color: #888888;
  }
  .download-error {
    align-items: center;
    gap: 4px;
    color: var(--error-fg, #b00020);
  }
  .file {
    min-height: 40px;
    cursor: pointer;
  }
  .icon {
    aspect-ratio: 1/1;
    background-color: var(--outstanding-bg);
    color: var(--outstanding-fg);
    align-items: center;
    justify-content: center;
    border-top-left-radius: 3px;
    border-bottom-left-radius: 3px;
  }
  .info {
    /* Имя файла не обрезается по высоте и помещается шире 160px */
    min-width: 160px;
    max-width: 320px;
    justify-content: center;
    gap: 2px;
    line-height: 1.3;
    padding: 4px 8px;
    border-top-right-radius: 3px;
    border-bottom-right-radius: 3px;
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .top-row,
  .bottom-row,
  .size {
    align-items: center;
  }
  .filename,
  .size {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bottom-row :global(.svelteui-Popper-root) {
    position: fixed;
  }
</style>
