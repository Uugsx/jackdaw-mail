<HeaderGroupBox>
  <hbox slot="header">
    {$t`Work time`}
  </hbox>
  <vbox class="working-hours">
    <label class="checkbox">
      <input type="checkbox" checked={settings.highlight} on:change={onHighlightChange} />
      {$t`Shade non-working time in the day and week views`}
    </label>

    <div class="days" aria-label={$t`Working calendar`}>
      {#each settings.schedule.days as day, index}
        <div class="day-row">
          <label class="day-toggle">
            <input
              type="checkbox"
              checked={day.enabled}
              aria-label={`${weekdayNames[index]}: ${day.enabled ? $t`Working day` : $t`Day off`}`}
              on:change={event => onDayEnabledChange(index, event)} />
            <span>{weekdayNames[index]}</span>
          </label>
          {#if day.enabled}
            <input
              type="time"
              value={formatWorkingTime(day.startMinutes)}
              aria-label={`${weekdayNames[index]}: ${$t`Start of workday`}`}
              aria-invalid={error == "invalid"}
              on:change={event => onTimeChange(index, "startMinutes", event)} />
            <span class="separator" aria-hidden="true">–</span>
            <input
              type="time"
              value={formatWorkingTime(day.endMinutes)}
              aria-label={`${weekdayNames[index]}: ${$t`End of workday`}`}
              aria-invalid={error == "invalid"}
              on:change={event => onTimeChange(index, "endMinutes", event)} />
          {:else}
            <span class="day-off">{$t`Day off`}</span>
          {/if}
        </div>
      {/each}
    </div>
    {#if error == "no-working-days"}
      <p class="error" role="alert">{$t`Select at least one working day.`}</p>
    {:else if error == "invalid"}
      <p class="error" role="alert">{$t`For each working day, the end time must be later than the start time.`}</p>
    {/if}

    <label class="time-zone">
      <span>{$t`Time zone`}</span>
      <select value={settings.timeZone ?? ""} on:change={onTimeZoneChange}>
        <option value="">{$t`This device (${deviceTimeZone})`}</option>
        {#each timeZones as zone}
          <option value={zone}>{zone}</option>
        {/each}
      </select>
    </label>

    <hbox class="actions">
      {#if exchangeCalendar}
        <Button
          label={$t`Load from ${exchangeCalendar.name}`}
          onClick={onLoadFromServer} />
      {/if}
      <Button
        label={$t`Use standard schedule`}
        plain
        onClick={onReset} />
    </hbox>
    {#if notice}
      <p class="notice font-small" role="status">{notice}</p>
    {/if}
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  import {
    DEFAULT_WORKING_HOURS_SCHEDULE, cloneWorkingHoursSchedule, formatWorkingTime, parseWorkingTime,
    validateWorkingHoursSchedule, type WorkingHoursSchedule, type WorkingHoursValidationError,
  } from "../../../logic/Reports/WorkingHours";
  import {
    loadCalendarWorkingHours, saveCalendarWorkingHours, type CalendarWorkingHours,
  } from "../../../logic/Calendar/WorkingHours/CalendarWorkingHours";
  import { appGlobal } from "../../../logic/app";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  let settings: CalendarWorkingHours = loadCalendarWorkingHours();
  let error: WorkingHoursValidationError | null = null;
  let notice = "";

  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    new Date(2024, 0, index + 1).toLocaleDateString(getDateTimeLocale(), { weekday: "long" }));
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZones: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? [];

  $: exchangeCalendar = $calendars.find(calendar => calendar.canReadWorkingHours) ?? null;
  const calendars = appGlobal.calendars;

  function update(changes: Partial<CalendarWorkingHours>) {
    settings = { ...settings, ...changes };
    notice = "";
    error = validateWorkingHoursSchedule(settings.schedule);
    if (!error) {
      saveCalendarWorkingHours(settings);
    }
  }

  function setSchedule(schedule: WorkingHoursSchedule) {
    update({ schedule });
  }

  function onHighlightChange(event: Event) {
    update({ highlight: (event.currentTarget as HTMLInputElement).checked });
  }

  function onDayEnabledChange(index: number, event: Event) {
    let enabled = (event.currentTarget as HTMLInputElement).checked;
    setSchedule({ days: settings.schedule.days.map((day, i) => i == index ? { ...day, enabled } : day) });
  }

  function onTimeChange(index: number, field: "startMinutes" | "endMinutes", event: Event) {
    let minutes = parseWorkingTime((event.currentTarget as HTMLInputElement).value);
    if (minutes == null) {
      return;
    }
    setSchedule({ days: settings.schedule.days.map((day, i) => i == index ? { ...day, [field]: minutes } : day) });
  }

  function onTimeZoneChange(event: Event) {
    let value = (event.currentTarget as HTMLSelectElement).value;
    update({ timeZone: value || null });
  }

  function onReset() {
    setSchedule(cloneWorkingHoursSchedule(DEFAULT_WORKING_HOURS_SCHEDULE));
  }

  async function onLoadFromServer() {
    let calendar = exchangeCalendar;
    let schedule = await calendar.fetchWorkingHours();
    if (!schedule) {
      notice = $t`The server did not send working hours for this mailbox.`;
      return;
    }
    setSchedule(schedule);
    notice = $t`Working hours loaded from ${calendar.name}.`;
  }
</script>

<style>
  .working-hours {
    gap: 12px;
    max-width: 36em;
  }
  .checkbox, .day-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .days {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .day-row {
    display: grid;
    grid-template-columns: minmax(9em, auto) auto auto auto;
    align-items: center;
    justify-content: start;
    gap: 8px;
    min-height: 30px;
  }
  .day-toggle span {
    text-transform: capitalize;
  }
  .separator, .day-off {
    opacity: 0.7;
  }
  .day-off {
    grid-column: 2 / span 3;
  }
  .time-zone {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .time-zone select {
    max-width: 100%;
  }
  .actions {
    gap: 8px;
    flex-wrap: wrap;
  }
  .error {
    margin: 0;
    color: var(--danger-fg);
  }
  .notice {
    margin: 0;
    opacity: 0.8;
  }
  input[aria-invalid="true"] {
    border-color: var(--danger-fg);
  }
</style>
