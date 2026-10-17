import { appGlobal } from "../app";
import { getDatabase as getMailDatabase } from "../Mail/SQL/SQLDatabase";
import { getDatabase as getChatDatabase } from "../Chat/SQL/SQLDatabase";
import { getDatabase as getFilesDatabase } from "../Files/SQL/SQLDatabase";
import sql, { type Database } from "../../../lib/rs-sqlite";
import {
  DEFAULT_WORKING_HOURS_SCHEDULE,
  isWithinWorkingHours,
  normalizeWorkingHoursSchedule,
  workingSecondsBetween,
  type WorkingHoursSchedule,
} from "./WorkingHours";
import {
  getConfiguredMailAddresses,
  mailAddressDomains,
  normalizeMailAddresses,
} from "./ResponseMessageAddresses";

export interface ReportDateRange {
  /** Начало периода в формате YYYY-MM-DD, включительно. */
  from: string;
  /** Конец периода в формате YYYY-MM-DD, включительно. */
  to: string;
}

export type ReportDatePreset = "7d" | "30d" | "90d" | "month" | "year" | "all";

export interface ReportFilters {
  /** Почтовый аккаунт, для которого нужно построить почтовую часть отчёта. */
  mailAccountId?: number | null;
  /** Адрес выбранного общего ящика для распознавания копий ответов. */
  mailboxAddress?: string | null;
  /** Почтовая папка внутри выбранного аккаунта. */
  mailFolderId?: number | null;
  /** Норматив первого ответа в минутах. По умолчанию — 30 минут. */
  responseTargetMinutes?: number | null;
  /** Рабочий календарь, по которому считаются минуты SLA. */
  workingHours?: WorkingHoursSchedule | null;
}

export const DEFAULT_RESPONSE_TARGET_MINUTES = 30;
export const MIN_RESPONSE_TARGET_MINUTES = 1;
export const MAX_RESPONSE_TARGET_MINUTES = 7 * 24 * 60;

export interface ReportMailAccountOption {
  accountId: number;
  accountName: string;
  email: string;
}

export interface ReportMailFolderOption {
  accountId: number;
  folderId: number;
  name: string;
  path: string;
  specialUse: string | null;
}

export type TimelineGranularity = "day" | "week" | "month";

export interface ActivityDay {
  day: string;
  incoming?: number;
  outgoing?: number;
  events?: number;
  files?: number;
}

export interface ActivityCell {
  /** Понедельник = 0, воскресенье = 6. */
  weekday: number;
  hour: number;
  count: number;
}

export interface MailSummary {
  total: number;
  incoming: number;
  outgoing: number;
  answered: number;
  withAttachments: number;
  totalBytes: number;
  responseTime: ResponseTimeStats;
}

export interface ResponseTimeStats {
  answered: number;
  averageSeconds: number | null;
  minimumSeconds: number | null;
  maximumSeconds: number | null;
  withinTarget: number;
  overTarget: number;
}

export type ResponseTimeStatus = "measured" | "outside-working-hours";

export interface MailResponseRow {
  emailId: number;
  folderId: number;
  accountId: number;
  accountName: string;
  /** Почтовый аккаунт, из папки которого найден первый связанный ответ. */
  responderAccountId?: number | null;
  responderAccountName?: string | null;
  subject: string;
  contactName: string;
  contactEmail: string;
  requestAt: Date;
  responseAt: Date;
  /**
   * Фактическое календарное время от запроса до ответа. Показывается даже
   * тогда, когда SLA для этой строки не оценивается.
   */
  actualDurationSeconds: number | null;
  /**
   * Рабочие секунды, использованные для проверки SLA. Равно null, если и
   * запрос, и ответ пришли вне рабочего графика: такой ответ засчитывается,
   * но надёжно оценить его по SLA нельзя.
   */
  durationSeconds: number | null;
  /** Null означает, что строка засчитана, но SLA для неё не оценивается. */
  withinTarget: boolean | null;
  /** Ответ вне графика отдельно отмечается в деталях и сводках. */
  responseTimeStatus: ResponseTimeStatus;
  /** Все уникальные метки входящего запроса. Используются для общего ящика. */
  categoryNames: string[];
}

export interface ResponseTimeDayRow {
  day: string;
  answered: number;
  averageSeconds: number | null;
  minimumSeconds: number | null;
  maximumSeconds: number | null;
  withinTarget: number;
  overTarget: number;
}

export interface MailAccountRow {
  accountId: number;
  accountName: string;
  total: number;
  incoming: number;
  outgoing: number;
  answered: number;
  totalBytes: number;
  lastActivity: Date | null;
}

export interface MailResponderRow {
  accountId: number;
  accountName: string;
  email: string;
  requests: number;
  answered: number;
  sent: number;
  lastActivity: Date | null;
  peakWeekday: number | null;
  peakHour: number | null;
  responseTime: ResponseTimeStats;
}

export interface MailFolderRow {
  accountId: number;
  accountName: string;
  folderName: string;
  folderPath: string;
  total: number;
  incoming: number;
  outgoing: number;
}

export interface MailCorrespondentRow {
  email: string;
  name: string;
  total: number;
  incoming: number;
  outgoing: number;
  answered: number;
  lastActivity: Date | null;
}

export interface MailTopicRow {
  topic: string;
  requests: number;
  answered: number;
  lastActivity: Date | null;
}

export interface MailCategoryRow {
  name: string;
  total: number;
  incoming: number;
  outgoing: number;
  answered: number;
  lastActivity: Date | null;
  peakWeekday: number | null;
  peakHour: number | null;
  responseTime: ResponseTimeStats;
}

export interface MailReport {
  summary: MailSummary;
  responseTargetMinutes: number;
  responseTimes: MailResponseRow[];
  responseTimeDays: ResponseTimeDayRow[];
  accounts: MailAccountRow[];
  responders: MailResponderRow[];
  folders: MailFolderRow[];
  correspondents: MailCorrespondentRow[];
  topics: MailTopicRow[];
  categories: MailCategoryRow[];
  daily: ActivityDay[];
  activity: ActivityCell[];
}

export interface CalendarSummary {
  events: number;
  hours: number;
  onlineMeetings: number;
  participants: number;
}

export interface CalendarRow {
  calendarId: number | string;
  calendarName: string;
  events: number;
  hours: number;
  onlineMeetings: number;
  participants: number;
}

export interface CalendarParticipantRow {
  email: string;
  name: string;
  events: number;
}

export interface CalendarReport {
  summary: CalendarSummary;
  calendars: CalendarRow[];
  participants: CalendarParticipantRow[];
  daily: ActivityDay[];
  activity: ActivityCell[];
}

export interface ChatSummary {
  total: number;
  incoming: number;
  outgoing: number;
}

export interface ChatRoomRow {
  roomId: number;
  roomName: string;
  accountId: number;
  accountName: string;
  total: number;
  incoming: number;
  outgoing: number;
  lastActivity: Date | null;
}

export interface ChatReport {
  summary: ChatSummary;
  rooms: ChatRoomRow[];
  daily: ActivityDay[];
  activity: ActivityCell[];
}

export interface FilesSummary {
  changed: number;
  bytes: number;
  directories: number;
}

export interface FileDirectoryRow {
  accountId: number;
  accountName: string;
  directoryName: string;
  directoryPath: string;
  files: number;
  bytes: number;
}

export interface FilesReport {
  summary: FilesSummary;
  directories: FileDirectoryRow[];
  daily: ActivityDay[];
  activity: ActivityCell[];
}

export interface ReportTimelinePoint {
  key: string;
  start: string;
  mailIncoming: number;
  mailOutgoing: number;
  chatIncoming: number;
  chatOutgoing: number;
  calendarEvents: number;
  filesChanged: number;
  total: number;
}

export interface ReportSummary {
  mailMessages: number;
  mailIncoming: number;
  mailOutgoing: number;
  mailAnswered: number;
  responseTargetMinutes: number;
  responseTime: ResponseTimeStats;
  chatMessages: number;
  chatIncoming: number;
  chatOutgoing: number;
  calendarEvents: number;
  calendarHours: number;
  filesChanged: number;
  fileBytes: number;
  activityCount: number;
  responseRate: number;
  peakWeekday: number | null;
  peakHour: number | null;
}

export interface ReportData {
  range: ReportDateRange;
  /** Заполнено, когда отчёт построен для конкретного почтового аккаунта. */
  mailAccountFilter?: ReportMailAccountOption | null;
  /** Заполнено, когда отчёт ограничен конкретной почтовой папкой. */
  mailFolderFilter?: ReportMailFolderOption | null;
  generatedAt: Date;
  granularity: TimelineGranularity;
  /** Рабочий календарь, применённый к расчёту времени ответа. */
  workingHours: WorkingHoursSchedule;
  summary: ReportSummary;
  timeline: ReportTimelinePoint[];
  activity: ActivityCell[];
  mail: MailReport;
  calendar: CalendarReport;
  chat: ChatReport;
  files: FilesReport;
}

interface ReportBounds {
  start: Date;
  endExclusive: Date;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Ограничивает интервал календарного события выбранным периодом отчёта.
 * Событие засчитывается только если после пересечения остаётся ненулевой
 * интервал; это не даёт включать часы за пределами фильтра дат.
 */
export function clipReportEventInterval(
  start: Date,
  end: Date,
  periodStart: Date,
  periodEndExclusive: Date,
): { start: Date; end: Date } | null {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    !Number.isFinite(periodStart.getTime()) ||
    !Number.isFinite(periodEndExclusive.getTime()) ||
    end <= start ||
    periodEndExclusive <= periodStart
  ) {
    return null;
  }
  const clippedStart = new Date(
    Math.max(start.getTime(), periodStart.getTime()),
  );
  const clippedEnd = new Date(
    Math.min(end.getTime(), periodEndExclusive.getTime()),
  );
  return clippedEnd > clippedStart
    ? { start: clippedStart, end: clippedEnd }
    : null;
}

export interface RawMailTopicRow {
  subject: string;
  requests: number;
  answered: number;
  lastActivity: Date | null;
}

export function normalizeResponseTargetMinutes(
  value: number | null | undefined,
): number {
  if (typeof value != "number" || !Number.isFinite(value)) {
    return DEFAULT_RESPONSE_TARGET_MINUTES;
  }
  const integerValue = Math.trunc(value);
  if (integerValue < MIN_RESPONSE_TARGET_MINUTES) {
    return DEFAULT_RESPONSE_TARGET_MINUTES;
  }
  return Math.min(integerValue, MAX_RESPONSE_TARGET_MINUTES);
}

export function emptyResponseTimeStats(): ResponseTimeStats {
  return {
    answered: 0,
    averageSeconds: null,
    minimumSeconds: null,
    maximumSeconds: null,
    withinTarget: 0,
    overTarget: 0,
  };
}

export function buildResponseTimeStats(
  rows: Array<{
    durationSeconds: number | null;
    responseTimeStatus?: ResponseTimeStatus;
    withinTarget?: boolean | null;
  }>,
  targetMinutes: number,
): ResponseTimeStats {
  // Сводка показывает только строки, для которых SLA действительно оценён.
  // Ответ вне графика может остаться в этой сводке, если запрос был получен
  // в рабочее время; строка с обоими моментами вне графика имеет null в
  // withinTarget и исключается из расчёта.
  const durations = rows
    .filter(
      (row) =>
        row.responseTimeStatus != "outside-working-hours" ||
        row.withinTarget != null,
    )
    .map((row) => row.durationSeconds)
    .filter(
      (duration): duration is number =>
        typeof duration == "number" &&
        Number.isFinite(duration) &&
        duration >= 0,
    );
  if (!durations.length) {
    return emptyResponseTimeStats();
  }
  const targetSeconds = normalizeResponseTargetMinutes(targetMinutes) * 60;
  const totalSeconds = durations.reduce((sum, duration) => sum + duration, 0);
  const withinTarget = durations.filter(
    (duration) => duration <= targetSeconds,
  ).length;
  return {
    answered: durations.length,
    averageSeconds: totalSeconds / durations.length,
    // Не через Math.min(...durations): на сотнях тысяч ответов spread переполняет стек
    minimumSeconds: durations.reduce((min, duration) => Math.min(min, duration), Infinity),
    maximumSeconds: durations.reduce((max, duration) => Math.max(max, duration), -Infinity),
    withinTarget,
    overTarget: durations.length - withinTarget,
  };
}

export function buildResponseTimeDays(
  rows: MailResponseRow[],
  targetMinutes: number,
): ResponseTimeDayRow[] {
  const grouped = new Map<string, MailResponseRow[]>();
  for (const row of rows) {
    const day = dateInputValue(row.requestAt);
    const dayRows = grouped.get(day);
    if (dayRows) {
      dayRows.push(row);
    } else {
      grouped.set(day, [row]);
    }
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayRows]) => {
      const stats = buildResponseTimeStats(dayRows, targetMinutes);
      return { day, ...stats };
    });
}

export function defaultReportDateRange(now = new Date()): ReportDateRange {
  return reportDateRangeForPreset("30d", now);
}

export function reportDateRangeForPreset(
  preset: ReportDatePreset,
  now = new Date(),
): ReportDateRange {
  const to = startOfLocalDay(now);
  const from = new Date(to);

  switch (preset) {
    case "all":
      return { from: "1970-01-01", to: dateInputValue(to) };
    case "year":
      from.setMonth(0, 1);
      break;
    case "month":
      from.setDate(1);
      break;
    case "7d":
      from.setDate(from.getDate() - 6);
      break;
    case "90d":
      from.setDate(from.getDate() - 89);
      break;
    case "30d":
      from.setDate(from.getDate() - 29);
      break;
  }

  return { from: dateInputValue(from), to: dateInputValue(to) };
}

/**
 * Возвращает почтовые аккаунты, доступные для фильтра отчёта.
 *
 * `emailAccount` — техническая таблица mail.db и при старте может быть
 * заполнена позже таблицы папок или объектов аккаунтов. Поэтому собираем
 * идентификаторы из всех доступных источников, чтобы фильтр не зависел от
 * порядка инициализации приложения.
 */
export async function loadReportMailAccounts(
  database?: Database,
): Promise<ReportMailAccountOption[]> {
  const configuredAccounts = appGlobal.emailAccounts.contents
    .map((account) => {
      const accountId = Number(account.dbID);
      if (!Number.isInteger(accountId) || accountId <= 0) {
        return null;
      }
      return {
        accountId,
        accountName: account.name || account.emailAddress || "Почтовый аккаунт",
        email:
          account.emailAddress || account.identities?.first?.emailAddress || "",
      };
    })
    .filter((account): account is ReportMailAccountOption => account != null);
  const configuredById = new Map(
    configuredAccounts.map((account) => [account.accountId, account]),
  );
  const accountIds = new Set(configuredById.keys());
  try {
    const db = database ?? (await getMailDatabase());
    const rows = (await db.all(sql`
      SELECT id AS accountId
      FROM emailAccount
      UNION
      SELECT DISTINCT accountID AS accountId
      FROM folder
      WHERE accountID IS NOT NULL
      ORDER BY accountId
      `)) as any[];
    for (const row of rows) {
      const accountId = rowNumber(row, "accountId");
      if (accountId > 0) {
        accountIds.add(accountId);
      }
    }
  } catch {
    return configuredAccounts.sort((a, b) => a.accountId - b.accountId);
  }
  return [...accountIds]
    .sort((a, b) => a - b)
    .map(
      (accountId) =>
        configuredById.get(accountId) ?? {
          accountId,
          accountName: findAccountName(
            appGlobal.emailAccounts,
            accountId,
            "Почтовый аккаунт",
          ),
          email: findAccountEmail(appGlobal.emailAccounts, accountId),
        },
    );
}

/** Возвращает папки выбранного почтового аккаунта для уточнения области отчёта. */
export async function loadReportMailFolders(
  accountId: number | null,
): Promise<ReportMailFolderOption[]> {
  if (accountId == null) {
    return [];
  }
  const db = await getMailDatabase();
  const rows = (await db.all(sql`
    SELECT
      id AS folderId,
      accountID AS accountId,
      name,
      path,
      specialUse
    FROM folder
    WHERE accountID = ${accountId}
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(specialUse, '')) = 'inbox' THEN 0
        WHEN UPPER(path) = 'INBOX' THEN 0
        WHEN LOWER(name) = 'входящие' THEN 0
        ELSE 1
      END,
      name COLLATE NOCASE,
      id
    `)) as any[];
  return rows
    .map((row) => ({
      accountId: rowNumber(row, "accountId"),
      folderId: rowNumber(row, "folderId"),
      name: rowText(row, "name", "Папка"),
      path: rowText(row, "path", ""),
      specialUse: rowText(row, "specialUse", "") || null,
    }))
    .filter((folder) => folder.accountId > 0 && folder.folderId > 0);
}

async function loadReportMailFolder(
  accountId: number | null,
  folderId: number | null,
): Promise<ReportMailFolderOption | null> {
  if (accountId == null || folderId == null) {
    return null;
  }
  const db = await getMailDatabase();
  const row = (await db.get(sql`
    SELECT
      id AS folderId,
      accountID AS accountId,
      name,
      path,
      specialUse
    FROM folder
    WHERE id = ${folderId}
      AND accountID = ${accountId}
    `)) as any;
  if (!row) {
    return null;
  }
  return {
    accountId: rowNumber(row, "accountId"),
    folderId: rowNumber(row, "folderId"),
    name: rowText(row, "name", "Папка"),
    path: rowText(row, "path", ""),
    specialUse: rowText(row, "specialUse", "") || null,
  };
}

/** Возвращает код ошибки, чтобы UI мог показать локализованный текст. */
export function validateReportDateRange(
  range: ReportDateRange,
): "invalid" | "reversed" | null {
  const from = parseDateInput(range.from);
  const to = parseDateInput(range.to);
  if (!from || !to) {
    return "invalid";
  }
  if (from.getTime() > to.getTime()) {
    return "reversed";
  }
  return null;
}

export function normalizeReportTopic(
  subject: string | null | undefined,
): string {
  const normalized = (subject ?? "")
    .trim()
    .replace(/^(?:(?:re|fw|fwd|aw|sv|wg)\s*:\s*)+/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || "(без темы)";
}

export function mergeReportTopics(rows: RawMailTopicRow[]): MailTopicRow[] {
  const topics = new Map<string, MailTopicRow>();
  for (const row of rows) {
    const topic = normalizeReportTopic(row.subject);
    const key = topic.toLocaleLowerCase();
    const existing = topics.get(key);
    if (existing) {
      existing.requests += row.requests;
      existing.answered += row.answered;
      if (
        !existing.lastActivity ||
        (row.lastActivity && row.lastActivity > existing.lastActivity)
      ) {
        existing.lastActivity = row.lastActivity;
      }
      continue;
    }
    topics.set(key, {
      topic,
      requests: row.requests,
      answered: row.answered,
      lastActivity: row.lastActivity,
    });
  }
  return [...topics.values()]
    .sort(
      (a, b) =>
        b.requests - a.requests ||
        b.answered - a.answered ||
        a.topic.localeCompare(b.topic),
    )
    .slice(0, 50);
}

/** Загружает почтовую часть отчёта. Третий параметр нужен для изолированных проверок. */
export async function loadReportMailData(
  range: ReportDateRange,
  filters: ReportFilters = {},
  database?: Database,
): Promise<MailReport> {
  const mailAccountId = normalizeMailAccountId(filters.mailAccountId);
  const workingHours = normalizeWorkingHoursSchedule(
    filters.workingHours,
    DEFAULT_WORKING_HOURS_SCHEDULE,
  );
  return loadMailReport(
    makeReportBounds(range),
    mailAccountId,
    normalizeMailFolderId(filters.mailFolderId, mailAccountId),
    normalizeResponseTargetMinutes(filters.responseTargetMinutes),
    workingHours,
    database,
    filters.mailboxAddress,
  );
}

export async function loadReportData(
  range: ReportDateRange,
  filters: ReportFilters = {},
): Promise<ReportData> {
  const bounds = makeReportBounds(range);
  const mailAccountId = normalizeMailAccountId(filters.mailAccountId);
  const mailFolderId = normalizeMailFolderId(
    filters.mailFolderId,
    mailAccountId,
  );
  const responseTargetMinutes = normalizeResponseTargetMinutes(
    filters.responseTargetMinutes,
  );
  const workingHours = normalizeWorkingHoursSchedule(
    filters.workingHours,
    DEFAULT_WORKING_HOURS_SCHEDULE,
  );
  const [mail, calendar, chat, files, mailFolderFilter] = await Promise.all([
    loadMailReport(
      bounds,
      mailAccountId,
      mailFolderId,
      responseTargetMinutes,
      workingHours,
      undefined,
      filters.mailboxAddress,
    ),
    loadCalendarReport(bounds),
    loadChatReport(bounds),
    loadFilesReport(bounds),
    loadReportMailFolder(mailAccountId, mailFolderId),
  ]);
  const granularity = timelineGranularity(bounds);
  const timeline = buildReportTimeline(
    bounds,
    granularity,
    mail.daily,
    calendar.daily,
    chat.daily,
    files.daily,
  );
  const activity = mergeActivityCells(
    mail.activity,
    calendar.activity,
    chat.activity,
    files.activity,
  );
  const activityCount = activity.reduce((sum, cell) => sum + cell.count, 0);
  const peakWeekday = peakActivity(activity, "weekday");
  const peakHour = peakActivity(activity, "hour");

  return {
    range: { ...range },
    mailAccountFilter:
      mailAccountId == null ? null : findReportMailAccount(mailAccountId),
    mailFolderFilter,
    generatedAt: new Date(),
    granularity,
    workingHours,
    timeline,
    activity,
    mail,
    calendar,
    chat,
    files,
    summary: {
      mailMessages: mail.summary.total,
      mailIncoming: mail.summary.incoming,
      mailOutgoing: mail.summary.outgoing,
      mailAnswered: mail.summary.answered,
      responseTargetMinutes,
      responseTime: mail.summary.responseTime,
      chatMessages: chat.summary.total,
      chatIncoming: chat.summary.incoming,
      chatOutgoing: chat.summary.outgoing,
      calendarEvents: calendar.summary.events,
      calendarHours: calendar.summary.hours,
      filesChanged: files.summary.changed,
      fileBytes: files.summary.bytes,
      activityCount,
      responseRate: mail.summary.incoming
        ? mail.summary.answered / mail.summary.incoming
        : 0,
      peakWeekday,
      peakHour,
    },
  };
}

async function loadMailReport(
  bounds: ReportBounds,
  mailAccountId: number | null,
  mailFolderId: number | null,
  responseTargetMinutes: number,
  workingHours: WorkingHoursSchedule,
  database?: Database,
  mailboxAddress?: string | null,
): Promise<MailReport> {
  const db = database ?? (await getMailDatabase());
  const mailboxAddresses = normalizeMailAddresses([
    mailAccountId == null
      ? null
      : findAccountEmail(appGlobal.emailAccounts, mailAccountId),
    mailboxAddress,
    ...getConfiguredMailAddresses(mailAccountId),
  ]);
  const knownSenderAddresses = getConfiguredMailAddresses();
  const mailboxDomains = mailAddressDomains(mailboxAddresses);
  const incomingKnownSenderPredicate = knownSenderAddresses.length
    ? sql`LOWER(TRIM(COALESCE(e.contactEmail, ''))) IN ${knownSenderAddresses}`
    : sql`0`;
  const incomingDomainSenderPredicate = mailboxDomains.length
    ? sql`
      INSTR(TRIM(COALESCE(e.contactEmail, '')), '@') > 0 AND
      LOWER(SUBSTR(
        TRIM(COALESCE(e.contactEmail, '')),
        INSTR(TRIM(COALESCE(e.contactEmail, '')), '@') + 1
      )) IN ${mailboxDomains}`
    : sql`0`;
  const replyKnownSenderPredicate = knownSenderAddresses.length
    ? sql`LOWER(TRIM(COALESCE(reply.contactEmail, ''))) IN ${knownSenderAddresses}`
    : sql`0`;
  const replyDomainSenderPredicate = mailboxDomains.length
    ? sql`
      INSTR(TRIM(COALESCE(reply.contactEmail, '')), '@') > 0 AND
      LOWER(SUBSTR(
        TRIM(COALESCE(reply.contactEmail, '')),
        INSTR(TRIM(COALESCE(reply.contactEmail, '')), '@') + 1
      )) IN ${mailboxDomains}`
    : sql`0`;
  const outgoingMessagePredicate = sql`
    (
      e.outgoing = 1 OR EXISTS (
        SELECT 1
        FROM folder directionFolder
        WHERE directionFolder.id = e.folderID
          AND LOWER(COALESCE(directionFolder.specialUse, '')) IN ('sent', 'outbox')
      )
    )`;
  const incomingResponseCopyPredicate =
    mailboxAddresses.length &&
    (knownSenderAddresses.length || mailboxDomains.length)
      ? sql`
      (
        (
          $${incomingKnownSenderPredicate} OR
          $${incomingDomainSenderPredicate}
        )
        AND EXISTS (
          SELECT 1
          FROM emailPersonRel recipientRel
          JOIN emailPerson recipientPerson
            ON recipientPerson.id = recipientRel.emailPersonID
          WHERE recipientRel.emailID = e.id
            AND recipientRel.recipientType IN (2, 3, 4)
            AND LOWER(TRIM(recipientPerson.emailAddress)) IN ${mailboxAddresses}
        )
        AND (
          (e.parentMsgID IS NOT NULL AND TRIM(e.parentMsgID) != '') OR
          LOWER(TRIM(COALESCE(e.subject, ''))) LIKE 're:%' OR
          LOWER(TRIM(COALESCE(e.subject, ''))) LIKE 'fw:%' OR
          LOWER(TRIM(COALESCE(e.subject, ''))) LIKE 'fwd:%'
        )
      )`
      : sql`0`;
  const replyResponseCopyPredicate =
    mailboxAddresses.length &&
    (knownSenderAddresses.length || mailboxDomains.length)
      ? sql`
      (
        (
          $${replyKnownSenderPredicate} OR
          $${replyDomainSenderPredicate}
        )
        AND EXISTS (
          SELECT 1
          FROM emailPersonRel recipientRel
          JOIN emailPerson recipientPerson
            ON recipientPerson.id = recipientRel.emailPersonID
          WHERE recipientRel.emailID = reply.id
            AND recipientRel.recipientType IN (2, 3, 4)
            AND LOWER(TRIM(recipientPerson.emailAddress)) IN ${mailboxAddresses}
        )
        AND (
          (reply.parentMsgID IS NOT NULL AND TRIM(reply.parentMsgID) != '') OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 're:%' OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 'fw:%' OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 'fwd:%'
        )
      )`
      : sql`0`;
  const incomingMessagePredicate = sql`
    NOT (
      $${outgoingMessagePredicate} OR
      $${incomingResponseCopyPredicate}
    )`;
  const replyMessagePredicate = sql`
    (
      reply.outgoing = 1 OR
      LOWER(COALESCE(replyFolder.specialUse, '')) IN ('sent', 'outbox') OR
      $${replyResponseCopyPredicate}
    )`;
  const replyLinkPredicate = sql`
    (
      (
        e.messageID IS NOT NULL AND
        TRIM(e.messageID) != '' AND
        reply.parentMsgID = e.messageID
      ) OR (
        e.threadID IS NOT NULL AND
        TRIM(e.threadID) != '' AND
        reply.threadID = e.threadID
      )
    )`;
  const activityPredicate = sql`
    (
      ($${outgoingMessagePredicate} AND e.dateSent >= ${bounds.startSeconds} AND e.dateSent < ${bounds.endSeconds}) OR
      ($${incomingMessagePredicate} AND e.dateReceived >= ${bounds.startSeconds} AND e.dateReceived < ${bounds.endSeconds})
    )`;
  const outgoingPredicate = sql`
    $${outgoingMessagePredicate} AND e.dateSent >= ${bounds.startSeconds} AND e.dateSent < ${bounds.endSeconds}`;
  const mailAccountPredicate =
    mailAccountId == null
      ? sql``
      : sql`
      AND EXISTS (
        SELECT 1
        FROM folder scopeFolder
        WHERE scopeFolder.id = e.folderID
          AND scopeFolder.accountID = ${mailAccountId}
      )`;
  const mailFolderPredicate =
    mailFolderId == null
      ? sql``
      : sql`
      AND e.folderID = ${mailFolderId}`;
  const mailScopePredicate = sql`
    $${mailAccountPredicate} $${mailFolderPredicate}`;
  const answeredPredicate = sql`
    $${incomingMessagePredicate} AND (
      COALESCE(e.isReplied, 0) = 1 OR EXISTS (
      SELECT 1
      FROM email reply
      JOIN folder replyFolder ON replyFolder.id = reply.folderID
      WHERE $${replyMessagePredicate}
        AND reply.dateSent >= e.dateReceived
        AND $${replyLinkPredicate}
      )
    )`;

  const summaryRow = (await db.get(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN $${incomingMessagePredicate} THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END) AS outgoing,
      SUM(CASE WHEN $${answeredPredicate} THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM emailAttachment a WHERE a.emailID = e.id
      ) THEN 1 ELSE 0 END) AS withAttachments,
      COALESCE(SUM(COALESCE(e.size, 0)), 0) AS totalBytes
    FROM email e
    WHERE $${activityPredicate} $${mailScopePredicate}
    `)) as any;

  const accountRows = (await db.all(sql`
    SELECT
      f.accountID AS accountId,
      COUNT(*) AS total,
      SUM(CASE WHEN $${incomingMessagePredicate} THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END) AS outgoing,
      SUM(CASE WHEN $${answeredPredicate} THEN 1 ELSE 0 END) AS answered,
      COALESCE(SUM(COALESCE(e.size, 0)), 0) AS totalBytes,
      MAX(CASE WHEN $${outgoingMessagePredicate} THEN e.dateSent ELSE e.dateReceived END) AS lastActivity
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE $${activityPredicate} $${mailScopePredicate}
    GROUP BY f.accountID
    ORDER BY total DESC
    `)) as any[];

  const responseRows = (await db.all(sql`
    SELECT
      e.id AS emailId,
      e.folderID AS folderId,
      f.accountID AS accountId,
      e.subject AS subject,
      e.contactName AS contactName,
      e.contactEmail AS contactEmail,
      e.dateReceived AS requestAt,
      e.isReplied AS isReplied,
      e.json AS metadata,
      (
        SELECT MIN(reply.dateSent)
        FROM email reply
        JOIN folder replyFolder ON replyFolder.id = reply.folderID
        WHERE $${replyMessagePredicate}
          AND reply.dateSent >= e.dateReceived
          AND $${replyLinkPredicate}
      ) AS responseAt,
      (
        SELECT replyFolder.accountID
        FROM email reply
        JOIN folder replyFolder ON replyFolder.id = reply.folderID
        WHERE $${replyMessagePredicate}
          AND reply.dateSent >= e.dateReceived
          AND $${replyLinkPredicate}
        ORDER BY reply.dateSent, reply.id
        LIMIT 1
      ) AS responseAccountId
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE $${incomingMessagePredicate}
      AND e.dateReceived >= ${bounds.startSeconds}
      AND e.dateReceived < ${bounds.endSeconds}
      $${mailScopePredicate}
    ORDER BY e.dateReceived, e.id
    `)) as any[];

  const categoryMessageRows = (await db.all(sql`
    SELECT DISTINCT
      TRIM(tag.tagName) AS name,
      e.id AS emailId
    FROM emailTag tag
    JOIN email e ON e.id = tag.emailID
    WHERE $${incomingMessagePredicate}
      AND e.dateReceived >= ${bounds.startSeconds}
      AND e.dateReceived < ${bounds.endSeconds}
      $${mailScopePredicate}
      AND length(TRIM(tag.tagName)) > 0
    `)) as any[];
  const categoryNamesByEmailId = new Map<number, string[]>();
  for (const row of categoryMessageRows) {
    const emailId = rowNumber(row, "emailId");
    const name = rowText(row, "name", "");
    if (!emailId || !name) {
      continue;
    }
    const names = categoryNamesByEmailId.get(emailId);
    if (names) {
      names.push(name);
    } else {
      categoryNamesByEmailId.set(emailId, [name]);
    }
  }

  const responseTimes = responseRows
    .map((row): MailResponseRow | null => {
      if (row.requestAt == null) {
        return null;
      }
      const requestAt = unixDate(row.requestAt);
      const responseAt = unixDate(row.responseAt) ?? providerResponseDate(row);
      if (!requestAt || !responseAt) {
        return null;
      }
      if (responseAt < requestAt) {
        return null;
      }
      const accountId = rowNumber(row, "accountId");
      const emailId = rowNumber(row, "emailId");
      const categoryNames = categoryNamesByEmailId.get(emailId) ?? [];
      const requestIsWithinWorkingHours = isWithinWorkingHours(
        requestAt,
        workingHours,
      );
      const responseIsOutsideWorkingHours = !isWithinWorkingHours(
        responseAt,
        workingHours,
      );
      const actualDurationSeconds =
        (responseAt.getTime() - requestAt.getTime()) / 1_000;
      const responseDurationSeconds = responseSlaDurationSeconds(
        requestAt,
        responseAt,
        requestIsWithinWorkingHours,
        responseIsOutsideWorkingHours,
        workingHours,
      );
      if (
        !Number.isFinite(actualDurationSeconds) ||
        actualDurationSeconds < 0 ||
        (responseDurationSeconds != null &&
          (!Number.isFinite(responseDurationSeconds) ||
            responseDurationSeconds < 0))
      ) {
        return null;
      }
      const responderAccountId = rowNumber(row, "responseAccountId");
      return {
        emailId,
        folderId: rowNumber(row, "folderId"),
        accountId,
        accountName: findAccountName(
          appGlobal.emailAccounts,
          accountId,
          "Почтовый аккаунт",
        ),
        responderAccountId: responderAccountId > 0 ? responderAccountId : null,
        responderAccountName:
          responderAccountId > 0
            ? findAccountName(
                appGlobal.emailAccounts,
                responderAccountId,
                "",
              )
            : null,
        subject: rowText(row, "subject", "(без темы)"),
        contactName: rowText(row, "contactName", ""),
        contactEmail: rowText(row, "contactEmail", ""),
        requestAt,
        responseAt,
        actualDurationSeconds,
        durationSeconds: responseDurationSeconds,
        withinTarget:
          responseDurationSeconds == null
            ? null
            : responseDurationSeconds <=
              normalizeResponseTargetMinutes(responseTargetMinutes) * 60,
        responseTimeStatus: responseIsOutsideWorkingHours
          ? "outside-working-hours"
          : "measured",
        categoryNames,
      };
    })
    .filter((row): row is MailResponseRow => row != null)
    .sort(
      (a, b) =>
        (b.durationSeconds ?? b.actualDurationSeconds ?? -1) -
          (a.durationSeconds ?? a.actualDurationSeconds ?? -1) ||
        b.requestAt.getTime() - a.requestAt.getTime() ||
        a.emailId - b.emailId,
    );
  const responseTime = buildResponseTimeStats(
    responseTimes,
    responseTargetMinutes,
  );
  const responseTimeDays = buildResponseTimeDays(
    responseTimes,
    responseTargetMinutes,
  );
  const responseTimeByAccount = new Map<number, MailResponseRow[]>();
  for (const response of responseTimes) {
    const accountResponses = responseTimeByAccount.get(response.accountId);
    if (accountResponses) {
      accountResponses.push(response);
    } else {
      responseTimeByAccount.set(response.accountId, [response]);
    }
  }

  const responseByEmailId = new Map(
    responseTimes.map((response) => [response.emailId, response]),
  );
  const categoryResponseTimes = new Map<string, MailResponseRow[]>();
  for (const row of categoryMessageRows) {
    const name = rowText(row, "name", "Категория");
    const emailId = rowNumber(row, "emailId");
    const response = responseByEmailId.get(emailId);
    if (!response) {
      continue;
    }
    const categoryResponses = categoryResponseTimes.get(name);
    if (categoryResponses) {
      categoryResponses.push(response);
    } else {
      categoryResponseTimes.set(name, [response]);
    }
  }
  const categoryPeakCounts = new Map<string, Map<string, number>>();
  for (const response of responseTimes) {
    for (const name of response.categoryNames) {
      const bucket = `${localWeekday(response.responseAt)}:${response.responseAt.getHours()}`;
      const counts = categoryPeakCounts.get(name);
      if (counts) {
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      } else {
        categoryPeakCounts.set(name, new Map([[bucket, 1]]));
      }
    }
  }
  const categoryPeaks = new Map<
    string,
    { weekday: number; hour: number; count: number }
  >();
  for (const [name, counts] of categoryPeakCounts) {
    for (const [bucket, count] of counts) {
      const [weekday, hour] = bucket.split(":").map(Number);
      const candidate = { weekday, hour, count };
      const existing = categoryPeaks.get(name);
      if (
        !existing ||
        candidate.count > existing.count ||
        (candidate.count == existing.count &&
          (candidate.weekday < existing.weekday ||
            (candidate.weekday == existing.weekday &&
              candidate.hour < existing.hour)))
      ) {
        categoryPeaks.set(name, candidate);
      }
    }
  }

  const folderRows = (await db.all(sql`
    SELECT
      f.accountID AS accountId,
      f.name AS folderName,
      f.path AS folderPath,
      COUNT(*) AS total,
      SUM(CASE WHEN $${incomingMessagePredicate} THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END) AS outgoing
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE $${activityPredicate} $${mailScopePredicate}
    GROUP BY f.accountID, f.name, f.path
    ORDER BY total DESC
    LIMIT 100
    `)) as any[];

  const correspondentRows = (await db.all(sql`
    SELECT
      COALESCE(NULLIF(TRIM(e.contactEmail), ''), '') AS email,
      MAX(NULLIF(TRIM(e.contactName), '')) AS name,
      COUNT(*) AS total,
      SUM(CASE WHEN $${incomingMessagePredicate} THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END) AS outgoing,
      SUM(CASE WHEN $${answeredPredicate} THEN 1 ELSE 0 END) AS answered,
      MAX(CASE WHEN $${outgoingMessagePredicate} THEN e.dateSent ELSE e.dateReceived END) AS lastActivity
    FROM email e
    WHERE $${activityPredicate} $${mailScopePredicate}
    GROUP BY COALESCE(NULLIF(TRIM(e.contactEmail), ''), '')
    ORDER BY total DESC
    LIMIT 200
    `)) as any[];

  const rawTopicRows = (await db.all(sql`
    SELECT
      TRIM(e.subject) AS subject,
      COUNT(*) AS requests,
      SUM(CASE WHEN $${answeredPredicate} THEN 1 ELSE 0 END) AS answered,
      MAX(e.dateReceived) AS lastActivity
    FROM email e
    WHERE $${incomingMessagePredicate}
      AND $${activityPredicate}
      $${mailScopePredicate}
      AND TRIM(COALESCE(e.subject, '')) != ''
    GROUP BY LOWER(TRIM(e.subject))
    ORDER BY requests DESC
    `)) as any[];

  const categoryRows = (await db.all(sql`
    WITH taggedMessages AS (
      SELECT DISTINCT
        TRIM(tag.tagName) AS tagName,
        e.id,
        CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END AS outgoing,
        COALESCE(e.isReplied, 0) AS isReplied,
        e.messageID,
        e.threadID,
        e.dateReceived,
        e.dateSent,
        e.folderID,
        e.contactEmail,
        e.parentMsgID,
        e.subject
      FROM emailTag tag
      JOIN email e ON e.id = tag.emailID
      WHERE $${activityPredicate}
        $${mailScopePredicate}
        AND length(TRIM(tag.tagName)) > 0
    )
    SELECT
      e.tagName AS name,
      COUNT(*) AS total,
      SUM(CASE WHEN e.outgoing = 0 THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN e.outgoing = 1 THEN 1 ELSE 0 END) AS outgoing,
      SUM(CASE WHEN $${answeredPredicate} THEN 1 ELSE 0 END) AS answered,
      MAX(CASE WHEN e.outgoing = 1 THEN e.dateSent ELSE e.dateReceived END) AS lastActivity
    FROM taggedMessages AS e
      GROUP BY e.tagName
    ORDER BY total DESC
    LIMIT 100
    `)) as any[];

  const dailyRows = (await db.all(sql`
    SELECT
      strftime('%Y-%m-%d', datetime(
        CASE WHEN $${outgoingMessagePredicate} THEN e.dateSent ELSE e.dateReceived END,
        'unixepoch', 'localtime'
      )) AS day,
      SUM(CASE WHEN $${incomingMessagePredicate} THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN $${outgoingMessagePredicate} THEN 1 ELSE 0 END) AS outgoing
    FROM email e
    WHERE $${activityPredicate} $${mailScopePredicate}
    GROUP BY day
    ORDER BY day
    `)) as any[];

  const activityRows = (await db.all(sql`
    SELECT
      strftime('%w', datetime(e.dateSent, 'unixepoch', 'localtime')) AS weekday,
      strftime('%H', datetime(e.dateSent, 'unixepoch', 'localtime')) AS hour,
      COUNT(*) AS count
    FROM email e
    WHERE $${outgoingPredicate} $${mailScopePredicate}
    GROUP BY weekday, hour
    `)) as any[];
  const responderActivityRows = (await db.all(sql`
    SELECT
      f.accountID AS accountId,
      strftime('%w', datetime(e.dateSent, 'unixepoch', 'localtime')) AS weekday,
      strftime('%H', datetime(e.dateSent, 'unixepoch', 'localtime')) AS hour,
      COUNT(*) AS count
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE $${outgoingPredicate} $${mailScopePredicate}
    GROUP BY f.accountID, weekday, hour
    `)) as any[];

  const responderPeaks = new Map<
    number,
    { weekday: number; hour: number; count: number }
  >();
  for (const row of responderActivityRows) {
    const accountId = rowNumber(row, "accountId");
    const candidate = {
      weekday: sqliteWeekday(rowNumber(row, "weekday")),
      hour: clamp(rowNumber(row, "hour"), 0, 23),
      count: rowNumber(row, "count"),
    };
    const existing = responderPeaks.get(accountId);
    if (
      !existing ||
      candidate.count > existing.count ||
      (candidate.count == existing.count &&
        (candidate.weekday < existing.weekday ||
          (candidate.weekday == existing.weekday &&
            candidate.hour < existing.hour)))
    ) {
      responderPeaks.set(accountId, candidate);
    }
  }

  const accounts = accountRows.map((row) => {
    const accountId = rowNumber(row, "accountId");
    return {
      accountId,
      accountName: findAccountName(
        appGlobal.emailAccounts,
        accountId,
        "Почтовый аккаунт",
      ),
      total: rowNumber(row, "total"),
      incoming: rowNumber(row, "incoming"),
      outgoing: rowNumber(row, "outgoing"),
      answered: rowNumber(row, "answered"),
      totalBytes: rowNumber(row, "totalBytes"),
      lastActivity: unixDate(row.lastActivity),
    };
  });

  return {
    summary: {
      total: rowNumber(summaryRow, "total"),
      incoming: rowNumber(summaryRow, "incoming"),
      outgoing: rowNumber(summaryRow, "outgoing"),
      answered: rowNumber(summaryRow, "answered"),
      withAttachments: rowNumber(summaryRow, "withAttachments"),
      totalBytes: rowNumber(summaryRow, "totalBytes"),
      responseTime,
    },
    responseTargetMinutes,
    responseTimes,
    responseTimeDays,
    accounts,
    responders: accounts
      .map((account) => {
        const peak = responderPeaks.get(account.accountId);
        const accountResponseTime = buildResponseTimeStats(
          responseTimeByAccount.get(account.accountId) ?? [],
          responseTargetMinutes,
        );
        return {
          accountId: account.accountId,
          accountName: account.accountName,
          email: findAccountEmail(appGlobal.emailAccounts, account.accountId),
          requests: account.incoming,
          answered: account.answered,
          sent: account.outgoing,
          lastActivity: account.lastActivity,
          peakWeekday: peak?.weekday ?? null,
          peakHour: peak?.hour ?? null,
          responseTime: accountResponseTime,
        };
      })
      .sort(
        (a, b) =>
          b.answered - a.answered ||
          b.sent - a.sent ||
          a.accountName.localeCompare(b.accountName),
      ),
    folders: folderRows.map((row) => {
      const accountId = rowNumber(row, "accountId");
      return {
        accountId,
        accountName: findAccountName(
          appGlobal.emailAccounts,
          accountId,
          "Почтовый аккаунт",
        ),
        folderName: rowText(row, "folderName", "Папка"),
        folderPath: rowText(row, "folderPath", ""),
        total: rowNumber(row, "total"),
        incoming: rowNumber(row, "incoming"),
        outgoing: rowNumber(row, "outgoing"),
      };
    }),
    correspondents: correspondentRows.map((row) => ({
      email: rowText(row, "email", ""),
      name: rowText(row, "name", ""),
      total: rowNumber(row, "total"),
      incoming: rowNumber(row, "incoming"),
      outgoing: rowNumber(row, "outgoing"),
      answered: rowNumber(row, "answered"),
      lastActivity: unixDate(row.lastActivity),
    })),
    topics: mergeReportTopics(
      rawTopicRows.map((row) => ({
        subject: rowText(row, "subject", ""),
        requests: rowNumber(row, "requests"),
        answered: rowNumber(row, "answered"),
        lastActivity: unixDate(row.lastActivity),
      })),
    ),
    categories: categoryRows.map((row) => ({
      name: rowText(row, "name", "Категория"),
      total: rowNumber(row, "total"),
      incoming: rowNumber(row, "incoming"),
      outgoing: rowNumber(row, "outgoing"),
      answered: rowNumber(row, "answered"),
      lastActivity: unixDate(row.lastActivity),
      peakWeekday:
        categoryPeaks.get(rowText(row, "name", "Категория"))?.weekday ?? null,
      peakHour:
        categoryPeaks.get(rowText(row, "name", "Категория"))?.hour ?? null,
      responseTime: buildResponseTimeStats(
        categoryResponseTimes.get(rowText(row, "name", "Категория")) ?? [],
        responseTargetMinutes,
      ),
    })),
    daily: dailyRows.map((row) => ({
      day: rowText(row, "day", ""),
      incoming: rowNumber(row, "incoming"),
      outgoing: rowNumber(row, "outgoing"),
    })),
    activity: activityRows.map((row) => ({
      weekday: sqliteWeekday(rowNumber(row, "weekday")),
      hour: clamp(rowNumber(row, "hour"), 0, 23),
      count: rowNumber(row, "count"),
    })),
  };
}

async function loadCalendarReport(
  bounds: ReportBounds,
): Promise<CalendarReport> {
  const calendars = appGlobal.calendars.contents.slice();
  await Promise.all(calendars.map((calendar) => calendar.readFromDB()));

  const calendarRows = new Map<string, CalendarRow>();
  const participantRows = new Map<string, CalendarParticipantRow>();
  const daily = new Map<string, number>();
  const activity = new Map<string, number>();
  let eventsCount = 0;
  let hours = 0;
  let onlineMeetings = 0;
  let participants = 0;

  for (const calendar of calendars) {
    const calendarKey = String(calendar.dbID ?? calendar.id);
    const row: CalendarRow = {
      calendarId: calendar.dbID ?? calendar.id,
      calendarName: calendar.name || "Календарь",
      events: 0,
      hours: 0,
      onlineMeetings: 0,
      participants: 0,
    };
    for (const event of calendar.eventsWithRecurrences) {
      if (!event.startTime || !isFinite(event.startTime.getTime())) {
        continue;
      }
      const start = event.startTime;
      const end =
        event.endTime && isFinite(event.endTime.getTime())
          ? event.endTime
          : start;
      if (!(start < bounds.endExclusive && end > bounds.start)) {
        continue;
      }

      const interval = clipReportEventInterval(
        start,
        end,
        bounds.start,
        bounds.endExclusive,
      );
      const isInstantEvent = end.getTime() == start.getTime();
      if (
        !interval &&
        (!isInstantEvent || start < bounds.start || start >= bounds.endExclusive)
      ) {
        continue;
      }
      const durationHours =
        interval == null
          ? 0
          : (interval.end.getTime() - interval.start.getTime()) / 3_600_000;
      row.events++;
      row.hours += durationHours;
      row.onlineMeetings += event.isOnline || !!event.onlineMeetingURL ? 1 : 0;
      row.participants += event.participants.length;
      eventsCount++;
      hours += durationHours;
      onlineMeetings += event.isOnline || !!event.onlineMeetingURL ? 1 : 0;
      participants += event.participants.length;

      const intervalStart = interval?.start ?? start;
      const day = dateInputValue(intervalStart);
      daily.set(day, (daily.get(day) ?? 0) + 1);
      const cellKey = `${localWeekday(intervalStart)}:${intervalStart.getHours()}`;
      activity.set(cellKey, (activity.get(cellKey) ?? 0) + 1);

      for (const participant of event.participants) {
        const email = (participant.emailAddress ?? "").trim();
        if (!email) {
          continue;
        }
        const key = email.toLocaleLowerCase();
        const participantRow = participantRows.get(key);
        if (participantRow) {
          participantRow.events++;
        } else {
          participantRows.set(key, {
            email,
            name: participant.name || email,
            events: 1,
          });
        }
      }
    }
    if (row.events) {
      calendarRows.set(calendarKey, row);
    }
  }

  return {
    summary: {
      events: eventsCount,
      hours,
      onlineMeetings,
      participants,
    },
    calendars: [...calendarRows.values()].sort((a, b) => b.events - a.events),
    participants: [...participantRows.values()]
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name))
      .slice(0, 100),
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, events]) => ({ day, events })),
    activity: [...activity.entries()].map(([key, count]) => {
      const [weekday, hour] = key.split(":").map(Number);
      return { weekday, hour, count };
    }),
  };
}

async function loadChatReport(bounds: ReportBounds): Promise<ChatReport> {
  const db = await getChatDatabase();
  const activityPredicate = sql`
    (
      (m.outgoing = 1 AND m.dateSent >= ${bounds.startSeconds} AND m.dateSent < ${bounds.endSeconds}) OR
      (m.outgoing = 0 AND m.dateReceived >= ${bounds.startSeconds} AND m.dateReceived < ${bounds.endSeconds})
    )`;
  const outgoingPredicate = sql`
    m.outgoing = 1 AND m.dateSent >= ${bounds.startSeconds} AND m.dateSent < ${bounds.endSeconds}`;

  const summaryRow = (await db.get(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN m.outgoing = 0 THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN m.outgoing = 1 THEN 1 ELSE 0 END) AS outgoing
    FROM message m
    WHERE $${activityPredicate}
    `)) as any;
  const roomRows = (await db.all(sql`
    SELECT
      m.chatID AS roomId,
      r.name AS roomName,
      r.accountID AS accountId,
      COUNT(*) AS total,
      SUM(CASE WHEN m.outgoing = 0 THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN m.outgoing = 1 THEN 1 ELSE 0 END) AS outgoing,
      MAX(CASE WHEN m.outgoing = 1 THEN m.dateSent ELSE m.dateReceived END) AS lastActivity
    FROM message m
    JOIN chatRoom r ON r.id = m.chatID
    WHERE $${activityPredicate}
    GROUP BY m.chatID, r.name, r.accountID
    ORDER BY total DESC
    LIMIT 100
    `)) as any[];
  const dailyRows = (await db.all(sql`
    SELECT
      strftime('%Y-%m-%d', datetime(
        CASE WHEN m.outgoing = 1 THEN m.dateSent ELSE m.dateReceived END,
        'unixepoch', 'localtime'
      )) AS day,
      SUM(CASE WHEN m.outgoing = 0 THEN 1 ELSE 0 END) AS incoming,
      SUM(CASE WHEN m.outgoing = 1 THEN 1 ELSE 0 END) AS outgoing
    FROM message m
    WHERE $${activityPredicate}
    GROUP BY day
    ORDER BY day
    `)) as any[];
  const activityRows = (await db.all(sql`
    SELECT
      strftime('%w', datetime(m.dateSent, 'unixepoch', 'localtime')) AS weekday,
      strftime('%H', datetime(m.dateSent, 'unixepoch', 'localtime')) AS hour,
      COUNT(*) AS count
    FROM message m
    WHERE $${outgoingPredicate}
    GROUP BY weekday, hour
    `)) as any[];

  return {
    summary: {
      total: rowNumber(summaryRow, "total"),
      incoming: rowNumber(summaryRow, "incoming"),
      outgoing: rowNumber(summaryRow, "outgoing"),
    },
    rooms: roomRows.map((row) => {
      const accountId = rowNumber(row, "accountId");
      return {
        roomId: rowNumber(row, "roomId"),
        roomName: rowText(row, "roomName", "Chat room"),
        accountId,
        accountName: findAccountName(
          appGlobal.chatAccounts,
          accountId,
          "Chat account",
        ),
        total: rowNumber(row, "total"),
        incoming: rowNumber(row, "incoming"),
        outgoing: rowNumber(row, "outgoing"),
        lastActivity: unixDate(row.lastActivity),
      };
    }),
    daily: dailyRows.map((row) => ({
      day: rowText(row, "day", ""),
      incoming: rowNumber(row, "incoming"),
      outgoing: rowNumber(row, "outgoing"),
    })),
    activity: activityRows.map((row) => ({
      weekday: sqliteWeekday(rowNumber(row, "weekday")),
      hour: clamp(rowNumber(row, "hour"), 0, 23),
      count: rowNumber(row, "count"),
    })),
  };
}

async function loadFilesReport(bounds: ReportBounds): Promise<FilesReport> {
  const db = await getFilesDatabase();
  const activityPredicate = sql`
    f.lastMod >= ${bounds.startSeconds} AND f.lastMod < ${bounds.endSeconds}`;

  const summaryRow = (await db.get(sql`
    SELECT
      COUNT(*) AS changed,
      COALESCE(SUM(f.size), 0) AS bytes,
      COUNT(DISTINCT f.directoryID) AS directories
    FROM file f
    WHERE $${activityPredicate}
    `)) as any;
  const directoryRows = (await db.all(sql`
    SELECT
      d.accountID AS accountId,
      d.name AS directoryName,
      d.path AS directoryPath,
      COUNT(*) AS files,
      COALESCE(SUM(f.size), 0) AS bytes
    FROM file f
    JOIN directory d ON d.id = f.directoryID
    WHERE $${activityPredicate}
    GROUP BY d.accountID, d.name, d.path
    ORDER BY files DESC
    LIMIT 100
    `)) as any[];
  const dailyRows = (await db.all(sql`
    SELECT
      strftime('%Y-%m-%d', datetime(f.lastMod, 'unixepoch', 'localtime')) AS day,
      COUNT(*) AS files
    FROM file f
    WHERE $${activityPredicate}
    GROUP BY day
    ORDER BY day
    `)) as any[];
  const activityRows = (await db.all(sql`
    SELECT
      strftime('%w', datetime(f.lastMod, 'unixepoch', 'localtime')) AS weekday,
      strftime('%H', datetime(f.lastMod, 'unixepoch', 'localtime')) AS hour,
      COUNT(*) AS count
    FROM file f
    WHERE $${activityPredicate}
    GROUP BY weekday, hour
    `)) as any[];

  return {
    summary: {
      changed: rowNumber(summaryRow, "changed"),
      bytes: rowNumber(summaryRow, "bytes"),
      directories: rowNumber(summaryRow, "directories"),
    },
    directories: directoryRows.map((row) => {
      const accountId = rowNumber(row, "accountId");
      return {
        accountId,
        accountName: findAccountName(
          appGlobal.fileSharingAccounts,
          accountId,
          "Files account",
        ),
        directoryName: rowText(row, "directoryName", "Directory"),
        directoryPath: rowText(row, "directoryPath", ""),
        files: rowNumber(row, "files"),
        bytes: rowNumber(row, "bytes"),
      };
    }),
    daily: dailyRows.map((row) => ({
      day: rowText(row, "day", ""),
      files: rowNumber(row, "files"),
    })),
    activity: activityRows.map((row) => ({
      weekday: sqliteWeekday(rowNumber(row, "weekday")),
      hour: clamp(rowNumber(row, "hour"), 0, 23),
      count: rowNumber(row, "count"),
    })),
  };
}

function makeReportBounds(range: ReportDateRange): ReportBounds {
  const validation = validateReportDateRange(range);
  if (validation) {
    throw new Error(
      validation == "reversed"
        ? "Период отчёта задан в обратном порядке"
        : "Даты отчёта некорректны",
    );
  }
  const start = parseDateInput(range.from)!;
  const end = parseDateInput(range.to)!;
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return {
    start,
    endExclusive,
    startSeconds: Math.floor(start.getTime() / 1000),
    endSeconds: Math.floor(endExclusive.getTime() / 1000),
  };
}

function timelineGranularity(bounds: ReportBounds): TimelineGranularity {
  const days = Math.ceil(
    (bounds.endExclusive.getTime() - bounds.start.getTime()) / 86_400_000,
  );
  if (days <= 45) {
    return "day";
  }
  if (days <= 370) {
    return "week";
  }
  return "month";
}

function buildReportTimeline(
  bounds: ReportBounds,
  granularity: TimelineGranularity,
  mailDays: ActivityDay[],
  calendarDays: ActivityDay[],
  chatDays: ActivityDay[],
  fileDays: ActivityDay[],
): ReportTimelinePoint[] {
  const points = new Map<string, ReportTimelinePoint>();
  let cursor = bucketStart(bounds.start, granularity);
  while (cursor < bounds.endExclusive) {
    const start = dateInputValue(cursor);
    points.set(start, {
      key: start,
      start,
      mailIncoming: 0,
      mailOutgoing: 0,
      chatIncoming: 0,
      chatOutgoing: 0,
      calendarEvents: 0,
      filesChanged: 0,
      total: 0,
    });
    cursor = nextBucket(cursor, granularity);
  }

  for (const row of mailDays) {
    const point = pointForDay(points, row.day, granularity);
    if (point) {
      point.mailIncoming += row.incoming ?? 0;
      point.mailOutgoing += row.outgoing ?? 0;
    }
  }
  for (const row of chatDays) {
    const point = pointForDay(points, row.day, granularity);
    if (point) {
      point.chatIncoming += row.incoming ?? 0;
      point.chatOutgoing += row.outgoing ?? 0;
    }
  }
  for (const row of calendarDays) {
    const point = pointForDay(points, row.day, granularity);
    if (point) {
      point.calendarEvents += row.events ?? 0;
    }
  }
  for (const row of fileDays) {
    const point = pointForDay(points, row.day, granularity);
    if (point) {
      point.filesChanged += row.files ?? 0;
    }
  }

  return [...points.values()].map((point) => ({
    ...point,
    total:
      point.mailIncoming +
      point.mailOutgoing +
      point.chatIncoming +
      point.chatOutgoing +
      point.calendarEvents +
      point.filesChanged,
  }));
}

function pointForDay(
  points: Map<string, ReportTimelinePoint>,
  day: string,
  granularity: TimelineGranularity,
): ReportTimelinePoint | null {
  const date = parseDateInput(day);
  if (!date) {
    return null;
  }
  return points.get(dateInputValue(bucketStart(date, granularity))) ?? null;
}

function mergeActivityCells(...groups: ActivityCell[][]): ActivityCell[] {
  const cells = new Map<string, ActivityCell>();
  for (const group of groups) {
    for (const cell of group) {
      const weekday = clamp(cell.weekday, 0, 6);
      const hour = clamp(cell.hour, 0, 23);
      const key = `${weekday}:${hour}`;
      const existing = cells.get(key);
      if (existing) {
        existing.count += cell.count;
      } else {
        cells.set(key, { weekday, hour, count: cell.count });
      }
    }
  }
  return [...cells.values()].sort(
    (a, b) => a.weekday - b.weekday || a.hour - b.hour,
  );
}

function peakActivity(
  cells: ActivityCell[],
  field: "weekday" | "hour",
): number | null {
  if (!cells.length) {
    return null;
  }
  const totals = new Map<number, number>();
  for (const cell of cells) {
    const value = cell[field];
    totals.set(value, (totals.get(value) ?? 0) + cell.count);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function bucketStart(date: Date, granularity: TimelineGranularity): Date {
  const result = startOfLocalDay(date);
  if (granularity == "week") {
    result.setDate(result.getDate() - localWeekday(result));
  } else if (granularity == "month") {
    result.setDate(1);
  }
  return result;
}

function nextBucket(date: Date, granularity: TimelineGranularity): Date {
  const result = new Date(date);
  if (granularity == "day") {
    result.setDate(result.getDate() + 1);
  } else if (granularity == "week") {
    result.setDate(result.getDate() + 7);
  } else {
    result.setMonth(result.getMonth() + 1, 1);
  }
  return result;
}

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function parseDateInput(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const result = new Date(0);
  result.setHours(0, 0, 0, 0);
  result.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    result.getFullYear() != Number(match[1]) ||
    result.getMonth() != Number(match[2]) - 1 ||
    result.getDate() != Number(match[3])
  ) {
    return null;
  }
  return result;
}

function dateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function sqliteWeekday(day: number): number {
  return (day + 6) % 7;
}

function unixDate(value: unknown): Date | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000);
}

/**
 * Некоторые серверы сохраняют только флаг ответа и время последнего действия
 * в локальном JSON письма, без локальной копии отправленного сообщения.
 */
function providerResponseDate(row: any): Date | null {
  if (rowNumber(row, "isReplied") != 1) {
    return null;
  }
  const metadata = row?.metadata;
  let lastVerbAt: unknown;
  if (typeof metadata == "string") {
    try {
      lastVerbAt = JSON.parse(metadata)?.lastVerbAt;
    } catch {
      return null;
    }
  } else if (metadata && typeof metadata == "object") {
    lastVerbAt = (metadata as Record<string, unknown>).lastVerbAt;
  }
  const milliseconds = Number(lastVerbAt);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }
  const responseAt = new Date(milliseconds);
  return Number.isFinite(responseAt.getTime()) ? responseAt : null;
}

/**
 * Считает рабочую длительность для SLA или возвращает null, если оценка
 * недостоверна. Когда запрос и ответ оба вне рабочего графика, сотрудник
 * всё равно получает засчитанный ответ и отметку о работе вне графика, но
 * SLA не сравнивается с фактическим календарным временем.
 */
function responseSlaDurationSeconds(
  requestAt: Date,
  responseAt: Date,
  requestIsWithinWorkingHours: boolean,
  responseIsOutsideWorkingHours: boolean,
  workingHours: WorkingHoursSchedule,
): number | null {
  if (!requestIsWithinWorkingHours && responseIsOutsideWorkingHours) {
    return null;
  }
  return workingSecondsBetween(requestAt, responseAt, workingHours);
}

function normalizeMailAccountId(
  value: number | null | undefined,
): number | null {
  return typeof value == "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeMailFolderId(
  value: number | null | undefined,
  accountId: number | null,
): number | null {
  return accountId != null &&
    typeof value == "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null;
}

function findReportMailAccount(accountId: number): ReportMailAccountOption {
  return {
    accountId,
    accountName: findAccountName(
      appGlobal.emailAccounts,
      accountId,
      "Почтовый аккаунт",
    ),
    email: findAccountEmail(appGlobal.emailAccounts, accountId),
  };
}

function rowNumber(row: any, key: string): number {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function rowText(row: any, key: string, fallback: string): string {
  const value = row?.[key];
  return typeof value == "string" && value.trim() ? value.trim() : fallback;
}

function findAccountName(
  accounts: Iterable<any>,
  id: number,
  fallback: string,
): string {
  for (const account of accounts) {
    if (Number(account.dbID) == id && account.name) {
      return account.name;
    }
  }
  return fallback;
}

function findAccountEmail(accounts: Iterable<any>, id: number): string {
  for (const account of accounts) {
    if (Number(account.dbID) != id) {
      continue;
    }
    return (
      account.emailAddress || account.identities?.first?.emailAddress || ""
    );
  }
  return "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
