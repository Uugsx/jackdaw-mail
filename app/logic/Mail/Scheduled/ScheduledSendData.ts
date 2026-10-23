import sql, { type Database } from "../../../../lib/rs-sqlite";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";

/**
 * - local — письмо ждёт в очереди Jackdaw и уйдёт, когда приложение запущено;
 * - server — письмо уже в «Исходящих» Exchange, сервер отправит его сам;
 * - undo — короткое окно «Отменить отправку».
 */
export type ScheduledSendMode = "local" | "server" | "undo";
export type ScheduledSendStatus = "pending" | "sending" | "failed";

/** Запланированное письмо без тела (тело читается отдельно, только когда нужно) */
export interface ScheduledSendRow {
  id: number;
  accountID: number;
  scheduleID: string;
  mode: ScheduledSendMode;
  sendAt: Date;
  subject: string;
  recipients: string;
  status: ScheduledSendStatus;
  attempts: number;
  error: string | null;
  created: Date;
}

export interface ScheduledSendInput {
  accountID: number;
  scheduleID: string;
  mode: ScheduledSendMode;
  sendAt: Date;
  subject: string;
  recipients: string;
  payload: string;
}

/** Вверх: письмо не должно уйти раньше выбранного времени */
function toSeconds(date: Date): number {
  return Math.ceil(date.getTime() / 1000);
}

function sanitizeMode(value: unknown): ScheduledSendMode {
  return value == "server" || value == "undo" ? value as ScheduledSendMode : "local";
}

function sanitizeStatus(value: unknown): ScheduledSendStatus {
  return value == "sending" || value == "failed" ? value as ScheduledSendStatus : "pending";
}

function rowToScheduled(row: any): ScheduledSendRow {
  return {
    id: Number(row.id),
    accountID: Number(row.accountID),
    scheduleID: String(row.scheduleID),
    mode: sanitizeMode(row.mode),
    sendAt: new Date(Number(row.sendAt) * 1000),
    subject: typeof row.subject == "string" ? row.subject : "",
    recipients: typeof row.recipients == "string" ? row.recipients : "",
    status: sanitizeStatus(row.status),
    attempts: Number(row.attempts) || 0,
    error: typeof row.error == "string" ? row.error : null,
    created: new Date(Number(row.created) * 1000),
  };
}

/** Все запланированные письма по времени отправки */
export async function loadScheduledSends(database?: Database): Promise<ScheduledSendRow[]> {
  let db = database ?? await getMailDatabase();
  let rows = await db.all(sql`
    SELECT id, accountID, scheduleID, mode, sendAt, subject, recipients, status, attempts, error, created
    FROM scheduledSend
    ORDER BY sendAt, id
  `) as any[];
  return rows.map(rowToScheduled);
}

export async function loadScheduledPayload(id: number, database?: Database): Promise<string | null> {
  let db = database ?? await getMailDatabase();
  let row = await db.get(sql`SELECT payload FROM scheduledSend WHERE id = ${id}`) as any;
  return typeof row?.payload == "string" ? row.payload : null;
}

/** @returns id новой строки */
export async function insertScheduledSend(input: ScheduledSendInput, database?: Database): Promise<number> {
  let db = database ?? await getMailDatabase();
  let result = await db.run(sql`
    INSERT INTO scheduledSend (
      accountID, scheduleID, mode, sendAt, subject, recipients, status, attempts, payload, created
    ) VALUES (
      ${input.accountID}, ${input.scheduleID}, ${input.mode}, ${toSeconds(input.sendAt)},
      ${input.subject}, ${input.recipients}, 'pending', 0, ${input.payload}, ${toSeconds(new Date())}
    )
  `);
  return Number(result.lastInsertRowid);
}

export async function updateScheduledStatus(
  id: number,
  values: { status: ScheduledSendStatus, attempts?: number, error?: string | null, sendAt?: Date },
  database?: Database,
): Promise<void> {
  let db = database ?? await getMailDatabase();
  let current = await db.get(sql`SELECT attempts, error, sendAt FROM scheduledSend WHERE id = ${id}`) as any;
  if (!current) {
    return;
  }
  await db.run(sql`
    UPDATE scheduledSend SET
      status = ${values.status},
      attempts = ${values.attempts ?? Number(current.attempts) ?? 0},
      error = ${values.error === undefined ? current.error ?? null : values.error},
      sendAt = ${values.sendAt ? toSeconds(values.sendAt) : Number(current.sendAt)}
    WHERE id = ${id}
  `);
}

/**
 * Помечает строку «отправляется», только если её ещё никто не взял.
 * @returns false — письмо уже отправляется или удалено
 */
export async function claimScheduledSend(id: number, database?: Database): Promise<boolean> {
  let db = database ?? await getMailDatabase();
  let result = await db.run(sql`
    UPDATE scheduledSend SET status = 'sending'
    WHERE id = ${id} AND status = 'pending'
  `);
  return Number(result.changes) > 0;
}

/**
 * После перезапуска: письмо, отправка которого прервалась, могло уйти, а могло и нет.
 * Повторять его сами не будем — человек решит по папке «Отправленные».
 * @returns количество таких писем
 */
export async function failInterruptedSends(error: string, database?: Database): Promise<number> {
  let db = database ?? await getMailDatabase();
  let result = await db.run(sql`
    UPDATE scheduledSend SET status = 'failed', error = ${error}
    WHERE status = 'sending'
  `);
  return Number(result.changes) || 0;
}

/**
 * Удаляет письмо из очереди, только пока его никто не начал отправлять.
 * @returns false — письмо уже отправляется (или удалено)
 */
export async function cancelPendingScheduledSend(id: number, database?: Database): Promise<boolean> {
  let db = database ?? await getMailDatabase();
  let result = await db.run(sql`
    DELETE FROM scheduledSend
    WHERE id = ${id} AND status != 'sending'
  `);
  return Number(result.changes) > 0;
}

export async function deleteScheduledSend(id: number, database?: Database): Promise<void> {
  let db = database ?? await getMailDatabase();
  await db.run(sql`DELETE FROM scheduledSend WHERE id = ${id}`);
}
