const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MAX_WORKING_TIME_MINUTES = MINUTES_PER_DAY - 1;
const MAX_SEARCH_DAYS = 366 * 10;

export interface WorkingDaySchedule {
  /** Понедельник = 0, воскресенье = 6. */
  enabled: boolean;
  /** Начало рабочего интервала в минутах от полуночи. */
  startMinutes: number;
  /** Конец рабочего интервала в минутах от полуночи, не включая его. */
  endMinutes: number;
}

export interface WorkingHoursSchedule {
  days: WorkingDaySchedule[];
}

export type WorkingHoursValidationError = "invalid" | "no-working-days";

const DEFAULT_WORKING_DAY: WorkingDaySchedule = {
  enabled: true,
  startMinutes: 9 * MINUTES_PER_HOUR,
  endMinutes: 18 * MINUTES_PER_HOUR,
};

/** Стандартный график: понедельник–пятница, 09:00–18:00. */
export const DEFAULT_WORKING_HOURS_SCHEDULE: WorkingHoursSchedule = {
  days: [
    { ...DEFAULT_WORKING_DAY },
    { ...DEFAULT_WORKING_DAY },
    { ...DEFAULT_WORKING_DAY },
    { ...DEFAULT_WORKING_DAY },
    { ...DEFAULT_WORKING_DAY },
    {
      enabled: false,
      startMinutes: 9 * MINUTES_PER_HOUR,
      endMinutes: 18 * MINUTES_PER_HOUR,
    },
    {
      enabled: false,
      startMinutes: 9 * MINUTES_PER_HOUR,
      endMinutes: 18 * MINUTES_PER_HOUR,
    },
  ],
};

export function cloneWorkingHoursSchedule(
  schedule: WorkingHoursSchedule,
): WorkingHoursSchedule {
  return {
    days: schedule.days.map((day) => ({ ...day })),
  };
}

/** Нормализует настройки, в том числе старые или повреждённые данные кеша. */
export function normalizeWorkingHoursSchedule(
  value: unknown,
  fallback: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): WorkingHoursSchedule {
  const fallbackDays = normalizedFallbackDays(fallback);
  const sourceDays =
    isRecord(value) && Array.isArray(value.days) ? value.days : [];
  return {
    days: Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
      normalizeDay(sourceDays[index], fallbackDays[index]),
    ),
  };
}

export function validateWorkingHoursSchedule(
  schedule: WorkingHoursSchedule,
): WorkingHoursValidationError | null {
  if (!Array.isArray(schedule.days) || schedule.days.length != DAYS_PER_WEEK) {
    return "invalid";
  }
  let workingDays = 0;
  for (const day of schedule.days) {
    if (!day.enabled) {
      continue;
    }
    workingDays++;
    if (
      !isValidTimeMinutes(day.startMinutes) ||
      !isValidTimeMinutes(day.endMinutes)
    ) {
      return "invalid";
    }
    if (day.startMinutes >= day.endMinutes) {
      return "invalid";
    }
  }
  return workingDays ? null : "no-working-days";
}

export function parseWorkingTime(
  value: string | null | undefined,
): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * MINUTES_PER_HOUR + minutes;
  return isValidTimeMinutes(total) ? total : null;
}

export function formatWorkingTime(minutes: number): string {
  const normalized = Math.min(
    MAX_WORKING_TIME_MINUTES,
    Math.max(0, Math.trunc(Number.isFinite(minutes) ? minutes : 0)),
  );
  const hours = Math.floor(normalized / MINUTES_PER_HOUR);
  const rest = normalized % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** День недели (понедельник = 0) и минуты от полуночи.
 * Без `timeZone` — местное время устройства, иначе — в этом часовом поясе IANA. */
export function weekdayAndMinutes(
  date: Date,
  timeZone?: string | null,
): { weekday: number; minutes: number } {
  if (!timeZone) {
    return {
      weekday: localWeekday(date),
      minutes:
        date.getHours() * MINUTES_PER_HOUR +
        date.getMinutes() +
        date.getSeconds() / 60 +
        date.getMilliseconds() / (60 * MILLISECONDS_PER_SECOND),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type == type)?.value ?? "";
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    weekday: Math.max(0, weekdays.indexOf(value("weekday"))),
    minutes:
      (Number(value("hour")) % 24) * MINUTES_PER_HOUR +
      Number(value("minute")) +
      Number(value("second")) / 60 +
      date.getMilliseconds() / (60 * MILLISECONDS_PER_SECOND),
  };
}

/** Проверяет, находится ли момент внутри рабочего интервала.
 * @param timeZone часовой пояс графика; по умолчанию местное время */
export function isWithinWorkingHours(
  date: Date,
  schedule: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
  timeZone?: string | null,
): boolean {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return false;
  }
  const normalized = normalizeWorkingHoursSchedule(schedule);
  const { weekday, minutes: minutesSinceMidnight } = weekdayAndMinutes(date, timeZone);
  const day = normalized.days[weekday];
  if (!day?.enabled || day.startMinutes >= day.endMinutes) {
    return false;
  }
  return (
    minutesSinceMidnight >= day.startMinutes &&
    minutesSinceMidnight < day.endMinutes
  );
}

/** Считает только рабочие секунды между двумя локальными моментами. */
export function workingSecondsBetween(
  start: Date,
  end: Date,
  schedule: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): number {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return 0;
  }

  const normalized = normalizeWorkingHoursSchedule(schedule);
  let totalMilliseconds = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const dayStart = startOfLocalDay(cursor);
    const day = normalized.days[localWeekday(cursor)];
    if (day?.enabled && day.startMinutes < day.endMinutes) {
      const windowStart = atLocalMinutes(dayStart, day.startMinutes);
      const windowEnd = atLocalMinutes(dayStart, day.endMinutes);
      const overlapStart = Math.max(start.getTime(), windowStart.getTime());
      const overlapEnd = Math.min(end.getTime(), windowEnd.getTime());
      if (overlapEnd > overlapStart) {
        totalMilliseconds += overlapEnd - overlapStart;
      }
    }
    cursor = nextLocalDay(dayStart);
  }
  return totalMilliseconds / MILLISECONDS_PER_SECOND;
}

/** Возвращает момент, когда накопится заданное количество рабочих секунд. */
export function addWorkingSeconds(
  start: Date,
  seconds: number,
  schedule: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): Date | null {
  if (!isValidDate(start) || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  if (seconds == 0) {
    return new Date(start);
  }

  const normalized = normalizeWorkingHoursSchedule(schedule);
  if (validateWorkingHoursSchedule(normalized) == "no-working-days") {
    return null;
  }

  let remainingMilliseconds = seconds * MILLISECONDS_PER_SECOND;
  let cursor = new Date(start);
  for (let dayOffset = 0; dayOffset <= MAX_SEARCH_DAYS; dayOffset++) {
    const dayStart = startOfLocalDay(cursor);
    const day = normalized.days[localWeekday(dayStart)];
    if (day?.enabled && day.startMinutes < day.endMinutes) {
      const windowStart = atLocalMinutes(dayStart, day.startMinutes);
      const windowEnd = atLocalMinutes(dayStart, day.endMinutes);
      const candidateStart = new Date(
        Math.max(cursor.getTime(), windowStart.getTime()),
      );
      if (candidateStart < windowEnd) {
        const availableMilliseconds =
          windowEnd.getTime() - candidateStart.getTime();
        if (remainingMilliseconds <= availableMilliseconds) {
          return new Date(candidateStart.getTime() + remainingMilliseconds);
        }
        remainingMilliseconds -= availableMilliseconds;
      }
    }
    cursor = nextLocalDay(dayStart);
  }
  return null;
}

function normalizedFallbackDays(
  fallback: WorkingHoursSchedule,
): WorkingDaySchedule[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const day = fallback.days?.[index];
    if (!day) {
      return { ...DEFAULT_WORKING_DAY };
    }
    const startMinutes = isValidTimeMinutes(day.startMinutes)
      ? Math.trunc(day.startMinutes)
      : DEFAULT_WORKING_DAY.startMinutes;
    const endMinutes = isValidTimeMinutes(day.endMinutes)
      ? Math.trunc(day.endMinutes)
      : DEFAULT_WORKING_DAY.endMinutes;
    return {
      enabled: !!day.enabled && startMinutes < endMinutes,
      startMinutes,
      endMinutes,
    };
  });
}

function normalizeDay(
  value: unknown,
  fallback: WorkingDaySchedule,
): WorkingDaySchedule {
  if (!isRecord(value)) {
    return { ...fallback };
  }
  const startMinutes = normalizedTime(
    value.startMinutes,
    fallback.startMinutes,
  );
  const endMinutes = normalizedTime(value.endMinutes, fallback.endMinutes);
  const enabled =
    typeof value.enabled == "boolean" ? value.enabled : fallback.enabled;
  return {
    enabled: enabled && startMinutes < endMinutes,
    startMinutes,
    endMinutes,
  };
}

function normalizedTime(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && isValidTimeMinutes(number)
    ? number
    : fallback;
}

function isValidTimeMinutes(value: unknown): value is number {
  return (
    typeof value == "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_WORKING_TIME_MINUTES
  );
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function atLocalMinutes(dayStart: Date, minutes: number): Date {
  const result = new Date(dayStart);
  result.setHours(
    Math.floor(minutes / MINUTES_PER_HOUR),
    minutes % MINUTES_PER_HOUR,
    0,
    0,
  );
  return result;
}

function nextLocalDay(dayStart: Date): Date {
  const result = new Date(dayStart);
  result.setDate(result.getDate() + 1);
  return result;
}

function localWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value == "object" && !Array.isArray(value);
}
