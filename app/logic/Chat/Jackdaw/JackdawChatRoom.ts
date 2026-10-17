import { ChatRoom } from "../ChatRoom";
import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Group } from "../../Abstract/Group";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { SQLChatMessage, uniqueAttachmentFilename } from "../SQL/SQLChatMessage";
import { JackdawChatAttachment, JackdawChatMessage } from "./JackdawChatMessage";
import type { JackdawChatAccount } from "./JackdawChatAccount";
import { decryptFile, encryptFile } from "./JackdawChatCrypto";
import { CHAT_PAYLOAD_VERSION, MAX_ACK_IDS, MAX_ATTACHMENTS, MAX_TEXT_LENGTH, type ChatAttachmentRef, type ChatPayload, type ChatRoomRef } from "./JackdawChatProtocol";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Совпадает с MAX_BLOB_BYTES на сервере */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 - 1024;
/** Исходящие с этими статусами не дошли до сервера: их досылаем после переподключения */
const UNSENT_STATUSES = [DeliveryStatus.Sending, DeliveryStatus.Failed];
/** Уже дошли до сервера: повторная отправка не нужна */
const SENT_STATUSES = [DeliveryStatus.Server, DeliveryStatus.User, DeliveryStatus.Seen];

/** Личный чат (`direct:<email>`) или группа (`group:<uuid>`) Jackdaw. */
export class JackdawChatRoom extends ChatRoom {
  declare account: JackdawChatAccount;
  readonly isGroup: boolean;
  /** Группа: адрес администратора. Только он меняет состав и название. */
  admin: string | null = null;
  /** Группа: все участники, включая нас */
  memberEmails: string[] = [];
  /** Личный чат: наш адрес, под которым нас знает собеседник. С него и отправляем. */
  ownEmail: string | null = null;
  protected historyLoaded = false;
  protected historyLoading: Promise<void> | null = null;
  /** Отправляемые сейчас: id → отправка. Повторный вызов ждёт ту же отправку, а не шлёт второй раз. */
  protected sending = new Map<string, Promise<void>>();

  constructor(account: JackdawChatAccount, isGroup = false) {
    super(account);
    this.isGroup = isGroup;
  }

  /** Адрес собеседника в личном чате */
  get peerEmail(): string | null {
    return this.isGroup ? null : this.id?.startsWith("direct:") ? this.id.slice("direct:".length) : null;
  }

  async listMembers(): Promise<void> {
    if (!this.isGroup) {
      await this.listMembers1to1();
    }
  }

  async listMessages(): Promise<void> {
    if (this.historyLoaded || !this.dbID) {
      // Чтение уже идёт: ждём его, чтобы вызывающий видел всю историю
      await this.historyLoading;
      return;
    }
    this.historyLoaded = true;
    this.historyLoading = (async () => {
      await SQLChatMessage.readAll(this);
      this.lastMessage = this.messages.contents
        .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
        .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
      this.updateUnreadCount();
      this.resumeDownloads();
    })();
    await this.historyLoading;
  }

  /** Превью и счётчик непрочитанных для списка чатов — без чтения всей истории */
  async loadSummary(): Promise<void> {
    if (this.historyLoaded || !this.dbID) {
      return;
    }
    let last = await SQLChatMessage.readLast(this);
    if (last && !this.historyLoaded && (!this.lastMessage || last.sent > this.lastMessage.sent)) {
      this.lastMessage = last;
    }
    let unread = await SQLChatMessage.countUnread(this);
    if (!this.historyLoaded) {
      this.unreadCount = unread;
    }
  }

  /** Пересчитывает непрочитанные входящие по загруженным сообщениям */
  updateUnreadCount(): void {
    this.unreadCount = this.messages.contents
      .filter(msg => msg instanceof JackdawChatMessage && !msg.outgoing && !msg.isRead)
      .length;
  }

  /** Отмечает прочитанными все входящие: комната открыта и окно в фокусе.
   * Собеседник получает отметку о прочтении одним сообщением (в личном чате). */
  async markAllRead(): Promise<void> {
    await this.listMessages();
    let unread = this.messages.contents
      .filter((msg): msg is JackdawChatMessage => msg instanceof JackdawChatMessage && !msg.outgoing && !msg.isRead);
    if (!unread.length) {
      this.updateUnreadCount();
      return;
    }
    for (let msg of unread) {
      msg.isRead = true;
    }
    this.updateUnreadCount();
    for (let msg of unread) {
      await msg.save();
    }
    let ids = unread.map(msg => msg.id);
    for (let i = 0; i < ids.length; i += MAX_ACK_IDS) {
      await this.sendReadReceipt(ids.slice(i, i + MAX_ACK_IDS));
    }
  }

  newMessage(): JackdawChatMessage {
    return new JackdawChatMessage(this);
  }

  /** Получатели: собеседник или участники группы, кроме нас */
  recipients(): string[] {
    if (!this.isGroup) {
      return this.peerEmail ? [this.peerEmail] : [];
    }
    return this.memberEmails.filter(email => !this.account.isOwnEmail(email));
  }

  /** Наш адрес для отправки в эту комнату: под ним нас знают собеседники.
   * Группа — наш адрес из состава группы. Личный чат — адрес, на который писал собеседник,
   * или с которого мы написали первыми. Иначе — первый подтверждённый (решает `sendPayload`). */
  senderEmail(): string | undefined {
    let own = this.account.registeredEmails;
    if (this.isGroup) {
      return this.memberEmails.find(email => own.includes(email)) ??
        (this.admin && own.includes(this.admin) ? this.admin : undefined);
    }
    return this.ownEmail && own.includes(this.ownEmail) ? this.ownEmail : undefined;
  }

  /** Запоминает наш адрес в личном чате. @returns true, если он изменился */
  rememberOwnEmail(email: string | null | undefined): boolean {
    if (this.isGroup || !email || this.ownEmail == email || !this.account.isOwnEmail(email)) {
      return false;
    }
    this.ownEmail = email;
    return true;
  }

  roomRef(): ChatRoomRef {
    if (!this.isGroup) {
      return { type: "direct", peer: this.peerEmail ?? undefined };
    }
    return {
      type: "group",
      id: this.id.slice("group:".length),
      name: this.name,
      admin: this.admin,
      members: this.memberEmails,
    };
  }

  // --- отправка -------------------------------------------------------------

  async sendMessage(message: ChatMessage): Promise<void> {
    if (message.isEdit) {
      throw new UserError(gt`Editing sent messages is not supported in Jackdaw chat yet.`);
    }
    if (message.attachments.length > MAX_ATTACHMENTS) {
      throw new UserError(gt`You can send at most ${MAX_ATTACHMENTS} files in one message.`);
    }
    if (message.text.length > MAX_TEXT_LENGTH) {
      throw new UserError(gt`The message is too long.`);
    }
    let refs = message instanceof JackdawChatMessage ? message.attachmentRefs : {};
    for (let attachment of message.attachments) {
      if (refs[attachment.filename]) {
        continue; // уже загружен на сервер при прошлой попытке
      }
      if (!attachment.content && attachment.filepathLocal) {
        await attachment.read(); // повторная отправка после перезапуска: файл на диске
      }
      if (!attachment.content) {
        throw new UserError(gt`Attachment is empty`);
      }
      if (attachment.content.size > MAX_ATTACHMENT_BYTES) {
        throw new UserError(gt`The file ${attachment.filename} is larger than 25 MB.`);
      }
    }
    message.id ??= crypto.randomUUID();
    let running = this.sending.get(message.id);
    if (running) {
      return await running; // двойной Enter или «Повторить» во время отправки
    }
    if (this.messages.contents.includes(message) && SENT_STATUSES.includes(message.deliveryStatus)) {
      return; // уже на сервере
    }
    let sending = this.sendNow(message).finally(() => this.sending.delete(message.id));
    this.sending.set(message.id, sending);
    await sending;
  }

  protected async sendNow(message: ChatMessage): Promise<void> {
    message.from ??= this.account.getOwnContact();
    message.outgoing = true;
    message.sent ??= new Date();
    message.received = new Date();
    message.deliveryStatus = DeliveryStatus.Sending;
    this.makeAttachmentNamesUnique(message);
    if (!this.messages.contents.includes(message)) {
      this.messages.add(message);
    }
    this.lastMessage = message;
    try {
      // Сохраняем до загрузки файлов: при обрыве или закрытии приложения сообщение не теряется
      // и досылается после переподключения.
      await this.saveMessage(message);
      let attachments: ChatAttachmentRef[] = [];
      for (let attachment of message.attachments) {
        attachments.push(await this.uploadAttachment(message, attachment));
      }
      let from = this.senderEmail();
      let sent = await this.account.sendPayload(this.recipients(), {
        v: CHAT_PAYLOAD_VERSION,
        kind: "message",
        id: message.id,
        room: this.roomRef(),
        text: message.text,
        html: message.hasHTML ? message.rawHTMLDangerous : null,
        inReplyTo: message.inReplyTo ?? null,
        attachments,
      }, false, from);
      message.deliveryStatus = sent.delivered > 0 ? DeliveryStatus.User : DeliveryStatus.Server;
      if (!this.isGroup && !this.ownEmail) {
        // Первыми написали мы: запоминаем, с какого адреса
        this.rememberOwnEmail(from ?? this.account.registeredEmails[0]);
        await this.save();
      }
    } catch (ex) {
      message.deliveryStatus = DeliveryStatus.Failed;
      await this.saveMessage(message);
      throw ex;
    }
    await this.saveMessage(message);
  }

  /** Шифрует и загружает файл. Уже загруженный при прошлой попытке не загружается снова. */
  protected async uploadAttachment(message: ChatMessage, attachment: Attachment): Promise<ChatAttachmentRef> {
    let refs = message instanceof JackdawChatMessage ? message.attachmentRefs : null;
    let known = refs?.[attachment.filename];
    if (known) {
      return known;
    }
    let encrypted = encryptFile(new Uint8Array(await attachment.content.arrayBuffer()));
    let blobId = await this.account.uploadBlob(encrypted.data);
    let ref: ChatAttachmentRef = {
      blobId,
      key: encrypted.key,
      sha256: encrypted.sha256,
      name: attachment.filename,
      mime: attachment.mimeType || "application/octet-stream",
      size: attachment.content.size,
    };
    if (refs) {
      refs[attachment.filename] = ref;
    }
    return ref;
  }

  /** Одинаковые имена файлов в одном сообщении: база и ссылки на файлы различают вложения по имени */
  protected makeAttachmentNamesUnique(message: ChatMessage): void {
    let taken = new Set<string>();
    for (let attachment of message.attachments) {
      attachment.filename = uniqueAttachmentFilename(attachment.filename || gt`File`, taken);
      taken.add(attachment.filename);
    }
  }

  /** Досылает исходящие, которые не дошли до сервера: после переподключения, в т.ч. после перезапуска.
   * Ошибки не показываем: сообщение остаётся «Не отправлено» с кнопкой «Повторить». */
  async sendUnsent(): Promise<void> {
    if (this.dbID && !this.historyLoaded &&
        await SQLChatMessage.hasOutgoingWithStatus(this, UNSENT_STATUSES).catch(() => true)) {
      await this.listMessages();
    }
    let unsent = this.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage && msg.outgoing &&
        UNSENT_STATUSES.includes(msg.deliveryStatus) && !this.sending.has(msg.id))
      .sort((a, b) => a.sent.getTime() - b.sent.getTime());
    for (let msg of unsent) {
      if (!this.account.isOnline) {
        return;
      }
      try {
        await this.sendMessage(msg);
      } catch (ex) {
        // статус уже «Не отправлено»
      }
    }
  }

  /** Рассылает участникам состав и название группы */
  async announceGroup(): Promise<void> {
    await this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION,
      kind: "group",
      id: crypto.randomUUID(),
      room: this.roomRef(),
    });
  }

  /** Сообщает собеседнику, что мы прочитали его сообщения. Только в личных чатах. */
  async sendReadReceipt(ids: string[]): Promise<void> {
    if (this.isGroup || !ids.length || !this.account.isOnline) {
      return;
    }
    await this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION,
      kind: "read",
      id: crypto.randomUUID(),
      room: this.roomRef(),
      ids,
    });
  }

  protected async saveMessage(message: ChatMessage): Promise<void> {
    if (!this.dbID) {
      await this.save();
    }
    await message.save();
  }

  // --- приём ------------------------------------------------------------------

  async addIncoming(payload: Extract<ChatPayload, { kind: "message" }>, from: string, fromMe: boolean, sentAt: Date): Promise<void> {
    await this.listMessages();
    if (this.messages.find(m => m.id == payload.id)) {
      return; // повторная доставка
    }
    let msg = this.newMessage();
    msg.id = payload.id;
    msg.from = this.account.getPersonUID(from);
    msg.contact = this.isGroup ? this.contact : msg.from;
    msg.outgoing = fromMe;
    msg.sent = sentAt;
    msg.received = new Date();
    msg.inReplyTo = payload.inReplyTo;
    msg.deliveryStatus = fromMe ? DeliveryStatus.Server : DeliveryStatus.Unknown;
    msg.isRead = fromMe;
    if (payload.html) {
      msg.html = payload.html; // хранится как есть, показывается только через санирующий геттер `html`
      msg.regenerateTextFromHTML();
    } else {
      msg.text = payload.text;
    }
    let taken = new Set<string>();
    for (let ref of payload.attachments) {
      this.addAttachment(msg, ref, taken);
    }
    this.messages.add(msg);
    if (!this.lastMessage || msg.sent > this.lastMessage.sent) {
      this.lastMessage = msg;
    }
    if (!fromMe) {
      this.updateUnreadCount();
    }
    await this.saveMessage(msg);
    // Скачиваем только после сохранения: иначе сохранение файла на диск могло совпасть
    // с сохранением сообщения без dbID/строки вложения и потеряться (RunOnce в Attachment.save).
    for (let attachment of msg.attachments) {
      if (attachment instanceof JackdawChatAttachment) {
        void this.downloadAttachment(attachment);
      }
    }
    if (!fromMe) {
      this.account.incomingMessageCallback(this, msg);
    }
  }

  protected addAttachment(msg: JackdawChatMessage, ref: ChatAttachmentRef, taken = new Set<string>()): void {
    let attachment = msg.newAttachment();
    attachment.filename = uniqueAttachmentFilename(sanitize.filename(ref.name, gt`File`), taken);
    taken.add(attachment.filename);
    attachment.mimeType = ref.mime;
    attachment.size = ref.size;
    // Как у своих исходящих (`fromFile()`): картинки показываются по MIME-типу,
    // а `inline` скрыл бы вложение из списка.
    attachment.disposition = ContentDisposition.attachment;
    msg.attachmentRefs[attachment.filename] = ref;
    msg.attachments.add(attachment);
  }

  /** Скачивает и расшифровывает файл. Ошибка остаётся на вложении, интерфейс предлагает повторить. */
  async downloadAttachment(attachment: JackdawChatAttachment): Promise<void> {
    let msg = attachment.message as JackdawChatMessage;
    let ref = msg.attachmentRefs[attachment.filename];
    if (!ref || attachment.content || attachment.filepathLocal || attachment.downloading) {
      return;
    }
    attachment.downloading = true;
    attachment.downloadError = null;
    try {
      let data = await this.account.downloadBlob(ref.blobId);
      let content = decryptFile(data, ref.key, ref.sha256);
      attachment.content = new File([content as Uint8Array<ArrayBuffer>], attachment.filename, { type: attachment.mimeType });
      attachment.size = content.length;
      await attachment.save();
    } catch (ex) {
      attachment.downloadError = ex instanceof Error ? ex : new Error(String(ex));
    } finally {
      attachment.downloading = false;
    }
  }

  /** Докачивает файлы, которые не успели скачаться (например, до перезапуска) */
  resumeDownloads(): void {
    if (!this.account.isOnline) {
      return;
    }
    for (let msg of this.messages.contents) {
      if (!(msg instanceof JackdawChatMessage)) continue;
      for (let attachment of msg.attachments) {
        if (attachment instanceof JackdawChatAttachment && attachment.needsDownload && !attachment.downloadError) {
          void this.downloadAttachment(attachment);
        }
      }
    }
  }

  /** Отметки о прочтении: от собеседника — для наших сообщений, от наших устройств — для входящих */
  markSeen(ids: string[], fromMe: boolean): void {
    let readChanged = false;
    for (let msg of this.messages.contents) {
      if (!(msg instanceof JackdawChatMessage) || !ids.includes(msg.id)) continue;
      if (fromMe && !msg.outgoing) {
        readChanged ||= !msg.isRead;
        msg.isRead = true;
      } else if (!fromMe && msg.outgoing) {
        msg.deliveryStatus = DeliveryStatus.Seen;
      } else {
        continue;
      }
      msg.save().catch(this.account.errorCallback);
    }
    if (readChanged) {
      this.updateUnreadCount();
    }
  }

  // --- группа -----------------------------------------------------------------

  async applyGroupInfo(ref: Extract<ChatRoomRef, { type: "group" }>, save = true): Promise<void> {
    if (!(this.contact instanceof Group)) {
      this.contact = new Group();
    }
    this.contact.name = ref.name || gt`Group`;
    this._name = this.contact.name;
    this.admin = ref.admin;
    this.memberEmails = ref.members;
    this.isAdmin = this.account.isOwnEmail(ref.admin);
    this.members.replaceAll(ref.members
      .filter(email => !this.account.isOwnEmail(email))
      .map(email => this.account.getPersonUID(email)));
    if (save) {
      await this.save();
    }
  }

  toExtraJSON(): any {
    return this.isGroup ? { groupAdmin: this.admin, groupMembers: this.memberEmails } : this.ownEmail ? { ownEmail: this.ownEmail } : {};
  }

  fromExtraJSON(json: any): void {
    if (!this.isGroup) {
      this.ownEmail = sanitize.nonemptystring(json?.ownEmail, null);
      return;
    }
    this.admin = sanitize.nonemptystring(json?.groupAdmin, null);
    this.memberEmails = Array.isArray(json?.groupMembers) ? json.groupMembers.filter((e: unknown) => typeof e == "string") : [];
    this.isAdmin = !!this.admin && this.account.isOwnEmail(this.admin);
  }
}
