import { getDateTimeLocale, gPlural, gt } from "../../l10n/l10n";

const formatters = new Map<string, Intl.DateTimeFormat>();

/** То же, что `date.toLocaleString(locale, options)`, но форматтер создаётся
 * один раз: строки списка писем форматируют дату на каждой перерисовке, и
 * `toLocaleString` каждый раз заново собирал правила локали (в ~10 раз медленнее).
 * Только для опций, где указан хотя бы один компонент даты или времени. */
function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  let locale = getDateTimeLocale();
  if (Number.isNaN(date.getTime?.())) {
    // `format()` бросает RangeError на неверной дате, а `toLocaleString` возвращает текст.
    return date.toLocaleString(locale, options);
  }
  let key = locale + "\u0000" + JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

/**
* @returns
* For today: Time, e.g. "15:23"
* This week: Weekday, Time, e.g. "Wed 15:23"
* Other this year: Date without year and time, e.g. "23.11. 15:23"
* Other: Date and time, e.g. "23.11.2018 15:23"
* Each in locale
* See also <https://momentjs.com> for relative time
*/
export function getDateTimeString(date: Date): string {
  if (!date) {
    return "";
  }
  let dateDetails: Intl.DateTimeFormatOptions;
  let today = new Date();
  if (date > today) { // future
    dateDetails = { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  } else if (date.getDate() == today.getDate() && today.getTime() - date.getTime() < k1DayMS) { // today
    dateDetails = { hour: "numeric", minute: "numeric" };
  } else if (today.getTime() - date.getTime() < 7 * k1DayMS &&
      today.getTime() - date.getTime() > -7 * k1DayMS) { // this week
    dateDetails = { weekday: "short", hour: "numeric", minute: "numeric" };
  } else if (date.getFullYear() == today.getFullYear()) { // this year
    dateDetails = { month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  } else { // full date
    dateDetails = { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  }
  return formatDate(date, dateDetails);
}

/** Calendar day key for comparisons. */
export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfDay(date: Date): Date {
  let day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Group key for mail list section headers. Messages with the same key share
 * one caption (e.g. all of last week under «На прошлой неделе»).
 */
export function getMailListGroupKey(date: Date): string {
  if (!date) {
    return "";
  }
  let day = startOfDay(date);
  let today = getToday();

  if (day.getTime() >= today.getTime()) {
    return "today";
  }

  let yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day.getTime() == yesterday.getTime()) {
    return "yesterday";
  }

  let thisWeekStart = getWeekStart(today);
  if (day.getTime() >= thisWeekStart.getTime()) {
    return `weekday:${calendarDayKey(day)}`;
  }

  let lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  let lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  if (day.getTime() >= lastWeekStart.getTime() && day.getTime() <= lastWeekEnd.getTime()) {
    return "last-week";
  }

  let year = today.getFullYear();
  let month = today.getMonth();
  let prevMonthStart = startOfDay(new Date(year, month - 1, 1));
  let prevMonthEnd = startOfDay(new Date(year, month, 0));
  if (day.getFullYear() == year &&
      day.getTime() >= prevMonthStart.getTime() &&
      day.getTime() <= prevMonthEnd.getTime()) {
    return "last-month";
  }

  if (day.getFullYear() == year) {
    return `month:${year}-${day.getMonth()}`;
  }

  if (day.getFullYear() == year - 1) {
    return "last-year";
  }

  return `year:${day.getFullYear()}`;
}

/** Section caption in the message list (no header for today). */
export function getMailDayGroupLabel(date: Date): string {
  if (!date) {
    return "";
  }
  let day = startOfDay(date);
  let today = getToday();

  if (day.getTime() >= today.getTime()) {
    return "";
  }

  let yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day.getTime() == yesterday.getTime()) {
    return gt`Yesterday`;
  }

  let thisWeekStart = getWeekStart(today);
  if (day.getTime() >= thisWeekStart.getTime()) {
    return formatDate(date, { weekday: "long" });
  }

  let lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  let lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  if (day.getTime() >= lastWeekStart.getTime() && day.getTime() <= lastWeekEnd.getTime()) {
    return gt`Last week`;
  }

  let year = today.getFullYear();
  let month = today.getMonth();
  let prevMonthStart = startOfDay(new Date(year, month - 1, 1));
  let prevMonthEnd = startOfDay(new Date(year, month, 0));
  if (day.getFullYear() == year &&
      day.getTime() >= prevMonthStart.getTime() &&
      day.getTime() <= prevMonthEnd.getTime()) {
    return gt`Last month`;
  }

  if (day.getFullYear() == year) {
    return formatDate(date, { month: "long" });
  }

  if (day.getFullYear() == year - 1) {
    return gt`Last year`;
  }

  return String(day.getFullYear());
}

/**
 * @returns
 * For today: "Today"
* This week: Weekday, long, e.g. "Wednesday"
* Other this year: Date, without year, e.g. "23.11."
* Other: Full Date, e.g. "23.11.2018"
* Each in locale
* See also <https://momentjs.com> for relative time
*/
export function getDateString(date: Date, fullDate?: Intl.DateTimeFormatOptions): string {
  if (!date) {
    return "";
  }
  let dateDetails: Intl.DateTimeFormatOptions;
  let today = new Date();
  if (date > today) { // future
    dateDetails = fullDate ?? { year: "numeric", month: "2-digit", day: "2-digit" };
  } else if (date.getDate() == today.getDate() && today.getTime() - date.getTime() < k1DayMS) { // today
    return gt`Today`;
  } else if (today.getTime() - date.getTime() < 7 * k1DayMS &&
      today.getTime() - date.getTime() > -7 * k1DayMS) { // this week
    dateDetails = { weekday: "long" };
  } else if (date.getFullYear() == today.getFullYear()) { // this year
    dateDetails = { month: "2-digit", day: "2-digit" };
    if (fullDate) {
      dateDetails = Object.assign({}, fullDate);
      dateDetails.year = undefined;
    }
  } else { // full date
    dateDetails = fullDate ?? { year: "numeric", month: "2-digit", day: "2-digit" };
  }
  return date.toLocaleString(getDateTimeLocale(), dateDetails);
}

export function getFormattedDateString(date: Date, dateDetails: Intl.DateTimeFormatOptions): string {
  if (!date) {
    return "";
  }
  return date.toLocaleString(getDateTimeLocale(), dateDetails);
}

/** @returns Time, e.g. "15:23" */
export function getTimeString(date: Date): string {
  if (!date) {
    return "";
  }
  return formatDate(date, { hour: "numeric", minute: "numeric" });
}

/**
 * @param weekday day of the week
 * @param form How long the name should be
 *    narrow = 1 char
 *    short = 2 chars
 *    long = full name
 * @return Name for the weekday, e.g. "Mo" or "Monday" */
export function weekdayLabel(weekday: number, form: "long" | "short" | "narrow") {
  let date = new Date(2010, 2, weekday);
  return date.toLocaleDateString(getDateTimeLocale(), { weekday: form });
};

/** Monday to Sunday, in order (sorted).
 *
 * If we ever want to support Sunday being the first day of the week,
 * simply change this to `[0, 1, 2, 3, 4, 5, 6]` at runtime. */
export const kAllWeekdays = [1, 2, 3, 4, 5, 6, 0];

/**
 * @param ianaTimezone IANA timezone, e.g. "Europe/Berlin"
 * @returns the city in English, for most timezones */
export function getTimezoneDisplay(ianaTimezone: string): string {
  return ianaTimezone.split("/").pop();
}
export function myTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function isSameTimezone(ianaTimezone: string, time: Date) {
  if (!ianaTimezone) {
    return true;
  }
  let summer = new Date(time);
  summer.setMonth(summer.getMonth() + 6);
  let tz = {
    timeZone: ianaTimezone,
  };
  return time.toLocaleString("de") == time.toLocaleString("de", tz) &&
    summer.toLocaleString("de") == summer.toLocaleString("de", tz);
}

export function getToday() {
  const today = new Date();
  today.setHours(0);
  today.setMinutes(0);
  today.setSeconds(0);
  today.setMilliseconds(0);
  return today;
}

/** @returns The Monday of the week that contains `date`, at 00:00 */
export function getWeekStart(date: Date): Date {
  let startTime = new Date(date);
  // `getDay()` is 0 on Sunday, which still belongs to the Monday before it
  startTime.setDate(startTime.getDate() - (startTime.getDay() + 6) % 7);
  startTime.setHours(0, 0, 0, 0);
  return startTime;
}

/** @returns Mon-Sun around `start` */
export function getWeekDays(start: Date): Date[] {
  let startTime = getWeekStart(start);
  let weekDays = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(new Date(startTime));
    startTime.setDate(startTime.getDate() + 1)
  }
  return weekDays;
}

export function getDurationString(durationInMS: number): string {
  let durationInSec = durationInMS / 1000;
  if (!durationInMS) {
    return "";
  } else if (durationInSec % k1DayS == 0) {
    let days = durationInSec / k1DayS;
    return Math.round(days) + " " + gPlural(days, { one: 'day', other: 'days' });
  } else if (durationInSec % k1HourS == 0) {
    let hours = durationInSec / k1HourS;
    return Math.round(hours) + " " + gPlural(hours, { one: 'hour', other: 'hours' });
  } else {
    let minutes = durationInSec / k1MinuteS;
    return Math.round(minutes) + " " + gPlural(minutes, { one: 'min', other: 'mins' });
  }
}

/** 1 day, in seconds */
export const k1MinuteS = 60;
export const k1HourS = 3600;
export const k1DayS = 86400;
export const k1WeekS = 7 * k1DayS;
export const k1MonthS = 31 * k1DayS;
/** 1 day, in milliseconds */
export const k1MinuteMS = k1MinuteS * 1000;
export const k1HourMS = k1HourS * 1000;
export const k1DayMS = k1DayS * 1000;
export const k1WeekMS = k1WeekS * 1000;
export const k1MonthMS = k1MonthS * 1000;
