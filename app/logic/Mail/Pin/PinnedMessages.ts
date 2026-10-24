/**
 * Закреплённые письма, как «Закрепить» в Outlook: стоят вверху списка папки.
 * Хранятся здесь (`mail.pinned.v1`) по ящику и Message-ID, на сервер не уходят.
 */
import type { EMail } from "../EMail";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { writable } from "svelte/store";

export const kPinnedKey = "mail.pinned.v1";

/** Меняется при каждом закреплении/откреплении: список пересобирается */
export const pinnedMessagesChanged = writable(0);

let cache: Set<string> | null = null;

function pinnedKeys(): Set<string> {
  if (!cache) {
    let value = getLocalStorage<string[]>(kPinnedKey, []).value;
    cache = new Set(Array.isArray(value) ? value.filter(key => typeof key == "string") : []);
  }
  return cache;
}

/** Ключ письма: ящик и Message-ID, без него — ID письма на сервере */
export function pinKey(email: EMail): string | null {
  let accountID = email.folder?.account?.id;
  let id = email.messageID || (email.pID != null ? "pid:" + email.pID : null);
  return accountID && id ? accountID + "\t" + id : null;
}

export function hasPinnedMessages(): boolean {
  return pinnedKeys().size > 0;
}

export function isMessagePinned(email: EMail): boolean {
  let key = pinKey(email);
  return !!key && pinnedKeys().has(key);
}

export function setMessagePinned(email: EMail, pinned: boolean): void {
  let key = pinKey(email);
  if (!key) {
    return;
  }
  let keys = pinnedKeys();
  if (pinned == keys.has(key)) {
    return;
  }
  if (pinned) {
    keys.add(key);
  } else {
    keys.delete(key);
  }
  getLocalStorage<string[]>(kPinnedKey, []).value = [...keys];
  pinnedMessagesChanged.update(count => count + 1);
}

export function toggleMessagePinned(email: EMail): void {
  setMessagePinned(email, !isMessagePinned(email));
}

/** Для тестов: забыть прочитанное из хранилища */
export function resetPinnedCache(): void {
  cache = null;
}
