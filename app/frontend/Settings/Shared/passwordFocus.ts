import { writable } from "svelte/store";

/** Запрос «поставить фокус в поле пароля». Страница «Сервер» может ещё не
 * существовать в момент запроса, поэтому поле смотрит на флаг при появлении. */
export const passwordFocusRequest = writable(false);

export function requestPasswordFocus() {
  passwordFocusRequest.set(true);
}

/** Счётчик вводов нового пароля: страница настроек сервера по нему
 * сохраняет аккаунт и сразу перепроверяет вход. */
export const newPasswordEntered = writable(0);
