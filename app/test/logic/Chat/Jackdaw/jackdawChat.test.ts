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

  test("без связи и без подтверждённого адреса — разные ошибки", async () => {
    let alice = await makeAccount(server, "alice@example.com");
    alice.client.isOnline = false;
    await expect(alice.account.devicesFor(["bob@example.com"], true)).rejects.toThrow(/No connection/);
    alice.client.isOnline = true;
    alice.client.verifiedEmails = [];
    await expect(alice.account.devicesFor(["bob@example.com"], true)).rejects.toThrow(/Confirm your address/);
  });
});
