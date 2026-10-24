/**
 * Печать календаря, как «Файл → Печать» в Outlook: день (список встреч),
 * неделя (7 столбцов) или месяц (сетка недель). Строит самостоятельную HTML-страницу,
 * которую фронтенд печатает через скрытый iframe.
 */
import type { Event } from "../Event";
import { escapeAttr, escapeHTML } from "../../Files/FileType/htmlHelper";

export type CalendarPrintRange = "day" | "week" | "month";

/** Что нужно от встречи для печати */
export type PrintableEvent = Pick<Event, "title" | "startTime" | "endTime" | "allDay" | "location">;

const kDayMS = 24 * 60 * 60 * 1000;
/** Сколько встреч показывать в клетке месяца до «+ ещё N» */
export const kMaxEventsPerMonthCell = 6;

export function startOfDay(date: Date): Date {
  let day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(date: Date, days: number): Date {
  let result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Понедельник недели, в которую входит `date` */
export function weekStart(date: Date): Date {
  let day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** Дни, которые попадут на страницу: день, неделя с понедельника или полные недели месяца */
export function calendarPrintDays(range: CalendarPrintRange, date: Date): Date[] {
  let first: Date;
  let count: number;
  if (range == "day") {
    first = startOfDay(date);
    count = 1;
  } else if (range == "week") {
    first = weekStart(date);
    count = 7;
  } else {
    let monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    let monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    first = weekStart(monthStart);
    let last = addDays(weekStart(monthEnd), 6);
    count = Math.round((startOfDay(last).getTime() - first.getTime()) / kDayMS) + 1;
  }
  let days: Date[] = [];
  for (let i = 0; i < count; i++) {
    days.push(addDays(first, i));
  }
  return days;
}

/** Встречи дня, сначала на весь день, потом по времени начала */
export function eventsOfDay(events: readonly PrintableEvent[], day: Date): PrintableEvent[] {
  let dayStart = startOfDay(day).getTime();
  let dayEnd = dayStart + kDayMS;
  return events
    .filter(event => event.startTime && event.endTime &&
      event.startTime.getTime() < dayEnd &&
      // Встреча нулевой длины в полночь — тоже этого дня
      (event.endTime.getTime() > dayStart || event.startTime.getTime() == dayStart))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) ||
      a.startTime.getTime() - b.startTime.getTime() ||
      (a.title ?? "").localeCompare(b.title ?? ""));
}

function timeText(event: PrintableEvent, day: Date, locale: string, allDayLabel: string): string {
  if (event.allDay) {
    return allDayLabel;
  }
  let format = (date: Date) => date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  let dayStart = startOfDay(day).getTime();
  // Многодневная встреча: в днях после первого — с начала дня
  let start = event.startTime.getTime() < dayStart ? "" : format(event.startTime);
  let end = event.endTime.getTime() > dayStart + kDayMS ? "" : format(event.endTime);
  return start + "–" + end;
}

export interface CalendarPrintTexts {
  /** Подпись времени у встречи на весь день */
  allDay: string;
  /** День без встреч */
  noEvents: string;
  /** «+ ещё N» в клетке месяца; `{0}` — число */
  more: string;
}

export interface CalendarPrintOptions {
  locale: string;
  texts: CalendarPrintTexts;
  /** Заголовок над таблицей; по умолчанию — даты */
  title?: string;
}

function eventHTML(event: PrintableEvent, day: Date, options: CalendarPrintOptions, withLocation: boolean): string {
  let location = withLocation && event.location ? `<span class="location">${escapeHTML(event.location)}</span>` : "";
  return `<div class="event${event.allDay ? " all-day" : ""}">` +
    `<span class="time">${escapeHTML(timeText(event, day, options.locale, options.texts.allDay))}</span> ` +
    `<span class="title">${escapeHTML(event.title || "")}</span>${location}</div>`;
}

export function calendarPrintTitle(range: CalendarPrintRange, date: Date, locale: string): string {
  let days = calendarPrintDays(range, date);
  if (range == "day") {
    return days[0].toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (range == "month") {
    return new Date(date.getFullYear(), date.getMonth(), 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
  }
  let format = (day: Date) => day.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  return format(days[0]) + " – " + format(days[days.length - 1]);
}

const kStyle = `
  @page { margin: 12mm; }
  @page landscape-page { size: landscape; }
  body { font: 10pt system-ui, -apple-system, "Segoe UI", sans-serif; color: #000; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 8pt 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  body.week, body.month { page: landscape-page; }
  th { font-weight: 600; text-align: start; padding: 3pt 4pt; border: 1px solid #999; background: #eee; }
  td { vertical-align: top; padding: 3pt 4pt; border: 1px solid #999; }
  .month td { height: 22mm; }
  .week td { height: 150mm; }
  .other-month { color: #888; }
  .day-number { font-weight: 600; margin-bottom: 2pt; }
  .event { margin-bottom: 2pt; overflow: hidden; text-overflow: ellipsis; }
  .month .event { white-space: nowrap; }
  .time { color: #444; font-variant-numeric: tabular-nums; }
  .all-day .title { font-weight: 600; }
  .location { color: #555; display: block; }
  .day-list .event { display: grid; grid-template-columns: 30mm 1fr; padding: 3pt 0; border-bottom: 1px solid #ccc; }
  .day-list .location { grid-column: 2; }
  .empty, .more { color: #777; }
`;

/** Готовая HTML-страница для печати */
export function buildCalendarPrintHTML(events: readonly PrintableEvent[], range: CalendarPrintRange, date: Date,
    options: CalendarPrintOptions): string {
  let days = calendarPrintDays(range, date);
  let title = options.title ?? calendarPrintTitle(range, date, options.locale);
  let body = "";
  if (range == "day") {
    let dayEvents = eventsOfDay(events, days[0]);
    body = `<div class="day-list">` + (dayEvents.length
      ? dayEvents.map(event => eventHTML(event, days[0], options, true)).join("")
      : `<div class="empty">${escapeHTML(options.texts.noEvents)}</div>`) + `</div>`;
  } else {
    let header = days.slice(0, 7).map(day =>
      `<th>${escapeHTML(day.toLocaleDateString(options.locale, range == "week"
        ? { weekday: "short", day: "numeric", month: "short" }
        : { weekday: "short" }))}</th>`).join("");
    let rows = "";
    for (let week = 0; week < days.length; week += 7) {
      rows += "<tr>" + days.slice(week, week + 7).map(day => {
        let dayEvents = eventsOfDay(events, day);
        let shown = range == "month" ? dayEvents.slice(0, kMaxEventsPerMonthCell) : dayEvents;
        let more = dayEvents.length - shown.length;
        let otherMonth = range == "month" && day.getMonth() != date.getMonth();
        return `<td class="${otherMonth ? "other-month" : ""}">` +
          (range == "month" ? `<div class="day-number">${day.getDate()}</div>` : "") +
          shown.map(event => eventHTML(event, day, options, range == "week")).join("") +
          (more > 0 ? `<div class="more">${escapeHTML(options.texts.more.replace("{0}", String(more)))}</div>` : "") +
          "</td>";
      }).join("") + "</tr>";
    }
    body = `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  return `<!DOCTYPE html><html lang="${escapeAttr(options.locale)}"><head><meta charset="utf-8">` +
    `<title>${escapeHTML(title)}</title><style>${kStyle}</style></head>` +
    `<body class="${range}"><h1>${escapeHTML(title)}</h1>${body}</body></html>`;
}
