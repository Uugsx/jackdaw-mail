<vbox class="assistant" role="group" aria-label={$t`Availability of participants`}>
  <hbox class="toolbar">
    <hbox class="nav">
      <button type="button" class="icon-btn" title={$t`Previous day`} aria-label={$t`Previous day`} on:click={() => shiftDay(-1)}>
        <ChevronLeftIcon size="16" />
      </button>
      <span class="day-label">{dayLabel}</span>
      <button type="button" class="icon-btn" title={$t`Next day`} aria-label={$t`Next day`} on:click={() => shiftDay(1)}>
        <ChevronRightIcon size="16" />
      </button>
    </hbox>
    <button type="button" class="find" on:click={findFreeSlot} disabled={loading || !hasKnownData}>
      <SearchIcon size="14" />
      {$t`Find a free time`}
    </button>
  </hbox>

  {#if loading}
    <vbox class="rows" aria-busy="true">
      {#each rows as row}
        <hbox class="row">
          <hbox class="who"><span class="name skeleton-text">{row.name}</span></hbox>
          <hbox class="track skeleton"></hbox>
        </hbox>
      {/each}
    </vbox>
  {:else if loadError}
    <hbox class="message error" role="alert">
      <span class="text">{loadError}</span>
      <button type="button" class="retry" on:click={reload}>{$t`Try again`}</button>
    </hbox>
  {:else}
    <vbox class="rows">
      <hbox class="row hours-row">
        <hbox class="who"></hbox>
        <hbox class="track hours">
          {#each hourMarks as mark}
            <span class="hour" style="inset-inline-start: {mark.pos}%">{mark.label}</span>
          {/each}
        </hbox>
      </hbox>
      {#each rows as row (row.key)}
        <hbox class="row">
          <hbox class="who" title={row.name}>
            <span class="name">{row.name}</span>
          </hbox>
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <hbox class="track" class:unknown={row.unknown} on:click={ev => onTrackClick(ev)} title={row.unknown ? $t`No availability data` : row.summary}>
            {#each hourMarks as mark}
              <span class="gridline" style="inset-inline-start: {mark.pos}%"></span>
            {/each}
            {#each row.busy as block}
              <span class="busy" style="inset-inline-start: {block.left}%; width: {block.width}%"></span>
            {/each}
            {#if row.unknown}
              <span class="unknown-label">{$t`No data`}</span>
            {/if}
          </hbox>
        </hbox>
      {/each}
      {#if selection}
        <span class="selection" style="inset-inline-start: calc(var(--who-width) + (100% - var(--who-width)) * {selection.left / 100}); width: calc((100% - var(--who-width)) * {selection.width / 100})"></span>
      {/if}
    </vbox>
    <hbox class="legend">
      <span class="key"><i class="swatch free"></i>{$t`Free`}</span>
      <span class="key"><i class="swatch busy"></i>{$t`Busy`}</span>
      <span class="key"><i class="swatch unknown"></i>{$t`No data`}</span>
      <span class="key"><i class="swatch selection"></i>{$t`Meeting time`}</span>
    </hbox>
    {#if conflictText}
      <hbox class="message conflict" role="status">{conflictText}</hbox>
    {:else if hasKnownData}
      <hbox class="message ok" role="status">{$t`Everyone is free at this time`}</hbox>
    {:else}
      <hbox class="message hint" role="status">{$t`This server does not share availability of other people`}</hbox>
    {/if}
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import type { Participant } from "../../../logic/Calendar/Participant";
  import type { Collection } from "svelte-collections";
  import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import SearchIcon from "lucide-svelte/icons/search";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  /** Приглашённые, чью занятость показываем */
  export let participants: Collection<Participant>;
  export let event: Event;

  /** Показываемый диапазон дня, часы */
  const kFromHour = 7;
  const kToHour = 21;
  const kSearchFromHour = 9;
  const kSearchToHour = 18;
  const kStepMinutes = 30;
  const kWindowDays = 7;
  const kSearchDays = 14;

  type Interval = { from: Date, to: Date, free: boolean };
  type Availability = { participant: Participant, availability?: Interval[] };

  $: list = $participants;
  $: calendar = $event.calendar;
  $: start = $event.startTime;
  $: end = $event.endTime;

  let day = startOfDay($event.startTime);
  let loadedFrom: Date = null;
  let loadedTo: Date = null;
  let data: Availability[] = [];
  let loading = false;
  let loadError: string | null = null;
  let requestId = 0;
  let participantsKey = "";

  $: key = list.contents.map(p => p.emailAddress).join(",");
  $: if (key !== participantsKey) {
    participantsKey = key;
    reload();
  }
  $: if (!loading && loadedFrom && (day < loadedFrom || addDays(day, 1) > loadedTo)) {
    reload();
  }

  /** Событие перенесли в другой день — показываем этот день */
  let lastEventDay = startOfDay($event.startTime).getTime();
  $: if (startOfDay(start).getTime() !== lastEventDay) {
    lastEventDay = startOfDay(start).getTime();
    day = startOfDay(start);
  }

  function startOfDay(date: Date): Date {
    let d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date: Date, days: number): Date {
    let d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  async function reload() {
    let id = ++requestId;
    let persons = list.contents.filter(p => p.emailAddress);
    if (!persons.length || !calendar) {
      data = [];
      loadedFrom = loadedTo = null;
      loading = false;
      loadError = null;
      return;
    }
    loading = true;
    loadError = null;
    let from = day;
    let to = addDays(day, kWindowDays);
    try {
      let result = await calendar.arePersonsFree(persons, from, to);
      if (id != requestId) {
        return;
      }
      data = persons.map(p => result.find(r => r.participant.emailAddress == p.emailAddress) ?? { participant: p });
      loadedFrom = from;
      loadedTo = to;
    } catch (ex) {
      if (id != requestId) {
        return;
      }
      data = [];
      loadedFrom = loadedTo = null;
      loadError = $t`Could not load availability` + (ex?.message ? ": " + ex.message : "");
    } finally {
      if (id == requestId) {
        loading = false;
      }
    }
  }

  function shiftDay(delta: number) {
    day = addDays(day, delta);
  }

  $: dayLabel = day.toLocaleDateString(getDateTimeLocale(), { weekday: "short", day: "numeric", month: "long" });

  const kSpan = (kToHour - kFromHour) * 60;

  function minutesFromDayStart(date: Date): number {
    return (date.getTime() - day.getTime()) / 60000 - kFromHour * 60;
  }

  function toPercent(minutes: number): number {
    return Math.min(100, Math.max(0, minutes / kSpan * 100));
  }

  function clipBlock(from: Date, to: Date): { left: number, width: number } | null {
    let a = minutesFromDayStart(from);
    let b = minutesFromDayStart(to);
    if (b <= 0 || a >= kSpan) {
      return null;
    }
    let left = toPercent(a);
    let right = toPercent(b);
    return { left, width: Math.max(right - left, 0.5) };
  }

  const kHourStep = 2;
  $: hourMarks = Array.from({ length: Math.floor((kToHour - kFromHour) / kHourStep) + 1 }, (_, i) => {
    let hour = kFromHour + i * kHourStep;
    return { pos: toPercent((hour - kFromHour) * 60), label: String(hour).padStart(2, "0") };
  });

  function timeLabel(date: Date): string {
    return date.toLocaleTimeString(getDateTimeLocale(), { hour: "2-digit", minute: "2-digit" });
  }

  $: rows = data.map((item, index) => {
    let name = item.participant.name || item.participant.emailAddress;
    let unknown = !item.availability;
    let busyIntervals = (item.availability ?? []).filter(i => !i.free);
    let blocks = busyIntervals
      .map(i => clipBlock(i.from, i.to))
      .filter(b => !!b);
    let todays = busyIntervals.filter(i => i.to > day && i.from < addDays(day, 1));
    let summary = unknown ? "" : todays.length
      ? name + ": " + $t`Busy` + " " + todays.map(i => timeLabel(i.from) + "–" + timeLabel(i.to)).join(", ")
      : name + ": " + $t`Free`;
    return { key: index + ":" + item.participant.emailAddress, name, unknown, busy: blocks, summary };
  });

  $: hasKnownData = data.some(item => !!item.availability);

  $: selection = clipBlock(start, end);

  function isBusyAt(item: Availability, from: Date, to: Date): boolean {
    return (item.availability ?? []).some(i => !i.free && i.from < to && from < i.to);
  }

  $: conflicts = data.filter(item => item.availability && isBusyAt(item, start, end));
  $: conflictText = conflicts.length
    ? $t`Busy at this time` + ": " + conflicts.map(c => c.participant.name || c.participant.emailAddress).join(", ")
    : "";

  function moveEventTo(newStart: Date) {
    let duration = event.duration;
    let alarmOffset = event.alarm ? event.startTime.getTime() - event.alarm.getTime() : null;
    event.startTime = newStart;
    event.duration = duration;
    if (alarmOffset != null) {
      event.alarm = new Date(newStart.getTime() - alarmOffset);
    }
  }

  function onTrackClick(ev: MouseEvent) {
    let track = ev.currentTarget as HTMLElement;
    let rect = track.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    let ratio = (ev.clientX - rect.left) / rect.width;
    if (getComputedStyle(track).direction == "rtl") {
      ratio = 1 - ratio;
    }
    let minutes = kFromHour * 60 + Math.round(ratio * kSpan / kStepMinutes) * kStepMinutes;
    moveEventTo(new Date(day.getTime() + minutes * 60000));
  }

  /** Ближайшее время после текущего начала, когда все, о ком есть данные, свободны */
  function findFreeSlot() {
    let duration = event.duration * 1000;
    let step = kStepMinutes * 60000;
    let known = data.filter(item => item.availability);
    let rangeEnd = loadedTo ? Math.min(loadedTo.getTime(), addDays(day, kSearchDays).getTime()) : 0;
    let t0 = Math.max(Date.now(), start.getTime() + step);
    t0 = Math.ceil(t0 / step) * step;
    for (let time = t0; time + duration <= rangeEnd; time += step) {
      let from = new Date(time);
      let to = new Date(time + duration);
      let fromMin = from.getHours() * 60 + from.getMinutes();
      let toMin = fromMin + duration / 60000;
      if (fromMin < kSearchFromHour * 60 || toMin > kSearchToHour * 60) {
        continue;
      }
      if (known.every(item => !isBusyAt(item, from, to))) {
        moveEventTo(from);
        return;
      }
    }
    loadError = $t`No common free time found in the next days`;
  }
</script>

<style>
  .assistant {
    --who-width: 120px;
    --track-height: 28px;
    --busy: #e5484d;
    --free: #3fa66a;
    position: relative;
    gap: 8px;
    min-width: 0;
  }
  .toolbar {
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .nav {
    align-items: center;
    gap: 4px;
  }
  .day-label {
    min-width: 140px;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
  }
  .find {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    min-height: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    white-space: nowrap;
  }
  .icon-btn:hover,
  .find:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  .icon-btn:active,
  .find:active:not(:disabled) {
    transform: translateY(1px);
  }
  .icon-btn:focus-visible,
  .find:focus-visible,
  .retry:focus-visible {
    outline: 2px solid var(--main-fg, currentColor);
    outline-offset: 2px;
  }
  .find:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .rows {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .row {
    align-items: stretch;
    min-height: var(--track-height);
    border-block-end: 1px solid var(--border);
  }
  .row:last-of-type {
    border-block-end: none;
  }
  .who {
    flex: 0 0 var(--who-width);
    width: var(--who-width);
    align-items: center;
    padding: 0 8px;
    min-width: 0;
    border-inline-end: 1px solid var(--border);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .track {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    cursor: pointer;
    background: color-mix(in srgb, var(--free) 14%, transparent);
  }
  .hours-row {
    min-height: 22px;
  }
  .track.hours {
    background: transparent;
    cursor: default;
  }
  .hour {
    position: absolute;
    top: 3px;
    transform: translateX(-50%);
    font-size: 11px;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
  .gridline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border);
    opacity: 0.6;
    pointer-events: none;
  }
  .track .busy {
    position: absolute;
    top: 4px;
    bottom: 4px;
    background: var(--busy);
    border-radius: 3px;
    pointer-events: none;
  }
  .track.unknown {
    background: repeating-linear-gradient(135deg,
      color-mix(in srgb, currentColor 10%, transparent) 0 6px,
      transparent 6px 12px);
  }
  .unknown-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    opacity: 0.7;
    pointer-events: none;
  }
  .rows > .selection {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--main-fg, #0078d4) 14%, transparent);
    border-inline: 2px solid var(--main-fg, #0078d4);
    pointer-events: none;
  }
  .legend {
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 12px;
    opacity: 0.8;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
  .swatch.free {
    background: color-mix(in srgb, var(--free) 30%, transparent);
  }
  .swatch.busy {
    background: var(--busy);
  }
  .swatch.unknown {
    background: repeating-linear-gradient(135deg,
      color-mix(in srgb, currentColor 25%, transparent) 0 3px,
      transparent 3px 6px);
  }
  .swatch.selection {
    background: color-mix(in srgb, var(--main-fg, #0078d4) 25%, transparent);
    border-color: var(--main-fg, #0078d4);
  }
  .message {
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 13px;
    line-height: 1.4;
  }
  .message.conflict {
    color: var(--busy);
  }
  .message.ok {
    color: var(--free);
  }
  .message.hint {
    opacity: 0.7;
  }
  .message.error {
    color: var(--danger-fg, var(--busy));
  }
  .retry {
    padding: 2px 10px;
    border: 1px solid currentColor;
    border-radius: 6px;
    background: transparent;
    color: inherit;
  }
  .skeleton {
    background: linear-gradient(90deg,
      color-mix(in srgb, currentColor 6%, transparent),
      color-mix(in srgb, currentColor 14%, transparent),
      color-mix(in srgb, currentColor 6%, transparent));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  .skeleton-text {
    opacity: 0.5;
  }
  @keyframes shimmer {
    to { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton { animation: none; }
  }
  @container (max-width: 420px) {
    .assistant {
      --who-width: 88px;
    }
    .day-label {
      min-width: 0;
    }
  }
</style>
