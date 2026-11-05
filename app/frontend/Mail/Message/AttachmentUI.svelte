<Clickable onClick={onOpen}>
  <hbox class="attachment"
    draggable="true"
    on:dragstart={onDragStart}
    >
    <hbox bind:this={iconEl}>
      <hbox class="icon">
        <FileIcon ext={$attachment.ext} localFilePath={$attachment.filepathLocal} size={24} />
      </hbox>
      <vbox class="info">
        <hbox class="filename top-row font-small">
          {$attachment.filename}
        </hbox>
        <hbox class="bottom-row font-smallest">
          <hbox class="size">
            {$attachment.size ? fileSize($attachment.size) : $t`Not downloaded`}
          </hbox>
          <hbox flex />
          <AttachmentMenu {attachment} />
        </hbox>
      </vbox>
    </hbox>
  </hbox>
</Clickable>

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { fileSize } from "../../Files/file";
  import { openFileInternallyFromFile, canOpenFileInternally } from "../../Files/open";
  import { assert } from "../../../logic/util/util";
  import AttachmentMenu from "./AttachmentMenu.svelte";
  import { canPreviewAttachment, previewAttachment } from "../Attachments/attachmentPreview";
  import FileIcon from "../../Files/Thumbnail/FileIcon.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { t } from "../../../l10n/l10n";

  export let attachment: Attachment;

  async function onOpen() {
    if (canOpenFileInternally(attachment.mimeType)) {
      let loadedAttachment = await attachment.load();
      await openFileInternallyFromFile(loadedAttachment.content);
    } else if (canPreviewAttachment(attachment)) {
      await previewAttachment(attachment);
    } else {
      await attachment.openOSApp();
    }
  }

  let iconEl: HTMLDivElement;

  function onDragStart(event: DragEvent) {
    assert(attachment.content instanceof File, $t`Attachment file is missing`);
    event.dataTransfer.items.clear();
    event.dataTransfer.items.add(attachment.content);
    event.dataTransfer.setDragImage(iconEl as HTMLElement, 0, 0);
    event.dataTransfer.effectAllowed = "copy";
    for (let item of event.dataTransfer.items) {
      console.log("dragging attachment file", item, item.kind, item.type);
    }
    // TODO doesn't work for me: Creates a .txt file with the filename as content
  }
</script>

<style>
  .attachment {
    min-height: 44px;
    height: auto;
    margin: 4px;
  }
  .attachment > hbox {
    align-items: stretch;
    min-height: 44px;
  }
  .icon {
    width: 44px;
    min-width: 44px;
    min-height: 44px;
    background-color: var(--outstanding-bg);
    color: var(--outstanding-fg);
    align-items: center;
    justify-content: center;
    border-top-left-radius: 3px;
    border-bottom-left-radius: 3px;
  }
  .info {
    width: min(220px, 100%);
    min-width: 160px;
    padding: 4px 8px;
    justify-content: center;
    border-top-right-radius: 3px;
    border-bottom-right-radius: 3px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%);
  }
  .attachment:hover .icon {
    background-color: var(--inverted-bg);
    color: var(--inverted-fg);
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
    line-height: 1.25;
    min-height: 1.25em;
  }
  .bottom-row :global(.svelteui-Popper-root) {
    position: fixed;
  }
</style>
