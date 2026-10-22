<!-- Чат в правой боковой панели: можно писать письмо и одновременно смотреть переписку.
  Список чатов → выбранный чат с лентой и полем ввода; «Назад» возвращает к списку. -->
<vbox flex class="chat-widget">
  {#if room}
    <hbox class="room-bar">
      <RoundButton label={$t`All chats`} icon={BackIcon} iconSize="16px" padding="4px" border={false} classes="plain"
        onClick={() => room = null} />
      <vbox flex class="room-title">
        <span class="name" title={$room.name}>{$room.name}</span>
        {#if peerEmail}
          <span class="email font-smallest" title={peerEmail}>{peerEmail}</span>
        {/if}
      </vbox>
      <RoundButton label={$t`Open in chat`} icon={ExpandIcon} iconSize="14px" padding="4px" border={false} classes="plain"
        onClick={() => openChatRoomFromOtherApp(room)} />
    </hbox>
    <vbox flex class="messages">
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
        <button type="button" class="room-row" on:click={() => room = item}>
          <hbox flex class="row-main">
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
  import { openChatRoomFromOtherApp } from "../Chat/open";
  import { chatUnreadTotal } from "../Chat/chatUnread";
  import BackIcon from "lucide-svelte/icons/arrow-left";
  import ExpandIcon from "lucide-svelte/icons/maximize-2";
  import { mergeColls } from "svelte-collections";
  import { backgroundError } from "../Util/error";
  import { t } from "../../l10n/l10n";

  let room: ChatRoom | null = null;

  const chatAccounts = appGlobal.chatAccounts;
  $: rooms = mergeColls($chatAccounts.map(account => account.rooms));
  /* Свежие чаты сверху; $chatUnreadTotal — чтобы список обновлялся при новых сообщениях */
  $: sortedRooms = $chatUnreadTotal >= 0 && $rooms.contents
    .slice()
    .sort((a, b) => (b.lastMessage?.sent?.getTime() ?? 0) - (a.lastMessage?.sent?.getTime() ?? 0));
  $: peerEmail = room instanceof JackdawChatRoom && !room.isGroup ? room.peerEmail : null;

  $: room && load(room);
  async function load(target: ChatRoom) {
    try {
      await target.listMembers();
      await target.listMessages();
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
