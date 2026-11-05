import { writable } from "svelte/store";
import type { ChatMessage } from "../../logic/Chat/ChatMessage";

/** Сообщение, на которое пользователь отвечает. Редактор показывает его над полем ввода. */
export const replyingTo = writable<ChatMessage | null>(null);

/** Короткий фрагмент сообщения для цитаты */
export function quoteSnippet(message: { text?: string } | null | undefined, max = 140): string {
  let text = (message?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
