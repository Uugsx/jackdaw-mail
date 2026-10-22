<!-- Поделиться письмом или событием в чате Jackdaw: выбор чата и комментарий -->
{#if $shareToChatRequest}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" use:portalToBody on:click|self={close}>
    <vbox class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-chat-title">
      <h2 id="share-chat-title">{$t`Send to chat`}</h2>
      <LinkCard link={$shareToChatRequest} />
      {#if !account}
        <p class="hint">{$t`Jackdaw chat is not connected on this device.`}</p>
      {:else if !rooms.length}
        <p class="hint">{$t`No chats yet. Start a chat in the Chat app or from a contact.`}</p>
      {:else}
        <input type="search" bind:value={filter} placeholder={$t`Find a chat`} aria-label={$t`Find a chat`} />
        <vbox class="rooms" role="listbox" aria-label={$t`Chats`}>
          {#each shownRooms as room (room.id)}
            <button type="button" class="room" class:selected={room == target} role="option" aria-selected={room == target}
              on:click={() => target = room}
              on:dblclick={() => catchErrors(send)}>
              {room.name}
            </button>
          {/each}
        </vbox>
        <input type="text" bind:value={comment} placeholder={$t`Comment (optional)`} aria-label={$t`Comment`}
          on:keydown={event => event.key == "Enter" && target && catchErrors(send)} />
      {/if}
      <hbox class="actions">
        <Button label={$t`Cancel`} plain onClick={close} />
        <Button label={$t`Send`} classes="filled" disabled={!target} onClick={send} />
      </hbox>
    </vbox>
  </div>
{/if}
<svelte:window on:keydown={event => event.key == "Escape" && $shareToChatRequest && close()} />

<script lang="ts">
  import { appGlobal } from "../../logic/app";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { JackdawChatRoom } from "../../logic/Chat/Jackdaw/JackdawChatRoom";
  import { JackdawChatMessage } from "../../logic/Chat/Jackdaw/JackdawChatMessage";
  import { shareToChatRequest } from "./shareToChat";
  import { openChatRoomFromOtherApp } from "./open";
  import LinkCard from "./MessageView/LinkCard.svelte";
  import Button from "../Shared/Button.svelte";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";

  const chatAccounts = appGlobal.chatAccounts;
  $: account = $chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  let filter = "";
  let comment = "";
  let target: JackdawChatRoom | null = null;
  $: rooms = ($shareToChatRequest && account ? account.rooms.contents : [])
    .filter((room): room is JackdawChatRoom => room instanceof JackdawChatRoom && room.isMember)
    .sort((a, b) => (b.lastMessage?.sent?.getTime() ?? 0) - (a.lastMessage?.sent?.getTime() ?? 0));
  $: shownRooms = rooms.filter(room => !filter || room.name?.toLowerCase().includes(filter.toLowerCase()));
  /* Единственный чат выбран сразу: остаётся нажать «Отправить» */
  $: if (!target && rooms.length == 1) {
    target = rooms[0];
  }

  function close() {
    $shareToChatRequest = null;
    filter = "";
    comment = "";
    target = null;
  }

  async function send() {
    let link = $shareToChatRequest;
    let room = target;
    if (!link || !room) {
      return;
    }
    let message = room.newMessage() as JackdawChatMessage;
    message.links = [link];
    message.text = comment.trim(); // строка-заглушка для старых версий добавляется при отправке
    message.outgoing = true;
    message.contact = room.contact;
    message.sent = new Date();
    close();
    openChatRoomFromOtherApp(room);
    await room.sendMessage(message);
  }

  function portalToBody(node: HTMLElement) {
    document.body.append(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.35);
  }
  .dialog {
    width: 420px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    gap: 12px;
    padding: 20px;
    border-radius: 12px;
    background-color: var(--main-bg);
    color: var(--main-fg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  h2 {
    margin: 0;
    font-size: 1.15em;
  }
  .hint {
    margin: 0;
    opacity: 0.8;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--main-fg) 14%, transparent);
    border-radius: 8px;
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  input:focus {
    border-color: var(--input-focus, var(--selected-border));
    outline: none;
  }
  .rooms {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .room {
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: pointer;
  }
  .room:hover {
    background-color: var(--hover-bg);
  }
  .room.selected {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .room:focus-visible {
    outline: 2px solid var(--selected-border);
    outline-offset: -2px;
  }
  .actions {
    justify-content: flex-end;
    gap: 8px;
  }
</style>
