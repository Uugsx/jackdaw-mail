import { readable } from "svelte/store";
import { appGlobal } from "../../logic/app";
import type { ChatRoom } from "../../logic/Chat/ChatRoom";

/** Сколько всего непрочитанных сообщений во всех чатах: счётчик на значке «Чат» в панели приложений.
 * Следит за аккаунтами чата, их комнатами и счётчиком каждой комнаты. */
export const chatUnreadTotal = readable(0, set => {
  let roomUnsubs = new Map<ChatRoom, () => void>();
  let accountUnsubs: (() => void)[] = [];

  function total(): number {
    let sum = 0;
    for (let room of roomUnsubs.keys()) {
      sum += room.unreadCount || 0;
    }
    return sum;
  }

  function watchRooms() {
    let current = new Set<ChatRoom>();
    for (let account of appGlobal.chatAccounts.contents) {
      for (let room of account.rooms.contents) {
        current.add(room);
      }
    }
    for (let [room, unsub] of roomUnsubs) {
      if (!current.has(room)) {
        unsub();
        roomUnsubs.delete(room);
      }
    }
    for (let room of current) {
      if (!roomUnsubs.has(room)) {
        roomUnsubs.set(room, room.subscribe(() => set(total())));
      }
    }
    set(total());
  }

  function watchAccounts() {
    accountUnsubs.forEach(unsub => unsub());
    accountUnsubs = appGlobal.chatAccounts.contents.map(account => account.rooms.subscribe(watchRooms));
    watchRooms();
  }

  let stopAccounts = appGlobal.chatAccounts.subscribe(watchAccounts);
  return () => {
    stopAccounts();
    accountUnsubs.forEach(unsub => unsub());
    roomUnsubs.forEach(unsub => unsub());
    roomUnsubs.clear();
  };
});
