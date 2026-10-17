<Splitter name="persons-list" initialRightRatio={4}>
  <vbox class="left-pane" slot="left">
    <Header bind:selectedAccount={$selectedAccount} {accounts} />
    <RoomList {rooms} bind:selectedRoom={$selectedRoom} />
  </vbox>
  <vbox class="right-pane  background-pattern" slot="right">
    {#if messages && $selectedRoom }
      <PersonHeader person={$selectedRoom.contact} />
      <vbox flex class="messages">
        <MessageList {messages}>
          <svelte:fragment slot="message" let:message let:previousMessage>
            {#if message instanceof ChatMessage }
              <Message {message} {previousMessage} hideHeaderFollowup={true} />
            {:else if message instanceof ChatRoomEvent}
              <ChatRoomEventUI {message} />
            {/if}
            </svelte:fragment>
        </MessageList>
      </vbox>
      <vbox class="editor">
        <MsgEditor to={$selectedRoom} />
      </vbox>
    {/if}
  </vbox>
</Splitter>

<script lang="ts">
  import { Person } from "../../logic/Abstract/Person";
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { ChatPersonUID } from "../../logic/Chat/ChatPersonUID";
  import { ChatMessage } from "../../logic/Chat/ChatMessage";
  import { ChatRoomEvent } from "../../logic/Chat/RoomEvent";
  import { selectedAccount, selectedRoom } from "./selected";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { selectedPerson } from "../Contacts/Person/Selected";
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import { appGlobal } from "../../logic/app";
  import MessageList from "./MessageView/MessageList.svelte";
  import Message from "./MessageView/Message.svelte";
  import ChatRoomEventUI from "./MessageView/RoomEventUI.svelte";
  import MsgEditor from "./MsgEditor.svelte";
  import Header from "./Header.svelte";
  import PersonHeader from "./PersonHeader.svelte";
  import RoomList from "./RoomList.svelte";
  import Splitter from "../Shared/Splitter.svelte";
  import { catchErrors } from "../Util/error";
  import { mergeColls } from "svelte-collections";
  import { onMount } from "svelte";

  $: accounts = appGlobal.chatAccounts.filterObservable(acc => acc.workspace == $selectedWorkspace || !$selectedWorkspace);
  $: rooms = $selectedAccount ? $selectedAccount.rooms : mergeColls(accounts.map(a => a.rooms));
  $: messages = $globalSearchTerm
    ? $selectedRoom?.messages.filterObservable(msg => msg.text?.toLowerCase().includes($globalSearchTerm))
    : $selectedRoom?.messages;

  $: $selectedRoom && catchErrors(loadMessages)
  async function loadMessages() {
    let room = $selectedRoom;
    if (!(room instanceof ChatRoom)) {
      return;
    }
    await room.listMembers();
    await room.listMessages();
  }

  onMount(() => {
    // null, а не undefined: иначе список комнат подставит своё значение по умолчанию (человека).
    $selectedRoom = ($selectedPerson && rooms.find(room => roomMatchesPerson(room, $selectedPerson))) || null;
  });
  function roomMatchesPerson(room: ChatRoom, person: Person): boolean {
    return room.contact instanceof ChatPersonUID && room.contact.matchesPerson(person);
  }

  $: linkSelectedPerson($selectedRoom);
  /** Link the open chat to an addressbook contact, so the other apps show the same person. */
  function linkSelectedPerson(room: ChatRoom | null) {
    let contact = room?.contact;
    let person = contact instanceof ChatPersonUID ? contact.findPerson()
      : contact instanceof Person ? contact : null;
    if (person) {
      $selectedPerson = person;
    }
  }

  $: $rooms, clearSelectedChat()
  function clearSelectedChat() {
    if (!rooms.contains($selectedRoom)) {
      $selectedRoom = rooms.last ?? null;
    }
  }
</script>

<style>
  .left-pane {
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on MessageList */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .right-pane {
    min-height: 0;
    min-width: 0;
  }
  .messages {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
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
