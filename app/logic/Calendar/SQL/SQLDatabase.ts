import { appGlobal } from "../../app";
import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { calendarDatabaseSchema } from "./createDatabase";
import { addEventAttachmentTable } from "./SQLEventMigrate";
import { getSQLiteDatabase } from "../../util/backend-wrapper";
import { openDatabaseOnce } from "../../util/openDatabaseOnce";

// <copied from="Mail/SQL/Account/SQLDatabase.ts">

let calendarDatabase: Database;

const openCalendarDatabase = openDatabaseOnce(() => getSQLiteDatabase("calendar.db"), async database => {
  await database.migrate(calendarDatabaseSchema, addEventAttachmentTable);
  await database.pragma('foreign_keys = true');
  await database.pragma('journal_mode = WAL');
});

export async function getDatabase(): Promise<Database> {
  if (calendarDatabase) {
    return calendarDatabase;
  }
  calendarDatabase = await openCalendarDatabase();
  return calendarDatabase;
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  calendarDatabase = await getSQLiteDatabase("test-calendar.db");
  await deleteDatabase();
  await calendarDatabase.migrate(calendarDatabaseSchema, addEventAttachmentTable);
  await calendarDatabase.pragma('foreign_keys = true');
  return calendarDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await calendarDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await calendarDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await calendarDatabase.pragma('user_version = 0');
  (calendarDatabase as any).close();
  calendarDatabase = null;
}
