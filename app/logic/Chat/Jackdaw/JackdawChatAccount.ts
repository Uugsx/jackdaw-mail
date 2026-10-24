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
import { JackdawChatMessage } from "./JackdawChatMessage";
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
import { ciphertextBytes, isFutureChatPayload, parseChatPayload, type ChatPayload, type ChatRoomRef, MAX_ACK_IDS, MAX_CIPHERTEXT_BYTES, MAX_GROUP_MEMBERS } from "./JackdawChatProtocol";
import { JackdawCallServiceError, type JackdawCallClient, type JackdawCallStatus } from "../../Meet/Jackdaw/JackdawCallClient";
import type { JackdawServerMessage } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { normalizeCallEmail } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { getPassword, setPassword } from "../../Auth/passwordLocalStorage";
import { proEntitlement } from "../../Billing/ProEntitlement";
import { chatConnectionProblem, JackdawChatConnectionError, type ChatConnectionProblem } from "./chatConnectionProblem";
import { notifyChangedProperty } from "../../util/Observable";
import { UserError, assert } from "../../util/util";
import { findDirectoryAddresses, findDirectoryName } from "./directoryAddresses";
import { nameFromChatID } from "../ChatPersonUID";
import { appGlobal } from "../../app";
import { gt } from "../../../l10n/l10n";

export const JACKDAW_CHAT_PROTOCOL = "jackdaw";
const DEVICE_KEYS_SECRET = "jackdaw-chat.device-keys";
const DEVICE_CACHE_MS = 60_000;
const BLOB_CHUNK_BYTES = 64 * 1024;
const BLOB_TIMEOUT_MS = 30_000;
/** Сколько ждать каталог организации при поиске адреса собеседника */
const DIRECTORY_TIMEOUT_MS = 5_000;
const MAX_CONTACT_NAME_LENGTH = 120;

/** Имя, собранное из адреса (`nlevchenko0181@` → «Nlevchenko0181»), или сам адрес: его стоит заменить настоящим */
function isNameFromAddress(name: string | null | undefined, email: string): boolean {
  return !name || name == email || name == nameFromChatID(email);
}

function readNames(value: unknown): Record<string, string> {
  let names: Record<string, string> = {};
  if (value && typeof value == "object" && !Array.isArray(value)) {
    for (let [email, name] of Object.entries(value)) {
      let key = normalizeCallEmail(email);
      if (key && typeof name == "string" && name.trim()) {
        names[key] = name.trim().slice(0, MAX_CONTACT_NAME_LENGTH);
      }
    }
  }
  return names;
}
/** Сообщение не расшифровалось: просим сервер больше его не присылать, но не теряем молча */
const UNDECRYPTABLE_TEXT = () => gt`This message could not be decrypted. Ask the sender to send it again.`;
/** Сколько удалённых групп помним, чтобы их не создало снова старое сообщение администратора */
const MAX_DELETED_GROUPS = 500;
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

/** Сколько кнопка «Переподключить» ждёт входа и регистрации устройства */
const RECONNECT_WAIT_MS = 30_000;
/** Состояния, в которых переподключение ещё идёт */
const WAITING_PROBLEMS = new Set<ChatConnectionProblem["kind"]>(["connecting", "registering"]);

export class JackdawChatAccount extends ChatAccount {
  readonly protocol: string = JACKDAW_CHAT_PROTOCOL;
  /** Ключи этого устройства. Секретный ключ хранится отдельно через шифрование ОС. */
  protected deviceKeys: DeviceKeys | null = null;
  /** email → deviceId → открытый ключ, известный нам. Новое устройство или смена ключа
   * принимаются, но показываются предупреждением (как «код безопасности изменился» в Signal). */
  protected pinnedKeys: Record<string, Record<string, string>> = {};
  /** id групп, которые мы удалили у себя. Создать такую группу снова может только
   * новое объявление состава от администратора, где мы есть (он пригласил нас снова). */
  protected deletedGroups: string[] = [];
  /** Псевдоним собеседника → адрес, на котором у него чат (из каталога организации).
   * Чат с человеком часто заведён на адрес из писем (`nikita.levchenko@`), а его устройство
   * подключено на адрес ящика (`nlevchenko0181@`): без этого сообщения были «Не отправлено». */
  protected addressAliases: Record<string, string> = {};
  /** Имена собеседников, заданные пользователем в чате: адрес → имя */
  protected contactNames: Record<string, string> = {};
  /** Имена из каталога организации: адрес → имя */
  protected directoryNames: Record<string, string> = {};
  /** Собеседники, чей адрес уже проверен при подключении: каталог не опрашиваем при каждом переподключении */
  protected peersChecked = new Set<string>();
  /** Другие адреса человека из каталога организации. Заменяется в тестах. */
  directoryAddresses: (email: string) => Promise<string[]> =
    email => findDirectoryAddresses(email, appGlobal.searchOnlyAddressbooks.contents);
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

  /** Имя собеседника: своё (переименован в чате), из адресной книги или каталога организации.
   * Имя из адреса (`Nlevchenko0181`) — только когда другого нет. */
  getPersonUID(userID: string, name?: string): ChatPersonUID {
    let person = super.getPersonUID(userID, name);
    let better = this.knownNameOf(userID);
    if (better && person.name != better && (this.customNameOf(userID) || isNameFromAddress(person.name, userID))) {
      person.name = better;
    }
    return person;
  }

  /** Своё имя для собеседника, заданное в чате. null — не переименован. */
  customNameOf(email: string): string | null {
    let key = normalizeCallEmail(email);
    return key ? this.contactNames[key] ?? null : null;
  }

  /** Лучшее известное имя без запросов в сеть. null — только имя из адреса. */
  protected knownNameOf(email: string): string | null {
    let key = normalizeCallEmail(email);
    if (!key) {
      return null;
    }
    let primary = this.addressAliases[key];
    let fromBook = [key, primary].filter(Boolean)
      .map(address => appGlobal.addressbooks.contents
        .flatMap(book => book.persons.contents)
        .find(person => person.name && person.emailAddresses.some(entry => normalizeCallEmail(entry.value) == address))?.name)
      .find(Boolean);
    return this.contactNames[key] ?? fromBook ?? this.directoryNames[key] ?? null;
  }

  /** Переименовать собеседника в чате (только у себя). Пустое имя — вернуть имя по умолчанию. */
  async renameContact(email: string, name: string): Promise<void> {
    let key = normalizeCallEmail(email);
    if (!key) {
      return;
    }
    let trimmed = name.trim().slice(0, MAX_CONTACT_NAME_LENGTH);
    if (trimmed) {
      this.contactNames[key] = trimmed;
    } else {
      delete this.contactNames[key];
    }
    await this.save();
    let person = this.getPersonUID(key);
    person.name = this.knownNameOf(key) ?? nameFromChatID(key);
    await this.saveRoomsWith(key);
  }

  /** Имя из каталога организации (Exchange GAL) для собеседника. Один раз за сеанс. */
  protected async loadDirectoryName(email: string): Promise<void> {
    let key = normalizeCallEmail(email);
    if (!key || this.contactNames[key] || this.directoryNames[key]) {
      return;
    }
    let lookup = this.directoryName(this.addressAliases[key] ?? key).catch(() => null);
    let timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), DIRECTORY_TIMEOUT_MS));
    let name = (await Promise.race([lookup, timeout]))?.trim();
    if (!name) {
      return;
    }
    this.directoryNames[key] = name.slice(0, MAX_CONTACT_NAME_LENGTH);
    await this.save();
    let person = this.getPersonUID(key);
    if (isNameFromAddress(person.name, key)) {
      person.name = this.knownNameOf(key) ?? person.name;
      await this.saveRoomsWith(key);
    }
  }

  /** Имя человека по адресу из каталога организации. Заменяется в тестах. */
  directoryName: (email: string) => Promise<string | null> =
    email => findDirectoryName(email, appGlobal.searchOnlyAddressbooks.contents);

  protected async saveRoomsWith(email: string): Promise<void> {
    for (let room of this.rooms.contents) {
      if (room instanceof JackdawChatRoom && !room.isGroup && room.peerEmail == email) {
        room.notifyObservers();
        await room.save().catch(this.errorCallback);
      }
    }
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
    this.deletedGroups = Array.isArray(json?.deletedGroups)
      ? json.deletedGroups.filter((id: unknown) => typeof id == "string").slice(-MAX_DELETED_GROUPS)
      : [];
    this.contactNames = readNames(json?.contactNames);
    this.directoryNames = readNames(json?.directoryNames);
    let aliases = json?.addressAliases;
    this.addressAliases = {};
    if (aliases && typeof aliases == "object" && !Array.isArray(aliases)) {
      for (let [alias, address] of Object.entries(aliases)) {
        let from = normalizeCallEmail(alias), to = typeof address == "string" ? normalizeCallEmail(address) : null;
        if (from && to && from != to) {
          this.addressAliases[from] = to;
        }
      }
    }
  }

  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.contactNames = this.contactNames;
    json.directoryNames = this.directoryNames;
    json.pinnedKeys = this.pinnedKeys;
    json.deletedGroups = this.deletedGroups;
    json.addressAliases = this.addressAliases;
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
    // Статус собеседника в списке чатов: псевдонимы узнаём заранее, не дожидаясь отправки
    for (let room of this.rooms.contents) {
      if (room instanceof JackdawChatRoom && !room.isGroup && room.peerEmail && !this.peersChecked.has(room.peerEmail)) {
        this.peersChecked.add(room.peerEmail);
        await this.chatAddressFor(room.peerEmail).catch(() => null);
        await this.loadDirectoryName(room.peerEmail).catch(() => null);
      }
    }
  }

  /** Почему чат сейчас не на связи. null — можно отправлять. */
  connectionProblem(): ChatConnectionProblem | null {
    let client = this.client;
    let status: JackdawCallStatus | null = !client ? null
      : client.isOnline ? "online"
      : client.status && client.status != "online" ? client.status : "offline";
    return chatConnectionProblem({
      status,
      proChecking: proEntitlement.value.status == "checking",
      proMessage: proEntitlement.value.message,
      lastError: client?.lastError ?? null,
      offlineSince: client?.offlineSince != null ? new Date(client.offlineSince) : null,
      hasVerifiedEmail: !!client?.verifiedEmails.length,
      isRegistered: this.registeredEmails.length > 0,
    });
  }

  /** Соединение с сервером для запроса. Нет связи или чат не подключён — понятная ошибка
   * с причиной; баннер с ней предлагает переподключиться. */
  requireOnline(): JackdawCallClient {
    let problem = this.connectionProblem();
    if (problem) {
      throw new JackdawChatConnectionError(problem, this);
    }
    return this.client!; // без соединения `connectionProblem()` вернул бы причину
  }

  /**
   * Кнопка «Переподключить»: входит заново сразу, без паузы и после отказа.
   * Неотправленное досылается после регистрации устройства, как при любом переподключении (`onReconnected`).
   * @param timeoutMs сколько ждать связи
   * @throws JackdawChatConnectionError с причиной, если связь не появилась
   */
  async reconnect(timeoutMs = RECONNECT_WAIT_MS): Promise<void> {
    this.client?.restart();
    await new Promise<void>((resolve, reject) => {
      let done = false;
      let stops: (() => void)[] = [];
      let finish = (problem: ChatConnectionProblem | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Не во время рассылки наблюдателям: отписка посреди неё пропустила бы следующего наблюдателя
        queueMicrotask(() => stops.forEach(stop => stop()));
        problem ? reject(new JackdawChatConnectionError(problem, this)) : resolve();
      };
      let check = () => {
        let problem = this.isOnline ? null : this.connectionProblem();
        // Подключение и регистрация устройства идут: ждём их результата
        if (problem && WAITING_PROBLEMS.has(problem.kind)) return;
        finish(problem);
      };
      let timer = setTimeout(() => finish(this.connectionProblem()), timeoutMs);
      stops.push(this.subscribe(check));
      if (this.client) {
        stops.push(this.client.subscribe(check));
      }
    });
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
    recipients = [...new Set(await Promise.all(recipients.map(email => this.chatAddressFor(email))))];
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

  /** @param onProgress доля загруженного, 0…1, после каждой части */
  async uploadBlob(data: Uint8Array, onProgress?: (done: number) => void): Promise<string> {
    let client = this.requireOnline();
    let blobId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    let total = Math.max(1, Math.ceil(data.length / BLOB_CHUNK_BYTES));
    for (let index = 0; index < total; index++) {
      let chunk = data.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES);
      await client.request({ type: "blob-put", blobId, index, total, data: toBase64(chunk) },
        reply => (reply.type == "blob-stored" && reply.index == index || reply.type == "error") && reply.blobId == blobId,
        BLOB_TIMEOUT_MS);
      onProgress?.((index + 1) / total);
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
    let fromNewerVersion = false;
    try {
      sender = await this.senderDevice(message.from, message.fromDevice);
      let decrypted = sender ? decryptMessage(message.ciphertext, message.key, message.messageId, sender, this.deviceKeys!) : null;
      payload = parseChatPayload(decrypted);
      fromNewerVersion = !payload && isFutureChatPayload(decrypted);
    } catch (ex) {
      payload = null;
    }
    if (payload && payload.id != message.messageId) {
      payload = null; // id внутри шифротекста должен совпасть с конвертом
    }
    if (payload) {
      let fromMe = this.isOwnEmail(message.from) || await this.isOwnDevice(sender!);
      await this.applyPayload(payload, message.from, new Date(message.sentAt || Date.now()), fromMe);
    } else if (!message.ephemeral && !fromNewerVersion) {
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
    // Новый чат создают только сообщение и объявление группы; отметки, правки, реакции — только в существующем
    let room = await this.roomForPayload(payload.room, from, fromMe, payload.kind == "message" || payload.kind == "group", payload.kind == "group");
    if (!room) return;
    switch (payload.kind) {
      case "message":
        await room.addIncoming(payload, from, fromMe, sentAt);
        break;
      case "read":
        room.markSeen(payload.ids, fromMe, from);
        break;
      case "edit":
        await room.applyEdit(payload, from, fromMe);
        break;
      case "delete":
        await room.applyDelete(payload, from, fromMe);
        break;
      case "reaction":
        await room.applyReaction(payload, from, fromMe);
        break;
      case "typing":
        room.applyTyping(from, fromMe);
        break;
      case "group":
        // Метаданные группы от администратора уже применены в roomForPayload()
        if (payload.leave) {
          await room.memberLeft(from);
        }
        break;
    }
  }

  /** Находит или создаёт комнату. Состав группы меняет только её администратор.
   * Вышедшего или убранного участника возвращает в группу только объявление состава (`announcement`):
   * устаревший состав в обычном сообщении администратора (гонка, старая версия) его не возвращает.
   * @param create false — только существующая комната
   * @param announcement Сообщение — объявление состава группы (kind "group") */
  protected async roomForPayload(ref: ChatRoomRef, from: string, fromMe: boolean, create = true, announcement = false): Promise<JackdawChatRoom | null> {
    if (ref.type == "direct") {
      let peer = fromMe ? ref.peer : from;
      if (!peer || this.isOwnEmail(peer)) return null;
      let room = create ? await this.getDirectRoom(peer) : this.findDirectRoom(normalizeCallEmail(peer) ?? peer);
      // Наш адрес в этом чате: собеседник писал на ref.peer, наше другое устройство — с from
      if (room?.rememberOwnEmail(fromMe ? from : ref.peer)) {
        await room.save();
      }
      return room;
    }
    let room = this.findRoomByID(`group:${ref.id}`);
    if (room) {
      if (from == room.admin && (room.isMember || announcement)) {
        await room.applyGroupInfo(ref);
      }
      if (!room.isMember) {
        return null; // мы не в группе: её сообщения нам больше не нужны
      }
      if (!room.memberEmails.includes(from) && from != room.admin && !fromMe) {
        return null; // посторонний не может писать в чужую группу
      }
      return room;
    }
    if (from != ref.admin || !create) {
      return null; // группу может создать только её администратор
    }
    if (!ref.members.some(email => this.isOwnEmail(email))) {
      return null; // нас в ней нет (например, нас из неё убрали)
    }
    if (this.deletedGroups.includes(ref.id)) {
      if (!announcement) {
        return null; // удалили у себя; устаревшее сообщение администратора её не возвращает
      }
      this.deletedGroups = this.deletedGroups.filter(id => id != ref.id); // пригласили снова
      await this.save();
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
    let existing = this.findDirectRoom(email);
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

  /** Создаёт группу. Мы — администратор.
   * Адреса без чата Jackdaw в группу не попадают: сообщения до них не дошли бы.
   * Интерфейс предупреждает о них заранее (`emailsWithoutChat`). */
  async createGroup(name: string, emails: string[]): Promise<JackdawChatRoom> {
    this.requireOnline();
    let wanted = [...new Set(emails.map(normalizeCallEmail).filter((e): e is string => !!e && !this.isOwnEmail(e)))];
    if (!wanted.length) {
      throw new UserError(gt`Add at least one member to the group.`);
    }
    let withoutChat = await this.emailsWithoutChat(wanted);
    let members = wanted.filter(email => !withoutChat.includes(email));
    if (!members.length) {
      throw new UserError(withoutChat.length == 1
        ? gt`${withoutChat[0]} does not use Jackdaw chat yet. Add someone who uses Jackdaw Mail.`
        : gt`None of these contacts use Jackdaw chat yet. Add someone who uses Jackdaw Mail.`);
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

  /** Адреса, у которых нет ни одного устройства с чатом Jackdaw. Один запрос на все адреса. */
  async emailsWithoutChat(emailAddresses: string[]): Promise<string[]> {
    let emails = [...new Set(emailAddresses.map(normalizeCallEmail).filter((e): e is string => !!e))];
    if (!emails.length) {
      return [];
    }
    let devices = await this.devicesFor(emails);
    return emails.filter(email => !(devices.get(email) ?? []).length);
  }

  /** Удаляет чат и его историю только у нас. Из группы сначала выходим:
   * иначе сообщение администратора создало бы её снова, а участники считали бы нас в ней. */
  async deleteRoom(room: JackdawChatRoom): Promise<void> {
    if (room.isGroup && room.isMember) {
      await room.leaveGroup();
    }
    if (room.dbID) {
      // Файлы вложений лежат на диске отдельно от базы: удаляем и их
      await room.listMessages();
      for (let msg of room.messages.contents) {
        if (!(msg instanceof JackdawChatMessage)) continue;
        for (let attachment of msg.attachments) {
          if (attachment.filepathLocal) {
            await this.storage.deleteAttachment(attachment).catch(this.errorCallback);
          }
        }
      }
      await this.storage.deleteRoom(room);
    }
    this.rooms.remove(room);
    if (room.isGroup) {
      let id = room.id.slice("group:".length);
      this.deletedGroups = [...this.deletedGroups.filter(known => known != id), id].slice(-MAX_DELETED_GROUPS);
      await this.save();
    }
  }

  /** Есть ли у адреса устройства для чата. Для кнопки «Написать». */
  async canChatWith(emailAddress: string): Promise<boolean> {
    let email = normalizeCallEmail(emailAddress);
    if (!email || !this.isOnline || this.isOwnEmail(email)) return false;
    let target = await this.chatAddressFor(email);
    return ((await this.devicesFor([target])).get(target) ?? []).length > 0;
  }

  // --- псевдонимы -------------------------------------------------------------

  /** Адрес, на котором у собеседника чат: известный по каталогу, иначе сам `email`. Без запросов. */
  primaryAddressOf(emailAddress: string): string | null {
    let email = normalizeCallEmail(emailAddress);
    return email ? this.addressAliases[email] ?? null : null;
  }

  /**
   * Куда писать: сам адрес, если на нём есть чат, иначе другой адрес того же человека
   * из каталога организации, на котором чат есть. Найденное запоминается.
   */
  async chatAddressFor(emailAddress: string): Promise<string> {
    let email = normalizeCallEmail(emailAddress);
    if (!email || this.isOwnEmail(email)) {
      return email ?? emailAddress;
    }
    let known = this.addressAliases[email];
    if (known) {
      return known;
    }
    if (((await this.devicesFor([email])).get(email) ?? []).length) {
      return email;
    }
    // Каталог может не ответить (нет входа в Exchange): отправка не ждёт его дольше нескольких секунд
    let lookup = this.directoryAddresses(email).catch(() => [] as string[]);
    let timeout = new Promise<string[]>(resolve => setTimeout(() => resolve([]), DIRECTORY_TIMEOUT_MS));
    let candidates = (await Promise.race([lookup, timeout]))
      .filter(address => address != email && !this.isOwnEmail(address));
    if (!candidates.length) {
      return email;
    }
    let devices = await this.devicesFor(candidates);
    let target = candidates.find(address => (devices.get(address) ?? []).length);
    if (!target) {
      return email;
    }
    this.addressAliases[email] = target;
    await this.save();
    // Статус и звонок по псевдониму берутся теперь с найденного адреса: обновляем интерфейс
    if (this.client) {
      this.client.presenceVersion++;
    }
    return target;
  }

  /** Личный чат с человеком: по его адресу или по псевдониму, у которого этот адрес основной */
  protected findDirectRoom(email: string): JackdawChatRoom | null {
    let room = this.findRoomByID(`direct:${email}`);
    if (room) {
      return room;
    }
    let alias = Object.keys(this.addressAliases).find(known =>
      this.addressAliases[known] == email && this.findRoomByID(`direct:${known}`));
    return alias ? this.findRoomByID(`direct:${alias}`) : null;
  }
}
