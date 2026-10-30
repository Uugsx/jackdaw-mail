import { getContext } from "svelte";
import type { EMail } from "../../logic/Mail/EMail";

/** Ключ контекста: встроенный просмотрщик (например, в отчётах) сам решает, где открыть другое письмо. */
export const kOpenMessageContext = "jackdaw.openMessage";

/** Обработчик «открыть письмо здесь» от окружающего просмотрщика или null — тогда письмо открывается в почте. */
export function getOpenMessageHandler(): ((message: EMail) => void) | null {
  return getContext<((message: EMail) => void) | undefined>(kOpenMessageContext) ?? null;
}
