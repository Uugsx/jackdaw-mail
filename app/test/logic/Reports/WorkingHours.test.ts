import { expect, test } from "vitest";
import {
  addWorkingSeconds,
  formatWorkingTime,
  isWithinWorkingHours,
  normalizeWorkingHoursSchedule,
  parseWorkingTime,
  validateWorkingHoursSchedule,
  workingSecondsBetween,
  type WorkingDaySchedule,
  type WorkingHoursSchedule,
} from "../../../logic/Reports/WorkingHours";

const workingDay = (
  startMinutes: number,
  endMinutes: number,
): WorkingDaySchedule => ({
  enabled: true,
  startMinutes,
  endMinutes,
});

const dayOff = (): WorkingDaySchedule => ({
  enabled: false,
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
});

const exampleSchedule: WorkingHoursSchedule = {
  days: [
    workingDay(9 * 60 + 30, 18 * 60),
    workingDay(9 * 60 + 30, 18 * 60),
    workingDay(9 * 60 + 30, 18 * 60),
    workingDay(9 * 60 + 30, 18 * 60),
    workingDay(9 * 60 + 30, 16 * 60),
    dayOff(),
    dayOff(),
  ],
};

test("считает только рабочие минуты с разным графиком по дням", () => {
  const fridayAfternoon = new Date(2026, 8, 4, 15, 50);
  const mondayMorning = new Date(2026, 8, 7, 9, 40);

  expect(
    workingSecondsBetween(fridayAfternoon, mondayMorning, exampleSchedule),
  ).toBe(20 * 60);
  expect(
    workingSecondsBetween(
      new Date(2026, 8, 4, 18, 5),
      mondayMorning,
      exampleSchedule,
    ),
  ).toBe(10 * 60);
  expect(
    workingSecondsBetween(
      new Date(2026, 8, 5, 12),
      mondayMorning,
      exampleSchedule,
    ),
  ).toBe(10 * 60);
});

test("считает начало рабочего интервала рабочим, а конец и выходной — нет", () => {
  expect(
    isWithinWorkingHours(new Date(2026, 8, 7, 9, 30), exampleSchedule),
  ).toBe(true);
  expect(
    isWithinWorkingHours(new Date(2026, 8, 7, 18, 0), exampleSchedule),
  ).toBe(false);
  expect(
    isWithinWorkingHours(new Date(2026, 8, 6, 12, 0), exampleSchedule),
  ).toBe(false);
});

test("переносит точку напоминания через конец дня и выходные", () => {
  expect(
    addWorkingSeconds(new Date(2026, 8, 4, 15, 50), 20 * 60, exampleSchedule),
  ).toEqual(new Date(2026, 8, 7, 9, 40));
  expect(
    addWorkingSeconds(new Date(2026, 8, 4, 18, 5), 10 * 60, exampleSchedule),
  ).toEqual(new Date(2026, 8, 7, 9, 40));
});

test("проверяет график и формат времени для формы настроек", () => {
  expect(parseWorkingTime("09:30")).toBe(570);
  expect(parseWorkingTime("18:00")).toBe(1080);
  expect(parseWorkingTime("24:00")).toBeNull();
  expect(formatWorkingTime(570)).toBe("09:30");
  expect(validateWorkingHoursSchedule(exampleSchedule)).toBeNull();
  expect(
    validateWorkingHoursSchedule({
      ...exampleSchedule,
      days: exampleSchedule.days.map((day, index) =>
        index == 0 ? { ...day, endMinutes: day.startMinutes } : day,
      ),
    }),
  ).toBe("invalid");
  expect(
    validateWorkingHoursSchedule({
      days: exampleSchedule.days.map((day) => ({ ...day, enabled: false })),
    }),
  ).toBe("no-working-days");
});

// Ноябрь 2026: 3 вт — предпраздничный (до 14:00), 4 ср — праздник,
// 5 чт — рабочий; 7–8 — выходные.
const calendarSchedule: WorkingHoursSchedule = {
  days: Array.from({ length: 7 }, (_, index) =>
    index < 5 ? workingDay(9 * 60, 18 * 60) : dayOff(),
  ),
  exceptions: [
    { date: "2026-11-03", kind: "short", endMinutes: 14 * 60 },
    { date: "2026-11-04", kind: "off" },
  ],
};

test("праздник и сокращённый день учитываются в isWithinWorkingHours", () => {
  expect(
    isWithinWorkingHours(new Date(2026, 10, 3, 13, 59), calendarSchedule),
  ).toBe(true);
  expect(
    isWithinWorkingHours(new Date(2026, 10, 3, 14, 0), calendarSchedule),
  ).toBe(false);
  expect(
    isWithinWorkingHours(new Date(2026, 10, 4, 11, 0), calendarSchedule),
  ).toBe(false);
  expect(
    isWithinWorkingHours(new Date(2026, 10, 5, 11, 0), calendarSchedule),
  ).toBe(true);
});

test("сокращённый день обрезает рабочие секунды", () => {
  expect(
    workingSecondsBetween(
      new Date(2026, 10, 3, 9, 0),
      new Date(2026, 10, 3, 18, 0),
      calendarSchedule,
    ),
  ).toBe(5 * 3600);
});

test("счёт через праздник, сокращённый день и выходные", () => {
  // вт 13:00 → чт 10:00: 1 ч (вт) + 0 (праздник) + 1 ч (чт)
  expect(
    workingSecondsBetween(
      new Date(2026, 10, 3, 13, 0),
      new Date(2026, 10, 5, 10, 0),
      calendarSchedule,
    ),
  ).toBe(2 * 3600);
  const due = addWorkingSeconds(
    new Date(2026, 10, 3, 13, 0),
    2 * 3600,
    calendarSchedule,
  );
  expect(due?.getTime()).toBe(new Date(2026, 10, 5, 10, 0).getTime());
  // пт 17:00 + 2 ч → пн 10:00 (выходные пропущены)
  expect(
    addWorkingSeconds(new Date(2026, 10, 6, 17, 0), 2 * 3600, calendarSchedule)
      ?.getTime(),
  ).toBe(new Date(2026, 10, 9, 10, 0).getTime());
});

test("без исключений поведение прежнее, мусор в исключениях отбрасывается", () => {
  const plain: WorkingHoursSchedule = { days: calendarSchedule.days };
  expect(
    workingSecondsBetween(
      new Date(2026, 10, 3, 9, 0),
      new Date(2026, 10, 3, 18, 0),
      plain,
    ),
  ).toBe(9 * 3600);
  const normalized = normalizeWorkingHoursSchedule({
    days: calendarSchedule.days,
    exceptions: [
      { date: "2026-02-31", kind: "off" },
      { date: "2026-11-03", kind: "short", endMinutes: 99999 },
      { date: "2026-11-04", kind: "off" },
      { date: "2026-11-04", kind: "off" },
    ],
  });
  expect(normalized.exceptions).toEqual([{ date: "2026-11-04", kind: "off" }]);
});
