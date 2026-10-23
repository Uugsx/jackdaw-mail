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
  await mailDatabase.migrate(
    mailDatabaseSchema,
    createReportReplyIndexes,
    createResponseReminderIndexes,
    createEMailLookupIndexes,
    createFollowUpReminderTable,
    createExchangeTaskTable,
    createScheduledSendTable,
    createMailTemplateTable,
  );
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
