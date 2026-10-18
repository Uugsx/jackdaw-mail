import { Database } from "@radically-straightforward/sqlite"; // formerly @leafac/sqlite
import type { SQLiteEngine } from "./SQLiteServer";

/** Открывает базу так же, как раньше `getSQLiteDatabase()` в главном процессе. */
export function openSQLiteEngine(filename: string | null, options: any, buffer?: Uint8Array): SQLiteEngine {
  if (buffer) {
    return new Database(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength), options);
  }
  return new Database(filename as string, options);
}
