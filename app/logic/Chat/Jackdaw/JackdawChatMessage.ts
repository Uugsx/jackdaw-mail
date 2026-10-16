import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import type { JackdawChatRoom } from "./JackdawChatRoom";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

const DELIVERY_STATUSES = Object.values(DeliveryStatus) as string[];

export class JackdawChatMessage extends ChatMessage {
  declare to: JackdawChatRoom;

  /** Прочитали входящее — сообщаем собеседнику (в личном чате) и своим устройствам */
  async markRead(read = true): Promise<void> {
    let wasRead = this.isRead;
    await super.markRead(read);
    if (read && !wasRead && !this.outgoing) {
      await this.save();
      this.to.sendReadReceipt([this.id]).catch(this.to.account.errorCallback);
    }
  }

  toExtraJSON(): any {
    // Статус доставки базовый класс не сохраняет, а для чата он виден пользователю.
    return { ...super.toExtraJSON(), deliveryStatus: this.deliveryStatus, isRead: this.isRead };
  }

  fromExtraJSON(json: any): void {
    super.fromExtraJSON(json);
    if (DELIVERY_STATUSES.includes(json?.deliveryStatus)) {
      this.deliveryStatus = json.deliveryStatus;
    }
    this.isRead = sanitize.boolean(json?.isRead, this.outgoing);
  }
}
