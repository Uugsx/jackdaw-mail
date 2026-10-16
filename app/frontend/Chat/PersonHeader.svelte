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
  import PersonPicture from "../Contacts/Person/PersonPicture.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import VideoCallIcon from '../asset/icon/appBar/meet.svg?raw';
  import VoiceCallIcon from '../asset/icon/meet/callVoice.svg?raw';
  import { t } from "../../l10n/l10n";

  export let person: ChatContact | Person;

  /** Calls a real `Person`/`Group` for now, or the email `PersonUID` in the mail chat mode.
   * TODO Later, we should prefer calling via Chat. */
  $: callTarget = person instanceof ChatPersonUID ? person.findPerson() : (person as Person | Group | PersonUID);
  const callClient = getJackdawCallClient();
  /** Кнопки только когда звонок реально возможен; присутствие собеседника обновляется через `$callClient`. */
  $: canCall = $callClient && $callClient.presenceVersion >= 0 && canStartCall(callTarget);
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
