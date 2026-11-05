import type { Query } from "./index";

/**
 * Пакетное выполнение запросов в одной транзакции.
 *
 * Пакет — список шагов. Параметр шага может ссылаться на результат
 * предыдущего шага того же пакета (`batchRef()`), например на
 * `lastInsertRowid` только что вставленной строки. Так зависимые запросы
 * (письмо → его получатели и метки) уходят к базе за один круг IPC
 * и фиксируются одним коммитом.
 */

/** Способ выполнения шага: как `Database.run()`, `get()` или `all()`. */
export type BatchMode = "run" | "get" | "all";

export type BatchStep = {
  query: Query;
  /** По умолчанию "run". Для `INSERT … RETURNING` — "get". */
  mode?: BatchMode;
};

/** Ссылка на результат шага `step` того же пакета. */
export type BatchRef = {
  batchRef: number;
  field: string;
};

/**
 * Параметр запроса, который при выполнении пакета заменяется
 * результатом шага `step`.
 * @param field Для шага "run" — `lastInsertRowid` или `changes`,
 *   для шага "get" — имя колонки возвращённой строки.
 */
export function batchRef(step: number, field = "lastInsertRowid"): BatchRef {
  return { batchRef: step, field };
}

export function isBatchRef(value: any): value is BatchRef {
  return !!value && typeof value == "object" &&
    typeof value.batchRef == "number" && typeof value.field == "string";
}

/** Значение ссылки по уже полученным результатам шагов.
 * @throws если шаг ещё не выполнен или не вернул нужное поле */
export function resolveBatchRef(ref: BatchRef, results: any[]): any {
  if (!Number.isInteger(ref.batchRef) || ref.batchRef < 0 || ref.batchRef >= results.length) {
    throw new Error(`Batch reference to step ${ref.batchRef} is not available yet`);
  }
  let result = results[ref.batchRef];
  let value = result == null || typeof result != "object" ? undefined : result[ref.field];
  if (value === undefined) {
    throw new Error(`Batch step ${ref.batchRef} returned no value for "${ref.field}"`);
  }
  return value;
}

/** Копия запроса, в которой ссылки на шаги заменены их значениями. */
export function resolveBatchQuery(query: Query, results: any[]): Query {
  if (!query.parameters.some(isBatchRef)) {
    return query;
  }
  return {
    sourceParts: query.sourceParts,
    parameters: query.parameters.map(parameter =>
      isBatchRef(parameter) ? resolveBatchRef(parameter, results) : parameter),
  };
}

/** Минимальный интерфейс базы для выполнения одного шага. */
export interface BatchExecutor<Result> {
  run(query: Query): Result;
  get(query: Query): Result;
  all(query: Query): Result;
}

/** Выполняет шаг, подставляя ссылки. Возвращает то, что вернул метод базы. */
export function executeBatchStep<Result>(executor: BatchExecutor<Result>, step: BatchStep, results: any[]): Result {
  let query = resolveBatchQuery(step.query, results);
  switch (step.mode ?? "run") {
    case "run":
      return executor.run(query);
    case "get":
      return executor.get(query);
    case "all":
      return executor.all(query);
    default:
      throw new Error(`Unknown batch step mode ${step.mode}`);
  }
}

/** База, умеющая выполнять пакет целиком (десктопный бэкенд). */
export interface BatchCapableDatabase {
  batch(steps: BatchStep[]): Promise<any[]> | any[];
}

export function supportsBatch(database: any): database is BatchCapableDatabase {
  return typeof database?.batch == "function";
}

/**
 * Выполняет пакет одной транзакцией, если бэкенд это умеет.
 * Иначе (мобильный бэкенд, тесты) — по шагам, как раньше,
 * без общей транзакции.
 * @returns результаты шагов в том же порядке
 */
export async function runBatch(database: any, steps: BatchStep[]): Promise<any[]> {
  if (!steps.length) {
    return [];
  }
  if (supportsBatch(database)) {
    return await database.batch(steps);
  }
  let results: any[] = [];
  for (let step of steps) {
    results.push(await executeBatchStep<any>(database, step, results));
  }
  return results;
}
