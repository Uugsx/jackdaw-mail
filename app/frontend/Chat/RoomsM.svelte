<vbox flex class="pane">
  <Header bind:selectedAccount={$selectedAccount} {accounts} />
  <RoomList {rooms} account={$selectedAccount} bind:selectedRoom bind:selectedContact {doSearch} />
</vbox>
{#if $appGlobal.isMobile}
  <RoomsBarM />
{/if}

<script lang="ts">
  import { ChatRoom } from "../../logic/Chat/ChatRoom";
  import { openChatRoomFromOtherApp } from "./open";
  import { selectedAccount } from "./selected";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { appGlobal } from "../../logic/app";
  import Header from "./Header.svelte";
  import RoomList from "./RoomList.svelte";
  import RoomsBarM from "./RoomsBarM.svelte";
  import { mergeColls } from "svelte-collections";
  import type { Person } from "../../logic/Abstract/Person";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { callTargetEmails } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { catchErrors } from "../Util/error";
  import { UserError } from "../../logic/util/util";
  import { gt } from "../../l10n/l10n";

  export let doSearch = false;

  $: accounts = appGlobal.chatAccounts.filterObservable(acc => acc.workspace == $selectedWorkspace || !$selectedWorkspace);
  $: rooms = $selectedAccount ? $selectedAccount.rooms : mergeColls(accounts.map(a => a.rooms));

  let selectedRoom: ChatRoom = null;

  $: selectedRoom instanceof ChatRoom && openChatRoomFromOtherApp(selectedRoom);

  /** Контакт без чата из результатов поиска: открываем чат Jackdaw с ним или объясняем, почему нельзя */
  let selectedContact: Person | null = null;
  $: selectedContact && catchErrors(() => openContactChat(selectedContact));
  async function openContactChat(contact: Person) {
    let account = appGlobal.chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
    if (!account?.isOnline) {
      throw new UserError(gt`Jackdaw chat is not connected on this device. Confirm your address for calls and chat in the settings.`);
    }
    let emails = callTargetEmails(contact);
    for (let email of emails) {
      if (await account.canChatWith(email)) {
        openChatRoomFromOtherApp(await account.getDirectRoom(email));
        return;
      }
    }
    throw new UserError(gt`${contact.name} does not use Jackdaw chat yet, or has not confirmed this address. You can send an email.`);
  }
</script>

<style>
  .pane {
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on MessageList */
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
</style>
