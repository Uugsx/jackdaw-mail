import { writable } from "svelte/store";
import type { ChatLinkRef } from "../../logic/Chat/Jackdaw/JackdawChatProtocol";
import type { EMail } from "../../logic/Mail/EMail";

/** Письмо или событие, которым пользователь хочет поделиться в чате: открывает диалог выбора чата */
export const shareToChatRequest = writable<ChatLinkRef | null>(null);
/** Само письмо для ссылки на письмо: уходит в чат файлом .eml */
export const shareToChatEmail = writable<EMail | null>(null);

export function shareToChat(link: ChatLinkRef, email: EMail | null = null): void {
  shareToChatEmail.set(link.type == "email" ? email : null);
  shareToChatRequest.set(link);
}
