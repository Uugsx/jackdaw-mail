import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { Attachment } from "../../Abstract/Attachment";
import type { JackdawChatRoom } from "./JackdawChatRoom";
import { parseAttachment, type ChatAttachmentRef } from "./JackdawChatProtocol";
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

  /** Ответы и пересылка в чате Jackdaw пока не поддерживаются */
  get canReply(): boolean {
    return false;
  }
  get canForward(): boolean {
    return false;
  }
  /** Удаление — только у себя: протокол пока не умеет отзывать отправленное */
  get deletesOnlyLocally(): boolean {
    return true;
  }

  /** Прочитали входящее — сообщаем собеседнику (в личном чате) и своим устройствам */
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
    return { ...super.toExtraJSON(), deliveryStatus: this.deliveryStatus, isRead: this.isRead, attachmentRefs: this.attachmentRefs };
  }

  fromExtraJSON(json: any): void {
    super.fromExtraJSON(json);
    if (DELIVERY_STATUSES.includes(json?.deliveryStatus)) {
      this.deliveryStatus = json.deliveryStatus;
    }
    this.isRead = sanitize.boolean(json?.isRead, this.outgoing);
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
