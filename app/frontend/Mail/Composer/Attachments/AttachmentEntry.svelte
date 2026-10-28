<hbox class="attachment" role="button" tabindex="0" title={$t`Preview`}
  on:click={onOpen} on:keydown={onKeydown}>
  <hbox class="icon">
    <FileIcon {ext} localFilePath={$attachment.filename} size={32} />
  </hbox>
  <vbox flex class="right">
    <hbox class="name font-small">
      {attachment.filename}
    </hbox>
    <hbox class="second-line">
      <hbox class="size font-small">
        {$t`${Math.ceil($attachment.size / 1024)} KB`}
      </hbox>
      <hbox flex />
      <hbox class="buttons" on:click|stopPropagation on:keydown|stopPropagation role="presentation">
        <Button plain icon={DeleteIcon} iconSize="16px" iconOnly
          label={$t`Delete this attachment`} onClick={onDelete} />
        <!--<Button plain icon={ChevronDownIcon} iconSize="16px" iconOnly />-->
      </hbox>
    </hbox>
  </vbox>
</hbox>

<script lang="ts">
  import type { Attachment } from "../../../../logic/Abstract/Attachment";
  import FileIcon from "../../../Files/Thumbnail/FileIcon.svelte";
  import Button from "../../../Shared/Button.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { Collection } from "svelte-collections";
  import { t } from "../../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  import { previewAttachment } from "../../Attachments/attachmentPreview";
  import { showError } from "../../../Util/error";

  export let attachment: Attachment;
  export let attachments: Collection<Attachment>;
  const dispatchEvent = createEventDispatcher<{ remove: Attachment }>();

  $: ext = attachment.filename.split(".").pop();

  /** Файл ещё не отправлен: просмотр берёт байты из `File` или с диска, на сервер ничего не уходит.
   * Листаем по всем видимым вложениям письма. */
  async function onOpen() {
    try {
      let gallery = attachments.contents.filter(other => other == attachment || !other.hidden);
      await previewAttachment(attachment, gallery, true);
    } catch (ex) {
      showError(ex);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.target == event.currentTarget && (event.key == "Enter" || event.key == " ")) {
      event.preventDefault();
      void onOpen();
    }
  }

  function onDelete() {
    attachments.remove(attachment);
    dispatchEvent("remove", attachment);
  }
</script>

<style>
  .attachment {
    cursor: pointer;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    box-shadow: -1px 0px 5px 0.5px rgb(0, 0, 0, 10%);
    border-radius: 5px;
    margin: 4px 6px 4px 12px;
    padding: 4px;
  }
  .attachment:focus-visible {
    outline: 2px solid var(--selected-bg, currentColor);
    outline-offset: 1px;
  }
  .icon {
    color: lightgray;
    margin-inline-end: 4px;
  }
  .icon :global(svg) {
    stroke-width: 1px;
  }
  .right {
    margin: 0px 4px;
  }
  .name {
    flex-wrap: wrap;
    font-weight: 500;
    line-height: 1.2;
  }
  .size {
    color: lightgray;
  }
  .buttons {
    align-items: start;
  }
  .buttons :global(svg) {
    color: lightgrey;
  }
</style>
