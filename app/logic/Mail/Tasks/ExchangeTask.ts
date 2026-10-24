/** Задачи Exchange (папка «Задачи», Outlook To Do) и сроки флажков писем. */

export type ExchangeTaskImportance = "Low" | "Normal" | "High";
export type ExchangeTaskStatus = "NotStarted" | "InProgress" | "Completed" | "WaitingOnOthers" | "Deferred";

/**
 * День без времени, `YYYY-MM-DD`. Сроки задач и флажков Exchange — даты, а не
 * моменты времени: храним их строкой, чтобы часовой пояс не сдвигал день.
 */
export type DayString = string;

export interface ExchangeTask {
  /** ID задачи на сервере (EWS ItemId) */
  itemID: string;
  changeKey: string | null;
  subject: string;
  /** Заметки, обычный текст */
  notes: string;
  startDay: DayString | null;
  dueDay: DayString | null;
  /** Когда отмечена выполненной; null — не выполнена */
  completedAt: Date | null;
  importance: ExchangeTaskImportance;
  status: ExchangeTaskStatus;
  lastModified: Date | null;
}

/** Поля, которые пользователь задаёт при создании и правке задачи */
export interface ExchangeTaskInput {
  subject: string;
  notes: string;
  startDay: DayString | null;
  dueDay: DayString | null;
  importance: ExchangeTaskImportance;
}

const kImportances: ExchangeTaskImportance[] = ["Low", "Normal", "High"];
const kStatuses: ExchangeTaskStatus[] = ["NotStarted", "InProgress", "Completed", "WaitingOnOthers", "Deferred"];
const kDayPattern = /^(\d{4})-(\d{2})-(\d{2})/;
const kMsPerDay = 24 * 60 * 60 * 1000;
const kMsPerHalfDay = kMsPerDay / 2;

export function sanitizeTaskImportance(value: unknown): ExchangeTaskImportance {
  return kImportances.includes(value as ExchangeTaskImportance) ? value as ExchangeTaskImportance : "Normal";
}

export function sanitizeTaskStatus(value: unknown): ExchangeTaskStatus {
  return kStatuses.includes(value as ExchangeTaskStatus) ? value as ExchangeTaskStatus : "NotStarted";
}

export function isTaskCompleted(task: Pick<ExchangeTask, "status">): boolean {
  return task.status == "Completed";
}

/** Проверенная строка дня или null */
export function sanitizeDay(value: unknown): DayString | null {
  if (typeof value != "string") {
    return null;
  }
  let match = kDayPattern.exec(value);
  if (!match) {
    return null;
  }
  let day = `${match[1]}-${match[2]}-${match[3]}`;
  return dayToLocalDate(day) ? day : null;
}

/** Местная дата → день */
export function localDay(date: Date): DayString {
  let pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** День → местная полночь; null для неверной строки */
export function dayToLocalDate(day: DayString | null): Date | null {
  let match = day ? kDayPattern.exec(day) : null;
  if (!match) {
    return null;
  }
  let [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let result = new Date(year, month - 1, date);
  if (result.getFullYear() != year || result.getMonth() != month - 1 || result.getDate() != date) {
    return null;
  }
  return result;
}

export function addDays(day: DayString, days: number): DayString {
  let date = dayToLocalDate(day);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

/**
 * Дата от сервера → день.
 * OWA отвечает в часовом поясе ящика (`2026-10-23T00:00:00+03:00`): берём день как написан.
 * EWS отвечает в UTC (`…Z`), потому что мы просим TimeZoneContext UTC. Для дня
 * без времени это полночь UTC, а флажок, поставленный Outlook в другом поясе,
 * может прийти как `2026-10-22T21:00:00Z`: округляем до ближайшей полуночи UTC.
 */
export function parseExchangeDay(value: unknown): DayString | null {
  if (typeof value != "string" || !kDayPattern.test(value)) {
    return null;
  }
  let hasOffset = /[+-]\d{2}:?\d{2}$/.test(value.trim());
  let isUTC = /Z$/i.test(value.trim());
  if (hasOffset || !isUTC) {
    return sanitizeDay(value);
  }
  let time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  let midnight = Math.floor((time + kMsPerHalfDay) / kMsPerDay) * kMsPerDay;
  return new Date(midnight).toISOString().slice(0, 10);
}

/** День для EWS: полночь UTC, так как запросы идут с TimeZoneContext UTC */
export function ewsDayValue(day: DayString): string {
  return `${day}T00:00:00Z`;
}

/** День для OWA: без пояса, сервер понимает его в поясе ящика */
export function owaDayValue(day: DayString): string {
  return `${day}T00:00:00`;
}

export function parseExchangeDate(value: unknown): Date | null {
  if (typeof value != "string" || !value) {
    return null;
  }
  let date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Флажок письма (Exchange Flag) */
export interface MailFlagState {
  /** Флажок стоит и не выполнен */
  flagged: boolean;
  startDay: DayString | null;
  dueDay: DayString | null;
  /** Флажок выполнен, когда */
  completedAt: Date | null;
}

/** Срок флажка из меню, как в Outlook */
export type FlagDueChoice = "today" | "tomorrow" | "this-week" | "next-week" | "no-date" | { dueDay: DayString };

/** Начало и срок флажка для выбора из меню. Неделя — с понедельника, рабочая — до пятницы. */
export function flagDaysForChoice(choice: FlagDueChoice, now = new Date()): { startDay: DayString | null, dueDay: DayString | null } {
  let today = localDay(now);
  if (choice == "no-date") {
    return { startDay: null, dueDay: null };
  }
  if (choice == "today") {
    return { startDay: today, dueDay: today };
  }
  if (choice == "tomorrow") {
    let tomorrow = addDays(today, 1);
    return { startDay: tomorrow, dueDay: tomorrow };
  }
  // 0 = понедельник … 6 = воскресенье
  let weekday = (now.getDay() + 6) % 7;
  let friday = addDays(today, 4 - weekday);
  if (choice == "this-week") {
    // В выходные пятница уже прошла: срок — сегодня
    return { startDay: today, dueDay: friday < today ? today : friday };
  }
  if (choice == "next-week") {
    let monday = addDays(today, 7 - weekday);
    return { startDay: monday, dueDay: addDays(monday, 4) };
  }
  let dueDay = sanitizeDay(choice.dueDay);
  if (!dueDay) {
    return { startDay: null, dueDay: null };
  }
  return { startDay: dueDay < today ? dueDay : today, dueDay };
}

/** Группа в списке задач по сроку */
export type TaskDueGroup = "overdue" | "today" | "tomorrow" | "later" | "no-date";

export function taskDueGroup(dueDay: DayString | null, now = new Date()): TaskDueGroup {
  if (!dueDay) {
    return "no-date";
  }
  let today = localDay(now);
  if (dueDay < today) {
    return "overdue";
  }
  if (dueDay == today) {
    return "today";
  }
  if (dueDay == addDays(today, 1)) {
    return "tomorrow";
  }
  return "later";
}

export function newTaskInput(): ExchangeTaskInput {
  return { subject: "", notes: "", startDay: null, dueDay: null, importance: "Normal" };
}

/** Проверка перед отправкой на сервер. @returns ключ ошибки или null */
export function validateTaskInput(input: ExchangeTaskInput): "subject" | "dates" | null {
  if (!input.subject?.trim()) {
    return "subject";
  }
  if (input.startDay && input.dueDay && input.startDay > input.dueDay) {
    return "dates";
  }
  return null;
}
