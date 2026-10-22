<hbox class="person">
  <PersonPicture {person} size={40} placeholder="initials" />
  <vbox flex class="name-box">
    <hbox class="name" title={$person.name}>{$person.name}</hbox>
    {#if presence}
      <hbox class="status" title={statusHint(presence)}>
        <StatusDot status={presence} size="8px" />
        <span>{statusLabel(presence)}</span>
      </hbox>
    {/if}
  </vbox>
  <hbox class="actions">
    {#if canCall && canVideo && peerStatus != "dnd"}
      <RoundButton label={$t`Video call`} icon={VideoCallIcon} classes="secondary large"
        onClick={() => startVideoCall(callTarget)} />
    {/if}
    {#if canCall && peerStatus == "dnd"}
      <!-- Сервер всё равно отклонит звонок: объясняем заранее -->
      <RoundButton label={$t`Audio call`} icon={VoiceCallIcon} classes="secondary large"
        disabled={statusHint(peerStatus)} />
    {:else if canCall}
      <RoundButton label={$t`Audio call`} icon={VoiceCallIcon} classes="secondary large"
        onClick={() => startAudioCall(callTarget)} />
    {:else if callUnavailableReason}
      <!-- В чате Jackdaw кнопка звонка видна всегда; неактивна с объяснением, почему звонить нельзя -->
      <RoundButton label={$t`Audio call`} icon={VoiceCallIcon} classes="secondary large"
        disabled={callUnavailableReason} />
    {/if}
    {#if chatEmail && showChatButton}
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
  import { startVideoCall, startAudioCall, canStartCall, canStartVideoCall } from "../../logic/Meet/StartCall";
  import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { JACKDAW_CHAT_PROTOCOL, type JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
  import { callTargetEmails } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import type { JackdawUserStatus } from "../../logic/Meet/Jackdaw/JackdawCallProtocol";
  import { jackdawCallUnavailableReason } from "../Shared/callUnavailable";
  import { appGlobal } from "../../logic/app";
  import { openChatRoomFromOtherApp } from "./open";
  import ChatIcon from "lucide-svelte/icons/message-square-text";
  import PersonPicture from "../Contacts/Person/PersonPicture.svelte";
  import StatusDot from "./Status/StatusDot.svelte";
  import { presenceOf, statusHint, statusLabel, type PresenceState } from "./Status/statusLabels";
  import RoundButton from "../Shared/RoundButton.svelte";
  import VideoCallIcon from '../asset/icon/appBar/meet.svg?raw';
  import VoiceCallIcon from '../asset/icon/meet/callVoice.svg?raw';
  import { t } from "../../l10n/l10n";

  export let person: ChatContact | Person;
  /** Кнопка «Написать в чат Jackdaw». false — когда её роль выполняет окружающая панель. */
  export let showChatButton = true;
  /** Показывать неактивную кнопку звонка с объяснением и вне чата Jackdaw (контакт из поиска) */
  export let explainCall = false;

  /** Calls a real `Person`/`Group` for now, or the email `PersonUID` in the mail chat mode.
   * TODO Later, we should prefer calling via Chat. */
  $: callTarget = person instanceof ChatPersonUID
    ? person.findPerson() ?? (person.protocol == JACKDAW_CHAT_PROTOCOL ? person : null)
    : (person as Person | Group | PersonUID);
  const callClient = getJackdawCallClient();
  /** Кнопки только когда звонок реально возможен; присутствие собеседника обновляется через `$callClient`. */
  $: canCall = $callClient && $callClient.presenceVersion >= 0 && canStartCall(callTarget);
  /** Статус собеседника в Jackdaw: «занят» или «не беспокоить» видны в шапке */
  let peerStatus: JackdawUserStatus = "available";
  $: peerStatus = $callClient && $callClient.presenceVersion >= 0 && !(person instanceof Group)
    ? callTargetEmails(callTarget as Person | PersonUID).map(email => callClient.statusOf(email)).find(s => s != "available") ?? "available"
    : "available";
  /** Что видно о собеседнике Jackdaw: в сети и его статус, или «не в сети». null — не пользователь Jackdaw или неизвестно. */
  let presence: PresenceState | null = null;
  $: presence = $callClient && $callClient.presenceVersion >= 0 && !(person instanceof Group) && callTarget
    ? presenceOf(callClient, callTargetEmails(callTarget as Person | PersonUID))
    : null;
  /** Видеозвонок: через Jackdaw или WhatsApp */
  $: canVideo = canCall && canStartVideoCall(callTarget);
  /** Почему в личном чате Jackdaw сейчас нельзя позвонить (у группы контакт — `Group`, звонков в группу нет).
   * null — не чат Jackdaw или звонок возможен. */
  $: callUnavailableReason = (inJackdawChat || explainCall) && !canCall && $callClient && !(person instanceof Group)
    ? jackdawCallUnavailableReason(callTargetEmails(callTarget as Person | PersonUID))
    : null;

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
    margin: 12px 15px;
    gap: 2px;
    min-width: 0;
    flex: 0 1 auto;
  }
  /* Имя в одну строку: «Hayden Huel» переносилось, хотя места хватало */
  .name {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    align-items: center;
    gap: 6px;
    font-weight: normal;
    font-size: 0.875em;
    opacity: 0.85;
  }
  .person {
    align-items: center;
  }
  .person > :global(.avatar) {
    flex: none;
    margin-inline-start: 16px;
  }
  .actions {
    align-items: center;
  }
  .actions :global(button) {
    margin-inline-end: 8px;
  }
</style>
