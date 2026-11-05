<vbox class="counter-proposal">
  <hbox class="text">
    {#if $message.outgoing}
      {$t`You proposed a new time for this meeting:`}
    {:else}
      {$t`${proposerName} proposes a new time for this meeting:`}
    {/if}
  </hbox>
  {#if $message.event}
    <hbox class="proposed font-large">{timeRange($message.event.startTime, $message.event.endTime)}</hbox>
  {/if}
  {#if calEvent && !sameTime}
    <hbox class="current font-small">{$t`Current time: ${timeRange(calEvent.startTime, calEvent.endTime)}`}</hbox>
  {/if}
  {#if accepted || (calEvent && sameTime)}
    <hbox class="done font-small" role="status">{$t`The meeting now takes place at the proposed time.`}</hbox>
  {:else if !$message.outgoing && canAccept}
    <hbox class="buttons">
      <Button
        label={$t`Accept proposed time`}
        icon={AcceptIcon}
        classes="accept font-normal"
        onClick={onAccept} />
      <Button
        label={$t`Open in calendar`}
        plain
        onClick={onOpen} />
    </hbox>
  {:else if !$message.outgoing && calEvent?.recurrenceCase == RecurrenceCase.Master}
    <hbox class="note font-small">{$t`Change the time of a recurring meeting in the calendar`}</hbox>
  {:else if !$message.outgoing && !calEvent}
    <hbox class="note font-small">{$t`The meeting was not found in your calendar`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
  import type { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
  import { openEvent } from "../open";
  import Button from "../../Shared/Button.svelte";
  import AcceptIcon from "lucide-svelte/icons/calendar-check";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let message: EMail;

  let invitation: IncomingInvitation | null = null;
  let calEvent: Event | null = null;
  let accepted = false;

  $: proposerName = $message.from?.name || $message.from?.emailAddress || "";
  $: $message, findEvent();
  function findEvent() {
    invitation = null;
    calEvent = null;
    accepted = false;
    if (!message.event) {
      return;
    }
    for (let calendar of message.folder.account.calendarsAvailable) {
      if (calendar.hasMatchingEvent(message.event)) {
        invitation = calendar.getIncomingInvitationForEMail(message);
        calEvent = invitation?.calEvent() ?? null;
        return;
      }
    }
  }

  $: sameTime = !!calEvent && !!message.event &&
    calEvent.startTime?.getTime() == message.event.startTime?.getTime() &&
    calEvent.endTime?.getTime() == message.event.endTime?.getTime();
  $: canAccept = !!invitation && !!calEvent && calEvent.recurrenceCase != RecurrenceCase.Master &&
    !calEvent.isIncomingMeeting;

  function timeRange(start: Date, end: Date): string {
    if (!start || !end) {
      return "";
    }
    let locale = getDateTimeLocale();
    let day = start.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    let from = start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    let to = end.toDateString() == start.toDateString()
      ? end.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : end.toLocaleString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    return `${day}, ${from} – ${to}`;
  }

  async function onAccept() {
    await invitation.acceptProposedTime();
    accepted = true;
    calEvent = invitation.calEvent();
  }

  function onOpen() {
    if (calEvent) {
      openEvent(calEvent);
    }
  }
</script>

<style>
  .counter-proposal {
    align-items: center;
    margin-block-start: 16px;
    gap: 4px;
    text-align: center;
  }
  .proposed {
    font-weight: 600;
  }
  .current, .note {
    opacity: 0.75;
  }
  .done {
    color: #1B8022;
  }
  .buttons {
    gap: 12px;
    margin-block-start: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .buttons :global(button.accept) {
    color: #1B8022;
    background-color: #AAE3D2;
  }
</style>
