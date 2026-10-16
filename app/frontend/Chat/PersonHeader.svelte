<hbox class="person">
  <PersonPicture {person} />
  <vbox flex class="name-box">
    <hbox class="name">{$person.name}</hbox>
  </vbox>
  <hbox class="actions">
    {#if canCall}
      <RoundButton label={$t`Video call`} icon={VideoCallIcon} classes="secondary large"
        onClick={() => startVideoCall(callTarget)} />
      <RoundButton label={$t`Audio call`} icon={VoiceCallIcon} classes="secondary large"
        onClick={() => startAudioCall(callTarget)} />
    {/if}
    {#if chatEmail}
      <RoundButton label={$t`Message in Jackdaw chat`} icon={ChatIcon} classes="secondary large"
        onClick={openJackdawChat} />
    {/if}
  </hbox>
  <hbox flex />
</hbox>

<script lang="ts">
  import { Person } from "../../logic/Abstract/Person";
  import { Group } from "../../logic/Abstract/Group";
  import { ChatPersonUID } from "../../logic/Chat/ChatPersonUID";
  import type { PersonUID } from "../../logic/Abstract/PersonUID";
  import type { ChatContact } from "../../logic/Chat/ChatRoom";
  import { startVideoCall, startAudioCall, canStartCall } from "../../logic/Meet/StartCall";
  import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { callTargetEmails } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { appGlobal } from "../../logic/app";
  import { openChatRoomFromOtherApp } from "./open";
  import ChatIcon from "lucide-svelte/icons/message-square-text";
  import PersonPicture from "../Contacts/Person/PersonPicture.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import VideoCallIcon from '../asset/icon/appBar/meet.svg?raw';
  import VoiceCallIcon from '../asset/icon/meet/callVoice.svg?raw';
  import { t } from "../../l10n/l10n";

  export let person: ChatContact | Person;

  /** Calls a real `Person`/`Group` for now, or the email `PersonUID` in the mail chat mode.
   * TODO Later, we should prefer calling via Chat. */
  $: callTarget = person instanceof ChatPersonUID
    ? person.findPerson() ?? (person.protocol == JACKDAW_CHAT_PROTOCOL ? person : null)
    : (person as Person | Group | PersonUID);
  const callClient = getJackdawCallClient();
  /** Кнопки только когда звонок реально возможен; присутствие собеседника обновляется через `$callClient`. */
  $: canCall = $callClient && $callClient.presenceVersion >= 0 && canStartCall(callTarget);

  /** «Написать» в чат Jackdaw — из почты и других мест, где собеседник ещё не в чате Jackdaw */
  const chatAccounts = appGlobal.chatAccounts;
  $: chatAccount = $chatAccounts.find(acc => acc.protocol == JACKDAW_CHAT_PROTOCOL) as JackdawChatAccount | undefined;
  $: inJackdawChat = person instanceof ChatPersonUID && person.protocol == JACKDAW_CHAT_PROTOCOL;
  let chatEmail: string | null = null;
  let chatCheck = 0;
  $: chatAccount && $chatAccount, findChatEmail(inJackdawChat ? null : callTarget);
  async function findChatEmail(target: typeof callTarget) {
    let check = ++chatCheck;
    chatEmail = null;
    if (!chatAccount?.isOnline || !target) {
      return;
    }
    for (let email of callTargetEmails(target instanceof Group ? null : target)) {
      if (await chatAccount.canChatWith(email).catch(() => false)) {
        if (check == chatCheck) {
          chatEmail = email;
        }
        return;
      }
    }
  }
  async function openJackdawChat() {
    if (!chatAccount || !chatEmail) {
      return;
    }
    openChatRoomFromOtherApp(await chatAccount.getDirectRoom(chatEmail));
  }
</script>

<style>
  .name-box {
    font-weight: bold;
    margin: 15px;
  }
  .actions {
    align-items: center;
  }
  .actions :global(button) {
    margin-inline-end: 8px;
  }
</style>
