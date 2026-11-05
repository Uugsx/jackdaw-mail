import sql, { type Database } from "../../../../../lib/rs-sqlite/index";
import { accountsDatabaseSchema } from "./createDatabase";
import { migrateToAccountsDB } from "./SQLAccountsMigrate";
import { getSQLiteDatabase } from "../../../util/backend-wrapper";
import { openDatabaseOnce } from "../../../util/openDatabaseOnce";

let accountsDatabase: Database;

// Lib docs:
// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
// https://github.com/radically-straightforward/radically-straightforward/tree/main/sqlite
// https://www.sqlite.org/lang.html

const openAccountsDatabase = openDatabaseOnce(async () => {
  await migrateToAccountsDB();
  return await getSQLiteDatabase("account.db");
}, async database => {
  await database.migrate(accountsDatabaseSchema);
  await database.pragma('foreign_keys = true');
  // Режим журнала не меняем: migrate() уже перевёл базу в WAL. Раньше здесь
  // база при каждом запуске возвращалась в DELETE, а переход из WAL берёт
  // эксклюзивную блокировку без ожидания: если файл открыт ещё где-то
  // (процесс базы прошлой версии, отдельное окно), запуск падал с SQLITE_BUSY.
});

export async function getDatabase(): Promise<Database> {
  if (accountsDatabase) {
    return accountsDatabase;
  }
  accountsDatabase = await openAccountsDatabase();
  return accountsDatabase;
}

/**
 * Creates a new database for testing only, in a different file,
 * and lets getDatabase() from now on return that test database,
 * until the process is shut down.
 */
export async function makeTestDatabase(): Promise<Database> {
  accountsDatabase = await getSQLiteDatabase("test-account.db");
  await deleteDatabase();
  await accountsDatabase.migrate(accountsDatabaseSchema);
  await accountsDatabase.pragma('foreign_keys = true');
  return accountsDatabase;
}

export async function deleteDatabase(): Promise<void> {
  let tables = await accountsDatabase.all(sql`SELECT name FROM sqlite_schema WHERE type='table'`) as any[];
  for (let row of tables) {
    let table = row.name;
    if (table?.startsWith("sqlite_")) {
      continue;
    }
    await accountsDatabase.execute(sql`DROP TABLE IF EXISTS ${table};`);
  }
  await accountsDatabase.pragma('user_version = 0');
  (accountsDatabase as any).close(); // any, because function exists, but not in TypeScript definitions
  accountsDatabase = null;
}
