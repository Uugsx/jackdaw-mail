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
import { isFutureChatPayload, parseChatPayload } from "../../../../logic/Chat/Jackdaw/JackdawChatProtocol";
import { JackdawChatAccount } from "../../../../logic/Chat/Jackdaw/JackdawChatAccount";
import { JackdawChatConnectionError } from "../../../../logic/Chat/Jackdaw/chatConnectionProblem";
import type { JackdawChatRoom } from "../../../../logic/Chat/Jackdaw/JackdawChatRoom";
import { DummyChatStorage } from "../../../../logic/Chat/SQL/DummyChatStorage";
import { DeliveryStatus } from "../../../../logic/Chat/ChatMessage";
import { Group } from "../../../../logic/Abstract/Group";
import { parseServerMessage } from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import { JackdawCallServiceError } from "../../../../logic/Meet/Jackdaw/JackdawCallClient";
import { CHAT_PAYLOAD_VERSION } from "../../../../logic/Chat/Jackdaw/JackdawChatProtocol";

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
  /** Все принятые chat-send, в порядке поступления */
  sent: any[] = [];

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
        this.sent.push(msg);
        let allowed = new Set([...msg.recipients, ...client.verifiedEmails]);
        let targets = Object.entries(msg.keys).filter(([target]) => (this.owners.get(target) ?? []).some(e => allowed.has(e)));
        if (!targets.length) {
          // Как call_server/chat.py: сообщение без ключей никто не прочитает
          client.emit({ type: "error", code: "no_recipients", message: "", requestType: "chat-send", messageId: msg.messageId });
          break;
        }
        let delivered = 0;
        for (let [target, key] of targets) {
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
  status = "online";
  lastError: string | null = null;
  offlineSince: number | null = null;
  deviceId = "";
  listeners = new Set<(m: any) => void>();
  observers = new Set<(o: any) => void>();
  /** Что делает `restart()`: по умолчанию ничего */
  onRestart: () => void = () => {};
  waiters: { match: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void }[] = [];
  counter = 0;
  constructor(public server: FakeServer, public verifiedEmails: string[]) {}
  addListener(fn: (m: any) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  subscribe(fn: (o: any) => void) { fn(this); this.observers.add(fn); return () => this.observers.delete(fn); }
  /** Состояние соединения, как у настоящего клиента: наблюдатели узнают о смене */
  setStatus(status: string, lastError: string | null = null, offlineSince: number | null = null) {
    this.status = status;
    this.isOnline = status == "online";
    this.lastError = lastError;
    this.offlineSince = offlineSince;
    for (let fn of [...this.observers]) fn(this);
  }
  restart() { this.onRestart(); }
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
        message.type == "error" ? waiter.reject(new JackdawCallServiceError(message.code)) : waiter.resolve(message);
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

  test("сообщение на свой адрес без других своих устройств — понятная ошибка, а не пустой список ключей", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    // Личный чат с собой не создаётся
    await expect(alice.account.getDirectRoom("Alice@example.com")).rejects.toThrow(/your own address/);
    expect(alice.account.findRoomByID("direct:alice@example.com")).toBeNull();
    // Комната с собой из старой версии: отправка даёт понятную ошибку
    let room = alice.account.newRoom(false) as JackdawChatRoom;
    room.id = "direct:alice@example.com";
    room.contact = alice.account.getPersonUID("alice@example.com");
    let msg = room.newMessage();
    msg.text = "себе";
    await expect(room.sendMessage(msg)).rejects.toThrow(/your own address/);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);
  });

  test("отправка контакту без чата — понятная ошибка", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let room = await alice.account.getDirectRoom("nobody@example.com");
    let msg = room.newMessage();
    msg.text = "x";
    await expect(room.sendMessage(msg)).rejects.toThrow();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);
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
    await bob.account.getDirectRoom("alice@example.com"); // известный собеседник
    bob.client.emit({ type: "chat-message", messageId: "msg-broken-1", from: "alice@example.com", fromDevice: alice.client.deviceId, ciphertext: "AAAA", key: "AAAA", sentAt: 1 });
    await settle();
    let room = bob.account.findRoomByID("direct:alice@example.com")!;
    expect((room.messages.first as any).text).toMatch(/decrypt|расшифр/i);
  });
});

describe("надёжность чата", () => {
  let server: FakeServer;
  beforeAll(async () => {
    await setupChatTestEnv();
  });
  beforeEach(() => {
    server = new FakeServer();
    memoryStorage.clear();
  });

  /** Переподключение: сервер снова регистрирует устройство */
  function reconnect(peer: { client: FakeClient }, email: string) {
    peer.client.isOnline = true;
    let publicKey = server.devices.get(email)!.find(d => d.deviceId == peer.client.deviceId)!.publicKey;
    server.handle(peer.client, { type: "chat-register", deviceId: peer.client.deviceId, publicKey });
  }

  test("без связи: «не отправлено», понятная ошибка, досылка после переподключения", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    alice.client.isOnline = false;
    let msg = room.newMessage();
    msg.text = "без сети";
    await expect(room.sendMessage(msg)).rejects.toThrow(/No connection/);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);
    expect(room.messages.contents).toContain(msg);
    expect(room.lastMessage).toBe(msg);

    reconnect(alice, "alice@example.com");
    await settle();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.User);
    let bobRoom = bob.account.findRoomByID("direct:alice@example.com")!;
    expect(bobRoom.messages.contents.map((m: any) => m.text)).toEqual(["без сети"]);
  });

  test("«Повторить» и двойной Enter не отправляют дважды, файл не загружается повторно", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");

    let msg = room.newMessage();
    msg.text = "дважды";
    await Promise.all([room.sendMessage(msg), room.sendMessage(msg)]);
    await room.sendMessage(msg); // уже доставлено
    expect(server.sent.filter(m => m.messageId == msg.id)).toHaveLength(1);

    // Первая попытка: файл загружен, а отправка сорвалась
    let withFile = room.newMessage();
    withFile.text = "с файлом";
    let attachment = withFile.newAttachment();
    attachment.fromFile(new File([new Uint8Array([1, 2, 3])], "a.bin", { type: "application/octet-stream" }));
    withFile.attachments.add(attachment);
    let sendPayload = alice.account.sendPayload.bind(alice.account);
    let spy = vi.spyOn(alice.account, "sendPayload").mockRejectedValueOnce(new Error("обрыв"));
    await expect(room.sendMessage(withFile)).rejects.toThrow("обрыв");
    expect(withFile.deliveryStatus).toBe(DeliveryStatus.Failed);
    spy.mockImplementation(sendPayload);
    await room.sendMessage(withFile); // «Повторить»
    await settle();
    expect(withFile.deliveryStatus).toBe(DeliveryStatus.User);
    expect(server.blobs.size).toBe(1);
    let received = bob.account.findRoomByID("direct:alice@example.com")!.messages.contents.find((m: any) => m.text == "с файлом") as any;
    expect(new Uint8Array(await received.attachments.first.content.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("два файла с одним именем не сливаются", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "два файла";
    for (let byte of [1, 2]) {
      let attachment = msg.newAttachment();
      attachment.fromFile(new File([new Uint8Array([byte])], "same.txt", { type: "text/plain" }));
      msg.attachments.add(attachment);
    }
    await room.sendMessage(msg);
    await settle();
    expect(msg.attachments.contents.map(a => a.filename)).toEqual(["same.txt", "same-2.txt"]);
    let received = bob.account.findRoomByID("direct:alice@example.com")!.messages.first as any;
    expect(received.attachments.contents.map((a: any) => a.filename)).toEqual(["same.txt", "same-2.txt"]);
    let contents = await Promise.all(received.attachments.contents.map(async (a: any) => [...new Uint8Array(await a.content.arrayBuffer())]));
    expect(contents).toEqual([[1], [2]]);
  });

  test("несколько своих адресов: ответ уходит с адреса, на который писали, чат не раздваивается", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let alice2Client = new FakeClient(server, ["alice@example.com", "alice@work.example"]);
    memoryStorage.clear();
    let alice2 = new JackdawChatAccount();
    alice2.storage = new DummyChatStorage();
    alice2.errorCallback = ex => { throw ex; };
    alice2.attachClient(alice2Client as any);
    await alice2.login(false);
    await settle();
    let bob = await makeAccount(server, "bob@example.com");

    // Боб пишет на рабочий адрес Алисы
    let bobRoom = await bob.account.getDirectRoom("alice@work.example");
    let hello = bobRoom.newMessage();
    hello.text = "на рабочий";
    await bobRoom.sendMessage(hello);
    await settle();
    let aliceRoom = alice2.findRoomByID("direct:bob@example.com")!;
    expect(aliceRoom.ownEmail).toBe("alice@work.example");

    let reply = aliceRoom.newMessage();
    reply.text = "ответ";
    await aliceRoom.sendMessage(reply);
    await settle();
    expect(server.sent.find(m => m.messageId == reply.id).from).toBe("alice@work.example");
    // У Боба ответ в том же чате, второго не появилось
    expect(bob.account.rooms.contents.map((r: any) => r.id)).toEqual(["direct:alice@work.example"]);
    expect(bobRoom.messages.contents.map((m: any) => m.text)).toEqual(["на рабочий", "ответ"]);
    // Первое устройство Алисы знает только alice@example.com, но узнаёт своё устройство:
    // копия попадает в чат с Бобом как исходящее, а не в чат с «alice@work.example»
    let copy = alice.account.findRoomByID("direct:bob@example.com")!.messages.contents.find((m: any) => m.text == "ответ") as any;
    expect(copy.outgoing).toBe(true);
    expect(alice.account.findRoomByID("direct:alice@work.example")).toBeNull();
  });

  test("группа: отправка с адреса из состава группы", async () => {
    let aliceClient = new FakeClient(server, ["alice@example.com", "alice@work.example"]);
    memoryStorage.clear();
    let alice = new JackdawChatAccount();
    alice.storage = new DummyChatStorage();
    alice.errorCallback = ex => { throw ex; };
    alice.attachClient(aliceClient as any);
    await alice.login(false);
    await settle();
    await makeAccount(server, "bob@example.com");
    let group = alice.newRoom(true) as JackdawChatRoom;
    group.id = "group:team-0001";
    await group.applyGroupInfo({ type: "group", id: "team-0001", name: "Работа", admin: "alice@work.example", members: ["alice@work.example", "bob@example.com"] }, false);
    alice.rooms.set(group.contact, group);
    let msg = group.newMessage();
    msg.text = "всем";
    await group.sendMessage(msg);
    expect(server.sent.find(m => m.messageId == msg.id).from).toBe("alice@work.example");
  });

  test("подтверждения пачкой: один chat-ack на порцию, chat-pull — после него", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    server.online.delete(bob.client.deviceId);
    let room = await alice.account.getDirectRoom("bob@example.com");
    for (let text of ["раз", "два", "три"]) {
      let msg = room.newMessage();
      msg.text = text;
      await room.sendMessage(msg);
    }
    let envelopes = server.queues.get(bob.client.deviceId)!;
    expect(envelopes).toHaveLength(3);
    let sentByBob: any[] = [];
    let send = bob.client.send.bind(bob.client);
    bob.client.send = (msg: any) => {
      if (msg.type == "chat-ack" || msg.type == "chat-pull") sentByBob.push(msg);
      if (msg.type != "chat-pull") send(msg); // следующую порцию в тесте не присылаем
    };
    for (let envelope of envelopes) bob.client.emit(envelope);
    bob.client.emit({ type: "chat-pending", count: 3, remaining: 7 });
    await settle();
    expect(sentByBob.map(m => m.type)).toEqual(["chat-ack", "chat-pull"]);
    expect(sentByBob[0].messageIds.sort()).toEqual(envelopes.map(e => e.messageId).sort());
    expect(server.queues.get(bob.client.deviceId)).toEqual([]);
    expect(bob.account.findRoomByID("direct:alice@example.com")!.messages.length).toBe(3);
  });

  test("отметка о прочтении и непрочитанные", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msgs = [];
    for (let text of ["раз", "два"]) {
      let msg = room.newMessage();
      msg.text = text;
      await room.sendMessage(msg);
      msgs.push(msg);
    }
    await settle();
    let bobRoom = bob.account.findRoomByID("direct:alice@example.com")!;
    expect(bobRoom.unreadCount).toBe(2);
    await bobRoom.markAllRead();
    await settle();
    expect(bobRoom.unreadCount).toBe(0);
    expect(msgs.map(m => m.deliveryStatus)).toEqual([DeliveryStatus.Seen, DeliveryStatus.Seen]);
  });

  test("посторонний: отметка о прочтении и нерасшифрованное не создают пустой чат", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let eve = await makeAccount(server, "eve@example.com");
    await eve.account.sendPayload(["alice@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "read", id: crypto.randomUUID(), room: { type: "direct", peer: "alice@example.com" }, ids: ["msg-00000001"],
    });
    alice.client.emit({ type: "chat-message", messageId: "msg-broken-2", from: "eve@example.com", fromDevice: eve.client.deviceId, ciphertext: "AAAA", key: "AAAA", sentAt: 1 });
    await settle();
    expect(alice.account.findRoomByID("direct:eve@example.com")).toBeNull();
    expect(alice.account.keyWarnings.some(w => w.includes("eve@example.com"))).toBe(true);
  });

  test("слишком длинное сообщение — понятная ошибка до отправки на сервер", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    await makeAccount(server, "bob@example.com");
    await expect(alice.account.sendPayload(["bob@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "message", id: crypto.randomUUID(), room: { type: "direct", peer: "bob@example.com" },
      text: "я".repeat(20_000), html: "<p>" + "я".repeat(40_000) + "</p>", inReplyTo: null, attachments: [],
    })).rejects.toThrow(/too long/);
    expect(server.sent).toHaveLength(0);
  });

  test("ошибка сервера no_recipients — понятный текст", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    await alice.account.devicesFor(["bob@example.com"]);
    server.owners.set(bob.client.deviceId, []); // устройство Боба отключено, а у Алисы ключи в кэше
    let room = await alice.account.getDirectRoom("bob@example.com");
    let msg = room.newMessage();
    msg.text = "x";
    await expect(room.sendMessage(msg)).rejects.toThrow(/does not use Jackdaw chat/);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);
  });

  test("новое устройство на своём адресе — предупреждение", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    await alice.account.devicesFor(["alice@example.com"]);
    expect(alice.account.keyWarnings).toEqual([]);
    await makeAccount(server, "alice@example.com"); // кто-то подключил чат на этом адресе
    await alice.account.devicesFor(["alice@example.com"], true);
    expect(alice.account.keyWarnings).toHaveLength(1);
    expect(alice.account.keyWarnings[0]).toMatch(/Your address alice@example.com/);
  });

  test("отказ сервера без причины: честный текст, «Переподключить» входит заново и досылает неотправленное", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    alice.client.setStatus("rejected");
    expect(alice.account.isOnline).toBe(false);
    let msg = room.newMessage();
    msg.text = "после отказа";
    let error = await room.sendMessage(msg).catch(ex => ex);
    expect(error).toBeInstanceOf(JackdawChatConnectionError);
    expect(error.kind).toBe("rejected");
    expect(error.canReconnect).toBe(true);
    expect(error.message).toMatch(/refused the connection/);
    expect(error.message).not.toMatch(/No connection/);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);

    let restarts = 0;
    alice.client.onRestart = () => {
      restarts++;
      alice.client.setStatus("connecting");
      queueMicrotask(() => {
        alice.client.setStatus("online");
        // Сервер приветствует, чат регистрирует устройство заново — как после настоящего входа
        alice.client.emit({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [] });
      });
    };
    await alice.account.reconnect();
    expect(restarts).toBe(1);
    expect(alice.account.isOnline).toBe(true);
    await settle();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.User);
    let bobRoom = bob.account.findRoomByID("direct:alice@example.com")!;
    expect(bobRoom.messages.contents.map((m: any) => m.text)).toEqual(["после отказа"]);
  });

  test("«Переподключить» без связи: ошибка с причиной и временем, сообщение ждёт", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    await makeAccount(server, "bob@example.com");
    let room = await alice.account.getDirectRoom("bob@example.com");
    let since = Date.now() - 60_000;
    alice.client.setStatus("offline", null, since);
    let msg = room.newMessage();
    msg.text = "ждёт";
    await expect(room.sendMessage(msg)).rejects.toThrow(/No connection to the Jackdaw server since/);
    alice.client.onRestart = () => {
      alice.client.setStatus("connecting", null, since);
      queueMicrotask(() => alice.client.setStatus("offline", "The Jackdaw server could not process the request. Try again later.", since));
    };
    let error = await alice.account.reconnect().catch(ex => ex);
    expect(error).toBeInstanceOf(JackdawChatConnectionError);
    expect(error.kind).toBe("offline");
    expect(error.message).toMatch(/since .+ Server response: The Jackdaw server could not process/);
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Failed);
  });

  test("«Переподключить» ждёт не дольше заданного и называет состояние", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    alice.client.setStatus("offline");
    alice.client.onRestart = () => alice.client.setStatus("connecting");
    let error = await alice.account.reconnect(20).catch(ex => ex);
    expect(error).toBeInstanceOf(JackdawChatConnectionError);
    expect(error.kind).toBe("connecting");
  });

  test("без Pro на устройстве — своя причина, а не «нет связи»", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    alice.client.setStatus("disabled");
    let error = await alice.account.devicesFor(["bob@example.com"], true).catch(ex => ex);
    expect(error).toBeInstanceOf(JackdawChatConnectionError);
    expect(["no-pro", "checking-pro"]).toContain(error.kind);
    expect(error.message).not.toMatch(/No connection/);
  });

  test("без связи и без подтверждённого адреса — разные ошибки", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    alice.client.isOnline = false;
    await expect(alice.account.devicesFor(["bob@example.com"], true)).rejects.toThrow(/No connection/);
    alice.client.isOnline = true;
    alice.client.verifiedEmails = [];
    await expect(alice.account.devicesFor(["bob@example.com"], true)).rejects.toThrow(/Confirm your address/);
  });
});

describe("управление группой", () => {
  let server: FakeServer;
  beforeAll(async () => {
    await setupChatTestEnv();
  });
  beforeEach(() => {
    server = new FakeServer();
    memoryStorage.clear();
  });

  async function threeMembers() {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let carol = await makeAccount(server, "carol@example.com");
    let group = await alice.account.createGroup("Команда", ["bob@example.com", "carol@example.com"]);
    await settle();
    return { alice, bob, carol, group };
  }

  async function send(room: JackdawChatRoom, text: string) {
    let msg = room.newMessage();
    msg.text = text;
    await room.sendMessage(msg);
    await settle();
    return msg;
  }

  test("участники без чата Jackdaw не попадают в группу; все без чата — понятная ошибка", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    await makeAccount(server, "bob@example.com");
    expect(await alice.account.emailsWithoutChat(["Bob@example.com", "nobody@example.com", "bad"])).toEqual(["nobody@example.com"]);
    let group = await alice.account.createGroup("Команда", ["bob@example.com", "nobody@example.com"]);
    expect(group.memberEmails).toEqual(["alice@example.com", "bob@example.com"]);
    await expect(alice.account.createGroup("Пусто", ["nobody@example.com"])).rejects.toThrow(/does not use Jackdaw chat/);
  });

  test("администратор переименовывает, добавляет и убирает участников", async () => {
    let { bob, carol, group } = await threeMembers();
    let dave = await makeAccount(server, "dave@example.com");
    let skipped = await group.updateGroup("Новая команда", ["bob@example.com", "dave@example.com", "nobody@example.com"]);
    await settle();
    expect(skipped).toEqual(["nobody@example.com"]);
    expect(group.name).toBe("Новая команда");
    expect(group.memberEmails).toEqual(["alice@example.com", "bob@example.com", "dave@example.com"]);

    let bobGroup = bob.account.findRoomByID(group.id)!;
    expect(bobGroup.name).toBe("Новая команда");
    expect(bobGroup.memberEmails).toEqual(group.memberEmails);
    // Новый участник получил группу, убранный узнал, что его в ней нет
    let daveGroup = dave.account.findRoomByID(group.id)!;
    expect(daveGroup.memberEmails).toEqual(group.memberEmails);
    let carolGroup = carol.account.findRoomByID(group.id)!;
    expect(carolGroup.isMember).toBe(false);
    let msg = carolGroup.newMessage();
    msg.text = "я ещё здесь?";
    await expect(carolGroup.sendMessage(msg)).rejects.toThrow(/no longer a member/);

    await send(daveGroup, "привет от Дейва");
    expect((group.messages.first as any).text).toBe("привет от Дейва");
    expect(carolGroup.messages.contents.some((m: any) => m.text == "привет от Дейва")).toBe(false);
  });

  test("менять группу может только администратор", async () => {
    let { bob, group } = await threeMembers();
    let bobGroup = bob.account.findRoomByID(group.id)!;
    await expect(bobGroup.updateGroup("Захват", ["bob@example.com"])).rejects.toThrow(/Only the group admin/);
    expect(bobGroup.name).toBe("Команда");
  });

  test("участник выходит: остальные убирают его, сообщения группы до него больше не идут", async () => {
    let { alice, bob, carol, group } = await threeMembers();
    let bobGroup = bob.account.findRoomByID(group.id)!;
    await bobGroup.leaveGroup();
    await settle();
    expect(bobGroup.isMember).toBe(false);
    expect(group.memberEmails).toEqual(["alice@example.com", "carol@example.com"]);
    expect(carol.account.findRoomByID(group.id)!.memberEmails).toEqual(["alice@example.com", "carol@example.com"]);
    await send(group, "без Боба");
    expect(bobGroup.messages.contents.some((m: any) => m.text == "без Боба")).toBe(false);
    expect(alice.account.findRoomByID(group.id)).toBe(group);
  });

  test("чужой выход подделать нельзя: выход убирает только самого отправителя", async () => {
    let { bob, carol, group } = await threeMembers();
    // Боб шлёт «выход» с составом, где нет Кэрол: убрать он может только себя
    let ref = group.roomRef() as any;
    await bob.account.sendPayload(["alice@example.com", "carol@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "group", id: crypto.randomUUID(),
      room: { ...ref, members: ["alice@example.com", "bob@example.com"] }, leave: true,
    });
    await settle();
    expect(group.memberEmails).toEqual(["alice@example.com", "carol@example.com"]);
    expect(carol.account.findRoomByID(group.id)!.isMember).toBe(true);
  });

  test("администратор выходит — группа переходит к следующему участнику", async () => {
    let { bob, carol, group } = await threeMembers();
    await group.leaveGroup();
    await settle();
    expect(group.isMember).toBe(false);
    expect(group.isAdmin).toBe(false);
    let bobGroup = bob.account.findRoomByID(group.id)!;
    expect(bobGroup.admin).toBe("bob@example.com");
    expect(bobGroup.isAdmin).toBe(true);
    expect(bobGroup.memberEmails).toEqual(["bob@example.com", "carol@example.com"]);
    await bobGroup.updateGroup("Команда Боба", ["carol@example.com"]);
    await settle();
    expect(carol.account.findRoomByID(group.id)!.name).toBe("Команда Боба");
  });

  test("удалить чат у себя: из группы при этом выходим, и она не возвращается", async () => {
    let { alice, bob, group } = await threeMembers();
    let bobGroup = bob.account.findRoomByID(group.id)!;
    await bob.account.deleteRoom(bobGroup);
    await settle();
    expect(bob.account.findRoomByID(group.id)).toBeNull();
    expect(group.memberEmails).not.toContain("bob@example.com");
    await send(group, "после удаления");
    expect(bob.account.findRoomByID(group.id)).toBeNull();

    let direct = await alice.account.getDirectRoom("bob@example.com");
    await alice.account.deleteRoom(direct);
    expect(alice.account.findRoomByID("direct:bob@example.com")).toBeNull();
  });

  test("отметки о прочтении в группе: «прочитано», когда прочитали все", async () => {
    let { bob, carol, group } = await threeMembers();
    let msg = await send(group, "прочитайте") as any;
    let bobMsg = bob.account.findRoomByID(group.id)!.messages.first as any;
    await bobMsg.markRead(true);
    await settle();
    expect(msg.readBy).toEqual(["bob@example.com"]);
    expect(msg.deliveryStatus).not.toBe(DeliveryStatus.Seen);
    await carol.account.findRoomByID(group.id)!.markAllRead();
    await settle();
    expect(msg.deliveryStatus).toBe(DeliveryStatus.Seen);
    expect(msg.toExtraJSON().readBy.sort()).toEqual(["bob@example.com", "carol@example.com"]);
  });

  test("устаревший состав в сообщении администратора не возвращает вышедшего и удалённую группу", async () => {
    let { alice, bob, group } = await threeMembers();
    let staleRef = { ...group.roomRef() as any }; // ещё с Бобом: так пишет старая версия или гонка
    let staleMessage = () => alice.account.sendPayload(["bob@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "message", id: crypto.randomUUID(), room: staleRef,
      text: "старый состав", html: null, inReplyTo: null, attachments: [],
    }, false, "alice@example.com");
    let bobGroup = bob.account.findRoomByID(group.id)!;
    await bobGroup.leaveGroup();
    await settle();
    await staleMessage();
    await settle();
    expect(bobGroup.isMember).toBe(false);
    expect(bobGroup.messages.contents.some((m: any) => m.text == "старый состав")).toBe(false);

    await bob.account.deleteRoom(bobGroup);
    await staleMessage();
    await settle();
    expect(bob.account.findRoomByID(group.id)).toBeNull();
    // Администратор пригласил снова — группа появляется
    await group.updateGroup("Команда", ["bob@example.com", "carol@example.com"]);
    await settle();
    expect(bob.account.findRoomByID(group.id)!.isMember).toBe(true);
  });

  test("объявление группы без нас не создаёт у нас комнату", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    await makeAccount(server, "carol@example.com");
    await alice.account.sendPayload(["bob@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "group", id: crypto.randomUUID(),
      room: { type: "group", id: "group-00000001", name: "Без Боба", admin: "alice@example.com", members: ["alice@example.com", "carol@example.com"] },
    });
    await settle();
    expect(bob.account.findRoomByID("group:group-00000001")).toBeNull();
  });

  test("формат: выход из группы разбирается, мусор в leave игнорируется", () => {
    let room = { type: "group", id: "group-0001", name: "x", admin: "a@x.com", members: ["b@x.com"] };
    expect(parseChatPayload({ v: 1, kind: "group", id: "msg-00000001", room, leave: true })).toMatchObject({ leave: true });
    expect(parseChatPayload({ v: 1, kind: "group", id: "msg-00000001", room, leave: "yes" })).not.toHaveProperty("leave");
  });
});

describe("ответы, правки, удаление, реакции и «печатает…»", () => {
  let server: FakeServer;
  beforeAll(async () => {
    await setupChatTestEnv();
  });
  beforeEach(() => {
    server = new FakeServer();
    memoryStorage.clear();
  });

  async function pair() {
    let alice = await makeAccount(server, "alice@example.com");
    let bob = await makeAccount(server, "bob@example.com");
    let aliceRoom = await alice.account.getDirectRoom("bob@example.com");
    let msg = aliceRoom.newMessage();
    msg.text = "Первый вариант";
    await aliceRoom.sendMessage(msg);
    await settle();
    let bobRoom = bob.account.findRoomByID("direct:alice@example.com")!;
    return { alice, bob, aliceRoom, bobRoom, msg: msg as any, received: bobRoom.messages.first as any };
  }

  test("новые виды содержимого проверяются, будущие — распознаются", () => {
    const room = { type: "direct" };
    expect(parseChatPayload({ v: 1, kind: "edit", id: "msg-00000002", room, target: "msg-00000001", text: "новый" }))
      .toMatchObject({ kind: "edit", target: "msg-00000001", text: "новый", html: null });
    expect(parseChatPayload({ v: 1, kind: "edit", id: "msg-00000002", room, target: "msg-00000001", text: "" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "delete", id: "msg-00000002", room, target: "bad id" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "reaction", id: "msg-00000002", room, target: "msg-00000001", emoji: "👍" }))
      .toMatchObject({ emoji: "👍" });
    expect(parseChatPayload({ v: 1, kind: "reaction", id: "msg-00000002", room, target: "msg-00000001", emoji: null }))
      .toMatchObject({ emoji: null });
    expect(parseChatPayload({ v: 1, kind: "reaction", id: "msg-00000002", room, target: "msg-00000001", emoji: "<b>текст</b>" })).toBeNull();
    expect(parseChatPayload({ v: 1, kind: "typing", id: "msg-00000002", room })).toMatchObject({ kind: "typing" });
    expect(isFutureChatPayload({ v: 1, kind: "poll", id: "msg-00000002", room })).toBe(true);
    expect(isFutureChatPayload({ v: 1, kind: "message", id: "msg-00000002", room })).toBe(false);
  });

  test("правка своего сообщения доходит собеседнику с пометкой", async () => {
    let { aliceRoom, msg, received } = await pair();
    let edit = await msg.createEdit();
    edit.text = "Исправленный вариант";
    await aliceRoom.sendMessage(edit);
    await settle();
    expect(msg.text).toBe("Исправленный вариант");
    expect(msg.edited).toBe(true);
    expect(aliceRoom.messages.length).toBe(1);
    expect(received.text).toBe("Исправленный вариант");
    expect(received.edited).toBe(true);
  });

  test("чужое сообщение править и удалять нельзя", async () => {
    let { bob, bobRoom, received, msg } = await pair();
    expect(received.canEdit).toBe(false);
    // Подделка: Боб шлёт правку сообщения Алисы
    await bob.account.sendPayload(["alice@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "edit", id: crypto.randomUUID(), room: bobRoom.roomRef(), target: msg.id, text: "взлом", html: null,
    } as any);
    await bob.account.sendPayload(["alice@example.com"], {
      v: CHAT_PAYLOAD_VERSION, kind: "delete", id: crypto.randomUUID(), room: bobRoom.roomRef(), target: msg.id,
    } as any);
    await settle();
    expect(msg.text).toBe("Первый вариант");
    expect(msg.deletedForAll).toBe(false);
  });

  test("удаление у всех убирает текст у собеседника", async () => {
    let { msg, received } = await pair();
    await msg.deleteForOthers();
    await settle();
    expect(msg.deletedForAll).toBe(true);
    expect(msg.text).not.toContain("Первый вариант");
    expect(received.deletedForAll).toBe(true);
    expect(received.text).not.toContain("Первый вариант");
    expect(received.canReply).toBe(false);
  });

  test("реакция ставится и снимается у собеседника", async () => {
    let { msg, received } = await pair();
    await received.setMyReaction("👍");
    await settle();
    expect([...msg.reactions.values()]).toEqual(["👍"]);
    await received.setMyReaction(null);
    await settle();
    expect(msg.reactions.length).toBe(0);
  });

  test("ответ ссылается на исходное сообщение", async () => {
    let { bobRoom, aliceRoom, received } = await pair();
    let reply = bobRoom.newMessage();
    reply.text = "Ответ";
    reply.inReplyTo = received.id;
    await bobRoom.sendMessage(reply);
    await settle();
    let arrived = aliceRoom.messages.find(m => m.text == "Ответ")!;
    expect(arrived.inReplyTo).toBe(received.id);
  });

  test("«печатает…» показывается, гаснет по сроку и снимается новым сообщением", async () => {
    let { aliceRoom, bobRoom } = await pair();
    aliceRoom.sendTyping();
    await settle();
    expect(bobRoom.typing).toEqual(["alice@example.com"]);
    // Повтор в течение нескольких секунд не отправляется
    let sentBefore = server.sent.length;
    aliceRoom.sendTyping();
    expect(server.sent.length).toBe(sentBefore);
    let message = aliceRoom.newMessage();
    message.text = "Готово";
    await aliceRoom.sendMessage(message);
    await settle();
    expect(bobRoom.typing).toEqual([]);
    // Срок подсказки вышел
    bobRoom.applyTyping("alice@example.com", false);
    (bobRoom as any).typingUntil.set("alice@example.com", Date.now() - 1);
    (bobRoom as any).refreshTyping();
    expect(bobRoom.typing).toEqual([]);
  });
});
