import { ChatRoom } from "../ChatRoom";
import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Group } from "../../Abstract/Group";
import { ContentDisposition } from "../../Abstract/Attachment";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import { JackdawChatMessage } from "./JackdawChatMessage";
import type { JackdawChatAccount } from "./JackdawChatAccount";
import { decryptFile, encryptFile } from "./JackdawChatCrypto";
import { CHAT_PAYLOAD_VERSION, MAX_ATTACHMENTS, MAX_TEXT_LENGTH, type ChatAttachmentRef, type ChatPayload, type ChatRoomRef } from "./JackdawChatProtocol";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Совпадает с MAX_BLOB_BYTES на сервере */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 - 1024;

/** Личный чат (`direct:<email>`) или группа (`group:<uuid>`) Jackdaw. */
export class JackdawChatRoom extends ChatRoom {
  declare account: JackdawChatAccount;
  readonly isGroup: boolean;
  /** Группа: адрес администратора. Только он меняет состав и название. */
  admin: string | null = null;
  /** Группа: все участники, включая нас */
  memberEmails: string[] = [];
  protected historyLoaded = false;

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
      return;
    }
    this.historyLoaded = true;
    await SQLChatMessage.readAll(this);
    this.lastMessage = this.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
      .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
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
    for (let attachment of message.attachments) {
      if (!attachment.content) {
        throw new UserError(gt`Attachment is empty`);
      }
      if (attachment.content.size > MAX_ATTACHMENT_BYTES) {
        throw new UserError(gt`The file ${attachment.filename} is larger than 25 MB.`);
      }
    }
    message.id ??= crypto.randomUUID();
    message.from ??= this.account.getOwnContact();
    message.outgoing = true;
    message.sent ??= new Date();
    message.received = new Date();
    message.deliveryStatus = DeliveryStatus.Sending;
    if (!this.messages.contents.includes(message)) {
      this.messages.add(message);
    }
    try {
      let attachments: ChatAttachmentRef[] = [];
      for (let attachment of message.attachments) {
        let encrypted = encryptFile(new Uint8Array(await attachment.content.arrayBuffer()));
        let blobId = await this.account.uploadBlob(encrypted.data);
        attachments.push({
          blobId,
          key: encrypted.key,
          sha256: encrypted.sha256,
          name: attachment.filename,
          mime: attachment.mimeType || "application/octet-stream",
          size: attachment.content.size,
        });
      }
      let sent = await this.account.sendPayload(this.recipients(), {
        v: CHAT_PAYLOAD_VERSION,
        kind: "message",
        id: message.id,
        room: this.roomRef(),
        text: message.text,
        html: message.hasHTML ? message.rawHTMLDangerous : null,
        inReplyTo: message.inReplyTo ?? null,
        attachments,
      });
      message.deliveryStatus = sent.delivered > 0 ? DeliveryStatus.User : DeliveryStatus.Server;
    } catch (ex) {
      message.deliveryStatus = DeliveryStatus.Unknown;
      await this.saveMessage(message);
      throw ex;
    }
    this.lastMessage = message;
    await this.saveMessage(message);
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
    for (let ref of payload.attachments) {
      this.addAttachment(msg, ref);
    }
    this.messages.add(msg);
    if (!this.lastMessage || msg.sent > this.lastMessage.sent) {
      this.lastMessage = msg;
    }
    await this.saveMessage(msg);
    if (!fromMe) {
      this.account.incomingMessageCallback(this, msg);
    }
  }

  protected addAttachment(msg: JackdawChatMessage, ref: ChatAttachmentRef): void {
    let attachment = msg.newAttachment();
    attachment.filename = sanitize.filename(ref.name, gt`File`);
    attachment.mimeType = ref.mime;
    attachment.size = ref.size;
    attachment.disposition = ref.mime.startsWith("image/") ? ContentDisposition.inline : ContentDisposition.attachment;
    msg.attachments.add(attachment);
    this.account.downloadBlob(ref.blobId)
      .then(async data => {
        let content = decryptFile(data, ref.key, ref.sha256);
        attachment.content = new File([content as Uint8Array<ArrayBuffer>], attachment.filename, { type: attachment.mimeType });
        attachment.size = content.length;
        await attachment.save();
      })
      .catch(this.account.errorCallback);
  }

  /** Отметки о прочтении: от собеседника — для наших сообщений, от наших устройств — для входящих */
  markSeen(ids: string[], fromMe: boolean): void {
    for (let msg of this.messages.contents) {
      if (!(msg instanceof JackdawChatMessage) || !ids.includes(msg.id)) continue;
      if (fromMe && !msg.outgoing) {
        msg.isRead = true;
      } else if (!fromMe && msg.outgoing) {
        msg.deliveryStatus = DeliveryStatus.Seen;
      } else {
        continue;
      }
      msg.save().catch(this.account.errorCallback);
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
    return this.isGroup ? { groupAdmin: this.admin, groupMembers: this.memberEmails } : {};
  }

  fromExtraJSON(json: any): void {
    if (!this.isGroup) return;
    this.admin = sanitize.nonemptystring(json?.groupAdmin, null);
    this.memberEmails = Array.isArray(json?.groupMembers) ? json.groupMembers.filter((e: unknown) => typeof e == "string") : [];
    this.isAdmin = !!this.admin && this.account.isOwnEmail(this.admin);
  }
}
