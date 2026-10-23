<FileDropTarget on:add-files={(dropped) => catchErrors(() => onFilesDrop(dropped))}>
  <vbox flex class="event-edit-window">
    <DialogHeader bind:event />
    <Scroll>
      <vbox class="columns" flex class:show-description={showDescription} class:show-attachments={showAttachments} bind:offsetWidth={width}>
        <vbox class="column1">
          <hbox class="time-box" >
            <TimeBox {event} />
            <vbox flex />
            {#if width > 600}
              <EventInDayView {event} />
            {/if}
          </hbox>
          <Section label={$t`Title`}>
            <TitleBox {event} />
          </Section>
          <Section>
            <ExpanderButtons>
              <ExpanderButton bind:expanded={showRepeat} label={$t`Repeat`} icon={RepeatIcon} on:expand={expandRepeat} />
              <ExpanderButton bind:expanded={showReminder} label={$t`Reminder`} icon={ReminderIcon} on:expand={expandReminder} />
              <ExpanderButton bind:expanded={showParticipants} label={$t`Invite`} icon={ParticipantsIcon} on:expand={expandParticipants} />
              <ExpanderButton bind:expanded={showLocation} label={$t`Location`} icon={LocationIcon} on:expand={expandLocation} />
              {#if canBookRooms}
                <ExpanderButton bind:expanded={roomsOpen} label={$t`Room *=> Meeting room in the office, booked for a meeting`} icon={RoomIcon} />
              {/if}
              <ExpanderButton bind:expanded={onlineMeetingOpen} label={$t`Online meeting`} icon={OnlineMeetingIcon} on:expand={expandOnlineMeeting} />
              <ExpanderButton bind:expanded={showDescription} label={$t`Description`} icon={DescriptionIcon} on:expand={expandDescription} />
              <ExpanderButton bind:expanded={showAttachments} label={$t`Attachment`} icon={AttachmentIcon} on:expand={() => catchErrors(expandAttachments)} />
            </ExpanderButtons>
          </Section>
          {#if participantsError}
            <p class="event-action-error" role="alert">{participantsError}</p>
          {/if}
          {#if showRepeat}
            <Section label={$t`Repeat`} icon={RepeatIcon}>
              <RepeatBox {event} />
            </Section>
          {/if}
          {#if showReminder}
            <Section label={$t`Reminder`} icon={ReminderIcon}>
              <SectionTitle label={$t`Reminder`}>
                <ReminderBox {event} />
              </SectionTitle>
            </Section>
          {/if}
          {#if showParticipants}
            <Section label={$t`Invite`} icon={ParticipantsIcon}>
              <ParticipantsBox {event} />
            </Section>
          {/if}
          {#if canBookRooms && roomsOpen}
            <Section label={$t`Room *=> Meeting room in the office, booked for a meeting`} icon={RoomIcon}>
              <SectionTitle label={$t`Room *=> Meeting room in the office, booked for a meeting`}>
                <RoomBox {event} />
              </SectionTitle>
            </Section>
          {/if}
          {#if showLocation}
            <Section label={$t`Location`} icon={LocationIcon}>
              <SectionTitle label={$t`Location`}>
                <LocationBox {event} />
              </SectionTitle>
            </Section>
          {/if}
          <Section label={$t`Show as`}>
            <hbox class="show-as">
              <RadioGroup
                items={freeBusyOptions}
                bind:value={event.freeBusyStatus}
                />
              <label class="private">
                <input type="checkbox" bind:checked={event.isPrivate} />
                {$t`Private`}
              </label>
            </hbox>
          </Section>
          {#if showOnlineMeeting}
            <Section label={$t`Online meeting`} icon={OnlineMeetingIcon}>
              <SectionTitle label={$t`Online meeting`}>
                <OnlineMeetingBox {event} />
              </SectionTitle>
            </Section>
          {/if}
        </vbox>
        <vbox class="column2 description" flex>
          {#if showDescription}
            <Section label={$t`Description`} icon={DescriptionIcon} flex>
              <DescriptionBox {event} />
            </Section>
          {/if}
        </vbox>
        {#if showAttachments}
          <vbox class="column3 attachments">
            <AttachmentsPane message={event} />
          </vbox>
        {/if}
      </vbox>
    </Scroll>
  </vbox>
</FileDropTarget>

<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { Frequency } from "../../../logic/Calendar/RecurrenceRule";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import TitleBox from "./TitleBox.svelte";
  import TimeBox from "./TimeBox.svelte";
  import RepeatBox from './RepeatBox.svelte';
  import ReminderBox from './ReminderBox.svelte';
  import ParticipantsBox from './ParticipantsBox.svelte';
  import LocationBox from './LocationBox.svelte';
  import OnlineMeetingBox from './OnlineMeetingBox.svelte';
  import RoomBox from './RoomBox.svelte';
  import DescriptionBox from './DescriptionBox.svelte';
  import EventInDayView from "../DisplayEvent/EventInDayView.svelte";
  import AttachmentsPane from "../../Mail/Composer/Attachments/AttachmentsPane.svelte";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import FileDropTarget from "../../Mail/Composer/Attachments/FileDropTarget.svelte";
  import Section from "./Section.svelte";
  import SectionTitle from "./SectionTitle.svelte";
  import DialogHeader from "./DialogHeader.svelte";
  import RadioGroup from "./RadioGroup.svelte";
  import ExpanderButtons from "../../Shared/ExpanderButtons.svelte";
  import ExpanderButton from "../../Shared/ExpanderButton.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import RepeatIcon from "lucide-svelte/icons/repeat-2";
  import ReminderIcon from "lucide-svelte/icons/bell";
  import ParticipantsIcon from "lucide-svelte/icons/users-round";
  import OnlineMeetingIcon from "lucide-svelte/icons/video";
  import LocationIcon from "lucide-svelte/icons/map-pin";
  import RoomIcon from "lucide-svelte/icons/door-open";
  import DescriptionIcon from "lucide-svelte/icons/notebook-pen";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import { catchErrors } from "../../Util/error";
  import { t, gt } from "../../../l10n/l10n";

  export let event: Event;

  $: attachments = event.attachments;
  $: showRepeat = !!event.recurrenceRule || event.parentEvent && event.isNew;
  $: showReminder = !!$event.alarm;
  $: showParticipants = $event.participants.hasItems;
  $: showLocation = !!$event.location;
  $: canBookRooms = !!$event.calendar?.canBookRooms;
  let roomsOpen = false;
  $: if ($event.participants.some(p => p.isResource)) roomsOpen = true;
  let onlineMeetingOpen = false;
  let participantsError: string | null = null;
  $: if ($event.isOnline) onlineMeetingOpen = true;
  $: showOnlineMeeting = onlineMeetingOpen;
  $: showDescription = !!$event.descriptionHTML;
  $: showAttachments = $attachments.some(attachment => !attachment.hidden);

  const freeBusyOptions = [
    { label: gt`Busy`, value: "Busy" },
    { label: gt`Free`, value: "Free" },
    { label: gt`Tentative`, value: "Tentative" },
    { label: gt`Out of office`, value: "OOF" },
  ];

  let width: number;

  function expandRepeat(): void {
    event.newRecurrenceRule(Frequency.Weekly);
  }

  const kDefaultReminderMins = 5;
  function expandReminder(): void {
    event.alarm = new Date(event.startTime.getTime() - kDefaultReminderMins * 60 * 1000);
  }

  function expandParticipants(): void {
    participantsError = null;
    if (event.myParticipation == InvitationResponse.Organizer) {
      return;
    }
    if (!event.calendar?.identitiesAvailable?.first) {
      participantsError = $t`Please set up an email account to send the invitation from`;
      return;
    }
    event.createMeeting();
  }

  function expandLocation(): void {
    event.location = " ";
  }

  function expandOnlineMeeting(): void {
    onlineMeetingOpen = true;
  }

  function expandDescription(): void {
    event.descriptionHTML = " ";
  }

  let fileSelector: FileSelector;
  /** The attachments sidebar appears as soon as there is an attachment,
   * so ask for the file right away. */
  async function expandAttachments(): Promise<void> {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    addFilesAsAttachments(event, [file]);
  }

  function onFilesDrop(dropped: CustomEvent): void {
    addFilesAsAttachments(event, dropped.detail.files as File[]);
  }
</script>

<style>
  .event-edit-window {
    container-type: inline-size;
  }
  .columns {
    padding: 12px 16px 4px 16px;
  }
  .time-box {
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .show-as {
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
  }
  .private {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .event-action-error {
    margin: 8px 0 0;
    color: var(--danger-fg);
    font-size: 12px;
    line-height: 1.4;
  }
  .time-box :global(.calendar) {
    max-width: 300px;
  }
  .description :global(.section > .icon) {
    display: none;
  }
  .column3.attachments {
    margin-block-start: 12px;
  }
  @container (min-width: 1000px) {
    .columns.show-description,
    .columns.show-attachments {
      flex-direction: row;
    }
    .column2 {
      margin-block-start: -8px;
      margin-inline-start: 24px;
    }
    .column3.attachments {
      width: 300px;
      margin-block-start: 4px;
      margin-inline-start: 12px;
      margin-inline-end: -16px;
    }
    /*.columns.show-description .column1 {
      order: 2;
    }
    .columns.show-description .column2 {
      order: 1;
      margin-inline-end: 24px;
    }*/
  }
  .event-edit-window :global(.svelteui-Checkbox-label) {
    padding-inline-start: 8px;
  }
  :global(.inline) {
    display: inline-flex !important;
  }
</style>
