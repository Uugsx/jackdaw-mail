import { appGlobal } from "../../app";
import { mailDatabaseSchema } from "./createDatabase";
import {
  createFolderIDDateSentIndex,
  createReportReplyIndexes,
  createResponseReminderIndexes,
  addEMailStatusColumns,
  repairReportReplyIndexes,
  dedupeEMailPersons,
  createEMailLookupIndexes,
  dedupeEMailsWithoutPID,
  createFollowUpReminderTable,
  createExchangeTaskTable,
  createScheduledSendTable,
  createMailTemplateTable,
  createMessageNoteTable,
  reloadRecentExchangeBodies,
  reloadExchangeBodiesFromServer,
  createEMailIDCounter,
} from "./SQLEMailMigrate";
import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { openDatabaseOnce } from "../../util/openDatabaseOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let mailDatabase: Database;

/** Миграции mail.db по порядку. Новые — только в конец списка:
 * номер последней выполненной хранится в user_version. */
export const mailDatabaseMigrations = [
  mailDatabaseSchema,
  createFolderIDDateSentIndex,
  createReportReplyIndexes,
  createResponseReminderIndexes,
  addEMailStatusColumns,
  repairReportReplyIndexes,
  // Уже выпущена седьмой (PR #14): установленные базы стоят на user_version 7.
  createEMailLookupIndexes,
  dedupeEMailPersons,
  dedupeEMailsWithoutPID,
  // Десятая: «Напомнить, если не ответят».
  createFollowUpReminderTable,
  // Одиннадцатая: задачи Exchange.
  createExchangeTaskTable,
  // Двенадцатая: отмена отправки и «Отправить позже».
  createScheduledSendTable,
  // Тринадцатая: шаблоны писем.
  createMailTemplateTable,
  // Четырнадцатая: заметки к письмам.
  createMessageNoteTable,
  // Пятнадцатая: письма Exchange с чужим текстом заново загружаются с сервера.
  reloadRecentExchangeBodies,
  // Шестнадцатая: то же после исправления чтения чужого исходника MIME.
  reloadExchangeBodiesFromServer,
  // Семнадцатая: номера писем больше не переиспользуются.
  createEMailIDCounter,
];

const openMailDatabase = openDatabaseOnce(() => getSQLiteDatabase("mail.db"), async database => {
  await database.migrate(...mailDatabaseMigrations);
  await database.pragma("foreign_keys = true");
  await database.pragma("journal_mode = WAL");
});

export async function getDatabase(): Promise<Database> {
  if (mailDatabase) {
    return mailDatabase;
  }
  mailDatabase = await openMailDatabase();
  return mailDatabase;
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  mailDatabase = await getSQLiteDatabase("test-mail.db");
  await deleteDatabase();
  mailDatabase = await getSQLiteDatabase("test-mail.db");
  await mailDatabase.migrate(
    mailDatabaseSchema,
    createReportReplyIndexes,
    createResponseReminderIndexes,
    createEMailLookupIndexes,
    createFollowUpReminderTable,
    createExchangeTaskTable,
    createScheduledSendTable,
    createMailTemplateTable,
    createMessageNoteTable,
  );
  await mailDatabase.pragma("foreign_keys = true");
  await mailDatabase.pragma("journal_mode = WAL");
  return mailDatabase;
}

/**
 * Витрина демо-режима: отчёты и живой SLA читают письма из базы, поэтому
 * показательные письма пишутся в отдельный файл, который пересоздаётся при каждом
 * запуске. Обычная mail.db не открывается и не меняется.
 */
export async function useShowcaseDatabase(): Promise<Database> {
  mailDatabase = await getSQLiteDatabase("showcase-mail.db");
  await deleteDatabase();
  mailDatabase = await getSQLiteDatabase("showcase-mail.db");
  await mailDatabase.migrate(...mailDatabaseMigrations);
  await mailDatabase.pragma("foreign_keys = true");
  await mailDatabase.pragma("journal_mode = WAL");
  return mailDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = (await mailDatabase.all(
    sql`SELECT name FROM sqlite_schema WHERE type='table'`,
  )) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await mailDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await mailDatabase.pragma("user_version = 0");
  (mailDatabase as any).close();
  mailDatabase = null;
}
