<vbox class="rooms">
  {#if selectedRooms.length}
    <hbox class="selected">
      {#each selectedRooms as room (room.emailAddress)}
        <hbox class="chip" title={room.emailAddress}>
          <DoorIcon size="14px" />
          <span class="chip-name">{room.name}</span>
          <Button
            label={$t`Remove room`}
            icon={RemoveIcon}
            iconSize="14px"
            iconOnly
            plain
            onClick={() => onRemove(room)}
            />
        </hbox>
      {/each}
    </hbox>
  {/if}

  {#if listsLoading}
    <hbox class="status">{$t`Loading rooms…`}</hbox>
  {:else if listsError}
    <Notice ex={listsError} compact onRetry={loadLists} />
  {:else if roomLists.length}
    <hbox class="controls">
      {#if roomLists.length > 1}
        <label class="field">
          <span>{$t`Room list`}</span>
          <select bind:value={selectedListAddress} on:change={() => loadRooms()}>
            {#each roomLists as list (list.emailAddress)}
              <option value={list.emailAddress}>{list.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="only-free">
        <input type="checkbox" bind:checked={onlyFree} />
        {$t`Only free`}
      </label>
    </hbox>
    {#if roomsLoading}
      <hbox class="status">{$t`Loading rooms…`}</hbox>
    {:else if roomsError}
      <Notice ex={roomsError} compact onRetry={loadRooms} />
    {:else if !rooms.length}
      <hbox class="status">{$t`There are no rooms in this list`}</hbox>
    {:else}
      {#if availabilityError}
        <Notice ex={availabilityError} compact message={$t`Could not check whether the rooms are free`} onRetry={() => checkAvailability(rooms, startMS, endMS)} />
      {/if}
      {#if !shownRooms.length}
        <hbox class="status">{availabilityLoading ? $t`Checking availability…` : $t`No free rooms at this time`}</hbox>
      {:else}
        <vbox class="list" role="list">
          {#each shownRooms as room (room.emailAddress)}
            {@const free = availability.get(room.emailAddress.toLowerCase())}
            {@const chosen = isChosen(room, selectedRooms)}
            <hbox class="room" role="listitem" class:chosen>
              <vbox class="room-name" flex>
                <span class="name">{room.name}</span>
                <span class="address font-smallest">{room.emailAddress}</span>
              </vbox>
              <span class="state font-smallest"
                class:free={free === true}
                class:busy={free === false}>
                {availabilityLoading && free === undefined ? $t`Checking…` :
                  free === true ? $t`Free *=> The meeting room is available at this time` :
                  free === false ? $t`Busy *=> The meeting room is booked at this time` :
                  $t`No data *=> The server did not tell whether the meeting room is available`}
              </span>
              {#if chosen}
                <hbox class="chosen-mark" title={$t`Selected`}>
                  <CheckIcon size="16px" />
                </hbox>
              {:else}
                <Button label={$t`Select`} plain onClick={() => onSelect(room)} />
              {/if}
            </hbox>
          {/each}
        </vbox>
      {/if}
    {/if}
  {:else}
    <p class="hint">{$t`The server has no room lists. Enter the room's email address.`}</p>
  {/if}

  {#if !listsLoading && !listsError}
    <form class="manual" on:submit|preventDefault={onAddManual}>
      <input type="email" bind:value={manualAddress} placeholder={$t`Room email address`} aria-label={$t`Room email address`} />
      <Button label={$t`Add room`} plain disabled={!isValidAddress(manualAddress)} onClick={onAddManual} />
    </form>
  {/if}
  {#if selectError}
    <p class="error" role="alert">{selectError}</p>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
  import {
    addRoomToEvent, getRoomsAvailability, getRoomsOfEvent, removeRoomFromEvent,
    type MeetingRoom, type RoomAvailability,
  } from "../../../logic/Calendar/EWS/MeetingRooms";
  import Button from "../../Shared/Button.svelte";
  import Notice from "../../Shared/Notice.svelte";
  import DoorIcon from "lucide-svelte/icons/door-open";
  import RemoveIcon from "lucide-svelte/icons/x";
  import CheckIcon from "lucide-svelte/icons/check";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  let roomLists: MeetingRoom[] = [];
  let listsLoading = true;
  let listsError: unknown = null;
  let selectedListAddress: string | null = null;
  let rooms: MeetingRoom[] = [];
  let roomsLoading = false;
  let roomsError: unknown = null;
  let availability = new Map<string, RoomAvailability>();
  let availabilityLoading = false;
  let availabilityError: unknown = null;
  let onlyFree = true;
  let manualAddress = "";
  let selectError: string | null = null;
  /** Ответ на устаревший запрос (сменили список или время) не показываем */
  let roomsRequest = 0;
  let availabilityRequest = 0;

  $: participants = event.participants;
  $: selectedRooms = $participants.contents.filter(p => p.isResource)
    .map(p => ({ name: p.name || p.emailAddress, emailAddress: p.emailAddress }));
  // Числа, а не Date: иначе любая правка встречи заново спрашивала бы занятость
  $: startMS = $event.startTime?.getTime();
  $: endMS = $event.endTime?.getTime();
  $: shownRooms = onlyFree
    ? rooms.filter(room => availability.get(room.emailAddress.toLowerCase()) === true || isChosen(room, selectedRooms))
    : rooms;
  $: checkAvailability(rooms, startMS, endMS);

  loadLists();

  async function loadLists(): Promise<void> {
    listsLoading = true;
    listsError = null;
    try {
      roomLists = await event.calendar.listRoomLists();
      selectedListAddress = roomLists[0]?.emailAddress ?? null;
    } catch (ex) {
      listsError = ex;
    } finally {
      listsLoading = false;
    }
    if (selectedListAddress) {
      await loadRooms();
    }
  }

  async function loadRooms(): Promise<void> {
    let list = roomLists.find(list => list.emailAddress == selectedListAddress);
    if (!list) {
      return;
    }
    let request = ++roomsRequest;
    roomsLoading = true;
    roomsError = null;
    rooms = [];
    try {
      let result = await event.calendar.listRooms(list);
      if (request == roomsRequest) {
        rooms = result;
      }
    } catch (ex) {
      if (request == roomsRequest) {
        roomsError = ex;
      }
    } finally {
      if (request == roomsRequest) {
        roomsLoading = false;
      }
    }
  }

  async function checkAvailability(rooms: MeetingRoom[], startMS: number, endMS: number): Promise<void> {
    let request = ++availabilityRequest;
    availability = new Map();
    availabilityError = null;
    if (!rooms.length || !startMS || !endMS || endMS <= startMS) {
      availabilityLoading = false;
      return;
    }
    availabilityLoading = true;
    try {
      let result = await getRoomsAvailability(event.calendar, rooms, new Date(startMS), new Date(endMS));
      if (request == availabilityRequest) {
        availability = result;
      }
    } catch (ex) {
      if (request == availabilityRequest) {
        availabilityError = ex;
      }
    } finally {
      if (request == availabilityRequest) {
        availabilityLoading = false;
      }
    }
  }

  function isChosen(room: MeetingRoom, selected: MeetingRoom[]): boolean {
    return selected.some(chosen => chosen.emailAddress.toLowerCase() == room.emailAddress.toLowerCase());
  }

  /** Комната — участник-ресурс, поэтому встреча становится собранием с организатором */
  function onSelect(room: MeetingRoom): void {
    selectError = null;
    if (event.myParticipation != InvitationResponse.Organizer) {
      if (!event.calendar?.identitiesAvailable?.first) {
        selectError = $t`Please set up an email account to send the invitation from`;
        return;
      }
      event.createMeeting();
    }
    addRoomToEvent(event, room);
  }

  function onRemove(room: MeetingRoom): void {
    removeRoomFromEvent(event, room);
  }

  function isValidAddress(address: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.trim());
  }

  function onAddManual(): void {
    let emailAddress = manualAddress.trim();
    if (!isValidAddress(emailAddress)) {
      return;
    }
    let room = rooms.find(room => room.emailAddress.toLowerCase() == emailAddress.toLowerCase())
      ?? { name: emailAddress, emailAddress };
    onSelect(room);
    if (!selectError) {
      manualAddress = "";
    }
  }
</script>

<style>
  .rooms {
    flex: 1 1 0;
    gap: 8px;
    min-width: 0;
    max-width: 40em;
    /* Длинные имена комнат не распирают окно встречи: ширину задаёт раздел */
    contain: inline-size;
  }
  .selected {
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    padding-inline-start: 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background-color: var(--main-bg);
  }
  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .controls {
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 12px;
  }
  .field span {
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
  }
  .field select {
    max-width: 20em;
    min-width: 0;
  }
  .only-free {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .status,
  .hint {
    margin: 0;
    color: color-mix(in srgb, var(--main-fg) 62%, transparent);
    font-size: 12px;
    line-height: 1.4;
  }
  .list {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .room {
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 4px 4px 4px 12px;
  }
  .room + .room {
    border-block-start: 1px solid var(--border);
  }
  .room-name {
    min-width: 0;
  }
  .room-name .name {
    overflow-wrap: anywhere;
  }
  .room-name .address {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .room-name .address {
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
  }
  .state {
    flex: none;
    color: color-mix(in srgb, var(--main-fg) 55%, transparent);
  }
  .state.free {
    color: var(--success-fg);
  }
  .state.busy {
    color: var(--danger-fg);
  }
  .chosen-mark {
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    color: var(--success-fg);
  }
  .manual {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .manual :global(button) {
    flex: none;
    white-space: nowrap;
  }
  .manual input {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 20em;
  }
  .error {
    margin: 0;
    color: var(--danger-fg);
    font-size: 12px;
    line-height: 1.4;
  }
</style>
