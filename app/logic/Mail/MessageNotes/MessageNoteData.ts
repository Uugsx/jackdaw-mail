import sql, { type Database } from "../../../../lib/rs-sqlite";
import { getDatabase as getMailDatabase } from "../SQL/SQLDatabase";
import { normalizeNoteText } from "./MessageNote";

/** Таблица `messageNote` в mail.db (миграция 14) */

export interface MessageNoteRecord {
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Ключ письма: Message-ID, иначе ID на сервере. Тот же принцип, что у закреплённых писем. */
export function messageNoteKey(messageID: string | null | undefined, pID: unknown): string | null {
  if (messageID) {
    return messageID;
  }
  return pID != null && pID !== "" ? "pid:" + pID : null;
}

async function database(db?: Database): Promise<Database> {
  return db ?? await getMailDatabase();
}

function toRecord(row: any): MessageNoteRecord {
  return {
    text: row.text,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function getMessageNote(accountID: string, messageKey: string, db?: Database): Promise<MessageNoteRecord | null> {
  let row = await (await database(db)).get(sql`
    SELECT text, createdAt, updatedAt FROM messageNote
    WHERE accountID = ${accountID} AND messageKey = ${messageKey}
  `) as any;
  return row ? toRecord(row) : null;
}

/**
 * Сохраняет заметку; пустой текст удаляет её.
 * @returns итоговая запись или null, если заметки не осталось
 */
export async function saveMessageNote(accountID: string, messageKey: string, text: string, db?: Database): Promise<MessageNoteRecord | null> {
  let value = normalizeNoteText(text);
  if (!value) {
    await deleteMessageNote(accountID, messageKey, db);
    return null;
  }
  let now = Date.now();
  await (await database(db)).run(sql`
    INSERT INTO messageNote (accountID, messageKey, text, createdAt, updatedAt)
    VALUES (${accountID}, ${messageKey}, ${value}, ${now}, ${now})
    ON CONFLICT (accountID, messageKey) DO UPDATE SET text = excluded.text, updatedAt = excluded.updatedAt
  `);
  return await getMessageNote(accountID, messageKey, db);
}

export async function deleteMessageNote(accountID: string, messageKey: string, db?: Database): Promise<void> {
  await (await database(db)).run(sql`
    DELETE FROM messageNote WHERE accountID = ${accountID} AND messageKey = ${messageKey}
  `);
}

/** Ключи всех писем ящика, у которых есть заметка (для индикатора в списке) */
export async function listNotedMessageKeys(accountID: string, db?: Database): Promise<Map<string, string>> {
  let rows = await (await database(db)).all(sql`
    SELECT messageKey, text FROM messageNote WHERE accountID = ${accountID}
  `) as any[];
  return new Map(rows.map(row => [row.messageKey, row.text]));
}

/** Ключи писем ящика, чья заметка содержит текст (без учёта регистра, в том числе кириллицы) */
export async function searchMessageNotes(accountID: string, term: string, db?: Database): Promise<Set<string>> {
  let needle = term.trim().toLowerCase();
  if (!needle) {
    return new Set();
  }
  // SQLite LIKE не сворачивает регистр кириллицы, поэтому сравниваем в JS
  let notes = await listNotedMessageKeys(accountID, db);
  let found = new Set<string>();
  for (let [key, text] of notes) {
    if (text.toLowerCase().includes(needle)) {
      found.add(key);
    }
  }
  return found;
}
