<Clickable {onDoubleClick}>
  <vbox flex class="events"
    style="--selected-calendar-color: {$selectedCalendar?.color ?? "black"}"
    on:pointerenter={() => hovering = true}
    on:pointerleave={() => hovering = false}
    >
    <!-- Нерабочее время: сверху и снизу от рабочей части ячейки -->
    {#if offHours}
      {#if offHours.top > 0}
        <div class="off-hours" style="top: 0; height: {offHours.top * 100}%" aria-hidden="true" />
      {/if}
      {#if offHours.bottom > 0}
        <div class="off-hours" style="bottom: 0; height: {offHours.bottom * 100}%" aria-hidden="true" />
      {/if}
    {/if}
    {#if $displayEvents?.hasItems}
      {#each $displayEvents.each as event (event.id)}
        <EventContainer {event} {start} {end} {conflicts}>
          <EventContent {event} {start} {end} forceShowText={conflicts.length > 1} />
        </EventContainer>
      {/each}
    {/if}

    {#if $displayOverlayEvents.hasItems}
      {#each $displayOverlayEvents.each as event}
        <EventContainer {event} {start} {end} {conflicts}>
          <slot name="event-overlay" start={event.startTime} {end} {event} events={displayEvents} />
        </EventContainer>
      {/each}
    {/if}

    {#if hovering}
      <slot name="event-hover"
        {start} {end}
        empty={!$displayEvents?.hasItems && !$displayOverlayEvents.hasItems}
        events={displayEvents}
        />
    {/if}
  </vbox>
</Clickable>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedCalendar } from "../selected";
  import EventContainer from "./EventContainer.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import { ArrayColl, Collection } from "svelte-collections";
  import EventContent from "./EventContent.svelte";
  import { calendarWorkingHours } from "../workingHours";
  import { workingSpanInCell, type CalendarWorkingHours } from "../../../logic/Calendar/WorkingHours/CalendarWorkingHours";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ celldblclick: { start: Date, end: Date, mouseEvent: MouseEvent } }>();

  export let start: Date;
  export let intervalInHours: number;
  export let events: Collection<Event>;
  export let overlayEvents: Collection<Event> | null = null;

  let displayEvents: ArrayColl<Event>;
  let displayOverlayEvents = new ArrayColl<Event>();
  let end: Date;
  $: start, intervalInHours, $overlayEvents, setEnd();
  function setEnd() {
    end = new Date(start);
    end.setHours(end.getHours() + intervalInHours);
    displayEvents = events.filterObservable(ev => ev.startTime < end && ev.endTime > start && !ev.allDay);
    displayOverlayEvents = overlayEvents
      ?.filterObservable(ev => ev.startTime < end && ev.endTime > start && !ev.allDay)
      ?? new ArrayColl<Event>();
  }

  $: offHours = offHoursIn(start, end, $calendarWorkingHours);
  function offHoursIn(start: Date, end: Date, settings: CalendarWorkingHours): { top: number, bottom: number } | null {
    if (!settings.highlight || !start || !end) {
      return null;
    }
    let span = workingSpanInCell(start, end, settings);
    return span ? { top: span.from, bottom: 1 - span.to } : { top: 1, bottom: 0 };
  }

  $: conflicts = overlayEvents
        ? displayEvents.concat(displayOverlayEvents)
        : displayEvents;

  let hovering = false;

  function onDoubleClick(mouseEvent: MouseEvent) {
    dispatchEvent("celldblclick", { start, end, mouseEvent });
  }
</script>

<style>
  .events {
    position: relative;
    border-left: 1px dotted var(--border);
    /* border-bottom: 1px dotted var(--border); /* should not make gap between cells */
    /* box-shadow: 0 1px 0 0 var(--border); */
    background-image: linear-gradient(to right, var(--border) 0%, rgba(255,255,255,0) 100%);
    background-position: bottom;
    background-size: 3px 1px;
    background-repeat: repeat-x;
  }
  .events:hover {
    background-color: color-mix(in srgb, var(--selected-calendar-color) 10%, transparent);
    color: white;
  }
  .events :global(.event) {
    z-index: 1;
  }
  .off-hours {
    position: absolute;
    left: 0;
    right: 0;
    /* От цвета текста: заметно и в светлой, и в тёмной теме */
    background-color: var(--calendar-off-hours-bg, color-mix(in srgb, var(--fg) 7%, transparent));
    pointer-events: none;
  }
</style>
