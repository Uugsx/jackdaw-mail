<hbox class="event font-small" on:click
  style="
    top: {startPosInPercent}%;
    left: {column / columns * 100}%;
    height: {heightInPercent}%;
    width: {100 / columns}%;
    --color: {event.color ?? event.calendar?.color}"
  class:conflict={conflicts.length > 1}
  class:cancelled={$event.isCancelled}
  class:selected={$selectedEvent == event}>
  <slot />
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedEvent } from "../selected";
  import type { ArrayColl } from "svelte-collections";
  import type { DayColumn } from "../../../logic/Calendar/dayColumns";

  export let event: Event;
  /** Time where the cell (not the event) starts */
  export let start: Date;
  /** Time where the cell (not the event) end */
  export let end: Date;
  /** event and all other events that happen in this time slot */
  export let conflicts: ArrayColl<Event>;
  /** Колонка события на весь день. Без неё — старый расчёт по событиям этого часа. */
  export let layout: DayColumn | undefined = undefined;

  $: column = layout ? layout.column : conflicts.indexOf(event);
  $: columns = layout ? layout.columns : conflicts.length;

  $: blockHeightInMS = end.getTime() - start.getTime();
  $: startPosInPercent = Math.max(0, ($event.startTime.getTime() - start.getTime()) / blockHeightInMS * 100);
  $: heightInPercent = Math.min(100, ($event.endTime.getTime() - start.getTime()) / blockHeightInMS * 100 - startPosInPercent);
</script>

<style>
  .event {
    position: absolute;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .event.conflict {
    /*outline: 2px solid red; TODO use box-shadow */
  }
  .event.cancelled {
    opacity: 30%;
  }
</style>
