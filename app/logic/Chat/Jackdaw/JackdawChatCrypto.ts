/**
 * Сквозное шифрование чата Jackdaw ↔ Jackdaw.
 *
 * Схема (без прямой секретности, это осознанное упрощение первой версии):
 * - у каждого устройства статическая пара X25519; открытый ключ публикуется на сервере;
 * - каждое сообщение шифруется случайным ключом XChaCha20-Poly1305, `messageId` входит в AAD;
 * - ключ сообщения заворачивается для каждого устройства получателя ключом
 *   HKDF(X25519(ключ отправителя, ключ получателя), salt = messageId, info = устройства).
 *   Развернуть его могут только отправитель и это устройство, поэтому удачная расшифровка
 *   доказывает, что сообщение пришло с устройства отправителя: подделать отправителя
 *   не может ни сервер, ни другой участник группы.
 * - файлы шифруются отдельным случайным ключом; ключ файла лежит внутри зашифрованного сообщения.
 *
 * Сервер раздаёт открытые ключи, поэтому теоретически может подменить их. Против этого:
 * `JackdawChatAccount` запоминает увиденные ключи и предупреждает о новом устройстве
 * или смене ключа, а отпечаток ключа можно сверить с собеседником.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const NONCE_BYTES = 24;
const KEY_BYTES = 32;
const WRAP_INFO = "jackdaw-chat-wrap-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DeviceKeys {
  deviceId: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface RemoteDevice {
  deviceId: string;
  publicKey: Uint8Array;
}

export class ChatDecryptError extends Error {
  constructor(message = "Could not decrypt the chat message") {
    super(message);
    this.name = "ChatDecryptError";
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  let binary = atob(value);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateDeviceKeys(): DeviceKeys {
  let secretKey = x25519.utils.randomSecretKey();
  return {
    deviceId: `chat-${crypto.randomUUID()}`,
    secretKey,
    publicKey: x25519.getPublicKey(secretKey),
  };
}

export function deviceKeysToJSON(keys: DeviceKeys): string {
  return JSON.stringify({ deviceId: keys.deviceId, secretKey: toBase64(keys.secretKey) });
}

export function deviceKeysFromJSON(json: string): DeviceKeys | null {
  try {
    let value = JSON.parse(json);
    if (typeof value?.deviceId != "string" || typeof value?.secretKey != "string") return null;
    let secretKey = fromBase64(value.secretKey);
    if (secretKey.length != KEY_BYTES) return null;
    return { deviceId: value.deviceId, secretKey, publicKey: x25519.getPublicKey(secretKey) };
  } catch {
    return null;
  }
}

/** Отпечаток ключа для сверки с собеседником: 8 групп по 4 шестнадцатеричных знака. */
export function keyFingerprint(publicKey: Uint8Array): string {
  let hex = Array.from(sha256(publicKey).subarray(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{4}/g)!.join(" ");
}

function wrapKey(shared: Uint8Array, messageId: string, senderDevice: string, recipientDevice: string): Uint8Array {
  return hkdf(sha256, shared, encoder.encode(messageId), encoder.encode(`${WRAP_INFO}|${senderDevice}|${recipientDevice}`), KEY_BYTES);
}

export interface EncryptedMessage {
  ciphertext: string;
  /** deviceId → завёрнутый ключ сообщения */
  keys: Record<string, string>;
}

export function encryptMessage(plaintext: unknown, messageId: string, sender: DeviceKeys, recipients: RemoteDevice[]): EncryptedMessage {
  let contentKey = randomBytes(KEY_BYTES);
  let nonce = randomBytes(NONCE_BYTES);
  let sealed = xchacha20poly1305(contentKey, nonce, encoder.encode(messageId)).encrypt(encoder.encode(JSON.stringify(plaintext)));
  let keys: Record<string, string> = {};
  for (let device of recipients) {
    if (device.deviceId == sender.deviceId) continue;
    let shared = x25519.getSharedSecret(sender.secretKey, device.publicKey);
    let kek = wrapKey(shared, messageId, sender.deviceId, device.deviceId);
    let wrapNonce = randomBytes(NONCE_BYTES);
    let wrapped = xchacha20poly1305(kek, wrapNonce).encrypt(contentKey);
    keys[device.deviceId] = toBase64(concat(wrapNonce, wrapped));
  }
  return { ciphertext: toBase64(concat(nonce, sealed)), keys };
}

/** @throws ChatDecryptError — подделка, чужой ключ или повреждение */
export function decryptMessage(ciphertext: string, wrappedKey: string, messageId: string, sender: RemoteDevice, me: DeviceKeys): unknown {
  try {
    let wrappedBytes = fromBase64(wrappedKey);
    let shared = x25519.getSharedSecret(me.secretKey, sender.publicKey);
    let kek = wrapKey(shared, messageId, sender.deviceId, me.deviceId);
    let contentKey = xchacha20poly1305(kek, wrappedBytes.subarray(0, NONCE_BYTES)).decrypt(wrappedBytes.subarray(NONCE_BYTES));
    let sealed = fromBase64(ciphertext);
    let plaintext = xchacha20poly1305(contentKey, sealed.subarray(0, NONCE_BYTES), encoder.encode(messageId))
      .decrypt(sealed.subarray(NONCE_BYTES));
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new ChatDecryptError();
  }
}

export interface EncryptedFile {
  data: Uint8Array;
  key: string;
  sha256: string;
}

export function encryptFile(content: Uint8Array): EncryptedFile {
  let key = randomBytes(KEY_BYTES);
  let nonce = randomBytes(NONCE_BYTES);
  let data = concat(nonce, xchacha20poly1305(key, nonce).encrypt(content));
  return { data, key: toBase64(key), sha256: toBase64(sha256(data)) };
}

/** @throws ChatDecryptError, если файл подменён или повреждён */
export function decryptFile(data: Uint8Array, key: string, expectedSha256: string): Uint8Array {
  if (toBase64(sha256(data)) != expectedSha256) {
    throw new ChatDecryptError("The file was changed or damaged");
  }
  try {
    return xchacha20poly1305(fromBase64(key), data.subarray(0, NONCE_BYTES)).decrypt(data.subarray(NONCE_BYTES));
  } catch {
    throw new ChatDecryptError("The file was changed or damaged");
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  let result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}
