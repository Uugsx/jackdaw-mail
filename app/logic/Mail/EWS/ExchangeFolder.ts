import { Folder, SpecialFolder } from "../Folder";
import type { EMail } from "../EMail";
import { ExchangePermission } from "./ExchangePermission";
import { AbstractFunction } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import type { Collection } from "svelte-collections";

export class ExchangeFolder extends Folder {
  /** True for folders stored in the separate Exchange archive mailbox. */
  isArchiveMailbox = false;
  /** Synthetic folder used to keep the archive hierarchy separate in the UI. */
  isArchiveMailboxRoot = false;

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.isArchiveMailbox = sanitize.boolean(json?.archiveMailbox, false);
    this.isArchiveMailboxRoot = sanitize.boolean(json?.archiveMailboxRoot, false);
    if (this.isArchiveMailbox) {
      // Прежние версии сохраняли папкам архива тип по имени («Входящие» →
      // Inbox): до обновления иерархии с сервера они вели себя как папки
      // самого ящика. У папок сетевого архива особого типа нет.
      this.specialFolder = SpecialFolder.Normal;
    }
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    if (this.isArchiveMailbox) {
      json.archiveMailbox = true;
    }
    if (this.isArchiveMailboxRoot) {
      json.archiveMailboxRoot = true;
    }
    return json;
  }

  disableChangeSpecial(): string | false {
    return gt`You cannot change special folders on the Exchange server`;
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    throw new AbstractFunction();
  }

  /** Whether `emailAddress` may create items, e.g. save a sent copy, in this shared folder.
   * Reading the permissions is itself denied unless we own the folder, so treat that
   * as "not allowed", letting the caller save the copy in his own folder instead. */
  async mayCreateItems(emailAddress: string): Promise<boolean> {
    try {
      // this.getPermissions() can throw
      return ExchangePermission.mayCreateItems(await this.getPermissions(), emailAddress);
    } catch (ex) {
      return false;
    }
  }

  /** Удалить сообщения из локального кеша после переноса на сервере. */
  protected async removeMessagesAfterServerMove(messages: Collection<EMail>): Promise<void> {
    let sourceMessages = messages.contents.slice();
    if (!sourceMessages.length) {
      return;
    }
    if (!sourceMessages.every(message => message.folder === this)) {
      throw new Error("All messages must be from the same folder");
    }
    this.messages.removeAll(sourceMessages);
    this.countTotal = Math.max(0, this.countTotal - sourceMessages.length);
    this.countUnread = Math.max(0, this.countUnread - sourceMessages.filter(message => !message.isRead).length);
    for (let message of sourceMessages) {
      await message.deleteMessageLocally();
    }
  }
}
