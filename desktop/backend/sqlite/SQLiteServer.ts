import type { Query } from "../../../lib/rs-sqlite";
import { executeBatchStep, type BatchStep } from "../../../lib/rs-sqlite/batch";
import { serializeError, type SQLiteRequest, type SQLiteResponse } from "./protocol";

/** Часть `Database` из @radically-straightforward/sqlite, которую использует сервер. */
export interface SQLiteEngine {
  migrate(): Promise<unknown>;
  execute(query: Query): unknown;
  run(query: Query): any;
  get(query: Query): any;
  all(query: Query): any;
  pragma(source: string, options?: any): any;
  executeTransaction<Type>(fn: () => Type): Type;
  close(): unknown;
}

export type OpenSQLiteEngine = (filename: string | null, options: any, buffer?: Uint8Array) => SQLiteEngine;

/**
 * Исполняет запросы к открытым базам. Не знает о транспорте:
 * в приложении работает в utilityProcess (`worker.ts`), в тестах — напрямую.
 */
export class SQLiteServer {
  protected readonly databases = new Map<number, SQLiteEngine>();
  protected nextDatabaseID = 1;

  constructor(protected readonly openEngine: OpenSQLiteEngine) {
  }

  async handle(request: SQLiteRequest): Promise<SQLiteResponse> {
    try {
      let result = await this.execute(request);
      return containsBinary(result)
        ? { requestID: request.requestID, result, binary: true }
        : { requestID: request.requestID, result };
    } catch (ex) {
      return { requestID: request.requestID, error: serializeError(ex) };
    }
  }

  protected async execute(request: SQLiteRequest): Promise<any> {
    switch (request.op) {
      case "open": {
        let engine = this.openEngine(request.filename, request.options, request.buffer);
        let dbID = this.nextDatabaseID++;
        this.databases.set(dbID, engine);
        return dbID;
      }
      case "close": {
        let engine = this.databases.get(request.dbID);
        this.databases.delete(request.dbID);
        engine?.close();
        return null;
      }
      case "closeAll":
        this.closeAll();
        return null;
      case "migrateSetup": {
        let engine = this.database(request.dbID);
        // Без миграций библиотека только ставит pragma и создаёт служебные
        // таблицы. Сами миграции выполняет главный процесс: функции миграций
        // живут в renderer и обращаются к базе обычными запросами.
        await engine.migrate();
        return engine.pragma("user_version", { simple: true });
      }
      case "execute":
        this.database(request.dbID).execute(withBuffers(request.query));
        return null;
      case "run":
        return toPlainRunResult(this.database(request.dbID).run(withBuffers(request.query)));
      case "get":
        return this.database(request.dbID).get(withBuffers(request.query));
      case "all":
        return this.database(request.dbID).all(withBuffers(request.query));
      case "pragma":
        return this.database(request.dbID).pragma(request.source, request.options);
      case "batch":
        return this.batch(this.database(request.dbID), request.steps);
      default:
        throw new Error(`Unknown SQLite operation ${(request as any).op}`);
    }
  }

  /** Все шаги в одной транзакции: ошибка любого шага откатывает весь пакет.
   * Внутри уже открытой транзакции better-sqlite3 использует SAVEPOINT. */
  protected batch(engine: SQLiteEngine, steps: BatchStep[]): any[] {
    if (!Array.isArray(steps)) {
      throw new Error("Batch steps must be an array");
    }
    return engine.executeTransaction(() => {
      let results: any[] = [];
      for (let step of steps) {
        let result = executeBatchStep<any>(engine, { ...step, query: withBuffers(step.query) }, results);
        results.push((step.mode ?? "run") == "run" ? toPlainRunResult(result) : result);
      }
      return results;
    });
  }

  closeAll(): void {
    for (let engine of this.databases.values()) {
      try {
        engine.close();
      } catch {
        // База уже закрыта или повреждена: закрываем остальные
      }
    }
    this.databases.clear();
  }

  protected database(dbID: number): SQLiteEngine {
    let engine = this.databases.get(dbID);
    if (!engine) {
      throw new Error(`SQLite database ${dbID} is not open`);
    }
    return engine;
  }
}

/** structured clone превращает Buffer в Uint8Array; better-sqlite3 привязывает BLOB как Buffer. */
function withBuffers(query: Query): Query {
  if (!query?.parameters?.some(parameter => parameter instanceof Uint8Array && !Buffer.isBuffer(parameter))) {
    return query;
  }
  return {
    sourceParts: query.sourceParts,
    parameters: query.parameters.map(parameter =>
      parameter instanceof Uint8Array && !Buffer.isBuffer(parameter)
        ? Buffer.from(parameter.buffer, parameter.byteOffset, parameter.byteLength)
        : parameter),
  };
}

/** Есть ли в результате BLOB. Обходит строки здесь, в процессе базы,
 * чтобы не нагружать главный процесс. */
function containsBinary(value: any): boolean {
  if (value instanceof Uint8Array) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsBinary);
  }
  if (value && typeof value == "object") {
    for (let key in value) {
      if (containsBinary(value[key])) {
        return true;
      }
    }
  }
  return false;
}

/** RunResult better-sqlite3 — обычный объект, но фиксируем ровно те поля,
 * которые раньше видел renderer через JPC. */
function toPlainRunResult(result: any): any {
  if (!result || typeof result != "object") {
    return result;
  }
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}
