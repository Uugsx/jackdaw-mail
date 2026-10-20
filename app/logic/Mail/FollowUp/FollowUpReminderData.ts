import sql, { type Database } from "../../../../lib/rs-sqlite";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";
import {
  FOLLOW_UP_CLOCK_SKEW_SECONDS,
  findFollowUpReply,
  normalizeFollowUpAddresses,
  normalizeReplySubject,
  type FollowUpReminder,
  type FollowUpReplyCandidate,
  type FollowUpScheduleMode,
  type FollowUpStatus,
} from "./FollowUpReminder";

export const MAX_ACTIVE_FOLLOW_UP_REMINDERS = 1_000;
const MAX_REPLY_CANDIDATES = 500;
/** Окно поиска отправленной копии по теме, если сервер заменил Message-ID. */
const SENT_COPY_MATCH_WINDOW_SECONDS = 15 * 60;
/** Сколько искать отправленную копию по теме: дольше синхронизация не опаздывает. */
const SENT_COPY_MATCH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Снятые и отвеченные напоминания хранятся для истории, потом удаляются. */
const FINISHED_REMINDER_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const outgoingFolderKinds = ["sent", "drafts", "outbox"];
const ignoredReplyFolderKinds = ["junk", "spam"];

export interface FollowUpReminderInput {
  accountId: number;
  messageID: string;
  threadID?: string | null;
  emailId?: number | null;
  subject: string;
  recipients: readonly string[];
  sentAt: Date;
  dueAt: Date;
  scheduleMode: FollowUpScheduleMode;
  durationDays?: number | null;
}

export interface FollowUpCheckResult {
  /** Напоминания, которые всё ещё ждут ответа (в том числе просроченные). */
  waiting: FollowUpReminder[];
  /** Напоминания, которые сняты в этой проверке, потому что пришёл ответ. */
  replied: FollowUpReminder[];
}

/** Создаёт напоминание или заново включает уже существующее для этого письма. */
export async function saveFollowUpReminder(
  input: FollowUpReminderInput,
  now = new Date(),
  database?: Database,
): Promise<FollowUpReminder> {
  const db = database ?? (await getMailDatabase());
  const accountId = Number(input.accountId);
  const messageID = input.messageID?.trim();
  if (!Number.isInteger(accountId) || accountId <= 0 || !messageID) {
    throw new Error("Follow-up reminder needs an account and a Message-ID");
  }
  const recipients = JSON.stringify(normalizeFollowUpAddresses(input.recipients));
  await db.run(sql`
    INSERT INTO followUpReminder (
      accountID, messageID, threadID, emailID, subject, recipients,
      sentAt, dueAt, scheduleMode, durationDays, status, createdAt
    ) VALUES (
      ${accountId}, ${messageID}, ${input.threadID || null}, ${input.emailId ?? null},
      ${input.subject ?? ""}, ${recipients},
      ${toSeconds(input.sentAt)}, ${toSeconds(input.dueAt)},
      ${input.scheduleMode}, ${input.durationDays ?? null}, 'waiting', ${toSeconds(now)}
    )
    ON CONFLICT (accountID, messageID) DO UPDATE SET
      threadID = COALESCE(excluded.threadID, threadID),
      emailID = COALESCE(excluded.emailID, emailID),
      subject = excluded.subject,
      recipients = excluded.recipients,
      sentAt = excluded.sentAt,
      dueAt = excluded.dueAt,
      scheduleMode = excluded.scheduleMode,
      durationDays = excluded.durationDays,
      status = 'waiting',
      notifiedAt = NULL,
      repliedAt = NULL,
      replyEmailID = NULL
  `);
  const row = await db.get<Record<string, unknown>>(sql`
    $${selectReminders()}
    WHERE r.accountID = ${accountId} AND r.messageID = ${messageID}
  `);
  const reminder = row ? reminderFromRow(row) : null;
  if (!reminder) {
    throw new Error("Follow-up reminder was not saved");
  }
  return reminder;
}

/** Ждущие ответа напоминания всех ящиков, по сроку. */
export async function loadWaitingFollowUpReminders(
  database?: Database,
): Promise<FollowUpReminder[]> {
  const db = database ?? (await getMailDatabase());
  const rows = await db.all<Record<string, unknown>>(sql`
    $${selectReminders()}
    WHERE r.status = 'waiting'
    ORDER BY r.dueAt ASC, r.id ASC
    LIMIT ${MAX_ACTIVE_FOLLOW_UP_REMINDERS}
  `);
  return rows
    .map(reminderFromRow)
    .filter((reminder): reminder is FollowUpReminder => reminder != null);
}

export async function loadFollowUpReminder(
  id: number,
  database?: Database,
): Promise<FollowUpReminder | null> {
  const db = database ?? (await getMailDatabase());
  const row = await db.get<Record<string, unknown>>(sql`
    $${selectReminders()}
    WHERE r.id = ${id}
  `);
  return row ? reminderFromRow(row) : null;
}

export async function cancelFollowUpReminder(
  id: number,
  database?: Database,
): Promise<void> {
  const db = database ?? (await getMailDatabase());
  await db.run(sql`
    UPDATE followUpReminder SET status = 'cancelled'
    WHERE id = ${id} AND status = 'waiting'
  `);
}

/** Переносит срок. Уведомление по новому сроку покажется снова один раз. */
export async function snoozeFollowUpReminder(
  id: number,
  dueAt: Date,
  database?: Database,
): Promise<void> {
  const db = database ?? (await getMailDatabase());
  await db.run(sql`
    UPDATE followUpReminder SET dueAt = ${toSeconds(dueAt)}, notifiedAt = NULL
    WHERE id = ${id} AND status = 'waiting'
  `);
}

export async function markFollowUpNotified(
  id: number,
  now = new Date(),
  database?: Database,
): Promise<void> {
  const db = database ?? (await getMailDatabase());
  await db.run(sql`
    UPDATE followUpReminder SET notifiedAt = ${toSeconds(now)}
    WHERE id = ${id} AND status = 'waiting'
  `);
}

/**
 * Проверяет все ждущие напоминания: находит отправленную копию, если она
 * ещё не найдена, и снимает напоминание, если в цепочку пришёл ответ.
 */
export async function checkFollowUpReminders(
  ownAddresses: readonly string[],
  now = new Date(),
  database?: Database,
): Promise<FollowUpCheckResult> {
  const db = database ?? (await getMailDatabase());
  await deleteFinishedFollowUpReminders(now, db);
  const reminders = await loadWaitingFollowUpReminders(db);
  const result: FollowUpCheckResult = { waiting: [], replied: [] };
  if (!reminders.length) {
    return result;
  }
  const personIDsByAddress = await loadPersonIDsByAddress(
    reminders.flatMap(reminder => reminder.recipients), db);
  for (let reminder of reminders) {
    if (reminder.emailId == null) {
      reminder = await resolveFollowUpSentCopy(reminder, now, db) ?? reminder;
    }
    const personIDs = reminder.recipients
      .flatMap(address => personIDsByAddress.get(address) ?? []);
    const candidates = await loadFollowUpReplyCandidates(reminder, personIDs, db);
    const reply = findFollowUpReply(reminder, candidates, ownAddresses);
    if (reply) {
      await db.run(sql`
        UPDATE followUpReminder SET
          status = 'replied',
          repliedAt = ${toSeconds(reply.receivedAt)},
          replyEmailID = ${reply.emailId}
        WHERE id = ${reminder.id} AND status = 'waiting'
      `);
      result.replied.push({
        ...reminder,
        status: "replied",
        repliedAt: reply.receivedAt,
      });
    } else {
      result.waiting.push(reminder);
    }
  }
  return result;
}

/**
 * Находит отправленную копию письма. Обычно по Message-ID; Exchange без
 * MIME-отправки назначает свой InternetMessageId, тогда — по теме, времени
 * и получателю в «Отправленных» и запоминает настоящий Message-ID.
 */
export async function resolveFollowUpSentCopy(
  reminder: FollowUpReminder,
  now = new Date(),
  database?: Database,
): Promise<FollowUpReminder | null> {
  const db = database ?? (await getMailDatabase());
  let row: Record<string, unknown> | null | undefined = await db.get<Record<string, unknown>>(sql`
    SELECT e.id AS emailID, e.messageID, e.threadID
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE e.messageID = ${reminder.messageID}
    ORDER BY
      (e.outgoing = 1 OR LOWER(COALESCE(f.specialUse, '')) IN ${outgoingFolderKinds}) DESC,
      e.id DESC
    LIMIT 1
  `);
  const sentAt = toSeconds(reminder.sentAt);
  if (!row && toSeconds(now) - sentAt <= SENT_COPY_MATCH_MAX_AGE_SECONDS && reminder.subject) {
    const rows = await db.all<Record<string, unknown>>(sql`
      SELECT e.id AS emailID, e.messageID, e.threadID, e.contactEmail
      FROM folder f
      JOIN email e ON e.folderID = f.id
      WHERE LOWER(COALESCE(f.specialUse, '')) = 'sent'
        AND e.dateSent BETWEEN ${sentAt - SENT_COPY_MATCH_WINDOW_SECONDS}
          AND ${sentAt + SENT_COPY_MATCH_WINDOW_SECONDS}
        AND e.subject = ${reminder.subject}
        AND e.messageID IS NOT NULL
        AND e.messageID NOT IN (
          SELECT other.messageID FROM followUpReminder other
          WHERE other.id != ${reminder.id}
        )
      ORDER BY ABS(e.dateSent - ${sentAt}) ASC, e.id DESC
      LIMIT 5
    `);
    const recipients = new Set(reminder.recipients);
    row = rows.find(candidate => recipients.has(
      normalizeFollowUpAddresses([candidate.contactEmail])[0] ?? "")) ?? null;
  }
  if (!row) {
    return null;
  }
  const emailId = numberValue(row.emailID);
  const messageID = textValue(row.messageID) || reminder.messageID;
  const threadID = textValue(row.threadID) || null;
  if (emailId == null) {
    return null;
  }
  await db.run(sql`
    UPDATE OR IGNORE followUpReminder SET
      emailID = ${emailId},
      messageID = ${messageID},
      threadID = COALESCE(${threadID}, threadID)
    WHERE id = ${reminder.id}
  `);
  return loadFollowUpReminder(reminder.id, db);
}

/**
 * Письма, которые могут быть ответом: по In-Reply-To, по цепочке и от
 * получателей после отправки. Поиск по parentMsgID и threadID идёт по
 * индексам `createReportReplyIndexes`, по отправителю — по индексу
 * emailPersonRel.emailPersonID.
 */
export async function loadFollowUpReplyCandidates(
  reminder: FollowUpReminder,
  recipientPersonIDs: readonly number[],
  database?: Database,
): Promise<FollowUpReplyCandidate[]> {
  const db = database ?? (await getMailDatabase());
  const threadIDs = [...new Set([reminder.threadID, reminder.messageID]
    .filter((id): id is string => !!id))];
  const sentAt = toSeconds(reminder.sentAt) - FOLLOW_UP_CLOCK_SKEW_SECONDS;
  const senderClause = recipientPersonIDs.length
    ? sql`
      UNION
      SELECT rel.emailID AS id
      FROM emailPersonRel rel
      WHERE rel.recipientType = 1
        AND rel.emailPersonID IN ${[...new Set(recipientPersonIDs)]}`
    : sql``;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT
      e.id AS emailId, e.messageID, e.parentMsgID, e.threadID,
      e.contactEmail, e.contactName, e.subject, e.dateReceived,
      e.outgoing, e.isDraft,
      LOWER(COALESCE(f.specialUse, '')) AS folderKind
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE e.id IN (
        SELECT id FROM email WHERE parentMsgID = ${reminder.messageID}
        UNION
        SELECT id FROM email WHERE threadID IN ${threadIDs}
        $${senderClause}
      )
      AND e.dateReceived >= ${sentAt}
      AND LOWER(COALESCE(f.specialUse, '')) NOT IN ${ignoredReplyFolderKinds}
    ORDER BY e.dateReceived ASC, e.id ASC
    LIMIT ${MAX_REPLY_CANDIDATES}
  `);
  const subject = normalizeReplySubject(reminder.subject);
  return rows
    .map((row): FollowUpReplyCandidate | null => {
      const emailId = numberValue(row.emailId);
      const receivedSeconds = numberValue(row.dateReceived);
      if (emailId == null || receivedSeconds == null) {
        return null;
      }
      return {
        emailId,
        messageID: textValue(row.messageID) || null,
        parentMsgID: textValue(row.parentMsgID) || null,
        threadID: textValue(row.threadID) || null,
        fromAddress: textValue(row.contactEmail) || null,
        fromName: textValue(row.contactName) || null,
        subject: textValue(row.subject) || null,
        receivedAt: new Date(receivedSeconds * 1000),
        outgoing: booleanValue(row.outgoing) ||
          outgoingFolderKinds.includes(textValue(row.folderKind)),
        isDraft: booleanValue(row.isDraft),
      };
    })
    .filter((candidate): candidate is FollowUpReplyCandidate => candidate != null &&
      // Письма от получателей на другие темы и вне цепочки не нужны в памяти.
      (candidate.parentMsgID == reminder.messageID ||
        (!!candidate.threadID && threadIDs.includes(candidate.threadID)) ||
        normalizeReplySubject(candidate.subject) == subject));
}

/** emailPerson.id по адресам. Адрес в базе хранится как в письме,
 * поэтому сравнение без учёта регистра, одним проходом на все напоминания. */
async function loadPersonIDsByAddress(
  addresses: readonly string[],
  db: Database,
): Promise<Map<string, number[]>> {
  const normalized = normalizeFollowUpAddressesUnlimited(addresses);
  const result = new Map<string, number[]>();
  if (!normalized.length) {
    return result;
  }
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, LOWER(TRIM(emailAddress)) AS address
    FROM emailPerson
    WHERE emailAddress IS NOT NULL
      AND LOWER(TRIM(emailAddress)) IN ${normalized}
  `);
  for (const row of rows) {
    const id = numberValue(row.id);
    const address = textValue(row.address);
    if (id == null || !address) {
      continue;
    }
    result.set(address, [...(result.get(address) ?? []), id]);
  }
  return result;
}

async function deleteFinishedFollowUpReminders(now: Date, db: Database): Promise<void> {
  const before = toSeconds(now) - FINISHED_REMINDER_RETENTION_SECONDS;
  await db.run(sql`
    DELETE FROM followUpReminder
    WHERE status != 'waiting'
      AND COALESCE(repliedAt, dueAt) < ${before}
  `);
}

function selectReminders() {
  return sql`
    SELECT
      r.id, r.accountID, r.messageID,
      -- Цепочка отправленной копии появляется после синхронизации
      COALESCE(r.threadID, e.threadID) AS threadID,
      r.subject, r.recipients,
      r.sentAt, r.dueAt, r.scheduleMode, r.durationDays, r.status,
      r.notifiedAt, r.repliedAt, r.createdAt,
      e.id AS sentEmailID, e.folderID AS sentFolderID,
      f.accountID AS sentFolderAccountID
    FROM followUpReminder r
    LEFT JOIN email e ON e.id = r.emailID AND e.messageID = r.messageID
    LEFT JOIN folder f ON f.id = e.folderID
  `;
}

function reminderFromRow(row: Record<string, unknown>): FollowUpReminder | null {
  const id = numberValue(row.id);
  const accountId = numberValue(row.accountID);
  const messageID = textValue(row.messageID);
  const sentAt = numberValue(row.sentAt);
  const dueAt = numberValue(row.dueAt);
  if (id == null || accountId == null || !messageID || sentAt == null || dueAt == null) {
    return null;
  }
  const scheduleMode = ["calendar", "working", "date"].includes(textValue(row.scheduleMode))
    ? textValue(row.scheduleMode) as FollowUpScheduleMode
    : "calendar";
  const status = ["waiting", "replied", "cancelled"].includes(textValue(row.status))
    ? textValue(row.status) as FollowUpStatus
    : "waiting";
  return {
    id,
    accountId,
    messageID,
    threadID: textValue(row.threadID) || null,
    emailId: numberValue(row.sentEmailID),
    folderId: numberValue(row.sentFolderID),
    folderAccountId: numberValue(row.sentFolderAccountID),
    subject: textValue(row.subject),
    recipients: parseRecipients(row.recipients),
    sentAt: new Date(sentAt * 1000),
    dueAt: new Date(dueAt * 1000),
    scheduleMode,
    durationDays: numberValue(row.durationDays),
    status,
    notifiedAt: dateValue(row.notifiedAt),
    repliedAt: dateValue(row.repliedAt),
    createdAt: dateValue(row.createdAt) ?? new Date(sentAt * 1000),
  };
}

function parseRecipients(value: unknown): string[] {
  try {
    const parsed = JSON.parse(textValue(value) || "[]");
    return Array.isArray(parsed) ? normalizeFollowUpAddresses(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeFollowUpAddressesUnlimited(addresses: readonly string[]): string[] {
  return [...new Set(addresses
    .filter((address): address is string => typeof address == "string")
    .map(address => address.trim().toLowerCase())
    .filter(address => address.includes("@")))];
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function numberValue(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function textValue(value: unknown): string {
  return typeof value == "string" ? value.trim() : "";
}

function booleanValue(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

function dateValue(value: unknown): Date | null {
  const seconds = numberValue(value);
  return seconds == null ? null : new Date(seconds * 1000);
}
