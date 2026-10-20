import { appGlobal } from "../../../app";
import type { Database } from "../../../../../lib/rs-sqlite/index";
import { mailSourceDatabaseSchema } from "./createSourceDatabase";
import { addUNIQUEEMailID } from "./SQLSourceEMailMigrate";
import { getConfigDir, getSQLiteDatabase } from "../../../util/backend-wrapper";
import { openDatabaseOnce } from "../../../util/openDatabaseOnce";

let mailSourceDatabase: Database;

const openMailSourceDatabase = openDatabaseOnce(async () => {
  let dir = await appGlobal.remoteApp.path.join(
    await getConfigDir(), "backup");
  await appGlobal.remoteApp.fs.mkdir(dir, { recursive: true, mode: 0o700 });
  let file = await appGlobal.remoteApp.path.join("backup", "mail-backup.db");
  return await getSQLiteDatabase(file);
}, async database => {
  await database.migrate(mailSourceDatabaseSchema, addUNIQUEEMailID);
  await database.pragma('journal_mode = WAL');
});

export async function getDatabase(): Promise<Database> {
  if (mailSourceDatabase) {
    return mailSourceDatabase;
  }
  mailSourceDatabase = await openMailSourceDatabase();
  return mailSourceDatabase;
}
