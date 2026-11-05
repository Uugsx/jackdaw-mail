import type { Query } from "../../../lib/rs-sqlite";
import type { BatchStep } from "../../../lib/rs-sqlite/batch";

/**
 * Сообщения между главным процессом Electron и отдельным процессом SQLite.
 *
 * Каждый запрос несёт `requestID`, ответ возвращает тот же ID.
 * Процесс базы обрабатывает запросы строго по очереди, поэтому порядок
 * запросов одного вызывающего сохраняется так же, как при синхронном
 * better-sqlite3 в главном процессе.
 */

export type SQLiteOperation =
  | { op: "open", filename: string | null, options: any, buffer?: Uint8Array }
  | { op: "close", dbID: number }
  | { op: "closeAll" }
  /** Подготовка библиотеки к миграциям (pragma и служебные таблицы).
   * Возвращает текущий `user_version`. */
  | { op: "migrateSetup", dbID: number }
  | { op: "execute", dbID: number, query: Query }
  | { op: "run", dbID: number, query: Query }
  | { op: "get", dbID: number, query: Query }
  | { op: "all", dbID: number, query: Query }
  | { op: "pragma", dbID: number, source: string, options?: any }
  | { op: "batch", dbID: number, steps: BatchStep[] };

export type SQLiteRequest = SQLiteOperation & { requestID: number };

/** Ошибка в виде, который переживает structured clone вместе с кодом SQLite. */
export type SerializedError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
};

export type SQLiteResponse =
  /** `binary` — в результате есть BLOB: главный процесс вернёт им тип Buffer.
   * Без флага он не обходит строки результата. */
  | { requestID: number, result: any, binary?: boolean }
  | { requestID: number, error: SerializedError };

export function serializeError(ex: unknown): SerializedError {
  if (ex instanceof Error) {
    return {
      name: ex.name,
      message: ex.message,
      code: typeof (ex as any).code == "string" ? (ex as any).code : undefined,
      stack: ex.stack,
    };
  }
  return { name: "Error", message: String(ex) };
}

/** Восстанавливает ошибку на стороне главного процесса,
 * сохраняя `code` (например, `SQLITE_CONSTRAINT_UNIQUE`). */
export function deserializeError(serialized: SerializedError): Error {
  let ex = new Error(serialized.message) as Error & { code?: string };
  ex.name = serialized.name;
  if (serialized.code) {
    ex.code = serialized.code;
  }
  if (serialized.stack) {
    ex.stack = serialized.stack;
  }
  return ex;
}
