import { writable } from "svelte/store";

/**
 * Идёт поиск писем: от ввода запроса (включая паузу перед запуском)
 * до результата или ошибки. Без этого после ввода ничего не менялось,
 * пока внезапно не появлялись результаты.
 */
export const mailSearchInProgress = writable(false);

/** Поиск на сервере Exchange для результатов из строки поиска */
export interface MailServerSearchStatus {
  /** Идёт запрос страницы */
  loading: boolean;
  /** На сервере есть ещё результаты */
  hasMore: boolean;
  /** Часть папок не ответила */
  failed: boolean;
  /** Сколько писем добавил сервер */
  added: number;
  loadMore: () => void;
}

/** null — сервер в текущем поиске не участвует */
export const mailServerSearch = writable<MailServerSearchStatus | null>(null);
