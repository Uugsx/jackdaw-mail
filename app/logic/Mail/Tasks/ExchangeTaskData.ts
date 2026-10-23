import sql, { type Database, type Query } from "../../../../lib/rs-sqlite";
import { runBatch } from "../../../../lib/rs-sqlite/batch";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";
import {
  sanitizeDay, sanitizeTaskImportance, sanitizeTaskStatus,
  type DayString, type ExchangeTask,
} from "./ExchangeTask";

/** Помеченных писем в списке задач не больше: дальше — папка «С флажком» */
export const kMaxFlaggedEMails = 500;

/** Письмо с флажком в списке задач */
export interface FlaggedEMailRow {
  emailId: number;
  folderId: number;
  accountId: number;
  subject: string;
  contactName: string | null;
  contactEmail: string | null;
  received: Date;
  startDay: DayString | null;
  dueDay: DayString | null;
}

export async function loadExchangeTasks(accountId: number, database?: Database): Promise<ExchangeTask[]> {
  let db = database ?? await getMailDatabase();
  let rows = await db.all(sql`
    SELECT itemID, changeKey, subject, notes, startDay, dueDay, completedAt, importance, status, lastModified
    FROM exchangeTask
    WHERE accountID = ${accountId}
  `) as any[];
  return rows.map(rowToTask);
}

/** Заменяет задачи ящика тем, что прислал сервер */
export async function replaceExchangeTasks(accountId: number, tasks: ExchangeTask[], database?: Database): Promise<void> {
  let db = database ?? await getMailDatabase();
  // Одной транзакцией: при сбое остаётся прежний список
  await runBatch(db, [
    { query: sql`DELETE FROM exchangeTask WHERE accountID = ${accountId}` },
    ...tasks.map(task => ({ query: insertTaskQuery(accountId, task) })),
  ]);
}

export async function saveExchangeTask(accountId: number, task: ExchangeTask, database?: Database): Promise<void> {
  let db = database ?? await getMailDatabase();
  await db.run(insertTaskQuery(accountId, task));
}

export async function deleteExchangeTaskLocally(accountId: number, itemID: string, database?: Database): Promise<void> {
  let db = database ?? await getMailDatabase();
  await db.run(sql`DELETE FROM exchangeTask WHERE accountID = ${accountId} AND itemID = ${itemID}`);
}

function insertTaskQuery(accountId: number, task: ExchangeTask): Query {
  return sql`
    INSERT INTO exchangeTask (
      accountID, itemID, changeKey, subject, notes, startDay, dueDay,
      completedAt, importance, status, lastModified
    ) VALUES (
      ${accountId}, ${task.itemID}, ${task.changeKey}, ${task.subject ?? ""}, ${task.notes ?? ""},
      ${task.startDay}, ${task.dueDay}, ${toSeconds(task.completedAt)},
      ${task.importance}, ${task.status}, ${toSeconds(task.lastModified)}
    )
    ON CONFLICT (accountID, itemID) DO UPDATE SET
      changeKey = excluded.changeKey,
      subject = excluded.subject,
      notes = excluded.notes,
      startDay = excluded.startDay,
      dueDay = excluded.dueDay,
      completedAt = excluded.completedAt,
      importance = excluded.importance,
      status = excluded.status,
      lastModified = excluded.lastModified
  `;
}

function rowToTask(row: any): ExchangeTask {
  return {
    itemID: String(row.itemID),
    changeKey: row.changeKey == null ? null : String(row.changeKey),
    subject: String(row.subject ?? ""),
    notes: String(row.notes ?? ""),
    startDay: sanitizeDay(row.startDay),
    dueDay: sanitizeDay(row.dueDay),
    completedAt: fromSeconds(row.completedAt),
    importance: sanitizeTaskImportance(row.importance),
    status: sanitizeTaskStatus(row.status),
    lastModified: fromSeconds(row.lastModified),
  };
}

/**
 * Письма с флажком во всех ящиках (не в корзине и не в спаме).
 * Срок флажка — в JSON письма, ключ `flag` (см. JSONEMail).
 */
export async function loadFlaggedEMails(database?: Database): Promise<FlaggedEMailRow[]> {
  let db = database ?? await getMailDatabase();
  let rows = await db.all(sql`
    SELECT email.id AS emailId, email.folderID AS folderId, folder.accountID AS accountId,
      email.subject, email.contactName, email.contactEmail, email.dateReceived, email.json
    FROM email
      JOIN folder ON (email.folderID = folder.id)
    WHERE email.isStarred = 1
      AND COALESCE(folder.specialUse, '') NOT IN ('trash', 'junk', 'spam')
    ORDER BY email.dateReceived DESC
    LIMIT ${kMaxFlaggedEMails}
  `) as any[];
  return rows.map(row => {
    let flag = parseJSON(row.json)?.flag ?? {};
    return {
      emailId: Number(row.emailId),
      folderId: Number(row.folderId),
      accountId: Number(row.accountId),
      subject: String(row.subject ?? ""),
      contactName: row.contactName == null ? null : String(row.contactName),
      contactEmail: row.contactEmail == null ? null : String(row.contactEmail),
      received: new Date(Number(row.dateReceived) * 1000),
      startDay: sanitizeDay(flag.startDay),
      dueDay: sanitizeDay(flag.dueDay),
    };
  });
}

function parseJSON(text: unknown): any {
  if (typeof text != "string" || !text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toSeconds(date: Date | null): number | null {
  return date ? Math.floor(date.getTime() / 1000) : null;
}

function fromSeconds(value: unknown): Date | null {
  if (value == null || !Number.isFinite(Number(value))) {
    return null;
  }
  return new Date(Number(value) * 1000);
}
