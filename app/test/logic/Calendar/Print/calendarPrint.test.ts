import { buildCalendarPrintHTML, calendarPrintDays, calendarPrintTitle, eventsOfDay, kMaxEventsPerMonthCell, weekStart, type PrintableEvent } from "../../../../logic/Calendar/Print/CalendarPrint";
import { describe, expect, test } from "vitest";

const kOptions = { locale: "ru-RU", texts: { allDay: "Весь день", noEvents: "Нет встреч", more: "+ ещё {0}" } };

function ev(title: string, start: string, end: string, allDay = false, location = ""): PrintableEvent {
  return { title, startTime: new Date(start), endTime: new Date(end), allDay, location };
}

describe("Дни на странице", () => {
  test("День, неделя с понедельника, полные недели месяца", () => {
    let wednesday = new Date(2026, 9, 21, 15, 30); // 21.10.2026 — среда
    expect(calendarPrintDays("day", wednesday).map(day => day.getDate())).toEqual([21]);
    let week = calendarPrintDays("week", wednesday);
    expect(week.map(day => day.getDate())).toEqual([19, 20, 21, 22, 23, 24, 25]);
    expect(weekStart(new Date(2026, 9, 25)).getDate()).toBe(19); // воскресенье → понедельник до него
    let month = calendarPrintDays("month", wednesday);
    expect(month.length % 7).toBe(0);
    expect(month[0]).toEqual(new Date(2026, 8, 28)); // понедельник до 1 октября
    expect(month[month.length - 1]).toEqual(new Date(2026, 10, 1)); // воскресенье после 31 октября
  });

  test("Заголовки", () => {
    let date = new Date(2026, 9, 21);
    expect(calendarPrintTitle("month", date, "ru-RU")).toMatch(/октябрь 2026/i);
    expect(calendarPrintTitle("week", date, "ru-RU")).toContain("19 октября 2026");
    expect(calendarPrintTitle("day", date, "ru-RU")).toMatch(/среда/i);
  });
});

describe("Встречи дня", () => {
  test("Весь день первым, потом по времени; многодневная — во всех днях", () => {
    let events = [
      ev("Обед", "2026-10-21T12:00:00", "2026-10-21T13:00:00"),
      ev("Утро", "2026-10-21T09:00:00", "2026-10-21T09:30:00"),
      ev("Отпуск", "2026-10-20T00:00:00", "2026-10-23T00:00:00", true),
      ev("Вчера", "2026-10-20T10:00:00", "2026-10-20T11:00:00"),
      ev("Полночь", "2026-10-21T00:00:00", "2026-10-21T00:00:00"),
    ];
    expect(eventsOfDay(events, new Date(2026, 9, 21)).map(event => event.title))
      .toEqual(["Отпуск", "Полночь", "Утро", "Обед"]);
    expect(eventsOfDay(events, new Date(2026, 9, 23)).map(event => event.title)).toEqual([]);
  });
});

describe("HTML", () => {
  test("День: время, место, экранирование, пустой день", () => {
    let html = buildCalendarPrintHTML([ev("<b>Планёрка</b>", "2026-10-21T09:00:00", "2026-10-21T09:30:00", false, "Переговорная 1")],
      "day", new Date(2026, 9, 21), kOptions);
    expect(html).toContain("&lt;b&gt;Планёрка&lt;/b&gt;");
    expect(html).not.toContain("<b>Планёрка");
    expect(html).toContain("09:00–09:30");
    expect(html).toContain("Переговорная 1");
    expect(html).toContain('<body class="day">');
    expect(buildCalendarPrintHTML([], "day", new Date(2026, 9, 21), kOptions)).toContain("Нет встреч");
  });

  test("Неделя: 7 столбцов; месяц: «+ ещё» при переполнении клетки, чужие дни серые", () => {
    let week = buildCalendarPrintHTML([], "week", new Date(2026, 9, 21), kOptions);
    expect(week.match(/<th>/g)).toHaveLength(7);
    expect(week.match(/<tr>/g)).toHaveLength(2);
    let many = Array.from({ length: kMaxEventsPerMonthCell + 2 }, (_, i) =>
      ev("Встреча " + i, `2026-10-21T${String(8 + i).padStart(2, "0")}:00:00`, `2026-10-21T${String(8 + i).padStart(2, "0")}:30:00`));
    let month = buildCalendarPrintHTML(many, "month", new Date(2026, 9, 21), kOptions);
    expect(month).toContain("+ ещё 2");
    expect(month).toContain('class="other-month"');
    expect(month.match(/class="event"/g)).toHaveLength(kMaxEventsPerMonthCell);
  });
});
