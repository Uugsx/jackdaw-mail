<hbox class="persons-toolbar">
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
{#if dialogOpenPerson}
  <vbox class="dialog">
    <hbox class="account">
      {$t`Chat with`}
      <AccountDropDown accounts={appGlobal.chatAccounts} bind:selectedAccount filterByWorkspace={true} />
      <RoundButton
        label={$t`Close`}
        onClick={() => dialogOpenPerson = false}
        icon={XIcon}
        iconSize="16px"
        padding="2px"
        />
    </hbox>
    <PersonAutocomplete skipPersonFunc={filterPerson} onAddPerson={person => catchErrors(() => openChatWithPerson(person))} />
    <hbox class="label or">{isJackdaw ? $t`or enter an email address` : $t`or enter chat ID`}</hbox>
    <hbox>
      <input type="text" bind:value={chatID} placeholder={isJackdaw ? "name@example.com" : ""} />
      <RoundButton
        label={$t`Open`}
        onClick={onOpenChatID}
        icon={OpenIcon}
        />
    </hbox>
  </vbox>
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
    <PersonAutocomplete skipPersons={groupMembers} skipPersonFunc={skipPersonWithoutEmail} onAddPerson={addGroupMember} />
    {#if $groupMembers.length}
      <ul class="group-members">
        {#each $groupMembers.contents as member (member.emailAddress)}
          <li>
            <span class="member-name">{member.name || member.emailAddress}</span>
            <span class="member-email">{member.emailAddress}</span>
            <RoundButton
              label={$t`Remove`}
              icon={XIcon}
              iconSize="12px"
              padding="2px"
              onClick={() => groupMembers.remove(member)}
              />
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">{$t`Add the Jackdaw Mail users who should be in the group.`}</p>
    {/if}
    <hbox class="buttons">
      <RoundButton
        label={$t`Create group`}
        icon={OpenIcon}
        classes="create"
        disabled={!$groupMembers.length}
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
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../Shared/Menu/MenuItem.svelte";
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
  import { ArrayColl } from "svelte-collections";
  import { UserError } from "../../logic/util/util";
  import { gt } from "../../l10n/l10n";

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

  /** Личный чат Jackdaw создаётся и сохраняется сразу, чтобы появиться в списке.
   * Только с тем, кто пользуется чатом Jackdaw: иначе получился бы чат, в который нельзя написать. */
  async function openJackdawChat(account: JackdawChatAccount, email: string) {
    let address = email?.trim();
    if (!address) {
      return;
    }
    let existing = account.findRoomByID(`direct:${address.toLowerCase()}`);
    if (!existing && !account.isOnline) {
      throw new UserError(gt`Jackdaw chat is not connected on this device. Confirm your address for calls and chat in the settings.`);
    }
    if (!existing && !await account.canChatWith(address)) {
      throw new UserError(account.isOwnEmail(address.toLowerCase())
        ? gt`This is your own address. To chat, choose another contact.`
        : gt`${address} does not use Jackdaw chat yet, or has not confirmed this address. You can send an email instead.`);
    }
    $selectedRoom = existing ?? await account.getDirectRoom(address);
    dialogOpenPerson = false;
  }

  async function openChatWithPerson(person: PersonUID) {
    if (!selectedAccount) {
      return;
    }
    if (selectedAccount instanceof JackdawChatAccount) {
      await openJackdawChat(selectedAccount, person.emailAddress);
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
      await openJackdawChat(selectedAccount, chatID);
      return;
    }
    let room = selectedAccount.newRoom(false);
    room.contact = selectedAccount.getPersonUID(chatID);
    selectedAccount.rooms.add(room);
  }
  let groupName = "";
  const groupMembers = new ArrayColl<PersonUID>();
  function addGroupMember(person: PersonUID) {
    if (!groupMembers.find(member => member.emailAddress == person.emailAddress)) {
      groupMembers.add(person);
    }
  }
  async function createGroup() {
    if (!(selectedAccount instanceof JackdawChatAccount) || groupMembers.isEmpty) {
      return;
    }
    $selectedRoom = await selectedAccount.createGroup(groupName, groupMembers.contents.map(member => member.emailAddress));
    groupName = "";
    groupMembers.clear();
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
    margin: 10px 12px 10px 16px;
    align-items: center;
  }
  .dialog {
    margin: 32px 32px;
  }
  .dialog .account {
    margin-block-end: 12px;
    align-items: center;
  }
  .label.or {
    margin-block: 6px;
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
  .new-group input {
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--main-bg);
    color: var(--main-fg);
  }
  .new-group input:focus-visible {
    outline: 2px solid var(--icon-primary);
    outline-offset: 1px;
  }
  .group-members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group-members li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .member-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member-email {
    flex: 1;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: color-mix(in srgb, var(--main-fg) 65%, transparent);
  }
  .new-group .buttons {
    justify-content: end;
  }
</style>
