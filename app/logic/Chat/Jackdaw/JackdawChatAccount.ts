/**
 * Чат Jackdaw ↔ Jackdaw: аккаунт.
 *
 * Сообщения идут через то же соединение, что и звонки (`JackdawCallClient`).
 * Адрес собеседника — подтверждённый email. Шифрование — `JackdawChatCrypto`.
 * История и вложения хранятся локально в базе чатов, как у других протоколов.
 */
import { ChatAccount } from "../ChatAccount";
import type { ChatRoom } from "../ChatRoom";
import { ChatPersonUID } from "../ChatPersonUID";
import type { ChatMessage } from "../ChatMessage";
import { PersonUID } from "../../Abstract/PersonUID";
import type { Person } from "../../Abstract/Person";
import { JackdawChatRoom } from "./JackdawChatRoom";
import {
  decryptMessage,
  deviceKeysFromJSON,
  deviceKeysToJSON,
  encryptMessage,
  fromBase64,
  generateDeviceKeys,
  toBase64,
  type DeviceKeys,
  type RemoteDevice,
} from "./JackdawChatCrypto";
import { ciphertextBytes, parseChatPayload, type ChatPayload, type ChatRoomRef, MAX_ACK_IDS, MAX_CIPHERTEXT_BYTES, MAX_GROUP_MEMBERS } from "./JackdawChatProtocol";
import { JackdawCallServiceError, type JackdawCallClient } from "../../Meet/Jackdaw/JackdawCallClient";
import type { JackdawServerMessage } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { normalizeCallEmail } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { getPassword, setPassword } from "../../Auth/passwordLocalStorage";
import { notifyChangedProperty } from "../../util/Observable";
import { UserError, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export const JACKDAW_CHAT_PROTOCOL = "jackdaw";
const DEVICE_KEYS_SECRET = "jackdaw-chat.device-keys";
const DEVICE_CACHE_MS = 60_000;
const BLOB_CHUNK_BYTES = 64 * 1024;
const BLOB_TIMEOUT_MS = 30_000;
/** Сообщение не расшифровалось: просим сервер больше его не присылать, но не теряем молча */
const UNDECRYPTABLE_TEXT = () => gt`This message could not be decrypted. Ask the sender to send it again.`;
/** Подтверждения (chat-ack) отправляются пачкой не чаще этого: сервер принимает 120 ack в минуту */
const ACK_MIN_INTERVAL_MS = 500;

export class JackdawChatPerson extends ChatPersonUID {
  constructor(email: string, name?: string) {
    super(JACKDAW_CHAT_PROTOCOL, email, name);
    this.emailAddress = email;
  }

  /** Контакт ищется по email, а не по записи чат-аккаунта в адресной книге */
  findPerson() {
    return PersonUID.prototype.findPerson.call(this);
  }

  /** Тоже по email, без учёта регистра: в адресной книге адрес может быть записан иначе */
  matchesPerson(person: Person): boolean {
    let email = this.emailAddress.toLowerCase();
    return !!person?.emailAddresses.find(entry => entry.value?.toLowerCase() == email);
  }
}

export class JackdawChatAccount extends ChatAccount {
  readonly protocol: string = JACKDAW_CHAT_PROTOCOL;
  /** Ключи этого устройства. Секретный ключ хранится отдельно через шифрование ОС. */
  protected deviceKeys: DeviceKeys | null = null;
  /** email → deviceId → открытый ключ, известный нам. Новое устройство или смена ключа
   * принимаются, но показываются предупреждением (как «код безопасности изменился» в Signal). */
  protected pinnedKeys: Record<string, Record<string, string>> = {};
  /** Адреса, для которых устройство зарегистрировано на сервере */
  @notifyChangedProperty
  registeredEmails: string[] = [];
  /** У собеседника появилось новое устройство или сменился ключ */
  @notifyChangedProperty
  keyWarnings: string[] = [];
  /** Новое входящее сообщение (не наше). Интерфейс показывает уведомление. */
  incomingMessageCallback: (room: JackdawChatRoom, message: ChatMessage) => void = () => {};
  protected client: JackdawCallClient | null = null;
  protected unlisten: (() => void) | null = null;
  protected deviceCache = new Map<string, { at: number; devices: RemoteDevice[] }>();
  protected registering: Promise<void> | null = null;
  /** Входящие обрабатываются по одному: иначе два первых сообщения новой группы создали бы две комнаты */
  protected incomingQueue: Promise<void> = Promise.resolve();
  /** Сколько входящих ждут обработки в `incomingQueue` */
  protected incomingCount = 0;
  /** Обработанные, но ещё не подтверждённые серверу сообщения */
  protected pendingAcks = new Set<string>();
  protected ackTimer: ReturnType<typeof setTimeout> | null = null;
  protected lastAckAt = 0;

  constructor() {
    super();
    this.name = "Jackdaw Mail";
    this.loginOnStartup = true;
  }

  get isLoggedIn(): boolean {
    return !!this.deviceKeys;
  }

  /** `isOnline` базового класса: соединение есть и устройство зарегистрировано */
  protected updateOnline(): void {
    let online = !!this.client?.isOnline && this.registeredEmails.length > 0;
    if (!this.client?.isOnline && this.registeredEmails.length) {
      this.registeredEmails = []; // после переподключения устройство регистрируется заново
    }
    if (this.isOnline != online) {
      this.isOnline = online;
      this.notifyObservers("isOnline", !online);
    }
  }

  get deviceID(): string | null {
    return this.deviceKeys?.deviceId ?? null;
  }

  get devicePublicKey(): Uint8Array | null {
    return this.deviceKeys?.publicKey ?? null;
  }

  /** Подключает аккаунт к соединению сервиса звонков. Вызывается из `JackdawChats`. */
  attachClient(client: JackdawCallClient): void {
    if (this.client == client) return;
    this.unlisten?.();
    this.client = client;
    let stopListening = client.addListener(message => this.onServerMessage(message));
    let stopWatching = client.subscribe(() => this.updateOnline());
    this.unlisten = () => {
      stopListening();
      stopWatching();
    };
    if (client.isOnline) {
      void this.register().catch(this.errorCallback);
    }
  }

  async login(_interactive: boolean): Promise<void> {
    await this.loadDeviceKeys();
    await this.listRooms();
    if (this.client?.isOnline) {
      await this.register();
    }
  }

  /** После запуска: превью последнего сообщения и непрочитанные — без чтения всей истории */
  async listRooms(): Promise<void> {
    await super.listRooms();
    for (let room of this.rooms.contents) {
      if (room instanceof JackdawChatRoom) {
        await room.loadSummary().catch(this.errorCallback);
      }
    }
  }

  async logout(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    this.registeredEmails = [];
    this.updateOnline();
  }

  protected async loadDeviceKeys(): Promise<void> {
    if (this.deviceKeys) return;
    let saved = await getPassword(DEVICE_KEYS_SECRET);
    this.deviceKeys = saved ? deviceKeysFromJSON(saved) : null;
    if (!this.deviceKeys) {
      this.deviceKeys = generateDeviceKeys();
      await setPassword(DEVICE_KEYS_SECRET, deviceKeysToJSON(this.deviceKeys));
    }
  }

  newRoom(isGroup = false): ChatRoom {
    return new JackdawChatRoom(this, isGroup);
  }

  protected newPersonUID(userID: string, name: string): ChatPersonUID {
    return new JackdawChatPerson(userID, name);
  }

  getOwnContact(): ChatPersonUID {
    let email = this.client?.verifiedEmails[0] ?? this.registeredEmails[0] ?? "";
    return this.getPersonUID(email, this.realname);
  }

  isOwnEmail(email: string): boolean {
    return (this.client?.verifiedEmails ?? []).includes(email) || this.registeredEmails.includes(email);
  }

  fromConfigJSON(json: any): void {
    super.fromConfigJSON(json);
    let pinned = json?.pinnedKeys;
    this.pinnedKeys = pinned && typeof pinned == "object" && !Array.isArray(pinned) ? pinned : {};
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.pinnedKeys = this.pinnedKeys;
    return json;
  }

  // --- соединение -----------------------------------------------------------

  protected onServerMessage(message: JackdawServerMessage): void {
    switch (message.type) {
      case "welcome":
      case "verified":
        void this.register().catch(this.errorCallback);
        break;
      case "chat-registered":
        this.registeredEmails = message.emails;
        this.updateOnline();
        void this.onReconnected().catch(this.errorCallback);
        break;
      case "chat-message":
        this.incomingCount++;
        this.incomingQueue = this.incomingQueue
          .then(() => this.onEncryptedMessage(message))
          .catch(this.errorCallback)
          .finally(() => {
            this.incomingCount--;
            if (!this.incomingCount) {
              this.scheduleAcks();
            }
          });
        break;
      case "chat-pending":
        // Порция обработана (очередь идёт по порядку): подтверждаем её одним chat-ack
        // и только потом просим следующую. Иначе сервер прислал бы неподтверждённые снова.
        this.incomingQueue = this.incomingQueue
          .then(() => {
            this.flushAcks();
            if (message.remaining > 0) {
              this.client?.send({ type: "chat-pull" });
            }
          })
          .catch(this.errorCallback);
        break;
    }
  }

  protected async register(): Promise<void> {
    if (!this.client?.isOnline || !this.client.verifiedEmails.length) return;
    this.registering ??= (async () => {
      await this.loadDeviceKeys();
      assert(this.deviceKeys && this.client, "No chat device keys");
      await this.client.request({
        type: "chat-register",
        deviceId: this.deviceKeys.deviceId,
        publicKey: toBase64(this.deviceKeys.publicKey),
      }, reply => reply.type == "chat-registered" || reply.type == "error" && reply.requestType == "chat-register");
    })().finally(() => {
      this.registering = null;
    });
    await this.registering;
  }

  /** Подтверждает серверу обработанные сообщения: до MAX_ACK_IDS в одном chat-ack */
  protected flushAcks(): void {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    while (this.pendingAcks.size) {
      let batch = [...this.pendingAcks].slice(0, MAX_ACK_IDS);
      try {
        this.client?.send({ type: "chat-ack", messageIds: batch });
      } catch (ex) {
        return; // нет связи: подтвердим после переподключения, повторы отбрасываются по id
      }
      for (let id of batch) {
        this.pendingAcks.delete(id);
      }
      this.lastAckAt = Date.now();
    }
  }

  /** Подтверждение живых сообщений, когда очередь опустела, но не чаще ACK_MIN_INTERVAL_MS */
  protected scheduleAcks(): void {
    if (!this.pendingAcks.size || this.ackTimer) {
      return;
    }
    let wait = this.lastAckAt + ACK_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.flushAcks();
      return;
    }
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.flushAcks();
    }, wait);
  }

  /** Устройство снова зарегистрировано: досылаем неотправленное и докачиваем файлы */
  protected async onReconnected(): Promise<void> {
    this.flushAcks();
    for (let room of this.rooms.contents) {
      if (!(room instanceof JackdawChatRoom)) continue;
      room.resumeDownloads();
      await room.sendUnsent();
    }
  }

  protected requireOnline(): JackdawCallClient {
    if (!this.client?.isOnline) {
      // Лицензию отклонили — переподключение не поможет, говорим почему
      if (this.client?.status == "rejected" && this.client.lastError) {
        throw new UserError(this.client.lastError);
      }
      throw new UserError(gt`No connection to the Jackdaw server. Unsent messages will be sent automatically when the connection is restored.`);
    }
    if (!this.client.verifiedEmails.length) {
      throw new UserError(gt`The chat is not connected. Confirm your address in Settings → Jackdaw Pro → Calls and chat.`);
    }
    if (!this.registeredEmails.length) {
      throw new UserError(gt`The chat is still connecting. Try again in a moment.`);
    }
    return this.client;
  }

  // --- ключи устройств --------------------------------------------------------

  /** Устройства собеседников. Новые устройства и смену ключа отмечаем предупреждением. */
  async devicesFor(emails: string[], refresh = false): Promise<Map<string, RemoteDevice[]>> {
    let client = this.requireOnline();
    let result = new Map<string, RemoteDevice[]>();
    let missing: string[] = [];
    for (let email of emails) {
      let cached = this.deviceCache.get(email);
      if (!refresh && cached && Date.now() - cached.at < DEVICE_CACHE_MS) {
        result.set(email, cached.devices);
      } else {
        missing.push(email);
      }
    }
    if (missing.length) {
      let requestId = client.nextRequestID("chat-keys");
      let reply = await client.request<Extract<JackdawServerMessage, { type: "chat-keys-result" }>>(
        { type: "chat-keys", requestId, emails: missing },
        r => r.type == "chat-keys-result" && r.requestId == requestId || r.type == "error" && r.requestId == requestId);
      let pinsChanged = false;
      for (let email of missing) {
        let devices = (reply.devices[email] ?? []).map(d => ({ deviceId: d.deviceId, publicKey: fromBase64(d.publicKey) }))
          .filter(d => d.publicKey.length == 32);
        pinsChanged = this.pin(email, devices) || pinsChanged;
        this.deviceCache.set(email, { at: Date.now(), devices });
        result.set(email, devices);
      }
      if (pinsChanged) {
        await this.save();
      }
    }
    return result;
  }

  /** @returns true, если закреплённые ключи изменились */
  protected pin(email: string, devices: RemoteDevice[]): boolean {
    let known = this.pinnedKeys[email];
    let first = !known;
    known ??= {};
    let changed = false;
    for (let device of devices) {
      let key = toBase64(device.publicKey);
      if (known[device.deviceId] == key) continue;
      // Своё новое устройство тоже показываем: так видно, если чат подключил кто-то чужой.
      // Это устройство само себя не предупреждает.
      if (!first && device.deviceId != this.deviceKeys?.deviceId) {
        let own = this.isOwnEmail(email);
        let warning = known[device.deviceId]
          ? own
            ? gt`The security key of your address ${email} has changed on one of your devices. If this was not you, check your devices.`
            : gt`The security key of ${email} has changed. If you did not expect this, check with the contact.`
          : own
            ? gt`Your address ${email} has started using Jackdaw chat on a new device. If this was not you, check your devices.`
            : gt`${email} has started using Jackdaw chat on a new device.`;
        this.keyWarnings = [...this.keyWarnings.filter(w => w != warning), warning];
      }
      known[device.deviceId] = key;
      changed = true;
    }
    this.pinnedKeys[email] = known;
    return changed;
  }

  // --- отправка -------------------------------------------------------------

  /** Шифрует и отправляет сообщение всем устройствам получателей и своим другим устройствам.
   * @param from Наш адрес, с которого отправить (под ним нас знает комната).
   *   Если он не зарегистрирован на этом устройстве — первый зарегистрированный. */
  async sendPayload(recipients: string[], payload: ChatPayload, ephemeral = false, from?: string): Promise<Extract<JackdawServerMessage, { type: "chat-sent" }>> {
    let client = this.requireOnline();
    await this.loadDeviceKeys();
    let own = this.registeredEmails;
    // Сервер ограничивает шифротекст; проверяем заранее и говорим понятно, а не «сервер отклонил запрос»
    if (ciphertextBytes(payload) > MAX_CIPHERTEXT_BYTES) {
      throw new UserError(gt`The message is too long. Split it into several messages or send the text as a file.`);
    }
    let byEmail = await this.devicesFor([...new Set([...recipients, ...own])]);
    let devices = [...byEmail.values()].flat();
    // Своё устройство в получатели не попадает: если других нет, сервер получил бы пустой список ключей.
    let ownDeviceID = this.deviceKeys!.deviceId;
    if (!recipients.some(email => (byEmail.get(email) ?? []).some(device => device.deviceId != ownDeviceID))) {
      throw new UserError(recipients.every(email => this.isOwnEmail(email))
        ? gt`This is your own address. Jackdaw chat is not set up on your other devices yet.`
        : gt`This contact does not use Jackdaw chat yet.`);
    }
    let encrypted = encryptMessage(payload, payload.id, this.deviceKeys!, devices);
    try {
      return await client.request({
        type: "chat-send",
        messageId: payload.id,
        from: from && own.includes(from) ? from : own[0],
        recipients,
        ciphertext: encrypted.ciphertext,
        keys: encrypted.keys,
        ephemeral,
      }, reply => (reply.type == "chat-sent" || reply.type == "error") && reply.messageId == payload.id);
    } catch (ex) {
      // Коды ошибок чата: текст здесь, общий serverErrorMessage() о них не знает
      switch (ex instanceof JackdawCallServiceError ? ex.code : null) {
        case "no_recipients":
          this.deviceCache.clear(); // список устройств устарел
          throw new UserError(recipients.every(email => this.isOwnEmail(email))
            ? gt`This is your own address. Jackdaw chat is not set up on your other devices yet.`
            : gt`This contact does not use Jackdaw chat on any device now.`);
        case "quota_exceeded":
          throw new UserError(gt`Too many of your messages are still waiting for delivery on the server. They are deleted after delivery or after 30 days. Try again later.`);
        default:
          throw ex;
      }
    }
  }

  async uploadBlob(data: Uint8Array): Promise<string> {
    let client = this.requireOnline();
    let blobId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    let total = Math.max(1, Math.ceil(data.length / BLOB_CHUNK_BYTES));
    for (let index = 0; index < total; index++) {
      let chunk = data.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES);
      await client.request({ type: "blob-put", blobId, index, total, data: toBase64(chunk) },
        reply => (reply.type == "blob-stored" && reply.index == index || reply.type == "error") && reply.blobId == blobId,
        BLOB_TIMEOUT_MS);
    }
    return blobId;
  }

  async downloadBlob(blobId: string): Promise<Uint8Array> {
    let client = this.requireOnline();
    let parts: Uint8Array[] = [];
    let total = 1;
    for (let index = 0; index < total; index++) {
      let reply = await client.request<Extract<JackdawServerMessage, { type: "blob-data" }>>(
        { type: "blob-get", blobId, index },
        r => (r.type == "blob-data" && r.index == index || r.type == "error") && r.blobId == blobId,
        BLOB_TIMEOUT_MS);
      total = reply.total;
      parts.push(fromBase64(reply.data));
    }
    let result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (let part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  // --- приём ------------------------------------------------------------------

  protected async onEncryptedMessage(message: Extract<JackdawServerMessage, { type: "chat-message" }>): Promise<void> {
    await this.loadDeviceKeys();
    let payload: ChatPayload | null = null;
    let sender: RemoteDevice | null = null;
    try {
      sender = await this.senderDevice(message.from, message.fromDevice);
      payload = sender ? parseChatPayload(decryptMessage(message.ciphertext, message.key, message.messageId, sender, this.deviceKeys!)) : null;
    } catch (ex) {
      payload = null;
    }
    if (payload && payload.id != message.messageId) {
      payload = null; // id внутри шифротекста должен совпасть с конвертом
    }
    if (payload) {
      let fromMe = this.isOwnEmail(message.from) || await this.isOwnDevice(sender!);
      await this.applyPayload(payload, message.from, new Date(message.sentAt || Date.now()), fromMe);
    } else if (!message.ephemeral) {
      await this.addUndecryptable(message.messageId, message.from, new Date(message.sentAt || Date.now()));
    }
    if (!message.ephemeral) {
      // Подтверждаем пачкой: после порции (chat-pending) или когда очередь опустеет
      this.pendingAcks.add(message.messageId);
      if (this.pendingAcks.size >= MAX_ACK_IDS) {
        this.flushAcks();
      }
    }
  }

  /** Наше другое устройство, которое писало с другого нашего адреса (не подтверждённого здесь).
   * Узнаём по тому же ключу устройства под нашим адресом: иначе своё сообщение
   * выглядело бы входящим от «чужого» адреса и создало бы второй чат. */
  protected async isOwnDevice(sender: RemoteDevice): Promise<boolean> {
    if (!this.registeredEmails.length) {
      return false;
    }
    let ownDevices = [...(await this.devicesFor(this.registeredEmails).catch(() => new Map<string, RemoteDevice[]>())).values()].flat();
    let key = toBase64(sender.publicKey);
    return ownDevices.some(device => device.deviceId == sender.deviceId && toBase64(device.publicKey) == key);
  }

  protected async senderDevice(email: string, deviceId: string): Promise<RemoteDevice | null> {
    let devices = (await this.devicesFor([email])).get(email) ?? [];
    let device = devices.find(d => d.deviceId == deviceId);
    if (!device) {
      device = ((await this.devicesFor([email], true)).get(email) ?? []).find(d => d.deviceId == deviceId);
    }
    return device ?? null;
  }

  protected async applyPayload(payload: ChatPayload, from: string, sentAt: Date, fromMe = this.isOwnEmail(from)): Promise<void> {
    // Отметка о прочтении относится к уже существующему чату и новый не создаёт
    let room = await this.roomForPayload(payload.room, from, fromMe, payload.kind != "read");
    if (!room) return;
    switch (payload.kind) {
      case "message":
        await room.addIncoming(payload, from, fromMe, sentAt);
        break;
      case "read":
        room.markSeen(payload.ids, fromMe);
        break;
      case "group":
        // Метаданные группы уже применены в roomForPayload()
        break;
    }
  }

  /** Находит или создаёт комнату. Состав группы меняет только её администратор.
   * @param create false — только существующая комната */
  protected async roomForPayload(ref: ChatRoomRef, from: string, fromMe: boolean, create = true): Promise<JackdawChatRoom | null> {
    if (ref.type == "direct") {
      let peer = fromMe ? ref.peer : from;
      if (!peer || this.isOwnEmail(peer)) return null;
      let room = create ? await this.getDirectRoom(peer) : this.findRoomByID(`direct:${normalizeCallEmail(peer)}`);
      // Наш адрес в этом чате: собеседник писал на ref.peer, наше другое устройство — с from
      if (room?.rememberOwnEmail(fromMe ? from : ref.peer)) {
        await room.save();
      }
      return room;
    }
    let room = this.findRoomByID(`group:${ref.id}`);
    if (room) {
      if (from == room.admin) {
        await room.applyGroupInfo(ref);
      }
      if (!room.memberEmails.includes(from) && from != room.admin && !fromMe) {
        return null; // посторонний не может писать в чужую группу
      }
      return room;
    }
    if (from != ref.admin || !create) {
      return null; // группу может создать только её администратор
    }
    room = this.newRoom(true) as JackdawChatRoom;
    room.id = `group:${ref.id}`;
    await room.applyGroupInfo(ref, false);
    this.rooms.set(room.contact, room);
    await room.save();
    return room;
  }

  /** Комнату сообщения не узнать: оно могло быть и из группы. Поэтому кладём его только
   * в уже существующий личный чат с отправителем; новый (пустой) чат не создаём,
   * а показываем предупреждение. */
  protected async addUndecryptable(messageId: string, from: string, sentAt: Date): Promise<void> {
    if (this.isOwnEmail(from)) return;
    let room = this.findRoomByID(`direct:${normalizeCallEmail(from)}`);
    if (!room) {
      let warning = gt`A message from ${from} could not be decrypted. Ask the sender to send it again.`;
      this.keyWarnings = [...this.keyWarnings.filter(w => w != warning), warning];
      return;
    }
    await room.listMessages();
    if (room.messages.find(m => m.id == messageId)) return;
    let msg = room.newMessage();
    msg.id = messageId;
    msg.from = this.getPersonUID(from);
    msg.contact = msg.from;
    msg.outgoing = false;
    msg.sent = sentAt;
    msg.received = new Date();
    msg.text = UNDECRYPTABLE_TEXT();
    room.messages.add(msg);
    room.updateUnreadCount();
    await msg.save();
  }

  findRoomByID(id: string): JackdawChatRoom | null {
    return (this.rooms.contents.find(room => room.id == id) as JackdawChatRoom | undefined) ?? null;
  }

  /** Личный чат с адресом. Создаётся и сохраняется при первом обращении. */
  async getDirectRoom(emailAddress: string): Promise<JackdawChatRoom> {
    let email = normalizeCallEmail(emailAddress);
    if (!email) {
      throw new UserError(gt`This is not a valid email address.`);
    }
    if (this.isOwnEmail(email)) {
      throw new UserError(gt`This is your own address.`);
    }
    let existing = this.findRoomByID(`direct:${email}`);
    if (existing) return existing;
    let person = this.getPersonUID(email);
    if (!this.roster.includes(person)) {
      this.roster.add(person);
    }
    let room = this.newRoom(false) as JackdawChatRoom;
    room.id = `direct:${email}`;
    room.contact = person;
    room.members.replaceAll([person]);
    this.rooms.set(person, room);
    await room.save();
    return room;
  }

  /** Создаёт группу. Мы — администратор. */
  async createGroup(name: string, emails: string[]): Promise<JackdawChatRoom> {
    this.requireOnline();
    let members = [...new Set(emails.map(normalizeCallEmail).filter((e): e is string => !!e && !this.isOwnEmail(e)))];
    if (!members.length) {
      throw new UserError(gt`Add at least one member to the group.`);
    }
    if (members.length > MAX_GROUP_MEMBERS) {
      throw new UserError(gt`A group can have at most ${MAX_GROUP_MEMBERS} members.`);
    }
    let room = this.newRoom(true) as JackdawChatRoom;
    room.id = `group:${crypto.randomUUID()}`;
    await room.applyGroupInfo({
      type: "group",
      id: room.id.slice("group:".length),
      name: name.trim() || gt`Group`,
      admin: this.registeredEmails[0],
      members: [this.registeredEmails[0], ...members],
    }, false);
    this.rooms.set(room.contact, room);
    await room.save();
    await room.announceGroup();
    return room;
  }

  /** Есть ли у адреса устройства для чата. Для кнопки «Написать». */
  async canChatWith(emailAddress: string): Promise<boolean> {
    let email = normalizeCallEmail(emailAddress);
    if (!email || !this.isOnline || this.isOwnEmail(email)) return false;
    return ((await this.devicesFor([email])).get(email) ?? []).length > 0;
  }
}
