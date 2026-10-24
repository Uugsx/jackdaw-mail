import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Attachment } from "../../Abstract/Attachment";
import type { JackdawChatRoom } from "./JackdawChatRoom";
import { parseAttachment, type ChatAttachmentRef, parseLink, type ChatLinkRef } from "./JackdawChatProtocol";
import { notifyChangedProperty } from "../../util/Observable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";

const DELIVERY_STATUSES = Object.values(DeliveryStatus) as string[];

/** Вложение чата Jackdaw: файл лежит на сервере зашифрованным, пока не скачан. */
export class JackdawChatAttachment extends Attachment {
  /** Файл скачивается с сервера */
  @notifyChangedProperty
  downloading = false;
  /** Скачать не удалось. Интерфейс показывает ошибку с кнопкой «Повторить». */
  @notifyChangedProperty
  downloadError: Error | null = null;
  /** Загрузка своего файла на сервер, 0…1. null — не загружается. */
  @notifyChangedProperty
  uploadProgress: number | null = null;

  /** Есть ли что скачивать: ссылка на файл на сервере известна, а самого файла у нас нет */
  get needsDownload(): boolean {
    let message = this.message as JackdawChatMessage;
    return !this.content && !this.filepathLocal && !!message?.attachmentRefs?.[this.filename];
  }

  async retryDownload(): Promise<void> {
    let message = this.message as JackdawChatMessage;
    await message.to.downloadAttachment(this);
  }
}

export class JackdawChatMessage extends ChatMessage {
  declare to: JackdawChatRoom;
  /** Имя файла вложения → где оно лежит на сервере и чем зашифровано.
   * Нужно, чтобы докачать файл после перезапуска и не загружать его повторно при повторной отправке. */
  attachmentRefs: Record<string, ChatAttachmentRef> = {};
  /** Группа: кто из участников прочитал наше сообщение */
  readBy: string[] = [];
  /** Ссылки на письма и события календаря */
  @notifyChangedProperty
  links: ChatLinkRef[] = [];
  /** Автор изменил текст после отправки */
  @notifyChangedProperty
  edited = false;
  /** Автор удалил сообщение у всех: остаётся только отметка */
  @notifyChangedProperty
  deletedForAll = false;

  get canReply(): boolean {
    return !this.deletedForAll;
  }
  /** Пересылки в чате Jackdaw пока нет */
  get canForward(): boolean {
    return false;
  }
  /** Править и удалять у всех можно только своё отправленное сообщение */
  get canEdit(): boolean {
    return this.outgoing && !this.deletedForAll && this.deliveryStatus != DeliveryStatus.Failed;
  }
  get canDeleteForOthers(): boolean {
    return this.canEdit;
  }
  /** Чужое сообщение удаляется только у нас: интерфейс так и подписывает кнопку и спрашивает */
  get deletesOnlyLocally(): boolean {
    return !this.outgoing;
  }
  override canReact = true;

  /** Базовый класс меняет только HTML: текст (превью в списке чатов) приводим в соответствие */
  override async deleteForOthers(): Promise<void> {
    await super.deleteForOthers();
    this.regenerateTextFromHTML();
    this.reactions.clear();
    await this.save();
  }

  protected override async sendRetractionToOthers(): Promise<void> {
    await this.to.sendDeleteForAll(this);
    this.deletedForAll = true;
  }

  override async setMyReactionOnServer(emoji: string | null): Promise<void> {
    await this.to.sendReaction(this, emoji);
  }

  /** Прочитали входящее — сообщаем собеседнику (в группе — участникам) и своим устройствам */
  async markRead(read = true): Promise<void> {
    let wasRead = this.isRead;
    await super.markRead(read);
    if (read != wasRead) {
      this.to.updateUnreadCount();
    }
    if (read && !wasRead && !this.outgoing) {
      await this.save();
      this.to.sendReadReceipt([this.id]).catch(this.to.account.errorCallback);
    }
  }

  newAttachment(): JackdawChatAttachment {
    let attachment = new JackdawChatAttachment();
    attachment.message = this;
    assert(this.room.account.storage.supportsAttachments, "Need ChatAccountStorage that supports attachments");
    attachment.storage = new ArrayColl([this.room.account.storage]);
    return attachment;
  }

  toExtraJSON(): any {
    // Статус доставки базовый класс не сохраняет, а для чата он виден пользователю.
    return { ...super.toExtraJSON(), deliveryStatus: this.deliveryStatus, isRead: this.isRead, attachmentRefs: this.attachmentRefs,
      ...(this.readBy.length ? { readBy: this.readBy } : {}),
      ...(this.links.length ? { links: this.links } : {}),
      ...(this.edited ? { edited: true } : {}),
      ...(this.deletedForAll ? { deletedForAll: true } : {}) };
  }

  fromExtraJSON(json: any): void {
    super.fromExtraJSON(json);
    if (DELIVERY_STATUSES.includes(json?.deliveryStatus)) {
      this.deliveryStatus = json.deliveryStatus;
    }
    this.isRead = sanitize.boolean(json?.isRead, this.outgoing);
    this.readBy = Array.isArray(json?.readBy) ? json.readBy.filter((e: unknown) => typeof e == "string") : [];
    this.edited = json?.edited === true;
    this.links = Array.isArray(json?.links) ? json.links.map(parseLink).filter(Boolean) as ChatLinkRef[] : [];
    this.deletedForAll = json?.deletedForAll === true;
    let refs = json?.attachmentRefs;
    this.attachmentRefs = {};
    if (refs && typeof refs == "object" && !Array.isArray(refs)) {
      for (let [filename, value] of Object.entries(refs)) {
        let ref = parseAttachment(value);
        if (ref) {
          this.attachmentRefs[filename] = ref;
        }
      }
    }
  }
}
