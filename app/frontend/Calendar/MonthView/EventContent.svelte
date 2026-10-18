<Clickable onClick={onSelect} onDoubleClick={onOpen}>
  <hbox class="event font-small"
    title={eventAsText}>
    {#if !$event.allDay && !isContinued}
      <hbox class="time">
        {startTime}
      </hbox>
    {/if}
    <hbox class="title">{$event.title}</hbox>
  </hbox>
</Clickable>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { openEvent } from "../open";
  import { selectedEvent } from "../selected";
  import Clickable from "../../Shared/Clickable.svelte";
  import { getDurationString } from "../../Util/date";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let event: Event;
  /** Time where the cell (not the event) starts */
  export let start: Date;

  $: startTime = $event.startTime.toLocaleString(getDateTimeLocale(), {
    hour: "numeric",
    minute: $event.startTime.getMinutes() != 0 ? "2-digit" : undefined,
  });
  $: eventAsText = ($event.allDay ? "" : `${startTime} – ${getDurationString(event.endTime.getTime() - event.startTime.getTime())}\n`) +
     event.title +
     (event.participants.isEmpty ? "" : "\n" + event.participants.getIndexRange(0, 4).map(person => person.name).join(", "));
  $: isContinued = $event.startTime < start;

  function onSelect() {
    $selectedEvent = event;
  }

  function onOpen() {
    openEvent(event, true);
  }
</script>

<style>
  .event {
    background-color: var(--color);
    color: lch(from var(--color) calc((49.44 - l) * infinity) 0 0);
    box-sizing: border-box;
    padding-inline-start: 4px;
    width: 100%;
  }
  @media (prefers-color-scheme: dark) {
    .event {
      background-image:
        linear-gradient(var(--color), var(--color)),
        linear-gradient(#000000AA, #000000AA);
      background-blend-mode: overlay;
      background-color: unset;
      color: unset;
    }
  }
  .event:hover {
    background-color: #20AF9E70;
  }
  /* Время не сжимается: при нехватке места многоточием сокращается название. */
  .time {
    flex-shrink: 0;
    margin-inline-end: 4px;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  /* Очень узкая сетка месяца (рядом открыт день): время должно помещаться целиком. */
  @container (max-width: 420px) {
    .event {
      padding-inline-start: 2px;
    }
    .time {
      margin-inline-end: 2px;
      font-size: 11px;
    }
  }
  /* Ячейка ~28px: помещается только время, название остаётся во всплывающей подсказке. */
  @container (max-width: 260px) {
    .event {
      padding-inline-start: 1px;
    }
    .time {
      display: block;
      min-width: 0;
      flex-shrink: 1;
      margin-inline-end: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .time + .title {
      display: none;
    }
  }
  :global(.cancelled) .time,
  .title {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.cancelled) .title {
    text-decoration: line-through;
  }
</style>
