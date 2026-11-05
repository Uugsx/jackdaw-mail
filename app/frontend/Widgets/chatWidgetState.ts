import type { ChatRoom } from "../../logic/Chat/ChatRoom";
import { getLocalStorage } from "../Util/LocalStorage";
import { openChatRoomFromOtherApp } from "../Chat/open";
import { chatApp } from "../Chat/ChatJackdawApp";
import { openApp } from "../AppsBar/selectedApp";
import { widgetsExpanded } from "./widgetState";
import { writable } from "svelte/store";

/** Что открыто в чате боковой панели: панель при скрытии размонтируется, а открытый чат
 * должен вернуться и после повторного открытия, и после перезапуска приложения. */
export interface ChatWidgetPlace {
  roomID: string;
  /** Отступ ленты сверху. null — лента прокручена до конца (к новым сообщениям). */
  scrollTop: number | null;
}

export const chatWidgetPlaceSetting = getLocalStorage<ChatWidgetPlace | null>("widgets.chat.place", null);

/** Чат, открытый сейчас в панели. Заголовок панели открывает его же в большом окне. */
export const chatWidgetRoom = writable<ChatRoom | null>(null);

export function rememberChatWidgetRoom(room: ChatRoom | null) {
  let current = chatWidgetPlaceSetting.value;
  if (!room) {
    chatWidgetPlaceSetting.value = null;
  } else if (current?.roomID != room.id) {
    chatWidgetPlaceSetting.value = { roomID: room.id, scrollTop: null };
  }
}

export function rememberChatWidgetScroll(roomID: string, scrollTop: number | null) {
  let current = chatWidgetPlaceSetting.value;
  if (current?.roomID != roomID || current.scrollTop === scrollTop) {
    return;
  }
  chatWidgetPlaceSetting.value = { roomID, scrollTop };
}

/** «Открыть в чате»: панель сразу скрывается, этот чат открывается в большом окне.
 * Без чата — открывается приложение «Чат». Открытый в панели чат запоминается. */
export function openChatWidgetInMainWindow(room: ChatRoom | null) {
  widgetsExpanded.value = false;
  if (room) {
    openChatRoomFromOtherApp(room);
  } else {
    openApp(chatApp, {});
  }
}
