<vbox class="time-box font-smallest" flex
  title={time?.toLocaleDateString(getDateTimeLocale()) + "\n" + time?.toLocaleTimeString(getDateTimeLocale())}>
  {#if !sameDay}
    <hbox class="date">
      {getDateString(time, { year: "2-digit", month: "2-digit", day: "2-digit" })}
    </hbox>
  {/if}
  <hbox class="time">
    {getTimeString(time)}
  </hbox>
</vbox>

<script lang="ts">
  import type { LogEntry } from "../../../logic/Contacts/History/History";
  import { getDateString, getTimeString } from "../../Util/date";
  import { getDateTimeLocale } from "../../../l10n/l10n";

  export let message: LogEntry;
  export let previousMessage: LogEntry | null;

  $: time = (message as any)._history_time as Date; // set in `searchLog()` `.sortBy()`
  $: sameDay = time?.toLocaleDateString() == (previousMessage as any)?._history_time.toLocaleDateString();
</script>

<style>
  .time-box {
    /* column width in <ContactHistory>. Must be wide enough for "20/08/28" (.date content).  */
    overflow: hidden;
    padding: 6px 4px 4px 0px;
  }
  .date {
    font-weight: 600;
    align-self: start;
    padding-inline-start: 6px;
    margin-block-end: 2px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .time {
    padding-inline-start: 6px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
