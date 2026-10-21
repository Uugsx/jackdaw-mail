import { writable } from "svelte/store";

/**
 * Идёт поиск писем: от ввода запроса (включая паузу перед запуском)
 * до результата или ошибки. Без этого после ввода ничего не менялось,
 * пока внезапно не появлялись результаты.
 */
export const mailSearchInProgress = writable(false);
