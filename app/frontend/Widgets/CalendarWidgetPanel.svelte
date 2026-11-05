<vbox flex class="calendar-widget">
  {#if appGlobal.calendars.isEmpty}
    <vbox flex class="setup-empty">
      <JackdawChaseLoader compact idle />
      <p class="setup-title font-smallest">{$t`Connect a calendar account`}</p>
      <p class="setup-text font-smallest">{$t`Your events from Jackdaw calendars will appear here, like Outlook My Day.`}</p>
      <Button label={$t`Set up calendar`} onClick={openCalendarSetup} />
    </vbox>
  {:else}
    <WidgetMiniMonth bind:visibleMonth />

    <div class="agenda-scroll" bind:this={agendaScrollEl}>
      <vbox class="agenda">
        {#each agendaDays as dayGroup (dayGroup.date.getTime())}
          <vbox class="day-group"
            data-day={dayGroup.date.getTime()}
            class:is-selected={isSameDay(dayGroup.date, $selectedDate)}>
            <hbox class="day-header font-smallest" class:is-today={dayGroup.isToday}>
              {#if dayGroup.isToday}
                {$t`Today`} • {dayGroup.weekday} • {dayGroup.fullDate}
              {:else if dayGroup.isTomorrow}
                {$t`Tomorrow`} • {dayGroup.weekday} • {dayGroup.fullDate}
              {:else}
                {dayGroup.weekday} • {dayGroup.fullDate}
              {/if}
            </hbox>
            {#if dayGroup.events.length === 0}
              <p class="empty font-smallest">{$t`No events scheduled`}</p>
            {:else}
              {#each dayGroup.events as event (event.id)}
                <button type="button" class="event-card" title={[event.title, eventDetail(event)].filter(Boolean).join("\n")} on:click={() => openEvent(event)}>
                  <vbox class="event-time-col font-smallest tabular-nums">
                    {#if event.allDay}
                      <span class="time-main">{$t`All day`}</span>
                    {:else}
                      <span class="time-main">{formatTime(event.startTime)}</span>
                      {#if event.duration}
                        <span class="time-duration">{formatDuration(event)}</span>
                      {/if}
                    {/if}
                  </vbox>
                  <vbox flex class="event-body">
                    <span class="event-accent" style="--event-color: {event.color ?? event.calendar?.color}" aria-hidden="true" />
                    <vbox flex class="event-text">
                      <span class="event-title font-smallest">{event.title}</span>
                      {#if eventDetail(event)}
                        <span class="event-detail font-smallest">{eventDetail(event)}</span>
                      {/if}
                    </vbox>
                  </vbox>
                </button>
              {/each}
            {/if}
          </vbox>
        {/each}
      </vbox>
    </div>
  {/if}
</vbox>

<script lang="ts">
  import WidgetMiniMonth from "./WidgetMiniMonth.svelte";
  import JackdawChaseLoader from "../Shared/JackdawChaseLoader.svelte";
  import Button from "../Shared/Button.svelte";
  import { shownCalendarEvents, selectedDate } from "../Calendar/selected";
  import { openEvent } from "../Calendar/open";
  import { openApp } from "../AppsBar/selectedApp";
  import { calendarApp } from "../Calendar/CalendarJackdawApp";
  import { appGlobal } from "../../logic/app";
  import type { Event } from "../../logic/Calendar/Event";
  import { getDateTimeLocale, t } from "../../l10n/l10n";
  import { getDurationString, getToday } from "../Util/date";
  import { tick } from "svelte";

  interface AgendaDayGroup {
    date: Date;
    weekday: string;
    fullDate: string;
    isToday: boolean;
    isTomorrow: boolean;
    events: Event[];
  }

  const AGENDA_FUTURE_DAYS = 21;

  let visibleMonth = startOfMonth(new Date());
  let agendaScrollEl: HTMLDivElement;
  let lastScrolledDay: number | null = null;
  let lastSyncedSelected = 0;

  $: if ($selectedDate) {
    let stamp = $selectedDate.getTime();
    if (stamp !== lastSyncedSelected) {
      lastSyncedSelected = stamp;
      visibleMonth = startOfMonth($selectedDate);
    }
  }

  $: agendaRange = getAgendaRange(visibleMonth);
  $: agendaDays = buildAgendaDays([...shownCalendarEvents], agendaRange.start, agendaRange.count);
  $: $selectedDate, scrollToSelectedDay($selectedDate);

  function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function getAgendaRange(month: Date): { start: Date, count: number } {
    let start = startOfDay(startOfMonth(month));
    let monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    let futureEnd = getToday();
    futureEnd.setDate(futureEnd.getDate() + AGENDA_FUTURE_DAYS);
    let end = monthEnd > futureEnd ? monthEnd : futureEnd;
    let count = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    return { start, count: Math.max(count, 1) };
  }

  function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function endOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  function isSameDay(a: Date, b: Date | null | undefined): boolean {
    if (!b) {
      return false;
    }
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function buildAgendaDays(events: Event[], startDay: Date, horizonDays: number): AgendaDayGroup[] {
    let today = getToday();
    let tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let groups: AgendaDayGroup[] = [];

    for (let offset = 0; offset < horizonDays; offset++) {
      let date = new Date(startDay);
      date.setDate(date.getDate() + offset);
      let start = startOfDay(date);
      let end = endOfDay(date);
      let dayEvents = events
        .filter(ev => ev.endTime >= start && ev.startTime <= end)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      groups.push({
        date,
        weekday: date.toLocaleDateString(getDateTimeLocale(), { weekday: "long" }),
        fullDate: date.toLocaleDateString(getDateTimeLocale(), { day: "numeric", month: "long" }),
        isToday: isSameDay(date, today),
        isTomorrow: isSameDay(date, tomorrow),
        events: dayEvents,
      });
    }
    return groups;
  }

  async function scrollToSelectedDay(date: Date | null | undefined) {
    if (!date || !agendaScrollEl) {
      return;
    }
    let stamp = date.getTime();
    if (lastScrolledDay === stamp) {
      return;
    }
    await tick();
    let target = agendaScrollEl.querySelector(`[data-day="${stamp}"]`);
    target?.scrollIntoView({ block: "nearest" });
    lastScrolledDay = stamp;
  }

  function formatTime(date: Date): string {
    return date.toLocaleString(getDateTimeLocale(), { hour: "2-digit", minute: "2-digit" });
  }

  function formatDuration(event: Event): string {
    if (!event.duration || event.allDay) {
      return "";
    }
    return getDurationString(event.duration * 1000);
  }

  function eventDetail(event: Event): string {
    return event.onlineMeetingURL?.trim()
      || event.location?.trim()
      || "";
  }

  function openCalendarSetup() {
    openApp(calendarApp, {});
  }
</script>

<style>
  .calendar-widget {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    background: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .setup-empty {
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px 16px;
    text-align: center;
  }
  .setup-empty :global(.setup-icon) {
    color: color-mix(in srgb, var(--leftbar-fg) 58%, transparent);
  }
  .setup-title {
    margin: 0;
    font-weight: 650;
  }
  .setup-text {
    margin: 0;
    max-width: 240px;
    line-height: 1.35;
    color: color-mix(in srgb, var(--leftbar-fg) 68%, transparent);
  }
  .agenda-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .agenda {
    gap: 12px;
    padding: 10px 10px 16px;
  }
  .day-group {
    gap: 4px;
  }
  .day-group.is-selected .day-header:not(.is-today) {
    color: var(--icon-primary);
  }
  .day-header {
    font-weight: 650;
    color: color-mix(in srgb, var(--leftbar-fg) 78%, transparent);
    padding-inline: 2px;
    line-height: 1.35;
  }
  .day-header.is-today {
    color: var(--icon-primary);
  }
  .empty {
    margin: 0;
    padding: 2px 2px 4px;
    color: color-mix(in srgb, var(--leftbar-fg) 58%, transparent);
    line-height: 1.35;
  }
  .event-card {
    display: flex;
    align-items: stretch;
    gap: 10px;
    width: 100%;
    padding: 8px 4px;
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: default;
  }
  .event-card:hover {
    background: var(--hover-bg);
    border-color: var(--border);
  }
  .event-time-col {
    flex-shrink: 0;
    width: 3.25rem;
    gap: 2px;
    align-items: flex-start;
    color: color-mix(in srgb, var(--leftbar-fg) 72%, transparent);
  }
  .time-main {
    font-weight: 600;
    color: var(--leftbar-fg);
  }
  .time-duration {
    opacity: 0.72;
    font-size: 10px;
    line-height: 1.2;
  }
  .event-body {
    position: relative;
    flex-direction: row;
    align-items: stretch;
    min-width: 0;
    gap: 8px;
  }
  .event-accent {
    flex-shrink: 0;
    width: 3px;
    border-radius: 999px;
    background: var(--event-color, var(--icon-primary));
  }
  .event-text {
    min-width: 0;
    gap: 2px;
  }
  .event-title {
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .event-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in srgb, var(--leftbar-fg) 62%, transparent);
  }
</style>
