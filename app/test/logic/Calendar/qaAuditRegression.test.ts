// Регрессионные тесты к QA-аудиту календаря (октябрь 2026).
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { Participant } from "../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { SQLCalendar } from "../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../logic/Calendar/SQL/SQLEvent";
import { convertICalToEvent, parseICalDuration } from "../../../logic/Calendar/ICal/ICalToEvent";
import { Frequency, RecurrenceRule } from "../../../logic/Calendar/RecurrenceRule";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

let calendar: Calendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "calendar-qa-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: () => path.join(tempDir, "files"),
    fs: fsPromises,
  } as any;
  calendar = new Calendar();
  calendar.name = "QA";
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

describe("Локальная БД сохраняет поля события", () => {
  test("место, напоминание, частное, занятость и необязательный участник", async () => {
    let event = calendar.newEvent();
    event.title = "Планёрка";
    event.startTime = new Date("2026-11-10T10:00:00Z");
    event.endTime = new Date("2026-11-10T11:00:00Z");
    event.location = "Переговорная 3";
    event.alarm = new Date("2026-11-10T09:45:00Z");
    event.isPrivate = true;
    event.freeBusyStatus = "OOF";
    event.participants.add(new Participant("boss@example.com", "Boss", InvitationResponse.Organizer));
    event.participants.add(new Participant("opt@example.com", "Opt", InvitationResponse.NoResponseReceived, true));
    await event.saveLocally();

    let read = calendar.newEvent();
    await SQLEvent.read(event.dbID, read);
    expect(read.location).toBe("Переговорная 3");
    expect(read.alarm?.toISOString()).toBe("2026-11-10T09:45:00.000Z");
    expect(read.isPrivate).toBe(true);
    expect(read.freeBusyStatus).toBe("OOF");
    let optional = read.participants.find(p => p.emailAddress == "opt@example.com");
    expect(optional?.isOptional).toBe(true);
    let organizer = read.participants.find(p => p.emailAddress == "boss@example.com");
    expect(organizer?.isOptional).toBe(false);
  });
});

describe("Повторения", () => {
  test("частота NONE не зацикливает развёртку", () => {
    let rule = new RecurrenceRule({
      masterDuration: 3600,
      timezone: "UTC",
      seriesStartTime: new Date("2026-01-05T10:00:00Z"),
      frequency: Frequency.None,
    } as any);
    expect(() => rule.fillOccurrences(Infinity, new Date("2027-01-01T00:00:00Z"))).not.toThrow();
    expect(rule.occurrences.length).toBe(1);
  });

  test("BYDAY с плюсом (+1MO) разбирается как первый понедельник", () => {
    let rule = RecurrenceRule.fromCalString(3600, "UTC", new Date("2026-01-05T10:00:00Z"),
      "RRULE:FREQ=MONTHLY;BYDAY=+1MO");
    expect(rule.week).toBe(1);
    expect(rule.weekdays).toEqual([1]);
  });

  test("UNTIL у серии «весь день» — локальная дата, без сдвига на день (UTC−5)", () => {
    // Ошибка проявлялась только в поясах западнее UTC
    let previousTZ = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      let start = new Date(2026, 0, 5);
      let rule = RecurrenceRule.fromCalString(86400, undefined, start,
        "RRULE:FREQ=WEEKLY;UNTIL=20261231");
      expect(rule.getCalString(true)).toContain("UNTIL=20261231");
    } finally {
      process.env.TZ = previousTZ;
    }
  });
});

describe("Разбор iCal", () => {
  test("длительность DURATION", () => {
    expect(parseICalDuration("PT1H30M")).toBe(5400);
    expect(parseICalDuration("P1D")).toBe(86400);
    expect(parseICalDuration("P1W")).toBe(7 * 86400);
    expect(parseICalDuration("-PT15M")).toBe(-900);
    expect(parseICalDuration("P")).toBeNull();
    expect(parseICalDuration("garbage")).toBeNull();
  });

  function ics(lines: string[]): string {
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QA//EN", "BEGIN:VEVENT", "UID:qa-1@example.com",
      "DTSTAMP:20261001T000000Z", ...lines, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  }

  test("VEVENT с DURATION вместо DTEND получает время окончания", () => {
    let event = calendar.newEvent();
    expect(convertICalToEvent(ics(["SUMMARY:Звонок", "DTSTART:20261110T100000Z", "DURATION:PT45M"]), event)).toBe(true);
    expect(event.endTime.toISOString()).toBe("2026-11-10T10:45:00.000Z");
  });

  test("событие «весь день» без DTEND длится один день", () => {
    let event = calendar.newEvent();
    convertICalToEvent(ics(["SUMMARY:Праздник", "DTSTART;VALUE=DATE:20261104"]), event);
    expect(event.allDay).toBe(true);
    expect(event.durationDays).toBe(1);
  });

  test("обновление с сервера снимает «весь день», отмену и место", () => {
    let event = calendar.newEvent();
    convertICalToEvent(ics(["SUMMARY:A", "DTSTART;VALUE=DATE:20261104", "DTEND;VALUE=DATE:20261105",
      "STATUS:CANCELLED", "LOCATION:Офис"]), event);
    expect(event.allDay).toBe(true);
    expect(event.isCancelled).toBe(true);
    expect(event.location).toBe("Офис");

    convertICalToEvent(ics(["SUMMARY:A", "DTSTART:20261104T100000Z", "DTEND:20261104T110000Z"]), event);
    expect(event.allDay).toBe(false);
    expect(event.isCancelled).toBe(false);
    expect(event.location).toBe("");
    expect(event.duration).toBe(3600);
  });
});
