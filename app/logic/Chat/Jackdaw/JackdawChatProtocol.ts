/**
 * Содержимое зашифрованного сообщения чата Jackdaw. Оно расшифровано, но пришло от
 * собеседника, поэтому каждое поле проверяется: размер, тип, формат адресов.
 */
import { normalizeCallEmail } from "../../Meet/Jackdaw/JackdawCallProtocol";

export const CHAT_PAYLOAD_VERSION = 1;
export const MAX_GROUP_MEMBERS = 50;
export const MAX_ATTACHMENTS = 10;
export const MAX_TEXT_LENGTH = 20_000;
/** Совпадает с MAX_CIPHERTEXT_BYTES на сервере */
export const MAX_CIPHERTEXT_BYTES = 96 * 1024;
/** Сколько шифрование добавляет к содержимому: nonce XChaCha20 (24) и тег Poly1305 (16) */
const CIPHERTEXT_OVERHEAD_BYTES = 24 + 16;
/** Сколько id принимает сервер в одном chat-ack (PENDING_BATCH на сервере) */
export const MAX_ACK_IDS = 200;
const MAX_NAME_LENGTH = 120;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MIME_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

export type ChatRoomRef =
  | { type: "direct"; peer?: string }
  | { type: "group"; id: string; name: string; admin: string; members: string[] };

export interface ChatAttachmentRef {
  blobId: string;
  key: string;
  sha256: string;
  name: string;
  mime: string;
  size: number;
}

export type ChatPayload =
  | { v: 1; kind: "message"; id: string; room: ChatRoomRef; text: string; html: string | null; inReplyTo: string | null; attachments: ChatAttachmentRef[] }
  | { v: 1; kind: "read"; id: string; room: ChatRoomRef; ids: string[] }
  /** Состав и название группы от администратора. `leave` — участник сообщает, что вышел.
   * Старые версии не знают `leave` и просто игнорируют такое сообщение не от администратора. */
  | { v: 1; kind: "group"; id: string; room: ChatRoomRef; leave?: true };

function id(value: unknown): string | null {
  return typeof value == "string" && ID_PATTERN.test(value) ? value : null;
}

function text(value: unknown, max: number): string {
  return typeof value == "string" ? value.slice(0, max) : "";
}

function cleanName(value: unknown): string {
  return text(value, MAX_NAME_LENGTH).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

function parseRoom(value: any): ChatRoomRef | null {
  if (value?.type == "direct") {
    let peer = value.peer == null ? undefined : normalizeCallEmail(value.peer);
    return peer === null ? null : { type: "direct", peer };
  }
  if (value?.type == "group") {
    let groupId = id(value.id);
    let admin = normalizeCallEmail(value.admin);
    if (!groupId || !admin || !Array.isArray(value.members)) return null;
    let members = [...new Set(value.members.slice(0, MAX_GROUP_MEMBERS + 1).map(normalizeCallEmail).filter(Boolean))] as string[];
    if (!members.includes(admin)) members.unshift(admin);
    return { type: "group", id: groupId, name: cleanName(value.name), admin, members };
  }
  return null;
}

export function parseAttachment(value: any): ChatAttachmentRef | null {
  if (!value || typeof value != "object") return null;
  let size = value.size;
  if (typeof value.blobId != "string" || !BLOB_ID_PATTERN.test(value.blobId) ||
      typeof value.key != "string" || !BASE64_PATTERN.test(value.key) ||
      typeof value.sha256 != "string" || !BASE64_PATTERN.test(value.sha256) ||
      typeof size != "number" || !Number.isInteger(size) || size < 0) {
    return null;
  }
  let mime = typeof value.mime == "string" && MIME_PATTERN.test(value.mime) ? value.mime.toLowerCase() : "application/octet-stream";
  return { blobId: value.blobId, key: value.key, sha256: value.sha256, name: cleanName(value.name), mime, size };
}

/** Размер шифротекста, который получится из этого содержимого. Проверяется до шифрования. */
export function ciphertextBytes(payload: ChatPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length + CIPHERTEXT_OVERHEAD_BYTES;
}

/** @returns null, если содержимое не соответствует формату */
export function parseChatPayload(value: unknown): ChatPayload | null {
  let data = value as any;
  if (!data || typeof data != "object" || data.v != CHAT_PAYLOAD_VERSION) return null;
  let messageId = id(data.id);
  let room = parseRoom(data.room);
  if (!messageId || !room) return null;
  switch (data.kind) {
    case "message": {
      let attachments = Array.isArray(data.attachments)
        ? data.attachments.slice(0, MAX_ATTACHMENTS).map(parseAttachment).filter(Boolean) as ChatAttachmentRef[]
        : [];
      let body = text(data.text, MAX_TEXT_LENGTH);
      if (!body && !attachments.length) return null;
      return {
        v: 1, kind: "message", id: messageId, room, text: body,
        html: typeof data.html == "string" ? data.html.slice(0, MAX_TEXT_LENGTH * 4) : null,
        inReplyTo: id(data.inReplyTo), attachments,
      };
    }
    case "read": {
      let ids = Array.isArray(data.ids) ? data.ids.slice(0, 200).map(id).filter(Boolean) as string[] : [];
      return ids.length ? { v: 1, kind: "read", id: messageId, room, ids } : null;
    }
    case "group":
      if (room.type != "group") return null;
      return data.leave === true ? { v: 1, kind: "group", id: messageId, room, leave: true } : { v: 1, kind: "group", id: messageId, room };
    default:
      return null;
  }
}
