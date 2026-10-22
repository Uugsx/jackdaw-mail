<!-- Две строки: учётные записи и «Новый чат», под ними свой статус. В одной строке статус
  наезжал на «Новый чат» в узкой колонке, и кнопка переставала нажиматься. -->
<vbox class="persons-toolbar">
  <hbox class="top-row">
    <AccountSelectorRound bind:selectedAccount {accounts} iconDefault={ChatIcon} />
    <hbox flex />
    <hbox class="buttons">
      {#if selectedAccount && !$selectedAccount.isLoggedIn}
        <RoundButton
          label={$t`Login`}
          icon={LoginIcon}
          classes="small"
          iconSize="12px"
          onClick={() => $selectedAccount.login(true)}
          />
      {/if}
      <ButtonMenu bind:isMenuOpen={isButtonMenuOpen}>
        <RoundButton
          slot="control"
          label={$t`New chat`}
          icon={AddIcon}
          iconSize="22px"
          padding="9px"
          onClick={() => isButtonMenuOpen = !isButtonMenuOpen}
          classes="large create"
          />
        <MenuItem
          label={$t`Chat with person`}
          onClick={() => dialogOpenPerson = true}
          />
        <!-- Комнаты по ID и новые комнаты есть не у всех протоколов: в чате Jackdaw — только группа -->
        {#if !isJackdaw}
          <MenuItem
            label={$t`Open existing chat room`}
            onClick={() => dialogOpenChatRoom = true}
            />
        {:else}
          <MenuItem
            label={$t`New group`}
            onClick={() => dialogNewChatRoom = true}
            />
        {/if}
      </ButtonMenu>
    </hbox>
  </hbox>
  {#if isJackdaw}
    <hbox class="my-status">
      <MyStatusButton />
    </hbox>
  {/if}
</vbox>
{#if dialogOpenPerson}
  <!-- Форма: Enter в поле адреса открывает чат так же, как кнопка со стрелкой -->
  <form class="dialog new-chat" on:submit|preventDefault={() => catchErrors(onOpenChatID)}>
    <hbox class="account">
      <h2 class="dialog-title">{$t`Chat with`}</h2>
      <hbox flex />
      <RoundButton
        label={$t`Close`}
        onClick={() => dialogOpenPerson = false}
        icon={XIcon}
        iconSize="16px"
        padding="2px"
        />
    </hbox>
    {#if $accounts.length > 1}
      <AccountDropDown accounts={appGlobal.chatAccounts} bind:selectedAccount filterByWorkspace={true} />
    {/if}
    <PersonAutocomplete skipPersonFunc={filterPerson} onAddPerson={person => catchErrors(() => openChatWithPerson(person))} />
    <label class="label or" for="new-chat-id">{isJackdaw ? $t`or enter an email address` : $t`or enter chat ID`}</label>
    <hbox class="chat-id">
      <input id="new-chat-id" type={isJackdaw ? "email" : "text"} bind:value={chatID}
        placeholder={isJackdaw ? "name@example.com" : ""} autocomplete="off" />
      <RoundButton
        label={$t`Open`}
        onClick={onOpenChatID}
        icon={OpenIcon}
        disabled={!chatID?.trim()}
        />
    </hbox>
  </form>
{:else if dialogOpenChatRoom}
  <vbox class="dialog">
    <hbox class="account">
      {$t`Open chat room`}
      <AccountDropDown accounts={appGlobal.chatAccounts} bind:selectedAccount filterByWorkspace={true} />
      <RoundButton
        label={$t`Close`}
        onClick={() => dialogOpenChatRoom = false}
        icon={XIcon}
        iconSize="16px"
        padding="2px"
        />
    </hbox>
    <input type="text" bind:value={chatRoomID} />
    <hbox class="buttons">
      <RoundButton
        label={$t`Open`}
        onClick={onOpenChatRoom}
        icon={OpenIcon}
        />
    </hbox>
  </vbox>
{:else if dialogNewChatRoom && selectedAccount instanceof JackdawChatAccount}
  <form class="dialog new-group" on:submit|preventDefault={() => catchErrors(createGroup)}>
    <hbox class="account">
      <h2 class="dialog-title">{$t`New group`}</h2>
      <hbox flex />
      <RoundButton
        label={$t`Close`}
        onClick={() => dialogNewChatRoom = false}
        icon={XIcon}
        iconSize="16px"
        padding="2px"
        />
    </hbox>
    <label for="new-group-name">{$t`Group name`}</label>
    <input id="new-group-name" type="text" bind:value={groupName} maxlength="120" placeholder={$t`Team`} />
    <label for="new-group-members">{$t`Members`}</label>
    <GroupMembersInput account={selectedAccount} members={groupMembers} bind:withoutChat={groupWithoutChat} bind:isChecking={groupChecking} />
    <hbox class="buttons">
      <RoundButton
        label={$t`Create group`}
        icon={OpenIcon}
        classes="create"
        disabled={!$groupMembers.length || groupChecking || $groupMembers.length <= groupWithoutChat.length}
        onClick={createGroup}
        />
    </hbox>
  </form>
{:else if dialogNewChatRoom}
{/if}


<script lang="ts">
  import type { ChatAccount } from "../../logic/Chat/ChatAccount";
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import AccountSelectorRound from "../Shared/AccountSelectorRound.svelte";
  import PersonAutocomplete from "../Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
  import GroupMembersInput from "./GroupMembersInput.svelte";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
  import MyStatusButton from "./Status/MyStatusButton.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import ChatIcon from "lucide-svelte/icons/message-square-text";
  import LoginIcon from "lucide-svelte/icons/key-round";
  import OpenIcon from "lucide-svelte/icons/circle-arrow-right";
  import XIcon from "lucide-svelte/icons/x";
  import { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";
  import AccountDropDown from "../Shared/AccountDropDown.svelte";
  import { appGlobal } from "../../logic/app";
  import { JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { selectedRoom } from "./selected";
  import { catchErrors } from "../Util/error";
  import { openJackdawChat } from "./openJackdawChat";
  import { ArrayColl } from "svelte-collections";

  export let accounts: Collection<ChatAccount>;
  export let selectedAccount: ChatAccount;

  let isButtonMenuOpen = false;
  $: isJackdaw = selectedAccount instanceof JackdawChatAccount;
  let dialogOpenPerson = false;
  let dialogOpenChatRoom = false;
  let dialogNewChatRoom = false;

  function filterPerson(person: PersonUID): boolean {
    if (!selectedAccount) {
      return false;
    }
    if (selectedAccount instanceof JackdawChatAccount) {
      return skipPersonWithoutEmail(person);
    }
    if (selectedAccount.protocol == "whatsapp") {
      return person.findPerson()?.phoneNumbers.hasItems;
    }
    return person.findPerson()?.chatAccounts.some(ce => ce.protocol == selectedAccount.protocol);
  }
  /** Чат Jackdaw адресуется по email: без адреса писать некуда */
  function skipPersonWithoutEmail(person: PersonUID): boolean {
    return !person.emailAddress?.includes("@");
  }

  async function openJackdawChatAndClose(account: JackdawChatAccount, email: string) {
    let room = await openJackdawChat(account, email);
    if (room) {
      $selectedRoom = room;
      dialogOpenPerson = false;
    }
  }

  async function openChatWithPerson(person: PersonUID) {
    if (!selectedAccount) {
      return;
    }
    if (selectedAccount instanceof JackdawChatAccount) {
      await openJackdawChatAndClose(selectedAccount, person.emailAddress);
      return;
    }
    let room = selectedAccount.newRoom(false);
    room.contact = selectedAccount.getPersonUID(person.emailAddress);
    selectedAccount.rooms.add(room);
    dialogOpenPerson = false;
  }

  let chatID: string;
  async function onOpenChatID() {
    if (!selectedAccount || !chatID?.trim()) {
      return;
    }
    if (selectedAccount instanceof JackdawChatAccount) {
      await openJackdawChatAndClose(selectedAccount, chatID);
      return;
    }
    let room = selectedAccount.newRoom(false);
    room.contact = selectedAccount.getPersonUID(chatID);
    selectedAccount.rooms.add(room);
  }
  let groupName = "";
  const groupMembers = new ArrayColl<PersonUID>();
  /** Выбранные участники без чата Jackdaw: в группу не попадут, диалог предупреждает о них */
  let groupWithoutChat: string[] = [];
  let groupChecking = false;
  async function createGroup() {
    if (!(selectedAccount instanceof JackdawChatAccount) || groupMembers.isEmpty) {
      return;
    }
    $selectedRoom = await selectedAccount.createGroup(groupName, groupMembers.contents.map(member => member.emailAddress));
    groupName = "";
    groupMembers.clear();
    groupWithoutChat = [];
    dialogNewChatRoom = false;
  }

  let chatRoomID: string;
  function onOpenChatRoom() {
    if (!selectedAccount || !chatRoomID?.trim()) {
      return;
    }
    let room = selectedAccount.newRoom(false);
    room.contact = selectedAccount.getPersonUID(chatRoomID); // TODO which contact for group?;
    selectedAccount.rooms.add(room);
  }
</script>

<style>
  .persons-toolbar {
    margin: 8px 12px 8px 16px;
    gap: 8px;
  }
  .top-row {
    align-items: center;
    gap: 8px;
  }
  /* Подпись «Jackdaw Mail» целиком, без многоточия */
  .top-row :global(.account) {
    width: 76px;
  }
  .buttons {
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .my-status {
    min-width: 0;
  }
  .dialog {
    margin: 16px;
  }
  .dialog .account {
    margin-block-end: 12px;
    align-items: center;
  }
  .label.or {
    margin-block: 6px;
  }
  .new-chat {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .new-chat .account {
    margin-block-end: 0;
  }
  .new-chat .label.or {
    margin-block: 4px 0;
    font-size: 13px;
    font-weight: 600;
  }
  .chat-id {
    align-items: center;
    gap: 8px;
  }
  .chat-id input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .new-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dialog-title {
    margin: 0;
    font-size: 16px;
  }
  .new-group label {
    font-size: 13px;
    font-weight: 600;
    margin-block-start: 4px;
  }
  .new-chat input,
  .new-group input {
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--main-bg);
    color: var(--main-fg);
  }
  .new-chat input:focus-visible,
  .new-group input:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .new-group .buttons {
    justify-content: end;
  }
</style>
