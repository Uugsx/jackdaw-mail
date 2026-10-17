<vbox bind:clientWidth={width} flex>
  <Splitter
    hasRight={person && width > 600}
    initialRightRatio={0.4}
    name="phone-contact-history-during-call">
    <vbox class="left" slot="left" flex>
      <!-- Область объявлений есть всегда: экранный диктор читает изменения только уже существующей области. -->
      <hbox class="reconnecting font-normal" role="status" aria-live="polite">
        {#if $meeting.reconnecting}
          <hbox class="pulse" aria-hidden="true" />
          {$t`Reconnecting…`}
        {/if}
      </hbox>
      {#if $showDialPad}
        <DialPad on:digit={ev => catchErrors(() => onSendSTMF(ev.detail))} />
      {/if}
    </vbox>
    <Scroll slot="right">
      <vbox class="contact-history" flex>
        <ContactHistory {person} colorInherit={true} />
      </vbox>
    </Scroll>
  </Splitter>
</vbox>

<script lang="ts">
  import type { MeetingParticipant } from "../../../../logic/Meet/Participant";
  import type { VideoConfMeeting } from "../../../../logic/Meet/VideoConfMeeting";
  import { PhoneCall } from "../../../../logic/Meet/PhoneCall";
  import { showDialPad } from "../../uiState";
  import ContactHistory from "../../../Contacts/History/ContactHistory.svelte";
  import Splitter from "../../../Shared/Splitter.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";
  import DialPad from "./DialPad.svelte";
  import { catchErrors } from "../../../Util/error";
  import { assert } from "../../../../logic/util/util";
  import { t } from "../../../../l10n/l10n";

  export let showParticipant: MeetingParticipant;
  export let meeting: VideoConfMeeting;

  let width: number;
  $: participants = $meeting.participants;
  $: remote = showParticipant ?? $participants.first
  $: person = remote?.findPerson();

  async function onSendSTMF(digit: string) {
    assert(meeting instanceof PhoneCall, "Not a phone call");
    await meeting.sendDTMF(digit);
  }
</script>

<style>
  .left {
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .reconnecting {
    align-items: center;
    gap: 8px;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: currentColor;
    animation: pulse 1s cubic-bezier(0.16, 1, 0.3, 1) infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
