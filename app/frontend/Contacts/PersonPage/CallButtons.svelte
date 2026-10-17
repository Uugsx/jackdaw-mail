<hbox class="call-buttons">
  {#if preferredVideoCall && canVideo}
    <RoundButton
      label={$t`Video call`}
      icon={CameraIcon}
      classes="large secondary action"
      onClick={() => startVideoCall(person)} />
  {/if}
  {#if preferredVideoCall}
    <RoundButton
      label={$t`Audio call`}
      icon={CallIcon}
      classes="large secondary action"
      onClick={() => startAudioCall(person)} />
  {:else if !preferredPhoneNumber && $emailAddresses.hasItems}
    <!-- Звонок по email между пользователями Jackdaw: кнопка видна, неактивна с объяснением -->
    <RoundButton
      label={$t`Audio call`}
      icon={CallIcon}
      classes="large secondary action"
      disabled={$callClient && jackdawCallUnavailableReason(callTargetEmails(person))} />
  {/if}
  {#if preferredPhoneNumber}
    <a href="tel:{preferredPhoneNumber}" class="phone-call">
      <RoundButton
        label={$t`Call`}
        icon={CallIcon}
        iconSize="19px"
        classes="large secondary action" />
    </a>
  {/if}
  {#if existingRoom || jackdawChatEmail}
    <RoundButton
      label={$t`Message`}
      icon={ChatIcon}
      classes="large secondary action"
      onClick={openChat} />
  {/if}
  {#if preferredEmailAddress}
    <a href="mailto:{preferredEmailAddress}">
      <RoundButton
        label={$t`Send mail`}
        icon={MailIcon}
        classes="large secondary action" />
    </a>
  {/if}
</hbox>

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import { startVideoCall, startAudioCall, canStartCall, canStartVideoCall } from "../../../logic/Meet/StartCall";
  import { callTargetEmails, getJackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCalls";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { ChatPersonUID } from "../../../logic/Chat/ChatPersonUID";
  import type { ChatRoom } from "../../../logic/Chat/ChatRoom";
  import { appGlobal } from "../../../logic/app";
  import { openChatRoomFromOtherApp } from "../../Chat/open";
  import { jackdawCallUnavailableReason } from "../../Shared/callUnavailable";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import MailIcon from '../../asset/icon/appBar/mail.svg?raw';
  import ChatIcon from '../../asset/icon/appBar/chat.svg?raw';
  import CameraIcon from '../../asset/icon/appBar/meet.svg?raw';
  import CallIcon from '../../asset/icon/meet/callVoice.svg?raw';
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  $: emailAddresses = person.emailAddresses;
  $: phoneNumbers = person.phoneNumbers;
  $: chatAccounts = person.chatAccounts;
  $: preferredPhoneNumber = $phoneNumbers.isEmpty ? null :
      $phoneNumbers.sortBy(p => p.preference).first?.value;
  $: preferredEmailAddress = $emailAddresses.isEmpty ? null :
      $emailAddresses.sortBy(p => p.preference).first?.value;
  const callClient = getJackdawCallClient();
  /** Звонок через WhatsApp или Jackdaw, только если он сейчас возможен */
  $: preferredVideoCall = $callClient && $callClient.presenceVersion >= 0 && $emailAddresses && $chatAccounts && canStartCall(person);
  /** Видео — только через WhatsApp: звонки между пользователями Jackdaw голосовые */
  $: canVideo = $chatAccounts && canStartVideoCall(person);

  /* «Написать»: уже существующий чат с этим человеком или новый чат Jackdaw по email.
   * Кнопка показывается, только когда написать действительно можно. */
  const appChatAccounts = appGlobal.chatAccounts;
  $: jackdawAccount = $appChatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  $: existingRoom = $appChatAccounts && $emailAddresses && $chatAccounts && findExistingRoom(person);
  function findExistingRoom(target: Person): ChatRoom | null {
    for (let account of appChatAccounts.contents) {
      let room = account.rooms.contents.find(r => r.contact instanceof ChatPersonUID && r.contact.matchesPerson(target));
      if (room) {
        return room;
      }
    }
    return null;
  }
  let jackdawChatEmail: string | null = null;
  let chatCheck = 0;
  $: jackdawOnline = !!($jackdawAccount && jackdawAccount?.isOnline);
  $: person, $emailAddresses, jackdawOnline, void findJackdawChatEmail();
  async function findJackdawChatEmail() {
    let check = ++chatCheck;
    jackdawChatEmail = null;
    if (!jackdawOnline) {
      return;
    }
    for (let email of callTargetEmails(person)) {
      if (await jackdawAccount.canChatWith(email).catch(() => false)) {
        if (check == chatCheck) {
          jackdawChatEmail = email;
        }
        return;
      }
    }
  }
  async function openChat() {
    let room = existingRoom ?? (jackdawChatEmail ? await jackdawAccount.getDirectRoom(jackdawChatEmail) : null);
    if (room) {
      openChatRoomFromOtherApp(room);
    }
  }
</script>

<style>
  .call-buttons {
    gap: 10px;
  }
  :global(.mobile) .call-buttons :global(button) {
    border-color: transparent;
    box-shadow: -1px 0px 3px 0px rgba(22, 12, 39, 8%); /* #160C27 */;
    background-color: var(--bg);
    color: var(--fg);
  }
  .preferred {
    margin-block-start: 8px;
    margin-block-end: 8px;
    font-size: 13px;
  }
  .phone-call :global(.icon) {
    /* because the icon is 1px smaller */
    margin: 1px;
  }
</style>
