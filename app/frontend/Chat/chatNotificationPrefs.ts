import { getLocalStorage } from "../Util/LocalStorage";
import type { JackdawUserStatus } from "../../logic/Meet/Jackdaw/JackdawCallProtocol";

/** Как сообщать о новом сообщении чата. По умолчанию — как было до настройки: окно и звук. */
export const chatNotificationsSetting = getLocalStorage<string[]>("notifications.chat", ["popup", "sound"]);
/** Чаты без уведомлений: идентификаторы комнат */
export const mutedChatRoomsSetting = getLocalStorage<string[]>("chat.mutedRooms", []);

export function isChatRoomMuted(roomID: string): boolean {
  let muted = mutedChatRoomsSetting.value;
  return Array.isArray(muted) && muted.includes(roomID);
}

export function setChatRoomMuted(roomID: string, muted: boolean): void {
  let current = Array.isArray(mutedChatRoomsSetting.value) ? mutedChatRoomsSetting.value : [];
  let next = current.filter(id => id != roomID);
  if (muted) {
    next.push(roomID);
  }
  mutedChatRoomsSetting.value = next;
}

/**
 * Способы уведомления о сообщении в чате с учётом настроек.
 * «Не беспокоить» и отключённый чат — без окна и звука: сообщение просто появится в списке.
 */
export function chatNotificationKinds(roomID: string, myStatus: JackdawUserStatus): string[] {
  let kinds = Array.isArray(chatNotificationsSetting.value) ? chatNotificationsSetting.value : ["popup", "sound"];
  if (myStatus == "dnd" || isChatRoomMuted(roomID)) {
    return kinds.filter(kind => kind != "popup" && kind != "sound");
  }
  return kinds;
}
