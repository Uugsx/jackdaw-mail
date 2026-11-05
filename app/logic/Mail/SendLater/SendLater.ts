/**
 * Отмена отправки и отложенная отправка: общие правила без интерфейса и базы.
 *
 * Письмо после «Отправить» ждёт в очереди `scheduledSend` (mail.db):
 * - `undo` — несколько секунд, пока видна полоса «Отменить»;
 * - `later` — до выбранного времени («Отправить позже»).
 * Очередь переживает закрытие окна и выход из приложения.
 */

/** Варианты задержки отмены отправки в настройках, секунды */
export const kUndoSendDelays = [0, 5, 10, 20, 30] as const;
export type UndoSendDelay = typeof kUndoSendDelays[number];
export const kDefaultUndoSendDelay: UndoSendDelay = 5;

/** Утро для «Завтра утром» и «В понедельник утром», местное время */
export const kSendLaterMorningHour = 8;

/** Самая поздняя дата отложенной отправки */
export const kMaxSendLaterDays = 366;

export type ScheduledSendKind = "undo" | "later";
/** `local` — отправит приложение, `server` — отправку держит сервер Exchange */
export type ScheduledSendMode = "local" | "server";
/**
 * - `pending` — ждёт времени отправки;
 * - `sending` — отправляется сейчас;
 * - `failed` — не ушло, ждёт решения человека;
 * - `paused` — открыто для правки, само не уйдёт;
 * - `server` — передано серверу, он отправит сам.
 */
export type ScheduledSendStatus = "pending" | "sending" | "failed" | "paused" | "server";

export interface ScheduledSend {
  id: number;
  /** Свой ID записи: окно отправки, свойство письма на сервере */
  queueID: string;
  accountID: number;
  kind: ScheduledSendKind;
  mode: ScheduledSendMode;
  status: ScheduledSendStatus;
  sendAt: Date;
  attempts: number;
  lastError: string | null;
  subject: string;
  recipients: string[];
  createdAt: Date;
}

export function normalizeUndoSendDelay(value: unknown): UndoSendDelay {
  let number = Number(value);
  return (kUndoSendDelays as readonly number[]).includes(number)
    ? number as UndoSendDelay
    : kDefaultUndoSendDelay;
}

/** Завтра в 8:00 по местному времени */
export function tomorrowMorning(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, kSendLaterMorningHour, 0, 0, 0);
}

/**
 * Ближайший понедельник в 8:00 по местному времени.
 * В понедельник до 8:00 — сегодня, иначе — следующий.
 * Дни считаем по календарю, а не по 24 часам: переход на летнее время не сдвигает час.
 */
export function nextMondayMorning(now = new Date()): Date {
  let daysAhead = (8 - now.getDay()) % 7;
  let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, kSendLaterMorningHour, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead + 7, kSendLaterMorningHour, 0, 0, 0);
  }
  return candidate;
}

export type SendLaterTimeProblem = "invalid" | "past" | "too-far";

/** Проверка выбранного времени. null — время подходит. */
export function checkSendLaterTime(sendAt: Date | null | undefined, now = new Date()): SendLaterTimeProblem | null {
  if (!(sendAt instanceof Date) || !Number.isFinite(sendAt.getTime())) {
    return "invalid";
  }
  if (sendAt.getTime() <= now.getTime()) {
    return "past";
  }
  if (sendAt.getTime() - now.getTime() > kMaxSendLaterDays * 24 * 60 * 60 * 1000) {
    return "too-far";
  }
  return null;
}

/** Паузы между автоматическими повторами, когда сети нет: 1, 2, 5, 10, 15 минут */
const kRetryDelaysMs = [60_000, 120_000, 300_000, 600_000, 900_000];

export function retryDelayMs(attempts: number): number {
  let index = Math.max(0, Math.min(kRetryDelaysMs.length - 1, attempts - 1));
  return kRetryDelaysMs[index];
}

/**
 * Можно ли повторить отправку автоматически, не рискуя отправить письмо дважды.
 * Да — только когда запрос точно не дошёл до сервера: нет сети, имя сервера
 * не разрешилось, соединение отклонено. Обрыв посреди ответа, таймаут или
 * ошибка сервера — неизвестно, ушло ли письмо: решает человек.
 */
export function isSafeToRetrySend(ex: unknown, online = true): boolean {
  if (!online) {
    return true;
  }
  let error = ex as { code?: unknown, message?: unknown, cause?: { code?: unknown, message?: unknown } } | null;
  let text = [error?.code, error?.message, error?.cause?.code, error?.cause?.message]
    .filter(part => typeof part == "string")
    .join(" ");
  return /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED)\b/.test(text);
}

/** Текст ошибки для списка: без стека и не длиннее строки */
export function sendErrorText(ex: unknown): string {
  let message = ex instanceof Error ? ex.message : String(ex ?? "");
  message = message.replace(/\s+/g, " ").trim();
  return message.length > 500 ? message.slice(0, 499) + "…" : message;
}

/** Порядок в списке: сначала требующие внимания, затем по времени отправки */
export function sortScheduledSends(items: readonly ScheduledSend[]): ScheduledSend[] {
  const rank: Record<ScheduledSendStatus, number> = { failed: 0, paused: 1, sending: 2, pending: 3, server: 3 };
  return items.slice().sort((a, b) =>
    rank[a.status] - rank[b.status] || a.sendAt.getTime() - b.sendAt.getTime() || a.id - b.id);
}
