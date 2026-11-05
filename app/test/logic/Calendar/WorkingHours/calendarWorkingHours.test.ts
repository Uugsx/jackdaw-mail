import {
  defaultCalendarWorkingHours, isValidTimeZone, normalizeCalendarWorkingHours, parseExchangeWorkingHours, workingSpanInCell,
} from "../../../../logic/Calendar/WorkingHours/CalendarWorkingHours";
import { isWithinWorkingHours, weekdayAndMinutes, DEFAULT_WORKING_HOURS_SCHEDULE } from "../../../../logic/Reports/WorkingHours";
import { describe, expect, test } from "vitest";

/** Местное время: тесты не зависят от пояса машины */
function local(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 10, day, hour, minute); // ноябрь 2026: 9 — понедельник, 14 — суббота
}
function hourCell(day: number, hour: number) {
  return [local(day, hour), local(day, hour + 1)] as const;
}

describe("затенение ячеек", () => {
  const settings = defaultCalendarWorkingHours();

  test("рабочий час, нерабочий час, выходной", () => {
    expect(workingSpanInCell(...hourCell(9, 10), settings)).toEqual({ from: 0, to: 1 });
    expect(workingSpanInCell(...hourCell(9, 7), settings)).toBeNull();
    expect(workingSpanInCell(...hourCell(9, 18), settings)).toBeNull();
    expect(workingSpanInCell(...hourCell(14, 10), settings)).toBeNull();
  });

  test("начало в 9:30 — затенена верхняя половина", () => {
    let custom = normalizeCalendarWorkingHours({
      schedule: { days: DEFAULT_WORKING_HOURS_SCHEDULE.days.map(day => ({ ...day, startMinutes: 9 * 60 + 30 })) },
    });
    expect(workingSpanInCell(...hourCell(9, 9), custom)).toEqual({ from: 0.5, to: 1 });
  });

  test("часовой пояс графика: 9–18 по Москве", () => {
    let moscow = normalizeCalendarWorkingHours({ timeZone: "Europe/Moscow" });
    // 06:00 UTC = 09:00 MSK, понедельник
    expect(workingSpanInCell(new Date("2026-11-09T06:00:00Z"), new Date("2026-11-09T07:00:00Z"), moscow)).toEqual({ from: 0, to: 1 });
    expect(workingSpanInCell(new Date("2026-11-09T05:00:00Z"), new Date("2026-11-09T06:00:00Z"), moscow)).toBeNull();
    expect(weekdayAndMinutes(new Date("2026-11-08T22:30:00Z"), "Europe/Moscow")).toEqual({ weekday: 0, minutes: 90 });
  });

  test("отчёты: без пояса — прежнее поведение", () => {
    expect(isWithinWorkingHours(local(9, 10))).toBe(true);
    expect(isWithinWorkingHours(local(9, 20))).toBe(false);
    expect(isWithinWorkingHours(new Date("2026-11-09T06:30:00Z"), DEFAULT_WORKING_HOURS_SCHEDULE, "Europe/Moscow")).toBe(true);
  });
});

describe("настройки", () => {
  test("повреждённые данные — значения по умолчанию", () => {
    let settings = normalizeCalendarWorkingHours({ highlight: "yes", timeZone: "Mars/Olympus", schedule: 5 });
    expect(settings.highlight).toBe(true);
    expect(settings.timeZone).toBeNull();
    expect(settings.schedule.days[0]).toEqual({ enabled: true, startMinutes: 540, endMinutes: 1080 });
    expect(normalizeCalendarWorkingHours({ highlight: false }).highlight).toBe(false);
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("рабочие часы из Exchange", () => {
  test("EWS WorkingPeriodArray: дни через пробел, обед — два периода", () => {
    let schedule = parseExchangeWorkingHours({
      TimeZone: { Bias: "-180" },
      WorkingPeriodArray: {
        WorkingPeriod: [
          { DayOfWeek: "Monday Tuesday Wednesday Thursday", StartTimeInMinutes: "480", EndTimeInMinutes: "780" },
          { DayOfWeek: "Monday Tuesday Wednesday Thursday", StartTimeInMinutes: "840", EndTimeInMinutes: "1020" },
          { DayOfWeek: "Friday", StartTimeInMinutes: "480", EndTimeInMinutes: "960" },
        ],
      },
    });
    expect(schedule.days[0]).toEqual({ enabled: true, startMinutes: 480, endMinutes: 1020 });
    expect(schedule.days[4]).toEqual({ enabled: true, startMinutes: 480, endMinutes: 960 });
    expect(schedule.days[5].enabled).toBe(false);
    expect(schedule.days[6].enabled).toBe(false);
  });

  test("одиночный период и «Weekday»; пустой ответ — null", () => {
    let schedule = parseExchangeWorkingHours({ WorkingPeriodArray: { WorkingPeriod: { DayOfWeek: "Weekday", StartTimeInMinutes: 540, EndTimeInMinutes: 1080 } } });
    expect(schedule.days.filter(day => day.enabled)).toHaveLength(5);
    expect(parseExchangeWorkingHours(undefined)).toBeNull();
    expect(parseExchangeWorkingHours({ WorkingPeriodArray: { WorkingPeriod: { DayOfWeek: "Monday", StartTimeInMinutes: 600, EndTimeInMinutes: 500 } } })).toBeNull();
  });

  test("OWA: массив дней", () => {
    let schedule = parseExchangeWorkingHours({ WorkingPeriods: [{ Days: "Saturday, Sunday", StartTimeInMinutes: 600, EndTimeInMinutes: 720 }] });
    expect(schedule.days[5]).toEqual({ enabled: true, startMinutes: 600, endMinutes: 720 });
    expect(schedule.days[0].enabled).toBe(false);
  });
});
