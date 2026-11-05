<FileDropTarget
  on:add-files={onAddAttachment}>
  <!--on:inline-files={onAddInline}
  allowInline={true}>-->
  <vbox flex class="msg-editor">
    {#if showEmojis}
      <hbox>
        <vbox class="emojis">
          <GraphicSelector
            on:select={event => catchErrors(() => onGraphic(event))}
            on:backspace={() => catchErrors(onEmojiBackspace)}
            bind:isOpen={showEmojis}
            />
        </vbox>
        <vbox class="emoji-empty" flex />
      </hbox>
    {/if}
    {#if $attachments.some(attachment => !attachment.hidden)}
      <vbox class="attachments">
        <AttachmentsPane message={to.draftMessage} on:remove={onAttachmentRemove} />
      </vbox>
    {/if}
    {#if typingLabel}
      <hbox class="typing font-small" role="status" aria-live="polite">{typingLabel}</hbox>
    {/if}
    {#if isEditing}
      <hbox class="compose-context">
        <vbox flex class="context-text">
          <span class="context-title">{$t`Editing message`}</span>
        </vbox>
        <RoundButton label={$t`Cancel editing`} icon={XIcon} iconSize="14px" padding="4px" border={false} classes="plain"
          onClick={reset} />
      </hbox>
    {:else if replyTarget}
      <hbox class="compose-context">
        <vbox flex class="context-text">
          <span class="context-title">{$t`Reply to ${replyTarget.from?.name ?? ""}`}</span>
          <span class="context-snippet">{quoteSnippet(replyTarget) || $t`File`}</span>
        </vbox>
        <RoundButton label={$t`Cancel reply`} icon={XIcon} iconSize="14px" padding="4px" border={false} classes="plain"
          onClick={() => replyingTo.set(null)} />
      </hbox>
    {/if}
    <hbox flex class="editor-row">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <vbox flex class="editor-wrapper" on:keydown|capture={ev => isEnterSend && onKeyEnter(ev, () => catchErrors(send))}
        on:paste|capture={onPaste}>
        <HTMLEditorToolbar {editor}>
          <Button classes="emoji-toggle"
            onClick={() => showEmojis = !showEmojis}
            icon={EmojiIcon}
            iconSize="16px"
            iconOnly
            label={$t`Emoji`}
            selected={showEmojis}
            slot="start"
            />
          <Button classes="enter-toggle"
            onClick={() => isEnterSend = !isEnterSend}
            icon={EnterKeyIcon}
            iconSize="16px"
            iconOnly
            label={$t`Send`}
            selected={!isEnterSend}
            slot="last"
            />
        </HTMLEditorToolbar>
        <vbox flex class="editor-scroll-wrapper">
          <Scroll>
            <vbox flex class="editor">
              <HTMLEditor bind:html={to.draftMessage.rawHTMLDangerous} bind:editor on:change={onEditorChange} />
            </vbox>
          </Scroll>
        </vbox>
      </vbox>
      <vbox class="send-buttons">
        <RoundButton classes="send-button"
          onClick={send}
          icon={SendIcon}
          iconSize="24px"
          padding="6px"
          border={false}
          disabled={!to.draftMessage.hasHTML && $attachments.isEmpty}
          />
      </vbox>
    </hbox>
  </vbox>
</FileDropTarget>

<script lang="ts">
  import type { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { type ChatMessage, DeliveryStatus } from "../../logic/Chat/ChatMessage";
  import { insertImage, removeImageForAttachment, removeOrphanedInlineAttachments } from "../Shared/Editor/InsertImage";
  import type { Attachment } from "../../logic/Abstract/Attachment";
  import { selectedDraft, selectedEditor } from "./selected";
  import HTMLEditorToolbar from "../Shared/Editor/HTMLEditorToolbar.svelte";
  import HTMLEditor from "../Shared/Editor/HTMLEditor.svelte";
  import { classifyPastedFiles, filesFromClipboard } from "../Shared/Editor/clipboardFiles";
  import FileDropTarget from "../Mail/Composer/Attachments/FileDropTarget.svelte";
  import AttachmentsPane from "../Mail/Composer/Attachments/AttachmentsPane.svelte";
  import GraphicSelector from "./Emoji/GraphicSelector.svelte";
  import type { GraphicSelection } from "./Emoji/media";
  import Scroll from "../Shared/Scroll.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import Button from "../Shared/Button.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import EnterKeyIcon from "lucide-svelte/icons/corner-down-left";
  import EmojiIcon from "lucide-svelte/icons/smile";
  import XIcon from "lucide-svelte/icons/x";
  import { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import { quoteSnippet, replyingTo } from "./replyState";
  import { onKeyEnter } from "../Util/util";
  import { catchErrors } from "../Util/error";
  import type { Editor } from '@tiptap/core';
  import { t, gt } from "../../l10n/l10n";

  export let to: ChatRoom;

  let editor: Editor;

  let isEnterSend = true;
  $: to.draftMessage ??= to.newMessage();
  $: attachments = $to.draftMessage.attachments;
  $: $selectedDraft = $to.draftMessage;
  $: $selectedEditor = editor;
  let showEmojis = false;

  /** Ответ относится только к своему чату */
  $: replyTarget = $replyingTo && $replyingTo.to == to ? $replyingTo : null;
  $: isEditing = !!$to.draftMessage?.isEdit;
  /** Правка: текст исходного сообщения подставляется в редактор */
  let shownDraft: ChatMessage | null = null;
  $: editor && $to.draftMessage && showDraft($to.draftMessage);
  function showDraft(draft: ChatMessage) {
    if (draft === shownDraft) {
      return;
    }
    shownDraft = draft;
    if (draft.isEdit) {
      editor.commands.setContent(draft.rawHTMLDangerous ?? "");
      editor.commands.focus("end");
    }
  }

  $: typingNames = $to instanceof JackdawChatRoom ? $to.typing.length >= 0 && $to.typingNames : [];
  $: typingLabel = !typingNames || !typingNames.length ? ""
    : typingNames.length == 1 ? $t`${typingNames[0]} is typing…` : $t`${typingNames.join(", ")} are typing…`;

  async function send() {
    let room = to;
    let msg = room.draftMessage;
    if (!msg.hasHTML && !msg.attachments.hasItems) {
      return; // второй Enter сразу после отправки: черновик уже новый и пустой
    }
    msg.outgoing = true;
    moveInlineImagesToAttachments(msg);
    if (msg.attachments.hasItems && !msg.text.trim() && !/<img/i.test(msg.rawHTMLDangerous ?? "")) {
      // Только файл: пустой абзац редактора рисовался пустым пузырём под файлом
      msg.html = "";
      msg.text = "";
    }
    msg.text; // Generate to keep in sync
    msg.contact = room.contact;
    if (!msg.isEdit && replyTarget) {
      msg.inReplyTo = replyTarget.id;
    }
    replyingTo.set(null);
    msg.sent = new Date();
    // Отправляемое сообщение отделяем от редактора до первого await: новый текст и файлы
    // попадают в новый черновик, а не в сообщение, которое ещё загружается.
    reset();
    try {
      await room.sendMessage(msg);
    } catch (ex) {
      restoreDraft(room, msg);
      throw ex;
    }
  }

  function reset() {
    to.draftMessage = to.newMessage();
    editor.commands.setContent(""); // TODO fix HTMLEditor to listen to `html`
  }

  /** Не отправилось. Если протокол показывает сообщение как «Не отправлено» с повтором,
   * оно остаётся в чате. Иначе возвращаем его в редактор, если там ничего нового не набрано. */
  function restoreDraft(room: ChatRoom, msg: ChatMessage) {
    let shownAsFailed = msg.deliveryStatus == DeliveryStatus.Failed && room.messages.contents.includes(msg);
    let draft = room.draftMessage;
    if (shownAsFailed || draft?.hasHTML || draft?.attachments.hasItems) {
      return;
    }
    room.draftMessage = msg;
    if (room == to) {
      to = to; // обновить привязку редактора к черновику
      editor?.commands.setContent(msg.rawHTMLDangerous ?? "");
    }
  }

  function onAddAttachment(event: CustomEvent) {
    addFiles(event.detail.files as File[]);
  }

  function addFiles(files: File[]) {
    for (let file of files) {
      let att = to.draftMessage.newAttachment();
      att.fromFile(file);
      attachments.add(att);
    }
  }

  /** Ctrl+V с файлом или снимком экрана: вложение, как при перетаскивании.
   * Иначе редактор вставлял картинку в текст (base64), а она не доходила до собеседника. */
  function onPaste(event: ClipboardEvent) {
    // Файл из Finder приходит вместе с картинкой-иконкой: иконку не прикрепляем
    let pasted = classifyPastedFiles(filesFromClipboard(event.clipboardData));
    let files = [...pasted.attach, ...pasted.inline]
      .map(file => file.name && file.name != "image.png" ? file : renamePastedImage(file));
    if (!files.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    addFiles(files);
  }

  /** У снимка экрана из буфера имя всегда «image.png»: даём понятное и разное */
  function renamePastedImage(file: File): File {
    let ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    let now = new Date();
    let pad = (n: number) => String(n).padStart(2, "0");
    // Местное время, а не UTC: имя совпадает с часами пользователя
    let stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return new File([file], `${gt`Image`} ${stamp}.${ext}`, { type: file.type });
  }

  /** Картинки, вставленные в текст как data: (из буфера с HTML), уходят вложениями:
   * в тексте они превышали предел сообщения и вырезались у получателя. */
  function moveInlineImagesToAttachments(msg: ChatMessage) {
    if (!msg.rawHTMLDangerous?.includes("data:")) {
      return;
    }
    let doc = new DOMParser().parseFromString(msg.rawHTMLDangerous, "text/html");
    let images = [...doc.querySelectorAll("img")].filter(img => img.src.startsWith("data:"));
    for (let img of images) {
      // insertImage() уже положил эту картинку во вложения как встроенную: без этого получатель видел её дважды
      let inline = msg.attachments.find(attachment => attachment.related && attachment.dataURL == img.getAttribute("src"));
      if (inline) {
        msg.attachments.remove(inline);
      }
      let file = dataURLToFile(img.src);
      if (file) {
        let att = msg.newAttachment();
        att.fromFile(file);
        msg.attachments.add(att);
      }
      img.remove();
    }
    msg.rawHTMLDangerous = doc.body.innerHTML;
  }

  function dataURLToFile(url: string): File | null {
    let match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
    if (!match || !match[2]) {
      return null;
    }
    let bytes = Uint8Array.from(atob(match[3]), char => char.charCodeAt(0));
    return renamePastedImage(new File([bytes], "image.png", { type: match[1] }));
  }

  async function onAddInline(event: CustomEvent) {
    let files = event.detail.files as File[];
    for (let file of files) {
      await insertImage(editor, file, to.draftMessage); // sequential, to keep the image order
    }
  }

  async function onGraphic(ev: CustomEvent<GraphicSelection>) {
    if (ev.detail.file) {
      await insertImage(editor, ev.detail.file, to.draftMessage, ev.detail.width);
      return;
    }
    let emoji = ev.detail.emoji;
    if (emoji) {
      editor.commands.insertContent(emoji);
    }
  }

  function onAttachmentRemove(event: CustomEvent<Attachment>) {
    removeImageForAttachment(editor, event.detail);
  }

  function onEditorChange() {
    removeOrphanedInlineAttachments(editor, to.draftMessage);
    if (to instanceof JackdawChatRoom && !to.draftMessage?.isEdit && to.draftMessage?.hasHTML) {
      to.sendTyping();
    }
  }

  function onEmojiBackspace() {
    editor.view.focus();
    document.execCommand("delete");
  }
</script>

<style>
  .msg-editor {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    padding: 4px 4px 10px 10px;
    box-sizing: border-box;
    flex: 0 0 auto;
    min-height: 126px;
    min-width: 0;
  }
  .emojis {
    height: 300px;
    min-height: 0;
    min-width: 0;
    width: 600px;
  }
  .typing {
    padding: 2px 16px;
    opacity: 0.75;
    font-style: italic;
  }
  .compose-context {
    align-items: center;
    gap: 8px;
    margin: 4px 12px 0;
    padding: 6px 8px 6px 12px;
    border-inline-start: 3px solid var(--selected-border, currentColor);
    border-radius: 4px;
    background-color: var(--hover-bg);
  }
  .context-text {
    min-width: 0;
    gap: 2px;
  }
  .context-title {
    font-weight: 600;
  }
  .context-snippet {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
  }
  .attachments {
    height: 112px;
  }
  .attachments :global(.attachments-pane .inside) {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: start;
  }
  .attachments :global(.attachments-pane .attachment) {
    min-width: 200px;
  }
  .attachments :global(.attachments-pane .buttons) {
    margin-inline-start: 12px;
  }
  .editor-wrapper {
    flex: 3 1 0;
    height: 112px;
    min-height: 112px;
    min-width: 0;
  }
  .editor-row {
    flex: 0 0 auto;
    min-height: 112px;
    min-width: 0;
  }
  .editor-scroll-wrapper {
    background-color: var(--main-bg);
    color: var(--main-bf);
    border: 1px solid var(--border);
    border-radius: 8px;
    min-height: 0;
    min-width: 0;
  }
  .editor {
    font-family: unset;
    padding: 8px 12px;
  }
  .send-buttons {
    align-self: flex-end;
    margin-inline-start: 2px;
    margin-block-end: 2px;
  }
  .send-buttons :global(.button) {
    background-color: unset;
  }
</style>
