/**
 * Метка письма общего ящика для сервера присутствия (call_server/presence.py).
 *
 * Сервер не должен узнать, какое это письмо: тема, отправитель и Message-ID ему не передаются.
 * Метка — HMAC-SHA256 от Message-ID, ключ выводится из адреса ящика. У всех членов ящика метка
 * одного письма совпадает, поэтому они видят друг друга.
 *
 * Ограничение: адрес ящика серверу известен, значит общего секрета, скрытого от сервера, здесь нет.
 * Метка защищает Message-ID ровно настолько, насколько его трудно угадать: сервер может проверить
 * письмо, Message-ID которого он уже знает (например, сам его получил), но не может восстановить
 * письмо по метке. Ключ команды, неизвестный серверу, требует раздачи через сквозной чат — следующий шаг.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const KEY_CONTEXT = "jackdaw-shared-mailbox-collision-v1";
/** Длиннее Message-ID не бывают на практике (RFC 5322 ограничивает строку 998 символами) */
const MAX_MESSAGE_ID_LENGTH = 998;
const encoder = new TextEncoder();

/** Message-ID без угловых скобок и пробелов: разные протоколы отдают его по-разному. */
export function normalizeMessageID(messageID: string | null | undefined): string | null {
  if (typeof messageID != "string") return null;
  let value = messageID.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  if (!value || value.length > MAX_MESSAGE_ID_LENGTH || /\s/.test(value)) return null;
  return value;
}

/** @returns null, если у письма нет пригодного Message-ID */
export function collisionTag(mailbox: string, messageID: string | null | undefined): string | null {
  let id = normalizeMessageID(messageID);
  if (!id) return null;
  let key = sha256(encoder.encode(`${KEY_CONTEXT}\u0000${mailbox.trim().toLowerCase()}`));
  return bytesToHex(hmac(sha256, key, encoder.encode(id)));
}
