<vbox flex class="pane">
  {#if messages && room }
    <PersonHeader person={room.contact} />
    <vbox flex class="messages">
      <MessageList {messages}>
        <svelte:fragment slot="message" let:message let:previousMessage>
          {#if message instanceof ChatMessage }
            <Message {message} {previousMessage} hideHeaderFollowup={true} />
          {:else if message instanceof ChatRoomEvent}
            <RoomEventUI {message} />
          {/if}
          </svelte:fragment>
      </MessageList>
    </vbox>
    <vbox class="editor">
      <MsgEditor to={room} />
    </vbox>
  {:else if !room}
    <vbox class="empty" role="status">
      <h2>{$t`No chat selected`}</h2>
      <p>{$t`Choose a chat on the left, or type a name in the search field to find a contact and write to them.`}</p>
    </vbox>
  {/if}
</vbox>
{#if $appGlobal.isMobile}
  <RoomBarM />
{/if}

<script lang="ts">
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { ChatMessage } from "../../logic/Chat/ChatMessage";
  import { ChatRoomEvent } from "../../logic/Chat/RoomEvent";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import MessageList from "./MessageView/MessageList.svelte";
  import Message from "./MessageView/Message.svelte";
  import RoomEventUI from "./MessageView/RoomEventUI.svelte";
  import MsgEditor from "./MsgEditor.svelte";
  import PersonHeader from "./PersonHeader.svelte";
  import RoomBarM from "./RoomBarM.svelte";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";

  export let room: ChatRoom;

  $: messages = $globalSearchTerm
    ? room?.messages.filterObservable(msg => msg.text?.toLowerCase().includes($globalSearchTerm))
    : room?.messages;

  $: room && catchErrors(loadMessages)
  async function loadMessages() {
    await room?.listMembers();
    await room?.listMessages();
  }
</script>

<style>
  .messages {
    background: url(../asset/background-repeat.png) repeat;
    background-blend-mode: soft-light;
    background-color: var(--offset-bg);
    color: var(--offset-fg);
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
  .empty {
    margin: auto;
    padding: 24px;
    text-align: center;
  }
  .empty h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .empty p {
    margin: 0;
    opacity: 0.75;
  }
  .editor {
    flex: 0 0 auto;
    height: max-content;
    min-height: 126px;
    min-width: 0;
  }
  .editor > :global(.container) {
    flex: 0 0 auto;
  }
</style>
