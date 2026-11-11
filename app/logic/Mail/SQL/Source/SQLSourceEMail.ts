import type { MailContentStorage } from "../../MailAccount";
import type { EMail } from "../../EMail";
import type { Attachment } from "../../../Abstract/Attachment";
import { getDatabase } from "./SQLSourceDatabase";
import { SQLEMail } from "../SQLEMail";
import { assert } from "../../../util/util";
import sql from "../../../../../lib/rs-sqlite";
import { mimeMessageID, normalizeMessageID } from "./mimeMessageID";

// Разбор Message-ID — в отдельном файле без зависимостей приложения:
// его использует и скрипт проверки копии базы (scripts/db-integrity-check.ts)
export { mimeMessageID };

/**
 * Исходник принадлежит письму. Строки `emailMIME` ищутся по номеру строки
 * письма, а номера переиспользуются, и исходник удалённого письма оставался
 * под номером нового. Чужим считаем исходник, только если и у письма, и в
 * исходнике есть Message-ID и они разные: без заголовка сравнить нечем.
 */
export function mimeBelongsToEMail(mime: Uint8Array | string | null | undefined, email: EMail): boolean {
  let own = normalizeMessageID(email.id);
  let inMIME = mimeMessageID(mime);
  return !own || !inMIME || own == inMIME;
}

/** Stores the RFC822 MIME source of the email,
 * for backup purposes, and for features like
 * "View source", Forward/Redirect etc. */
export class SQLSourceEMail implements MailContentStorage {
  /**
   * Save only fully downloaded emails
   */
  async save(email: EMail) {
    assert(email.mime, "Have no email source that I could save");
    if (!email.dbID) {
      await SQLEMail.save(email);
    }
    await (await getDatabase()).run(sql`
      INSERT OR REPLACE INTO emailMIME (
        emailID, messageID, mime
      ) VALUES (
        ${email.dbID}, ${email.messageID}, ${email.mime}
      )`);
  }

  async read(email: EMail): Promise<void> {
    assert(email.dbID, "Have no email ID");
    let row = await (await getDatabase()).get(sql`
      SELECT
        mime
      FROM emailMIME
      WHERE emailID = ${email.dbID}
      `) as any;
    if (!row) {
      return;
    }
    if (!mimeBelongsToEMail(row.mime, email)) {
      // Исходник удалённого письма, чей номер строки достался этому письму:
      // его текст и вложения показались бы здесь. Убираем, письмо загрузится с сервера.
      await (await getDatabase()).run(sql`
        DELETE FROM emailMIME
        WHERE emailID = ${email.dbID}
        `);
      return;
    }
    email.mime = row.mime;
  }

  async deleteIt(email: EMail) {
    if (!email.dbID) {
      return;
    }
    assert(email.dbID, "Need Email DB ID to delete");
    await (await getDatabase()).run(sql`
      DELETE FROM emailMIME
      WHERE emailID = ${email.dbID}
      `);
  }

  supportsAttachments = true;
  async readAttachment(attachment: Attachment): Promise<boolean> {
    let email = attachment.message as EMail;
    if (!email.mime) {
      await this.read(email);
    }
    await email.parseMIME();
    return true;
  }
  async saveAttachment(attachment: Attachment): Promise<void> {
    await this.save(attachment.message as EMail);
  }
  async deleteAttachment(attachment: Attachment): Promise<void> {
  }
}
