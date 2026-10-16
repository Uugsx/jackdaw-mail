// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { describe, expect, test, beforeAll, beforeEach, vi } from "vitest";
import { setupChatTestEnv } from "../XMPP/setup";
import {
  decryptFile,
  decryptMessage,
  deviceKeysFromJSON,
  deviceKeysToJSON,
  encryptFile,
  encryptMessage,
  generateDeviceKeys,
  keyFingerprint,
  ChatDecryptError,
} from "../../../../logic/Chat/Jackdaw/JackdawChatCrypto";
import { parseChatPayload } from "../../../../logic/Chat/Jackdaw/JackdawChatProtocol";
import { JackdawChatAccount } from "../../../../logic/Chat/Jackdaw/JackdawChatAccount";
import type { JackdawChatRoom } from "../../../../logic/Chat/Jackdaw/JackdawChatRoom";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { Group } from "../../../../logic/Abstract/Group";
import { parseServerMessage } from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";

// Секретный ключ устройства сохраняется через localStorage; в Node его нет.
const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryStorage.set(key, value),
  removeItem: (key: string) => void memoryStorage.delete(key),
});

describe("шифрование чата", () => {
  test("получатель расшифровывает, посторонний — нет", () => {
    let alice = generateDeviceKeys(), bob = generateDeviceKeys(), eve = generateDeviceKeys();
    let encrypted = encryptMessage({ hello: "мир" }, "msg-0001", alice, [bob, alice]);
    expect(Object.keys(encrypted.keys)).toEqual([bob.deviceId]);
    expect(decryptMessage(encrypted.ciphertext, encrypted.keys[bob.deviceId], "msg-0001", alice, bob)).toEqual({ hello: "мир" });
    expect(() => decryptMessage(encrypted.ciphertext, encrypted.keys[bob.deviceId], "msg-0001", alice, { ...eve, deviceId: bob.deviceId }))
      .toThrow(ChatDecryptError);
  });

  test("подменить отправителя или id нельзя", () => {
    let alice = generateDeviceKeys(), bob = generateDeviceKeys(), mallory = generateDeviceKeys();
    let encrypted = encryptMessage({ text: "x" }, "msg-0001", alice, [bob]);
    // Сервер утверждает, что сообщение от mallory — ключ не развернётся.
    expect(() => decryptMessage(encrypted.ciphertext, encrypted.keys[bob.deviceId], "msg-0001", { ...mallory, deviceId: alice.deviceId }, bob))
      .toThrow(ChatDecryptError);
    expect(() => decryptMessage(encrypted.ciphertext, encrypted.keys[bob.deviceId], "msg-0002", alice, bob)).toThrow(ChatDecryptError);
  });

  test("повреждённый шифротекст отклоняется", () => {
    let alice = generateDeviceKeys(), bob = generateDeviceKeys();
    let encrypted = encryptMessage({ text: "x" }, "msg-0001", alice, [bob]);
    let broken = encrypted.ciphertext.slice(0, -4) + (encrypted.ciphertext.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptMessage(broken, encrypted.keys[bob.deviceId], "msg-0001", alice, bob)).toThrow(ChatDecryptError);
  });

  test("файлы: расшифровка и проверка целостности", () => {
    let content = new TextEncoder().encode("файл");
    let encrypted = encryptFile(content);
    expect(new TextDecoder().decode(decryptFile(encrypted.data, encrypted.key, encrypted.sha256))).toBe("файл");
    let tampered = encrypted.data.slice();
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptFile(tampered, encrypted.key, encrypted.sha256)).toThrow(ChatDecryptError);
  });

  test("ключи устройства сохраняются и восстанавливаются", () => {
    let keys = generateDeviceKeys();
    let restored = deviceKeysFromJSON(deviceKeysToJSON(keys))!;
    expect(restored.deviceId).toBe(keys.deviceId);
    expect(restored.publicKey).toEqual(keys.publicKey);
    expect(deviceKeysFromJSON("nonsense")).toBeNull();
    expect(keyFingerprint(keys.publicKey)).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  });
});

describe("формат содержимого", () => {
  const room = { type: "direct" };
  test("корректное сообщение", () => {
    expect(parseChatPayload({ v: 1, kind: "message", id: "msg-00000001", room, text: "hi", attachments: [] }))
      .toMatchObject({ kind: "message", text: "hi", html: null, inReplyTo: null });
  });
  test("мусор отклоняется", () => {
    expect(parseChatPayload(null)).toBeNull();
    expect(parseChatPayload({ v: 2, kind: "message", id: "msg-00000001", room, text: "hi" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "message", id: "../x", room, text: "hi" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "message", id: "msg-00000001", room, text: "" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "message", id: "msg-00000001", room: { type: "direct", peer: "not-an-email" }, text: "hi" })).toBeNull();
  });
  test("вложения и группы проверяются", () => {
    let payload = parseChatPayload({
      v: 1, kind: "message", id: "msg-00000001", text: "",
      room: { type: "group", id: "group-0001", name: "Команда\u0007", admin: "A@x.com", members: ["b@x.com", "bad"] },
      attachments: [
        { blobId: "a".repeat(32), key: "AAAA", sha256: "BBBB", name: "../../etc/passwd", mime: "image/png", size: 10 },
        { blobId: "../x", key: "AAAA", sha256: "BBBB", size: 1 },
      ],
    }) as any;
    expect(payload.room).toEqual({ type: "group", id: "group-0001", name: "Команда", admin: "a@x.com", members: ["a@x.com", "b@x.com"] });
    expect(payload.attachments).toHaveLength(1);
  });
});

/** Сервер чата в памяти с теми же правилами маршрутизации, что call_server/chat.py */
class FakeServer {
  devices = new Map<string, { deviceId: string; publicKey: string }[]>();
  owners = new Map<string, string[]>();
  queues = new Map<string, any[]>();
  online = new Map<string, FakeClient>();
  blobs = new Map<string, string[]>();

  handle(client: FakeClient, msg: any) {
    switch (msg.type) {
      case "chat-register": {
        for (let email of client.verifiedEmails) {
          let list = (this.devices.get(email) ?? []).filter(d => d.deviceId != msg.deviceId);
          this.devices.set(email, [...list, { deviceId: msg.deviceId, publicKey: msg.publicKey }]);
        }
        this.owners.set(msg.deviceId, client.verifiedEmails);
        client.deviceId = msg.deviceId;
        this.online.set(msg.deviceId, client);
        client.emit({ type: "chat-registered", deviceId: msg.deviceId, emails: client.verifiedEmails });
        for (let envelope of this.queues.get(msg.deviceId) ?? []) client.emit(envelope);
        client.emit({ type: "chat-pending", count: 0, remaining: 0 });
        break;
      }
      case "chat-keys":
        client.emit({ type: "chat-keys-result", requestId: msg.requestId, devices: Object.fromEntries(msg.emails.map((e: string) => [e, this.devices.get(e) ?? []])) });
        break;
      case "chat-send": {
        let allowed = new Set([...msg.recipients, ...client.verifiedEmails]);
        let delivered = 0;
        for (let [target, key] of Object.entries(msg.keys)) {
          if (!(this.owners.get(target) ?? []).some(e => allowed.has(e))) continue;
          let envelope = { type: "chat-message", messageId: msg.messageId, from: msg.from, fromDevice: client.deviceId, ciphertext: msg.ciphertext, key, sentAt: 1_800_000_000_000 };
          this.queues.set(target, [...(this.queues.get(target) ?? []), envelope]);
          let peer = this.online.get(target);
          if (peer) {
            peer.emit(envelope);
            delivered++;
          }
        }
        client.emit({ type: "chat-sent", messageId: msg.messageId, queued: Object.keys(msg.keys).length, delivered });
        break;
      }
      case "chat-ack":
        this.queues.set(client.deviceId, (this.queues.get(client.deviceId) ?? []).filter(e => !msg.messageIds.includes(e.messageId)));
        break;
      case "blob-put":
        this.blobs.set(msg.blobId, [...(this.blobs.get(msg.blobId) ?? []), msg.data]);
        client.emit({ type: "blob-stored", blobId: msg.blobId, index: msg.index, complete: msg.index == msg.total - 1 });
        break;
      case "blob-get": {
        let chunks = this.blobs.get(msg.blobId) ?? [];
        client.emit({ type: "blob-data", blobId: msg.blobId, index: msg.index, total: chunks.length, data: chunks[msg.index] });
        break;
      }
    }
  }
}

class FakeClient {
  isOnline = true;
  deviceId = "";
  listeners = new Set<(m: any) => void>();
  waiters: { match: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void }[] = [];
  counter = 0;
  constructor(public server: FakeServer, public verifiedEmails: string[]) {}
  addListener(fn: (m: any) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  subscribe(fn: (o: any) => void) { fn(this); return () => {}; }
  nextRequestID(prefix: string) { return `${prefix}-${++this.counter}`; }
  send(msg: any) { queueMicrotask(() => this.server.handle(this, JSON.parse(JSON.stringify(msg)))); }
  request(msg: any, match: (m: any) => boolean) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ match, resolve, reject });
      this.send(msg);
    });
  }
  emit(raw: any) {
    // Тот же разбор, что у настоящего клиента
    let message = parseServerMessage(JSON.stringify(raw));
    if (!message) throw new Error("bad server message " + raw.type);
    for (let fn of this.listeners) fn(message);
    for (let waiter of [...this.waiters]) {
      if (waiter.match(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        message.type == "error" ? waiter.reject(new Error(message.code)) : waiter.resolve(message);
      }
    }
  }
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

async function makeAccount(server: FakeServer, email: string) {
  memoryStorage.clear(); // новое устройство — новый ключ
  let account = new JackdawChatAccount();
  account.storage = new DummyChatStorage();
  account.errorCallback = ex => { throw ex; };
  let client = new FakeClient(server, [email]);
  account.attachClient(client as any);
  await account.login(false);
  await settle();
  return { account, client };
}

describe("чат между двумя пользователями", () => {
  let server: FakeServer;
  beforeAll(async () => {
    await setupChatTestEnv();
  });
  beforeEach(() => {
    server = new FakeServer();
    // Каждый аккаунт в тесте — отдельное устройство со своим ключом.
    memoryStorage.clear();
  });

  test("устройство регистрируется после подтверждения адреса", async () => {
    let { account } = await makeAccount(server, "alice@example.com");
    expect(account.isOnline).toBe(true);
    expect(account.registeredEmails).toEqual(["alice@example.com"]);
    expect(server.devices.get("alice@example.com")).toHaveLength(1);
  });

  test("личное сообщение доходит и отмечается прочитанным", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("Bob@Example.com");
    expect(room.id).toBe("direct:bob@example.com");
    let msg = room.newMessage();
    msg.text = "Привет, Боб";
    await room.sendMessage(msg);
    await settle();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.User);
    let bobRoom = bob.account.findRoomByID("direct:alice@example.com")!;
    expect(bobRoom).toBeTruthy();
    let received = bobRoom.messages.first as any;
    expect(received.text).toBe("Привет, Боб");
    expect(received.outgoing).toBe(false);
    expect(received.from.chatID).toBe("alice@example.com");
    expect(server.queues.get(bob.client.deviceId)).toEqual([]);
    await received.markRead(true);
    await settle();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Seen);
  });

  test("сообщение офлайн-получателю доставляется при подключении", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    server.online.delete(bob.client.deviceId);
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "пока ты был офлайн";
    await room.sendMessage(msg);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Server);
    expect(bob.account.findRoomByID("direct:alice@example.com")).toBeNull();
    server.handle(bob.client, { type: "chat-register", deviceId: bob.client.deviceId, publicKey: server.devices.get("bob@example.com")![0].publicKey });
    await settle();
    expect((bob.account.findRoomByID("direct:alice@example.com")!.messages.first as any).text).toBe("пока ты был офлайн");
  });

  test("повторная доставка не дублирует сообщение", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "один раз";
    server.online.delete(bob.client.deviceId); // без ack останется в очереди
    await room.sendMessage(msg);
    let envelope = server.queues.get(bob.client.deviceId)![0];
    bob.client.emit(envelope);
    bob.client.emit(envelope);
    await settle();
    expect(bob.account.findRoomByID("direct:alice@example.com")!.messages.length).toBe(1);
  });

  test("копия отправленного приходит на другое своё устройство", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let alice2 = await makeAccount(server, "alice@example.com");
    await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "с ноутбука";
    await room.sendMessage(msg);
    await settle();
    let copy = alice2.account.findRoomByID("direct:bob@example.com")!.messages.first as any;
    expect(copy.text).toBe("с ноутбука");
    expect(copy.outgoing).toBe(true);
  });

  test("отправка контакту без чата — понятная ошибка", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let room = await alice.account.getDirectRoom("nobody@example.com");
    let msg = room.newMessage();
    msg.text = "x";
    await expect(room.sendMessage(msg)).rejects.toThrow();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Unknown);
    expect(await alice.account.canChatWith("nobody@example.com")).toBe(false);
  });

  test("файл шифруется, загружается частями и расшифровывается у получателя", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "фото";
    let bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    let attachment = msg.newAttachment();
    attachment.filename = "photo.png";
    attachment.mimeType = "image/png";
    attachment.content = new File([bytes], "photo.png", { type: "image/png" });
    msg.attachments.add(attachment);
    await room.sendMessage(msg);
    await settle();
    let [blobId] = [...server.blobs.keys()];
    expect(server.blobs.get(blobId)!.length).toBe(2);
    let received = bob.account.findRoomByID("direct:alice@example.com")!.messages.first as any;
    let att = received.attachments.first;
    expect(att.filename).toBe("photo.png");
    expect(new Uint8Array(await att.content.arrayBuffer())).toEqual(bytes);
  });

  test("группа: создание, сообщение, посторонний не может писать", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let carol = await makeAccount(server, "carol@example.com");
    let eve = await makeAccount(server, "eve@example.com");
    let group = await alice.account.createGroup("Команда", ["bob@example.com", "carol@example.com"]);
    await settle();
    expect(group.contact).toBeInstanceOf(Group);
    expect(group.isAdmin).toBe(true);
    let bobGroup = bob.account.findRoomByID(group.id) as JackdawChatRoom;
    expect(bobGroup.name).toBe("Команда");
    expect(bobGroup.memberEmails.sort()).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
    expect(bobGroup.isAdmin).toBe(false);

    let msg = bobGroup.newMessage();
    msg.text = "всем привет";
    await bobGroup.sendMessage(msg);
    await settle();
    expect((carol.account.findRoomByID(group.id)!.messages.first as any).text).toBe("всем привет");
    expect((group.messages.first as any).from.chatID).toBe("bob@example.com");

    // eve знает id группы, но не участник: её сообщение отбрасывается
    let fake = eve.account.newRoom(true) as JackdawChatRoom;
    fake.id = group.id;
    await fake.applyGroupInfo({ type: "group", id: group.id.slice(6), name: "Взлом", admin: "eve@example.com", members: ["eve@example.com", "alice@example.com"] }, false);
    let evil = fake.newMessage();
    evil.text = "я теперь админ";
    await fake.sendMessage(evil);
    await settle();
    expect(group.name).toBe("Команда");
    expect(group.messages.contents.some((m: any) => m.text == "я теперь админ")).toBe(false);
  });

  test("смена ключа собеседника показывает предупреждение", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    await makeAccount(server, "bob@example.com");
    await alice.account.devicesFor(["bob@example.com"]);
    expect(alice.account.keyWarnings).toEqual([]);
    await makeAccount(server, "bob@example.com"); // второе устройство Боба
    await alice.account.devicesFor(["bob@example.com"], true);
    expect(alice.account.keyWarnings).toHaveLength(1);
  });

  test("нерасшифровываемое сообщение не теряется молча", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    bob.client.emit({ type: "chat-message", messageId: "msg-broken-1", from: "alice@example.com", fromDevice: alice.client.deviceId, ciphertext: "AAAA", key: "AAAA", sentAt: 1 });
    await settle();
    let room = bob.account.findRoomByID("direct:alice@example.com")!;
    expect((room.messages.first as any).text).toMatch(/decrypt|расшифр/i);
  });
});
