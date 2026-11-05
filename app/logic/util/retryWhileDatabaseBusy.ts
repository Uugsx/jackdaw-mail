import { isDatabaseBusyError } from "./friendlyError";
import { sleep } from "./util";

/** Паузы между попытками, пока база занята: всего около 30 с.
 * Каждая попытка сама ещё ждёт блокировку до busy_timeout процесса базы. */
export const kDatabaseBusyRetryDelaysMs = [500, 1000, 2000, 4000, 8000, 15000];

/** База занята, после паузы `delayMs` будет попытка `attempt + 1`. */
export type DatabaseBusyCallback = (ex: Error, attempt: number, delayMs: number) => void;

/**
 * Повторяет `func`, пока она падает с SQLITE_BUSY/SQLITE_LOCKED, с нарастающей
 * паузой. Другие ошибки и последняя неудача пробрасываются вызывающему.
 */
export async function retryWhileDatabaseBusy<T>(
  func: () => Promise<T>,
  onBusy?: DatabaseBusyCallback,
  delaysMs: readonly number[] = kDatabaseBusyRetryDelaysMs,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await func();
    } catch (ex) {
      let delayMs = delaysMs[attempt - 1];
      if (delayMs == null || !isDatabaseBusyError(ex)) {
        throw ex;
      }
      onBusy?.(ex as Error, attempt, delayMs);
      await sleep(delayMs / 1000);
    }
  }
}
