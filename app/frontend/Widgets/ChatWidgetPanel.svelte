<!-- Чат в правой боковой панели: можно писать письмо и одновременно смотреть переписку.
  Список чатов → выбранный чат с лентой и полем ввода; «Назад» возвращает к списку. -->
<vbox flex class="chat-widget">
  {#if room}
    <hbox class="room-bar">
      <RoundButton label={$t`All chats`} icon={BackIcon} iconSize="16px" padding="4px" border={false} classes="plain back"
        onClick={() => openRoom(null)} />
      <vbox flex class="room-title">
        <span class="name" title={$room.name}>{$room.name}</span>
        {#if peerEmail}
          <!-- Статус собеседника, как в шапке большого окна: видно, ответит ли он сейчас -->
          <hbox class="presence font-smallest" title={presence ? statusHint(presence) : peerEmail}>
            {#if presence}
              <StatusDot status={presence} size="8px" />
              <span class="presence-label">{statusLabel(presence)}</span>
              <span class="separator" aria-hidden="true">·</span>
            {/if}
            <span class="email">{peerEmail}</span>
          </hbox>
        {:else if groupMemberCount}
          <span class="email font-smallest">{$plural(groupMemberCount, { one: "# member", other: "# members" })}</span>
        {/if}
      </vbox>
      <RoundButton label={$t`Open in chat`} icon={ExpandIcon} iconSize="14px" padding="4px" border={false} classes="plain"
        onClick={() => openChatWidgetInMainWindow(room)} />
    </hbox>
    <vbox flex class="messages" bind:this={messagesE} on:scroll|capture={onScroll}>
      <MessageList messages={$room.messages}>
        <svelte:fragment slot="message" let:message let:previousMessage>
          {#if message instanceof ChatMessage}
            <Message {message} {previousMessage} hideHeaderFollowup={true} />
          {:else if message instanceof ChatRoomEvent}
            <ChatRoomEventUI {message} />
          {/if}
        </svelte:fragment>
      </MessageList>
    </vbox>
    {#if !(room instanceof JackdawChatRoom) || room.isMember}
      <vbox class="editor">
        <MsgEditor to={room} />
      </vbox>
    {/if}
  {:else if $rooms.isEmpty}
    <vbox class="empty" role="status">
      <p>{$t`No chats yet. Start a chat in the Chat app or from a contact.`}</p>
    </vbox>
  {:else}
    <vbox flex class="room-list">
      {#each sortedRooms as item (item.id)}
        <button type="button" class="room-row" on:click={() => openRoom(item)}>
          <hbox flex class="row-main">
            {#if rowPresence(item, $callClient)}
              <StatusDot status={rowPresence(item, $callClient)} size="8px" />
            {/if}
            <span class="row-name">{item.name}</span>
            {#if item.unreadCount}
              <span class="unread">{item.unreadCount > 99 ? "99+" : item.unreadCount}</span>
            {/if}
          </hbox>
          <span class="row-text font-smallest"><RoomSummary room={item} part="text" /></span>
        </button>
      {/each}
    </vbox>
  {/if}
</vbox>

<svelte:window on:focus={markRead} />

<script lang="ts">
  import { appGlobal } from "../../logic/app";
  import type { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { ChatMessage } from "../../logic/Chat/ChatMessage";
  import { ChatRoomEvent } from "../../logic/Chat/RoomEvent";
  import { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import MessageList from "../Chat/MessageView/MessageList.svelte";
  import Message from "../Chat/MessageView/Message.svelte";
  import ChatRoomEventUI from "../Chat/MessageView/RoomEventUI.svelte";
  import MsgEditor from "../Chat/MsgEditor.svelte";
  import RoomSummary from "../Chat/RoomSummary.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import StatusDot from "../Chat/Status/StatusDot.svelte";
  import { presenceOf, statusHint, statusLabel, type PresenceState } from "../Chat/Status/statusLabels";
  import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import type { JackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCallClient";
  import {
    chatWidgetPlaceSetting,
    chatWidgetRoom,
    openChatWidgetInMainWindow,
    rememberChatWidgetRoom,
    rememberChatWidgetScroll,
  } from "./chatWidgetState";
  import { onDestroy, tick } from "svelte";
  import { chatUnreadTotal } from "../Chat/chatUnread";
  import BackIcon from "lucide-svelte/icons/arrow-left";
  import ExpandIcon from "lucide-svelte/icons/maximize-2";
  import { mergeColls } from "svelte-collections";
  import { backgroundError } from "../Util/error";
  import { t, plural } from "../../l10n/l10n";

  /** Открытый в панели чат переживает скрытие панели и перезапуск (см. chatWidgetState) */
  let room: ChatRoom | null = null;
  let messagesE: HTMLElement;
  /** Сохранённый чат ещё не найден: аккаунты чата загружаются после панели */
  let restorePending = !!chatWidgetPlaceSetting.value;
  /** Прокрутку восстанавливаем один раз, после загрузки ленты */
  let restoreScrollTop: number | null = null;

  function openRoom(target: ChatRoom | null) {
    restorePending = false;
    restoreScrollTop = null;
    room = target;
    rememberChatWidgetRoom(target);
  }

  const chatAccounts = appGlobal.chatAccounts;
  $: rooms = mergeColls($chatAccounts.map(account => account.rooms));
  /* Свежие чаты сверху; $chatUnreadTotal — чтобы список обновлялся при новых сообщениях */
  $: sortedRooms = $chatUnreadTotal >= 0 && $rooms.contents
    .slice()
    .sort((a, b) => (b.lastMessage?.sent?.getTime() ?? 0) - (a.lastMessage?.sent?.getTime() ?? 0));
  $: peerEmail = room instanceof JackdawChatRoom && !room.isGroup ? room.peerEmail : null;
  $: groupMemberCount = room instanceof JackdawChatRoom && room.isGroup && $room ? room.memberEmails.length : 0;
  $: chatWidgetRoom.set(room);
  onDestroy(() => chatWidgetRoom.set(null));

  /* Присваивание `room` прямо здесь, а не в функции: тогда Svelte пересчитает зависящие от него строки
   * (адрес и статус собеседника) после восстановления */
  $: if (restorePending && $rooms) {
    room = restoredRoom() ?? room;
  }
  function restoredRoom(): ChatRoom | null {
    const place = chatWidgetPlaceSetting.value;
    let saved = place && $rooms.contents.find(item => item.id == place.roomID);
    if (!place || saved) {
      restorePending = false;
      restoreScrollTop = place?.scrollTop ?? null;
    }
    return saved || null;
  }

  const callClient = getJackdawCallClient();
  let presence: PresenceState | null = null;
  $: presence = $callClient && $callClient.presenceVersion >= 0 && peerEmail
    ? presenceOf(callClient, [peerEmail])
    : null;
  /** Статус собеседника в строке списка: только у личных чатов Jackdaw */
  function rowPresence(item: ChatRoom, client: JackdawCallClient | null): PresenceState | null {
    if (!client || client.presenceVersion < 0 || !(item instanceof JackdawChatRoom) || item.isGroup || !item.peerEmail) {
      return null;
    }
    return presenceOf(client, [item.peerEmail]);
  }

  /** Лента прокручена до конца — запоминаем «внизу», чтобы новые сообщения были видны */
  const kBottomSlackPx = 24;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let saveScroll: (() => void) | null = null;
  function onScroll(event: Event) {
    let target = event.target as HTMLElement;
    if (!room || !target?.classList?.contains("scroll")) {
      return;
    }
    let roomID = room.id;
    // Позицию снимаем сразу: при скрытии панели лента уже вне документа
    let atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < kBottomSlackPx;
    let scrollTop = atBottom ? null : Math.round(target.scrollTop);
    clearTimeout(scrollTimer);
    saveScroll = () => {
      saveScroll = null;
      rememberChatWidgetScroll(roomID, scrollTop);
    };
    scrollTimer = setTimeout(saveScroll, 200);
  }
  /* Панель скрыли сразу после прокрутки: позиция всё равно сохраняется */
  onDestroy(() => {
    clearTimeout(scrollTimer);
    saveScroll?.();
  });

  async function restoreScroll() {
    let top = restoreScrollTop;
    restoreScrollTop = null;
    if (top == null) {
      return;
    }
    // Лента сама прокручивается вниз после отрисовки сообщений: ставим позицию после неё
    await tick();
    requestAnimationFrame(() => {
      let scroller = messagesE?.querySelector(".scroll") as HTMLElement | null;
      if (scroller) {
        scroller.scrollTop = top;
      }
    });
  }

  $: room && load(room);
  async function load(target: ChatRoom) {
    try {
      await target.listMembers();
      await target.listMessages();
      await restoreScroll();
      markRead();
    } catch (ex) {
      backgroundError(ex);
    }
  }

  /* Новое сообщение в открытом здесь чате видно — отмечаем прочитанным */
  $: room && $room && $room.unreadCount && markRead();
  function markRead() {
    if (room instanceof JackdawChatRoom && document.hasFocus()) {
      room.markAllRead().catch(backgroundError);
    }
  }
</script>

<style>
  /* «Назад» в арабском и иврите указывает вправо */
  :global([dir="rtl"]) .room-bar :global(.back svg) {
    transform: scaleX(-1);
  }
  .chat-widget {
    min-height: 0;
    min-width: 0;
  }
  .room-bar {
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-block-end: 1px solid var(--border);
  }
  .room-title {
    min-width: 0;
  }
  .name,
  .email,
  .row-name,
  .row-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .presence {
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .presence-label {
    flex: none;
  }
  .separator {
    flex: none;
    opacity: 0.6;
  }
  .presence .email {
    min-width: 0;
  }
  .email,
  .row-text {
    opacity: 0.7;
  }
  /* Лента забирает остаток высоты, поле ввода всегда видно внизу */
  .messages {
    flex: 1 1 0;
    min-height: 0;
  }
  .editor {
    flex: none;
  }
  /* Обёртка FileDropTarget растягивается от нулевой высоты: здесь ей нужна высота по содержимому */
  .editor > :global(*) {
    flex: 0 0 auto;
  }
  /* Узкая панель: кнопки форматирования в одну строку с прокруткой, чтобы не съедать поле ввода */
  .editor :global(.toolbar) {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .messages :global(.scroll) {
    overflow-x: hidden;
  }
  /* Лента узкая: сообщения на всю ширину панели, без больших отступов основного окна */
  .messages :global(.message) {
    max-width: 92%;
    margin-inline: 8px;
  }
  .editor :global(.msg-editor) {
    min-height: 0;
  }
  .editor :global(.emojis) {
    width: 100%;
  }
  .room-list {
    overflow-y: auto;
    min-height: 0;
  }
  .room-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 8px 12px;
    border: none;
    border-block-end: 1px solid var(--border);
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: pointer;
  }
  .room-row:hover {
    background-color: var(--hover-bg);
  }
  .room-row:focus-visible {
    outline: 2px solid var(--selected-border);
    outline-offset: -2px;
  }
  .row-main {
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .row-name {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 500;
  }
  .unread {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background-color: var(--selected-border, #d9822b);
    color: white;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }
  .empty {
    padding: 16px;
    opacity: 0.8;
  }
</style>
