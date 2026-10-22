import { writable } from "svelte/store";
import type { ChatLinkRef } from "../../logic/Chat/Jackdaw/JackdawChatProtocol";

/** Письмо или событие, которым пользователь хочет поделиться в чате: открывает диалог выбора чата */
export const shareToChatRequest = writable<ChatLinkRef | null>(null);

export function shareToChat(link: ChatLinkRef): void {
  shareToChatRequest.set(link);
}
