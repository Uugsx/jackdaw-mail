import {
  DEFAULT_WORKING_HOURS_SCHEDULE,
  addWorkingSeconds,
  normalizeWorkingHoursSchedule,
  type WorkingHoursSchedule,
} from "../../Reports/WorkingHours";

/**
 * «Напомнить, если не ответят»: отслеживание исходящего письма до ответа
 * получателей. Здесь только чистые правила без базы и интерфейса, чтобы их
 * можно было проверить тестами.
 */

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
export const MAX_FOLLOW_UP_DAYS = 365;
export const MAX_FOLLOW_UP_RECIPIENTS = 100;
/** Допуск на расхождение часов сервера и клиента при сравнении времени ответа. */
export const FOLLOW_UP_CLOCK_SKEW_SECONDS = 2 * SECONDS_PER_MINUTE;

/**
 * Как считать срок: календарные сутки, рабочее время по расписанию ящика
 * (как SLA «Живого контроля ответов») или к конкретной дате.
 */
export type FollowUpScheduleMode = "calendar" | "working" | "date";

export type FollowUpChoice =
  | { mode: "calendar" | "working"; days: number }
  | { mode: "date"; dueAt: Date };

export type FollowUpStatus = "waiting" | "replied" | "cancelled";

/** Отслеживаемое исходящее письмо, как оно хранится в mail.db. */
export interface FollowUpReminder {
  id: number;
  /** emailAccount.id ящика, от имени которого отправлено письмо. */
  accountId: number;
  messageID: string;
  /** Идентификатор цепочки отправленной копии, если она уже найдена в базе. */
  threadID: string | null;
  /** email.id отправленной копии. null, пока её не нашли после отправки. */
  emailId: number | null;
  /** folder.id отправленной копии, если она найдена. */
  folderId: number | null;
  /** Ящик, в базе которого лежит отправленная копия: у общего ящика
   * Exchange может сохранить её в «Отправленных» основного ящика. */
  folderAccountId: number | null;
  subject: string;
  /** Адреса получателей в нижнем регистре. */
  recipients: string[];
  sentAt: Date;
  dueAt: Date;
  scheduleMode: FollowUpScheduleMode;
  /** Срок в днях для режимов calendar и working. */
  durationDays: number | null;
  status: FollowUpStatus;
  notifiedAt: Date | null;
  repliedAt: Date | null;
  createdAt: Date;
}

/** Map или MapColl заголовков письма. */
export interface FollowUpHeaderMap {
  entries(): Iterable<[string, string]>;
}

/** Входящее письмо, которое может оказаться ответом. */
export interface FollowUpReplyCandidate {
  emailId: number;
  messageID: string | null;
  parentMsgID: string | null;
  threadID: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  receivedAt: Date;
  /** Исходящее письмо или письмо из «Отправленных», «Черновиков», «Исходящих». */
  outgoing: boolean;
  isDraft?: boolean;
  /** Заголовки письма, если они известны (только у загруженных писем). */
  headers?: FollowUpHeaderMap | Record<string, string> | null;
}

export type FollowUpState = "waiting" | "overdue" | "replied" | "cancelled";

export const FOLLOW_UP_PRESETS: readonly FollowUpChoice[] = [
  { mode: "calendar", days: 1 },
  { mode: "calendar", days: 3 },
  { mode: "calendar", days: 7 },
  { mode: "working", days: 1 },
  { mode: "working", days: 3 },
];

export const FOLLOW_UP_SNOOZE_DAYS: readonly number[] = [1, 3, 7];

/** Нормализует выбор пользователя или данные из IPC. null — выбор некорректен. */
export function normalizeFollowUpChoice(value: unknown): FollowUpChoice | null {
  if (!value || typeof value != "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (source.mode == "date") {
    const dueAt = source.dueAt instanceof Date
      ? source.dueAt
      : typeof source.dueAt == "string" || typeof source.dueAt == "number"
        ? new Date(source.dueAt)
        : null;
    return dueAt && Number.isFinite(dueAt.getTime())
      ? { mode: "date", dueAt: new Date(dueAt) }
      : null;
  }
  if (source.mode == "calendar" || source.mode == "working") {
    const mode = source.mode as "calendar" | "working";
    const days = Number(source.days);
    return Number.isInteger(days) && days >= 1 && days <= MAX_FOLLOW_UP_DAYS
      ? { mode, days }
      : null;
  }
  return null;
}

export function isSameFollowUpChoice(
  a: FollowUpChoice | null | undefined,
  b: FollowUpChoice | null | undefined,
): boolean {
  if (!a || !b || a.mode != b.mode) {
    return false;
  }
  if (a.mode == "date" || b.mode == "date") {
    return a.mode == "date" && b.mode == "date" &&
      a.dueAt.getTime() == b.dueAt.getTime();
  }
  return a.days == b.days;
}

/**
 * Срок ответа для выбранного варианта.
 *
 * Рабочий режим считает N рабочих дней рабочим временем расписания ящика:
 * N × средняя длина рабочего дня. Для одинаковых рабочих дней это ровно то же
 * время через N рабочих дней; выходные и нерабочие часы пропускаются.
 * Возвращает null, если срок не вычислить (в расписании нет рабочих дней).
 */
export function computeFollowUpDueAt(
  choice: FollowUpChoice,
  sentAt: Date,
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): Date | null {
  if (!isValidDate(sentAt)) {
    return null;
  }
  if (choice.mode == "date") {
    return isValidDate(choice.dueAt) ? new Date(choice.dueAt) : null;
  }
  if (choice.mode == "calendar") {
    // setDate, а не +24 ч: при переходе на летнее время срок остаётся
    // в то же локальное время.
    const dueAt = new Date(sentAt);
    dueAt.setDate(dueAt.getDate() + choice.days);
    return dueAt;
  }
  const daySeconds = averageWorkingDaySeconds(workingHours);
  if (daySeconds <= 0) {
    return null;
  }
  return addWorkingSeconds(sentAt, choice.days * daySeconds, workingHours);
}

/** Новый срок при откладывании: от текущего момента, календарными днями. */
export function snoozeFollowUpDueAt(now: Date, days: number): Date {
  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + Math.max(1, Math.floor(days)));
  return dueAt;
}

function averageWorkingDaySeconds(schedule: WorkingHoursSchedule): number {
  const days = normalizeWorkingHoursSchedule(schedule).days
    .filter(day => day.enabled && day.startMinutes < day.endMinutes);
  if (!days.length) {
    return 0;
  }
  const totalMinutes = days.reduce(
    (total, day) => total + day.endMinutes - day.startMinutes, 0);
  return Math.round(totalMinutes / days.length * SECONDS_PER_MINUTE);
}

export function followUpState(
  reminder: Pick<FollowUpReminder, "status" | "dueAt">,
  now = new Date(),
): FollowUpState {
  if (reminder.status != "waiting") {
    return reminder.status;
  }
  return reminder.dueAt.getTime() <= now.getTime() ? "overdue" : "waiting";
}

/**
 * Нужно ли сейчас показать уведомление ОС: срок прошёл, ответа нет, и по
 * этому сроку уведомления ещё не было. `notBefore` откладывает уведомления
 * после запуска, пока синхронизация не успела скачать ответы, пришедшие
 * при закрытом приложении.
 */
export function shouldNotifyFollowUp(
  reminder: Pick<FollowUpReminder, "status" | "dueAt" | "notifiedAt">,
  now = new Date(),
  notBefore: Date | null = null,
): boolean {
  if (followUpState(reminder, now) != "overdue") {
    return false;
  }
  if (notBefore && now.getTime() < notBefore.getTime()) {
    return false;
  }
  return reminder.notifiedAt == null ||
    reminder.notifiedAt.getTime() < reminder.dueAt.getTime();
}

/** Нормализует адреса: нижний регистр, без пробелов и угловых скобок, без дублей. */
export function normalizeFollowUpAddresses(value: Iterable<unknown>): string[] {
  const result = new Set<string>();
  for (const item of value) {
    if (typeof item != "string") {
      continue;
    }
    const address = item.trim().replace(/^<|>$/g, "").toLowerCase();
    if (address.includes("@")) {
      result.add(address);
    }
    if (result.size >= MAX_FOLLOW_UP_RECIPIENTS) {
      break;
    }
  }
  return [...result];
}

/**
 * Тема без префиксов ответа и пересылки на распространённых языках:
 * «Re:», «RE[2]:», «AW:», «Ответ:», «Отв:», «TR:», «SV:», «Antw:», «Fwd:».
 */
export function normalizeReplySubject(subject: string | null | undefined): string {
  let result = (subject ?? "").replace(/\s+/g, " ").trim();
  const prefix = /^(?:re|aw|antw|sv|vs|ref|réf|rif|tr|wg|fw|fwd|отв|ответ|пересл|переслано)\s*(?:\[\d+\]|\(\d+\))?\s*[:：]\s*/iu;
  for (let i = 0; i < 10 && prefix.test(result); i++) {
    result = result.replace(prefix, "").trim();
  }
  return result.toLocaleLowerCase();
}

const automatedSubjectPatterns: readonly RegExp[] = [
  // Автоответы: фраза достаточно характерна, чтобы хватило начала темы.
  /^(?:automatic reply|auto(?:matic)?[- ]?(?:reply|response)|autoreply|out of (?:the )?office|réponse automatique|automatische antwort|respuesta automática|risposta automatica|автоответ|автоматический ответ)/iu,
  // Короткие слова считаются служебными только с двоеточием: «Read: …», но не «Readiness».
  /^(?:abwesenheit\p{L}*|abwesend|absence|fuori sede|вне офиса|delivered|read|not read|relayed|delivery notification|non remis|remis|lu|non lu|unzustellbar|zugestellt|gelesen|ungelesen|не доставлено|недоставлено|доставлено|прочитано|не прочитано)\s*:/iu,
  // Отчёты о недоставке и уведомления о доставке.
  /^(?:undeliverable|undelivered|delivery status notification|delivery (?:has failed|failure|failed|delayed)|mail delivery (?:failed|failure|subsystem|system)|returned mail|failure notice|не удается доставить|не удалось доставить|уведомление о доставке|уведомление о прочтении|возвращ[её]нное письмо)/iu,
];

const automatedSenderPatterns: readonly RegExp[] = [
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounces?|auto[-_.]?(?:reply|responder)?)(?:[+-][^@]*)?@/iu,
];

const automatedSenderNames = new Set([
  "mail delivery system",
  "mail delivery subsystem",
  "mailer-daemon",
  "microsoft outlook",
  "postmaster",
]);

function headerValue(
  headers: FollowUpReplyCandidate["headers"],
  name: string,
): string | null {
  if (!headers) {
    return null;
  }
  const lower = name.toLowerCase();
  const entries = typeof (headers as FollowUpHeaderMap).entries == "function"
    ? [...(headers as FollowUpHeaderMap).entries()]
    : Object.entries(headers as Record<string, string>);
  for (const [key, value] of entries) {
    if (String(key).toLowerCase() == lower) {
      return String(value ?? "");
    }
  }
  return null;
}

/**
 * Автоответ «Out of office», уведомление о доставке или прочтении, отчёт о
 * недоставке. Заголовки есть только у загруженных писем, поэтому основное
 * правило — тема и отправитель, как в базе.
 */
export function isAutomatedFollowUpMessage(
  message: Pick<FollowUpReplyCandidate, "subject" | "fromAddress" | "fromName" | "headers">,
): boolean {
  const autoSubmitted = headerValue(message.headers, "Auto-Submitted")?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted != "no") {
    return true;
  }
  if (headerValue(message.headers, "X-Autoreply") != null ||
      headerValue(message.headers, "X-Autorespond") != null) {
    return true;
  }
  const autoSuppress = headerValue(message.headers, "X-Auto-Response-Suppress")?.toLowerCase() ?? "";
  if (/\b(?:all|oof|autoreply)\b/.test(autoSuppress)) {
    return true;
  }
  const precedence = headerValue(message.headers, "Precedence")?.trim().toLowerCase();
  if (precedence == "auto_reply") {
    return true;
  }
  const contentType = headerValue(message.headers, "Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/report") ||
      contentType.includes("message/delivery-status") ||
      contentType.includes("message/disposition-notification")) {
    return true;
  }
  const address = (message.fromAddress ?? "").trim().toLowerCase();
  if (automatedSenderPatterns.some(pattern => pattern.test(address))) {
    return true;
  }
  const name = (message.fromName ?? "").trim().toLowerCase();
  if (automatedSenderNames.has(name)) {
    return true;
  }
  const subject = (message.subject ?? "").replace(/\s+/g, " ").trim();
  return automatedSubjectPatterns.some(pattern => pattern.test(subject));
}

/**
 * Решает, считается ли письмо ответом на отслеживаемое.
 *
 * Ответ — входящее письмо после отправки, не от своих адресов и не
 * автоматическое, которое:
 * 1. ссылается на отслеживаемое через In-Reply-To (любой отправитель); или
 * 2. пришло от одного из получателей в той же цепочке (threadID) либо
 *    с той же темой без префиксов «Re:» — для серверов, которые не сохраняют
 *    In-Reply-To и не дают идентификатор цепочки.
 */
export function isFollowUpReply(
  reminder: Pick<FollowUpReminder, "messageID" | "threadID" | "emailId" | "subject" | "recipients" | "sentAt">,
  candidate: FollowUpReplyCandidate,
  ownAddresses: readonly string[],
): boolean {
  if (candidate.outgoing || candidate.isDraft) {
    return false;
  }
  if (candidate.emailId == reminder.emailId ||
      (candidate.messageID && candidate.messageID == reminder.messageID)) {
    return false;
  }
  if (!isValidDate(candidate.receivedAt) ||
      candidate.receivedAt.getTime() <
        reminder.sentAt.getTime() - FOLLOW_UP_CLOCK_SKEW_SECONDS * MILLISECONDS_PER_SECOND) {
    return false;
  }
  const own = new Set(normalizeFollowUpAddresses(ownAddresses));
  const from = normalizeFollowUpAddresses([candidate.fromAddress])[0] ?? null;
  if (from && own.has(from)) {
    return false;
  }
  if (isAutomatedFollowUpMessage(candidate)) {
    return false;
  }
  if (candidate.parentMsgID && candidate.parentMsgID == reminder.messageID) {
    return true;
  }
  const recipients = new Set(reminder.recipients.filter(address => !own.has(address)));
  if (!from || !recipients.has(from)) {
    return false;
  }
  if (reminder.threadID && candidate.threadID == reminder.threadID) {
    return true;
  }
  if (candidate.threadID && candidate.threadID == reminder.messageID) {
    return true;
  }
  const subject = normalizeReplySubject(reminder.subject);
  return subject.length > 0 && normalizeReplySubject(candidate.subject) == subject;
}

/** Первый ответ среди кандидатов, по времени получения. */
export function findFollowUpReply(
  reminder: Pick<FollowUpReminder, "messageID" | "threadID" | "emailId" | "subject" | "recipients" | "sentAt">,
  candidates: readonly FollowUpReplyCandidate[],
  ownAddresses: readonly string[],
): FollowUpReplyCandidate | null {
  return candidates
    .filter(candidate => isFollowUpReply(reminder, candidate, ownAddresses))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())[0] ?? null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
