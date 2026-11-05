/**
 * Заметки к письмам для UI: кэш в памяти поверх таблицы `messageNote`
 * и счётчик изменений, по которому список пересобирает индикаторы.
 */
import type { EMail } from "../EMail";
import { messageNoteKey, listNotedMessageKeys, saveMessageNote, deleteMessageNote, searchMessageNotes } from "./MessageNoteData";
import { writable } from "svelte/store";

/** Меняется при каждой правке заметки или загрузке кэша ящика */
export const messageNotesChanged = writable(0);

/** Запрос открыть редактор заметки у письма (меню, кнопка, горячая клавиша) */
export const noteEditRequest = writable<{ message: EMail, nonce: number } | null>(null);

export function requestNoteEdit(message: EMail) {
  noteEditRequest.set({ message, nonce: Date.now() });
}

/** ящик → (ключ письма → текст) */
const cache = new Map<string, Map<string, string>>();
const loading = new Map<string, Promise<void>>();

function bump() {
  messageNotesChanged.update(value => value + 1);
}

function emailRef(email: EMail): { accountID: string, key: string } | null {
  let accountID = email.folder?.account?.id;
  let key = messageNoteKey(email.messageID, email.pID);
  return accountID && key ? { accountID, key } : null;
}

/** Загружает заметки ящика один раз; после загрузки список обновляется */
export function loadMessageNotes(accountID: string): Promise<void> {
  let existing = loading.get(accountID);
  if (existing) {
    return existing;
  }
  let promise = (async () => {
    try {
      cache.set(accountID, await listNotedMessageKeys(accountID));
    } catch (ex) {
      console.error("Message notes load failed", ex);
      cache.set(accountID, new Map());
    }
    bump();
  })();
  loading.set(accountID, promise);
  return promise;
}

/** Текст заметки из кэша; при первом обращении к ящику запускает загрузку */
export function getMessageNoteText(email: EMail): string | null {
  let ref = emailRef(email);
  if (!ref) {
    return null;
  }
  let notes = cache.get(ref.accountID);
  if (!notes) {
    void loadMessageNotes(ref.accountID);
    return null;
  }
  return notes.get(ref.key) ?? null;
}

export function hasMessageNote(email: EMail): boolean {
  return !!getMessageNoteText(email);
}

/** Пустой текст удаляет заметку. @returns сохранённый текст или null */
export async function setMessageNote(email: EMail, text: string): Promise<string | null> {
  let ref = emailRef(email);
  if (!ref) {
    return null;
  }
  let record = await saveMessageNote(ref.accountID, ref.key, text);
  let notes = cache.get(ref.accountID) ?? new Map<string, string>();
  cache.set(ref.accountID, notes);
  if (record) {
    notes.set(ref.key, record.text);
  } else {
    notes.delete(ref.key);
  }
  bump();
  return record?.text ?? null;
}

export async function removeMessageNote(email: EMail): Promise<void> {
  let ref = emailRef(email);
  if (!ref) {
    return;
  }
  await deleteMessageNote(ref.accountID, ref.key);
  cache.get(ref.accountID)?.delete(ref.key);
  bump();
}

/** Ключи писем ящика, у которых заметка содержит текст */
export async function findNotedMessageKeys(accountID: string, term: string): Promise<Set<string>> {
  return await searchMessageNotes(accountID, term);
}

/** Совпадает ли заметка письма с поисковой строкой (для проверки в памяти) */
export function messageNoteMatches(email: EMail, term: string): boolean {
  let text = getMessageNoteText(email);
  return !!text && text.toLowerCase().includes(term.trim().toLowerCase());
}
