import sql, { type Database } from "../../../../lib/rs-sqlite";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";
import type {
  ScheduledSend, ScheduledSendKind, ScheduledSendMode, ScheduledSendStatus,
} from "./SendLater";

/**
 * Очередь `scheduledSend` в mail.db.
 *
 * Отправку забирают «захватом»: строка переходит в `sending` с уникальной
 * меткой `claim`, и только владелец метки может её завершить. Так письмо
 * не уйдёт дважды, даже если таймер и кнопка «Отправить сейчас» сработают
 * одновременно. Строки `sending`, оставшиеся после сбоя или выхода,
 * при запуске переходят в `failed`: неизвестно, ушло ли письмо.
 */

export interface NewScheduledSend {
  queueID: string;
  accountID: number;
  kind: ScheduledSendKind;
  mode: ScheduledSendMode;
  status: ScheduledSendStatus;
  sendAt: Date;
  subject: string;
  recipients: string[];
  payload: string;
}

/** Причина в `lastError`, когда отправку прервал выход из приложения */
export const kInterruptedError = "interrupted";

async function database(db?: Database): Promise<Database> {
  return db ?? await getMailDatabase();
}

export async function insertScheduledSend(item: NewScheduledSend, db?: Database): Promise<void> {
  let now = Date.now();
  await (await database(db)).run(sql`
    INSERT INTO scheduledSend (
      queueID, accountID, kind, mode, status, sendAt, attempts, lastError,
      subject, recipients, payload, claim, createdAt, updatedAt
    ) VALUES (
      ${item.queueID}, ${item.accountID}, ${item.kind}, ${item.mode}, ${item.status},
      ${item.sendAt.getTime()}, 0, null,
      ${item.subject}, ${JSON.stringify(item.recipients)}, ${item.payload}, null, ${now}, ${now}
    )
  `);
}

/** Все письма очереди без содержимого — для списка и таймера */
export async function listScheduledSends(db?: Database): Promise<ScheduledSend[]> {
  let rows = await (await database(db)).all(sql`
    SELECT id, queueID, accountID, kind, mode, status, sendAt, attempts, lastError,
      subject, recipients, createdAt
    FROM scheduledSend
    ORDER BY sendAt, id
  `) as any[];
  return rows.map(rowToScheduledSend);
}

export async function getScheduledSend(queueID: string, db?: Database): Promise<ScheduledSend | null> {
  let row = await (await database(db)).get(sql`
    SELECT id, queueID, accountID, kind, mode, status, sendAt, attempts, lastError,
      subject, recipients, createdAt
    FROM scheduledSend
    WHERE queueID = ${queueID}
  `) as any;
  return row ? rowToScheduledSend(row) : null;
}

export async function loadScheduledSendPayload(queueID: string, db?: Database): Promise<string | null> {
  let row = await (await database(db)).get(sql`
    SELECT payload FROM scheduledSend WHERE queueID = ${queueID}
  `) as any;
  return typeof row?.payload == "string" ? row.payload : null;
}

/**
 * Забирает письмо для отправки.
 * @param force отправить сейчас, не дожидаясь срока (и повторить неудачное)
 * @returns true — отправлять может только этот вызов
 */
export async function claimScheduledSend(queueID: string, claim: string, options: { now?: Date, force?: boolean } = {}, db?: Database): Promise<boolean> {
  let conn = await database(db);
  let now = (options.now ?? new Date()).getTime();
  if (options.force) {
    await conn.run(sql`
      UPDATE scheduledSend
      SET status = 'sending', claim = ${claim}, updatedAt = ${now}
      WHERE queueID = ${queueID} AND mode = 'local'
        AND (status = 'pending' OR status = 'failed' OR status = 'paused')
    `);
  } else {
    await conn.run(sql`
      UPDATE scheduledSend
      SET status = 'sending', claim = ${claim}, updatedAt = ${now}
      WHERE queueID = ${queueID} AND mode = 'local' AND status = 'pending' AND sendAt <= ${now}
    `);
  }
  let row = await conn.get(sql`
    SELECT status, claim FROM scheduledSend WHERE queueID = ${queueID}
  `) as any;
  return row?.status == "sending" && row?.claim == claim;
}

/** Письмо ушло: убираем из очереди */
export async function finishScheduledSend(queueID: string, claim: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    DELETE FROM scheduledSend WHERE queueID = ${queueID} AND claim = ${claim}
  `);
}

/** Сервер Exchange принял письмо с отложенной отправкой */
export async function markScheduledOnServer(queueID: string, claim: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE scheduledSend
    SET status = 'server', mode = 'server', claim = null, lastError = null, updatedAt = ${Date.now()}
    WHERE queueID = ${queueID} AND claim = ${claim}
  `);
}

/** Не ушло, и повторять самим нельзя — ждём решения человека */
export async function failScheduledSend(queueID: string, claim: string, error: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE scheduledSend
    SET status = 'failed', claim = null, lastError = ${error},
      attempts = attempts + 1, updatedAt = ${Date.now()}
    WHERE queueID = ${queueID} AND claim = ${claim}
  `);
}

/** Не ушло, потому что нет сети: повторим сами в `sendAt` */
export async function retryScheduledSendLater(queueID: string, claim: string, sendAt: Date, error: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE scheduledSend
    SET status = 'pending', claim = null, lastError = ${error}, sendAt = ${sendAt.getTime()},
      attempts = attempts + 1, updatedAt = ${Date.now()}
    WHERE queueID = ${queueID} AND claim = ${claim}
  `);
}

/**
 * Убирает письмо из очереди, если оно сейчас не отправляется.
 * @returns false — письмо уже отправляется или его нет
 */
export async function deleteScheduledSend(queueID: string, db?: Database): Promise<boolean> {
  let conn = await database(db);
  let before = await conn.get(sql`SELECT status FROM scheduledSend WHERE queueID = ${queueID}`) as any;
  if (!before || before.status == "sending") {
    return false;
  }
  await conn.run(sql`
    DELETE FROM scheduledSend WHERE queueID = ${queueID} AND status != 'sending'
  `);
  let after = await conn.get(sql`SELECT status FROM scheduledSend WHERE queueID = ${queueID}`) as any;
  return !after;
}

/** Сервер не принял отложенную отправку — письмо отправит приложение */
export async function releaseScheduledSend(queueID: string, claim: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE scheduledSend
    SET status = 'pending', mode = 'local', claim = null, updatedAt = ${Date.now()}
    WHERE queueID = ${queueID} AND claim = ${claim}
  `);
}

/**
 * Меняет состояние письма, которое сейчас не отправляется.
 * Письмо с сервера к этому моменту уже отменено там: дальше его ведёт приложение.
 * @returns false — письмо уже отправляется или его нет
 */
export async function setScheduledSendStatus(queueID: string, status: "pending" | "paused", sendAt?: Date, db?: Database): Promise<boolean> {
  let conn = await database(db);
  let now = Date.now();
  if (sendAt) {
    await conn.run(sql`
      UPDATE scheduledSend
      SET status = ${status}, mode = 'local', sendAt = ${sendAt.getTime()}, lastError = null, updatedAt = ${now}
      WHERE queueID = ${queueID} AND status != 'sending'
    `);
  } else {
    await conn.run(sql`
      UPDATE scheduledSend
      SET status = ${status}, mode = 'local', lastError = null, updatedAt = ${now}
      WHERE queueID = ${queueID} AND status != 'sending'
    `);
  }
  let row = await conn.get(sql`SELECT status FROM scheduledSend WHERE queueID = ${queueID}`) as any;
  return row?.status == status;
}

/**
 * При запуске: отправки, прерванные выходом или сбоем, — в `failed`.
 * Автоматически их не повторяем: письмо могло уже уйти.
 */
export async function recoverInterruptedSends(db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    UPDATE scheduledSend
    SET status = 'failed', claim = null, lastError = ${kInterruptedError}, updatedAt = ${Date.now()}
    WHERE status = 'sending'
  `);
}

/** Письма, которые отправил сервер: срок прошёл — убираем из списка */
export async function removeSentServerScheduled(now = new Date(), db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    DELETE FROM scheduledSend WHERE status = 'server' AND sendAt <= ${now.getTime()}
  `);
}

function rowToScheduledSend(row: any): ScheduledSend {
  let recipients: string[] = [];
  try {
    let parsed = JSON.parse(row.recipients ?? "[]");
    recipients = Array.isArray(parsed) ? parsed.filter(item => typeof item == "string") : [];
  } catch {
    recipients = [];
  }
  return {
    id: Number(row.id),
    queueID: String(row.queueID),
    accountID: Number(row.accountID),
    kind: row.kind == "undo" ? "undo" : "later",
    mode: row.mode == "server" ? "server" : "local",
    status: sanitizeStatus(row.status),
    sendAt: new Date(Number(row.sendAt)),
    attempts: Number(row.attempts) || 0,
    lastError: typeof row.lastError == "string" ? row.lastError : null,
    subject: typeof row.subject == "string" ? row.subject : "",
    recipients,
    createdAt: new Date(Number(row.createdAt)),
  };
}

function sanitizeStatus(value: unknown): ScheduledSendStatus {
  return value == "sending" || value == "failed" || value == "paused" || value == "server"
    ? value as ScheduledSendStatus
    : "pending";
}
