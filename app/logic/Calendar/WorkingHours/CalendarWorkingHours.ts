import {
  DEFAULT_WORKING_HOURS_SCHEDULE, cloneWorkingHoursSchedule, normalizeWorkingHoursSchedule, weekdayAndMinutes,
  type WorkingDaySchedule, type WorkingHoursSchedule,
} from "../../Reports/WorkingHours";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { ensureArray } from "../../util/util";

/** Рабочие часы в календаре (Outlook: «Параметры календаря → Рабочее время»).
 * График — тот же, что у отчётов (`Reports/WorkingHours`), но общий для всех календарей. */
export interface CalendarWorkingHours {
  /** Затенять нерабочее время в видах «день», «рабочая неделя», «неделя» */
  highlight: boolean;
  schedule: WorkingHoursSchedule;
  /** Часовой пояс графика, IANA. null — пояс устройства */
  timeZone: string | null;
}

export const kCalendarWorkingHoursKey = "calendar.workingHours.v1";

export function defaultCalendarWorkingHours(): CalendarWorkingHours {
  return { highlight: true, schedule: cloneWorkingHoursSchedule(DEFAULT_WORKING_HOURS_SCHEDULE), timeZone: null };
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone != "string" || !timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCalendarWorkingHours(value: unknown): CalendarWorkingHours {
  let source = value && typeof value == "object" ? value as Record<string, unknown> : {};
  return {
    highlight: typeof source.highlight == "boolean" ? source.highlight : true,
    schedule: normalizeWorkingHoursSchedule(source.schedule),
    timeZone: isValidTimeZone(source.timeZone) ? source.timeZone : null,
  };
}

export function calendarWorkingHoursSetting() {
  return getLocalStorage<unknown>(kCalendarWorkingHoursKey, {});
}

export function loadCalendarWorkingHours(): CalendarWorkingHours {
  try {
    return normalizeCalendarWorkingHours(calendarWorkingHoursSetting().value);
  } catch {
    return defaultCalendarWorkingHours();
  }
}

export function saveCalendarWorkingHours(settings: CalendarWorkingHours) {
  calendarWorkingHoursSetting().value = normalizeCalendarWorkingHours(settings);
}

const kMinutesPerMS = 1 / 60_000;

/**
 * Рабочая часть интервала ячейки `[start, end)` как доли от 0 до 1 сверху вниз.
 * null — вся ячейка нерабочая. Рабочий интервал в сутках один, поэтому часть непрерывная.
 */
export function workingSpanInCell(start: Date, end: Date, settings: CalendarWorkingHours): { from: number, to: number } | null {
  let length = (end.getTime() - start.getTime()) * kMinutesPerMS;
  if (!(length > 0)) {
    return null;
  }
  let { weekday, minutes } = weekdayAndMinutes(start, settings.timeZone);
  let day = settings.schedule.days[weekday];
  if (!day?.enabled || day.startMinutes >= day.endMinutes) {
    return null;
  }
  let from = Math.max(day.startMinutes, minutes);
  let to = Math.min(day.endMinutes, minutes + length);
  if (to <= from) {
    return null;
  }
  return { from: (from - minutes) / length, to: (to - minutes) / length };
}

const kEWSWeekdays: Record<string, number[]> = {
  Monday: [0], Tuesday: [1], Wednesday: [2], Thursday: [3], Friday: [4], Saturday: [5], Sunday: [6],
  Weekday: [0, 1, 2, 3, 4], WeekendDay: [5, 6], Day: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Рабочие часы ящика из ответа `GetUserAvailability` (EWS `WorkingHours.WorkingPeriodArray`,
 * OWA — то же в JSON). Минуты — в поясе ящика, его здесь не переводим.
 * null — сервер график не прислал.
 */
export function parseExchangeWorkingHours(workingHours: any): WorkingHoursSchedule | null {
  let periods = ensureArray(workingHours?.WorkingPeriodArray?.WorkingPeriod ?? workingHours?.WorkingPeriodArray ?? workingHours?.WorkingPeriods);
  let days: WorkingDaySchedule[] = DEFAULT_WORKING_HOURS_SCHEDULE.days.map(day => ({ ...day, enabled: false }));
  let found = false;
  for (let period of periods) {
    let start = Number(period?.StartTimeInMinutes);
    let end = Number(period?.EndTimeInMinutes);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    let names: string[] = Array.isArray(period.DayOfWeek)
      ? period.DayOfWeek
      : String(period.DayOfWeek ?? period.Days ?? "").split(/[\s,]+/);
    for (let name of names) {
      for (let index of kEWSWeekdays[name] ?? []) {
        let day = days[index];
        // Несколько периодов в день (обед): от самого раннего начала до самого позднего конца
        days[index] = day.enabled
          ? { enabled: true, startMinutes: Math.min(day.startMinutes, start), endMinutes: Math.max(day.endMinutes, end) }
          : { enabled: true, startMinutes: start, endMinutes: end };
        found = true;
      }
    }
  }
  return found ? normalizeWorkingHoursSchedule({ days }) : null;
}
