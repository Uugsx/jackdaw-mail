import { ChatRoom } from "../ChatRoom";
import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Group } from "../../Abstract/Group";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { SQLChatMessage, uniqueAttachmentFilename } from "../SQL/SQLChatMessage";
import { JackdawChatAttachment, JackdawChatMessage } from "./JackdawChatMessage";
import type { JackdawChatAccount } from "./JackdawChatAccount";
import { decryptFile, encryptFile } from "./JackdawChatCrypto";
import { CHAT_PAYLOAD_VERSION, MAX_ACK_IDS, MAX_ATTACHMENTS, MAX_GROUP_MEMBERS, MAX_TEXT_LENGTH, withLinkFallback, withoutLinkFallback, type ChatAttachmentRef, type ChatPayload, type ChatRoomRef } from "./JackdawChatProtocol";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { notifyChangedProperty } from "../../util/Observable";
import { normalizeCallEmail } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { ChatPersonUID } from "../ChatPersonUID";

/** Совпадает с MAX_BLOB_BYTES на сервере */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 - 1024;
/** Исходящие с этими статусами не дошли до сервера: их досылаем после переподключения */
const UNSENT_STATUSES = [DeliveryStatus.Sending, DeliveryStatus.Failed];
/** Уже дошли до сервера: повторная отправка не нужна */
const SENT_STATUSES = [DeliveryStatus.Server, DeliveryStatus.User, DeliveryStatus.Seen];

/** Личный чат (`direct:<email>`) или группа (`group:<uuid>`) Jackdaw. */
/** Не чаще раза в 4 с сообщаем, что печатаем; собеседник показывает подсказку 6 с */
const TYPING_SEND_INTERVAL_MS = 4000;
const TYPING_SHOW_MS = 6000;

/** Текст сообщения: HTML хранится как есть и показывается через санирующий геттер `html` */
function setMessageContent(message: ChatMessage, text: string, html: string | null): void {
  if (html) {
    message.html = html;
    message.regenerateTextFromHTML();
  } else {
    message.html = null;
    message.text = text;
  }
}

export class JackdawChatRoom extends ChatRoom {
  declare account: JackdawChatAccount;
  readonly isGroup: boolean;
  /** Группа: адрес администратора. Только он меняет состав и название. */
  admin: string | null = null;
  /** Группа: все участники, включая нас. Интерфейс следит за ним: от него зависит `isMember`. */
  @notifyChangedProperty
  memberEmails: string[] = [];
  /** Личный чат: наш адрес, под которым нас знает собеседник. С него и отправляем. */
  ownEmail: string | null = null;
  protected historyLoaded = false;
  protected historyLoading: Promise<void> | null = null;
  /** Отправляемые сейчас: id → отправка. Повторный вызов ждёт ту же отправку, а не шлёт второй раз. */
  protected sending = new Map<string, Promise<void>>();
  /** Кто сейчас набирает сообщение: адреса собеседников. Интерфейс показывает «печатает…». */
  @notifyChangedProperty
  typing: string[] = [];
  protected typingUntil = new Map<string, number>();
  protected typingTimer: ReturnType<typeof setTimeout> | null = null;
  protected lastTypingSentAt = 0;

  constructor(account: JackdawChatAccount, isGroup = false) {
    super(account);
    this.isGroup = isGroup;
  }

  /** Адрес собеседника в личном чате */
  get peerEmail(): string | null {
    return this.isGroup ? null : this.id?.startsWith("direct:") ? this.id.slice("direct:".length) : null;
  }

  /** Группа: мы ещё в ней. Вышли или нас убрал администратор — писать в неё нельзя.
   * Личный чат — всегда. */
  get isMember(): boolean {
    return !this.isGroup || this.memberEmails.some(email => this.account.isOwnEmail(email));
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
   * Собеседник (в группе — все участники) получает отметку о прочтении одним сообщением. */
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
    if (!this.isMember) {
      throw new UserError(gt`You are no longer a member of this group.`);
    }
    if (message.isEdit) {
      await this.sendEdit(message);
      return;
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
        text: message instanceof JackdawChatMessage && message.links.length
          ? withLinkFallback(message.text, message.links)
          : message.text,
        html: message.hasHTML ? message.rawHTMLDangerous : null,
        inReplyTo: message.inReplyTo ?? null,
        attachments,
        ...(message instanceof JackdawChatMessage && message.links.length ? { links: message.links } : {}),
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
    let progress = attachment instanceof JackdawChatAttachment ? attachment : null;
    let blobId: string;
    if (progress) {
      progress.uploadProgress = 0;
    }
    try {
      blobId = await this.account.uploadBlob(encrypted.data, done => {
        if (progress) {
          progress.uploadProgress = done;
        }
      });
    } finally {
      if (progress) {
        progress.uploadProgress = null;
      }
    }
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

  /** Рассылает участникам состав и название группы
   * @param alsoTo Кому ещё: убранным из группы, чтобы они узнали об этом */
  async announceGroup(alsoTo: string[] = []): Promise<void> {
    await this.account.sendPayload([...new Set([...this.recipients(), ...alsoTo])], {
      v: CHAT_PAYLOAD_VERSION,
      kind: "group",
      id: crypto.randomUUID(),
      room: this.roomRef(),
    });
  }

  /** Новый текст нашего сообщения: у собеседников и на наших устройствах */
  protected async sendEdit(edit: ChatMessage): Promise<void> {
    let original = this.messages.find(m => m.id == edit.isEdit);
    if (!(original instanceof JackdawChatMessage) || !original.canEdit) {
      throw new UserError(gt`This message can no longer be edited.`);
    }
    let text = edit.text;
    if (!text.trim()) {
      throw new UserError(gt`The message is empty.`);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new UserError(gt`The message is too long.`);
    }
    let html = edit.hasHTML ? edit.rawHTMLDangerous : null;
    await this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION, kind: "edit", id: crypto.randomUUID(), room: this.roomRef(),
      target: original.id, text, html,
    }, false, this.senderEmail());
    setMessageContent(original, text, html);
    original.edited = true;
    await this.saveMessage(original);
  }

  /** Просит собеседников удалить наше сообщение. Текст и файлы у нас убирает `ChatMessage.deleteForOthers()`. */
  async sendDeleteForAll(message: JackdawChatMessage): Promise<void> {
    await this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION, kind: "delete", id: crypto.randomUUID(), room: this.roomRef(), target: message.id,
    }, false, this.senderEmail());
    message.attachmentRefs = {};
  }

  async sendReaction(message: JackdawChatMessage, emoji: string | null): Promise<void> {
    await this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION, kind: "reaction", id: crypto.randomUUID(), room: this.roomRef(), target: message.id, emoji,
    }, false, this.senderEmail());
  }

  /** «Печатает…» — не чаще раза в несколько секунд и только тем, кто сейчас в сети */
  sendTyping(): void {
    let now = Date.now();
    if (now - this.lastTypingSentAt < TYPING_SEND_INTERVAL_MS || !this.account.isOnline || !this.isMember || !this.recipients().length) {
      return;
    }
    this.lastTypingSentAt = now;
    this.account.sendPayload(this.recipients(), {
      v: CHAT_PAYLOAD_VERSION, kind: "typing", id: crypto.randomUUID(), room: this.roomRef(),
    }, true, this.senderEmail()).catch(() => {
      // Подсказка «печатает…» необязательна: ошибку не показываем
    });
  }

  /** Сообщает собеседнику (в группе — всем участникам), что мы прочитали его сообщения */
  async sendReadReceipt(ids: string[]): Promise<void> {
    if (!ids.length || !this.account.isOnline || !this.isMember || !this.recipients().length) {
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

  /** Править, удалять у всех может только автор сообщения */
  protected isAuthor(message: JackdawChatMessage, from: string, fromMe: boolean): boolean {
    return fromMe ? message.outgoing : !message.outgoing && normalizeCallEmail(message.from?.chatID) == from;
  }

  protected async findMessageForUpdate(target: string): Promise<JackdawChatMessage | null> {
    await this.listMessages();
    let message = this.messages.find(m => m.id == target);
    return message instanceof JackdawChatMessage ? message : null;
  }

  async applyEdit(payload: Extract<ChatPayload, { kind: "edit" }>, from: string, fromMe: boolean): Promise<void> {
    let original = await this.findMessageForUpdate(payload.target);
    if (!original || original.deletedForAll || !this.isAuthor(original, from, fromMe)) {
      return;
    }
    setMessageContent(original, payload.text, payload.html);
    original.edited = true;
    await this.saveMessage(original);
  }

  async applyDelete(payload: Extract<ChatPayload, { kind: "delete" }>, from: string, fromMe: boolean): Promise<void> {
    let original = await this.findMessageForUpdate(payload.target);
    if (!original || original.deletedForAll || !this.isAuthor(original, from, fromMe)) {
      return;
    }
    original.deletedForAll = true;
    setMessageContent(original, fromMe ? gt`You deleted this message` : gt`This message was deleted`, null);
    for (let attachment of original.attachments) {
      await attachment.deleteFile().catch(() => {});
    }
    original.attachments.clear();
    original.attachmentRefs = {};
    original.reactions.clear();
    await this.saveMessage(original);
  }

  async applyReaction(payload: Extract<ChatPayload, { kind: "reaction" }>, from: string, fromMe: boolean): Promise<void> {
    let message = await this.findMessageForUpdate(payload.target);
    if (!message || message.deletedForAll) {
      return;
    }
    if (fromMe) {
      // Реакция с нашего другого устройства: так же, как поставили бы её здесь
      await message.setMyReactionLocally(payload.emoji);
      return;
    }
    let person = this.account.getPersonUID(from);
    let existing = [...message.reactions.entries()]
      .find(([key]) => key instanceof ChatPersonUID && key.chatID == person.chatID)?.[0];
    if (existing) {
      message.reactions.delete(existing);
    }
    if (payload.emoji) {
      message.reactions.set(person, payload.emoji);
    }
    await this.saveMessage(message);
  }

  /** Имена тех, кто сейчас печатает */
  get typingNames(): string[] {
    return this.typing.map(email => this.account.getPersonUID(email).name || email);
  }

  /** Собеседник набирает сообщение: подсказка гаснет сама через несколько секунд */
  applyTyping(from: string, fromMe: boolean): void {
    if (fromMe) {
      return;
    }
    this.typingUntil.set(from, Date.now() + TYPING_SHOW_MS);
    this.refreshTyping();
  }

  protected stopTyping(from: string): void {
    if (this.typingUntil.delete(from)) {
      this.refreshTyping();
    }
  }

  protected refreshTyping(): void {
    let now = Date.now();
    for (let [email, until] of this.typingUntil) {
      if (until <= now) {
        this.typingUntil.delete(email);
      }
    }
    this.typing = [...this.typingUntil.keys()];
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.typingUntil.size) {
      let next = Math.min(...this.typingUntil.values()) - now;
      this.typingTimer = setTimeout(() => this.refreshTyping(), Math.max(50, next));
    }
  }

  async addIncoming(payload: Extract<ChatPayload, { kind: "message" }>, from: string, fromMe: boolean, sentAt: Date): Promise<void> {
    this.stopTyping(from);
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
      msg.text = payload.links?.length ? withoutLinkFallback(payload.text, payload.links) : payload.text;
    }
    msg.links = payload.links ?? [];
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

  /** Отметки о прочтении: от собеседника — для наших сообщений, от наших устройств — для входящих.
   * В группе наше сообщение «прочитано», когда его прочитали все участники.
   * @param from Кто прочитал. Нужен для групп. */
  markSeen(ids: string[], fromMe: boolean, from?: string): void {
    let readChanged = false;
    for (let msg of this.messages.contents) {
      if (!(msg instanceof JackdawChatMessage) || !ids.includes(msg.id)) continue;
      if (fromMe && !msg.outgoing) {
        readChanged ||= !msg.isRead;
        msg.isRead = true;
      } else if (!fromMe && msg.outgoing && !this.isGroup) {
        msg.deliveryStatus = DeliveryStatus.Seen;
      } else if (!fromMe && msg.outgoing && from && !msg.readBy.includes(from)) {
        msg.readBy = [...msg.readBy, from];
        if (this.recipients().every(email => msg.readBy.includes(email))) {
          msg.deliveryStatus = DeliveryStatus.Seen;
        }
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

  /** Администратор меняет название и состав группы и рассылает их участникам,
   * в том числе убранным: так они узнают, что больше не в группе.
   * Новые участники без чата Jackdaw не добавляются: сообщения до них не дошли бы.
   * @returns Адреса, которые не добавлены, потому что не пользуются чатом Jackdaw */
  async updateGroup(name: string, emails: string[]): Promise<string[]> {
    if (!this.isGroup || !this.isAdmin) {
      throw new UserError(gt`Only the group admin can change the group.`);
    }
    this.account.requireOnline();
    let wanted = [...new Set(emails.map(normalizeCallEmail)
      .filter((email): email is string => !!email && !this.account.isOwnEmail(email)))];
    let added = wanted.filter(email => !this.memberEmails.includes(email));
    let withoutChat = await this.account.emailsWithoutChat(added);
    let members = wanted.filter(email => !withoutChat.includes(email));
    if (!members.length) {
      throw new UserError(gt`Add at least one member to the group.`);
    }
    if (members.length > MAX_GROUP_MEMBERS) {
      throw new UserError(gt`A group can have at most ${MAX_GROUP_MEMBERS} members.`);
    }
    let removed = this.recipients().filter(email => !members.includes(email));
    let admin = (this.senderEmail() ?? this.admin)!;
    await this.applyGroupInfo({
      ...this.roomRef() as Extract<ChatRoomRef, { type: "group" }>,
      name: name.trim() || gt`Group`,
      admin,
      members: [admin, ...members],
    });
    await this.announceGroup(removed);
    return withoutChat;
  }

  /** Выходим из группы. История остаётся у нас, писать в группу больше нельзя.
   * Администратор передаёт группу следующему участнику — это понимают и старые версии.
   * Остальные участники сообщают о выходе всем, и все убирают их из состава у себя. */
  async leaveGroup(): Promise<void> {
    if (!this.isGroup || !this.isMember) {
      return;
    }
    let others = this.recipients();
    let me = this.senderEmail();
    let ref = this.roomRef() as Extract<ChatRoomRef, { type: "group" }>;
    let remaining = ref.members.filter(email => !this.account.isOwnEmail(email));
    if (others.length) {
      let payload: ChatPayload = this.isAdmin
        ? { v: CHAT_PAYLOAD_VERSION, kind: "group", id: crypto.randomUUID(), room: { ...ref, admin: remaining[0], members: remaining } }
        : { v: CHAT_PAYLOAD_VERSION, kind: "group", id: crypto.randomUUID(), room: ref, leave: true };
      await this.account.sendPayload(others, payload, false, me);
    }
    await this.applyGroupInfo({ ...ref, admin: this.isAdmin && remaining.length ? remaining[0] : ref.admin, members: remaining });
  }

  /** Участник сообщил, что вышел. Принимается только от него самого (адрес отправителя
   * подтверждён сервером), поэтому чужой выход подделать нельзя. */
  async memberLeft(email: string): Promise<void> {
    if (!this.isGroup || email == this.admin || !this.memberEmails.includes(email)) {
      return;
    }
    await this.applyGroupInfo({
      ...this.roomRef() as Extract<ChatRoomRef, { type: "group" }>,
      members: this.memberEmails.filter(member => member != email),
    });
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
