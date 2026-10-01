<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<vbox flex class="message-display"
  class:message-background-white={messageBackground == "white"}
  class:message-background-dark={messageBackground == "dark"}
  on:keydown={event => catchErrors(() => onKeyOnMessage(event, onZoomKey))}
  on:wheel|capture={onZoomWheel}
  tabindex={0}
  >
  <MessageHeader bind:message />
  <MessageAttachments attachments={message.attachments} />
  <SMLDisplayKinds {message} sml={message.sml} />
  <vbox class="body" flex>
    <Paper>
      <MessageBody {message} {zoom} on:zoomwheel={onZoomWheelFromBody} />
    </Paper>
  </vbox>
  {#if $appGlobal.isMobile}
    <MessageDisplayBarM bind:message />
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { onKeyOnMessage } from "./MessageKeyboard";
  import { appGlobal } from "../../../logic/app";
  import MessageHeader from "./MessageHeader.svelte";
  import MessageAttachments from "./AttachmentsUI.svelte";
  import MessageBody from "./MessageBody.svelte";
  import SMLDisplayKinds from "../SML/SMLDisplayKinds.svelte";
  import MessageDisplayBarM from "./MessageDisplayBarM.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import { catchErrors } from "../../Util/error";
  import {
    getMessageViewerBackgroundSetting,
    normalizeMessageViewerBackground,
  } from "./messageViewerAppearance";
  import {
    clampMessageZoom,
    getMessageZoomSetting,
    isMessageZoomWheelEvent,
    kMessageZoomDefault,
    messageZoomKeyDirection,
    stepMessageZoom,
  } from "./messageZoom";

  export let message: EMail;

  let messageBackgroundSetting = getMessageViewerBackgroundSetting();
  $: messageBackground = normalizeMessageViewerBackground($messageBackgroundSetting.value);

  let zoomSetting = getMessageZoomSetting();
  $: zoom = clampMessageZoom($zoomSetting.value);

  function setZoom(next: number) {
    zoomSetting.value = clampMessageZoom(next);
  }

  function onZoomWheel(event: WheelEvent) {
    if (!isMessageZoomWheelEvent(event)) {
      return;
    }
    event.preventDefault();
    setZoom(stepMessageZoom(zoom, event.deltaY > 0 ? -1 : 1));
  }

  function onZoomWheelFromBody(event: CustomEvent<{ direction: 1 | -1 }>) {
    setZoom(stepMessageZoom(zoom, event.detail.direction));
  }

  function onZoomKey(event: KeyboardEvent): boolean {
    let direction = messageZoomKeyDirection(event);
    if (direction == null) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    setZoom(direction == 0 ? kMessageZoomDefault : stepMessageZoom(zoom, direction));
    return true;
  }
</script>

<style>
  .message-display {
    --message-viewer-bg: var(--main-bg);
    --message-viewer-fg: var(--main-fg);
    background-color: var(--message-viewer-bg);
    color: var(--message-viewer-fg);
  }
  .message-display.message-background-white {
    --message-viewer-bg: #ffffff;
    --message-viewer-fg: #111827;

    /*
     * Элементы управления письмом находятся внутри просмотрщика, но их
     * общие стили используют токены темы приложения. При белом фоне письма
     * они должны оставаться читаемыми даже в тёмной теме приложения.
     */
    --bg: #ffffff;
    --fg: #111827;
    --main-bg: #ffffff;
    --main-fg: #111827;
    --border: #c7ced8;
    --hover-bg: #edf1f5;
    --hover-fg: #111827;
    --icon-primary: #9a5b00;
    --button-bg: #f5f6f8;
    --button-fg: #111827;
    --button-border: #b8c1cc;
    --selected-bg: #f4dfb5;
    --selected-fg: #111827;
    --selected-hover-bg: #edcc8a;
    --selected-hover-fg: #111827;
    --offset-bg: #f1f3f5;
    --offset-fg: #111827;
    --inverted-bg: #111827;
    --inverted-fg: #ffffff;
    --link-fg: #9a5b00;
    --link-hover-fg: #754200;
    --surface-subtle: #f4f5f7;
    --leftbar-bg: #f5f6f8;
    --leftbar-fg: #111827;
    --input-bg: #ffffff;
    --input-fg: #111827;
    --input-line: #b8c1cc;
    --input-placeholder: #6b7280;
    --danger-fg: #b42318;
    --glass-bg-elevated: rgba(255, 255, 255, 0.98);
    --glass-border: #c7ced8;
    --glass-hover-bg: rgba(17, 24, 39, 0.06);
    --glass-selected-bg: #f4f6f8;
    --glass-selected-border: rgba(154, 91, 0, 0.4);
    --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.85);
    --glass-shadow: 0 12px 28px rgba(17, 24, 39, 0.18);
  }
  .message-display.message-background-white :global(button.plain) {
    color: var(--message-viewer-fg);
  }
  .message-display.message-background-dark {
    --message-viewer-bg: #1a1a1c;
    --message-viewer-fg: #e5e7eb;

    /*
     * Тёмный фон письма должен быть самодостаточным: часть контролов
     * использует токены темы приложения, а не цвет самого просмотрщика.
     * Иначе при светлых/пользовательских токенах иконки становятся чёрными
     * на тёмной панели.
     */
    --bg: #1a1a1c;
    --fg: #e5e7eb;
    --main-bg: #1a1a1c;
    --main-fg: #e5e7eb;
    --border: #3a3d3f;
    --hover-bg: #2b2f33;
    --hover-fg: #f3f4f6;
    --icon-primary: #d79a31;
    --button-bg: #232628;
    --button-fg: #e5e7eb;
    --button-border: #454847;
    --selected-bg: #4a351d;
    --selected-fg: #f3e8d4;
    --selected-hover-bg: #65471f;
    --selected-hover-fg: #fff3de;
    --offset-bg: #27231e;
    --offset-fg: #f0e7d8;
    --inverted-bg: #eeeae3;
    --inverted-fg: #151718;
    --link-fg: #e2a842;
    --link-hover-fg: #f0bd62;
    --surface-subtle: #232628;
    --leftbar-bg: #1a1c1e;
    --leftbar-fg: #e9e5de;
    --input-bg: #1b1d1e;
    --input-fg: #eeeae3;
    --input-line: #434546;
    --input-placeholder: #9b9891;
    --danger-fg: #e17b65;
    --shadow-color: 0, 0, 0;
    --glass-bg-elevated: rgba(32, 34, 36, 0.96);
    --glass-border: rgba(255, 255, 255, 0.15);
    --glass-hover-bg: rgba(255, 255, 255, 0.08);
    --glass-selected-bg: rgba(255, 255, 255, 0.16);
    --glass-selected-border: rgba(215, 154, 49, 0.44);
    --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.12);
    --glass-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  }
  .message-display :global(.paper) {
    background-color: var(--message-viewer-bg);
    color: var(--message-viewer-fg);
    box-shadow: none;
    border-radius: 0;
    outline: none;
  }
  .body {
    margin-inline: 8px 16px;
    margin-block-end: 2px;
  }
  @media (max-width: 600px)  {
    .body {
      margin-inline-start: 4px;
      margin-inline-end: 1px;
      margin-block-end: 1px;
    }
  }
</style>
