import type { EMail } from "../EMail";
import { computeEMailContact } from "../EMail";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { SpecialFolder, type Folder } from "../Folder";
import { Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { getTagByName, Tag } from "../../Abstract/Tag";
import { JSONEMail } from "../JSON/JSONEMail";
import { getDatabase } from "./SQLDatabase";
import { convertHTMLToText } from "../../util/convertHTML";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { Lock } from "../../util/flow/Lock";
import { assert, fileExtensionForMIMEType } from "../../util/util";
import { ArrayColl, Collection } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

/** Stay below SQLite's portable bound-parameter limit when loading large folders. */
const kReadMainPropertiesBatchSize = 500;

export class SQLEMail {
  /**
   * Save complete emails and metadata updates for already persisted emails.
   */
  static async save(email: EMail) {
    assert(!email.downloadComplete || !!email.dbID || !!email.rawText || !!email.rawHTMLDangerous, "An email without body is not complete");
    let lock = await email.storageLock.lock();
    try {
      if (!email.folder.dbID) {
        await email.folder.save();
      }
      if (!email.dbID) {
        let existing = email.pID != null
          ? await (await getDatabase()).get(sql`
          SELECT
            id
          FROM email
          WHERE
            pID = ${email.pID} AND
            folderID = ${email.folder.dbID}
          `) as any
          : await (await getDatabase()).get(sql`
          SELECT
            id
          FROM email
          WHERE
            messageID = ${email.id} AND
            pID = ${email.pID} AND
            folderID = ${email.folder.dbID}
          `) as any;
        if (existing?.id) {
          email.dbID = existing.id;
        }
      }
      if (!email.sent) {
        email.sent = new Date();
      }
      if (!email.received) {
        email.received = email.sent;
      }
      let contact = email.contact as PersonUID;
      // Index HTML-only bodies so global search can find them
      let plaintext = email.rawText
        ?? (email.rawHTMLDangerous ? convertHTMLToText(email.rawHTMLDangerous) : null);
      if (!email.dbID) {
        let insert = await (await getDatabase()).run(sql`
          INSERT INTO email (
            messageID, folderID, pID, parentMsgID,
            size, dateSent, dateReceived,
            outgoing, contactEmail, contactName,
            subject, plaintext, html
          ) VALUES (
            ${email.id}, ${email.folder.dbID}, ${email.pID}, ${email.inReplyTo},
            ${email.size}, ${email.sent.getTime() / 1000}, ${email.received.getTime() / 1000},
            ${email.outgoing ? 1 : 0}, ${contact?.emailAddress}, ${email.contact?.name},
            ${email.subject}, ${plaintext}, ${email.rawHTMLDangerous}
          )`);
        email.dbID = insert.lastInsertRowid;
      } else {
        // This might be an update with only metadata, so don't overwrite content
        await (await getDatabase()).run(sql`
          UPDATE email SET
            messageID = ${email.id},
            folderID = ${email.folder.dbID},
            pID = ${email.pID},
            parentMsgID = ${email.inReplyTo},
            size = ${email.size},
            dateSent = ${email.sent.getTime() / 1000},
            dateReceived = ${email.received.getTime() / 1000},
            outgoing = ${email.outgoing ? 1 : 0},
            contactEmail = ${contact?.emailAddress},
            contactName = ${email.contact?.name},
            subject = ${email.subject},
            plaintext = COALESCE(${plaintext}, plaintext),
            html = COALESCE(${email.rawHTMLDangerous}, html)
          WHERE id = ${email.dbID}
        `);
      }
      await this.saveWritableProps(email, false);
      await this.saveRecipients(email);
      await this.saveAttachments(email);
    } finally {
      lock.release();
    }
  }

  static async saveWritableProps(email: EMail, doLock = true) {
    assert(email.dbID, "Need Email DB ID to save props");
    let lock = doLock ? await email.storageLock.lock() : null;
    try {
      let json = {} as any;
      JSONEMail.saveExtraData(email, json);
      let jsonStr = Object.keys(json).length
        ? JSON.stringify(json, null, 2)
        : null;

      // This might be an update with only metadata, so don't overwrite content
      await (await getDatabase()).run(sql`
        UPDATE email SET
          isRead = ${email.isRead ? 1 : 0},
          isStarred = ${email.isStarred ? 1 : 0},
          isReplied = ${email.isReplied ? 1 : 0},
          isForwarded = ${email.isForwarded ? 1 : 0},
          isImportant = ${email.isImportant ? 1 : 0},
          isSpam = ${email.isSpam ? 1 : 0},
          isDraft = ${email.isDraft ? 1 : 0},
          threadID = COALESCE(${email.threadID}, threadID),
          downloadComplete = MAX(downloadComplete, ${email.downloadComplete ? 1 : 0}),
          json = COALESCE(${jsonStr}, json)
        WHERE id = ${email.dbID}
        `);

      await this.saveTags(email, false);
    } finally {
      lock?.release();
    }
  }

  protected static async saveRecipients(email: EMail) {
    assert(email.dbID, "Need Email DB ID");
    // See comment in `saveAttachments()` below
    await (await getDatabase()).run(sql`
      DELETE FROM emailPersonRel
      WHERE emailID = ${email.dbID}
      `);

    await this.saveRecipient(email, email.from, 1);
    await this.saveRecipientsOfType(email, email.to, 2);
    await this.saveRecipientsOfType(email, email.cc, 3);
    await this.saveRecipientsOfType(email, email.bcc, 4);
    if (email.replyTo?.emailAddress) {
      await this.saveRecipient(email, email.replyTo, 5);
    }
  }

  protected static async saveRecipientsOfType(email: EMail, recipients: ArrayColl<PersonUID>, recipientsType: number) {
    for (let recipient of recipients) {
      await this.saveRecipient(email, recipient, recipientsType);
    }
  }

  protected static async saveRecipient(email: EMail, puid: PersonUID, recipientType: number) {
    let exists = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM emailPerson
        WHERE
          emailAddress = ${puid.emailAddress} AND
          name = ${puid.name}
      `) as any;
    let personID = exists?.id;
    if (!personID) {
      let insert = await (await getDatabase()).run(sql`
      INSERT OR IGNORE INTO emailPerson (
        name, emailAddress, personID
      ) VALUES (
        ${puid.name}, ${puid.emailAddress}, ${puid.person?.dbID}
      )`);
      personID = insert.lastInsertRowid;
    }
    await (await getDatabase()).run(sql`
      INSERT INTO emailPersonRel (
        emailID, emailPersonID, recipientType
      ) VALUES (
        ${email.dbID}, ${personID}, ${recipientType}
      )`);
  }

  protected static async saveAttachments(email: EMail) {
    assert(email.dbID, "Need Email DB ID");
    /** Problem: We might be saving the same email multiple times, because:
     * a) We save only the msg list of the folder, so we have only partial emails,
     *     and we don't know the attachments yet.
     * b) the full email might be saved multiple times.
     *
     * Solution:
     * For a partial email:
     * - leave the saved records alone
     * Otherwise:
     * - update the existing records, keeping `filepathLocal`
     * - delete only records for attachments that no longer exist,
     *   e.g. after decryption replaced them. */
    if (email.attachments.isEmpty) {
      return;
    }
    let db = await getDatabase();
    let existingRows = await db.all(sql`
      SELECT
        id, filename, contentID
      FROM emailAttachment
      WHERE emailID = ${email.dbID}
      `) as any[];
    for (let attachment of email.attachments) {
      let row = existingRows.find(row => row.filename == attachment.filename);
      if (row) {
        existingRows = existingRows.filter(r => r != row);
        await this.updateAttachment(attachment, row.id);
      } else {
        await this.saveAttachment(email, attachment);
      }
    }
    for (let row of existingRows) {
      await db.run(sql`
        DELETE FROM emailAttachment
        WHERE id = ${row.id}
        `);
    }
  }

  protected static async saveAttachment(email: EMail, a: Attachment) {
    assert(email.dbID, "Need to save email before attachment");
    let filepath = a.filepathLocal?.replace(JSONEMail.filesDir + "/", "");
    await (await getDatabase()).run(sql`
      INSERT OR IGNORE INTO emailAttachment (
        emailID, filename, filepathLocal, mimeType, size, contentID, disposition, related
      ) VALUES (
        ${email.dbID}, ${a.filename}, ${filepath}, ${a.mimeType}, ${a.size},
        ${a.contentID}, ${a.disposition}, ${a.related ? 1 : 0}
      )`);
  }

  protected static async updateAttachment(a: Attachment, rowID: number) {
    let filepath = a.filepathLocal?.replace(JSONEMail.filesDir + "/", "");
    await (await getDatabase()).run(sql`
      UPDATE emailAttachment SET
        contentID = ${a.contentID},
        mimeType = ${a.mimeType},
        size = ${a.size},
        disposition = ${a.disposition},
        related = ${a.related ? 1 : 0},
        filepathLocal = COALESCE(${filepath}, filepathLocal)
      WHERE id = ${rowID}
      `);
  }

  /** After downloading and saving the attachment file locally, or moving it on disk,
   * save its local disk location. */
  static async saveAttachmentFilename(email: EMail, a: Attachment) {
    assert(email.dbID, "Need to save email before attachment");
    let filepath = a.filepathLocal?.replace(JSONEMail.filesDir + "/", "");
    await (await getDatabase()).run(sql`
      UPDATE emailAttachment SET
        filepathLocal = ${filepath}
      WHERE emailID = ${email.dbID}
        AND filename = ${a.filename}
      `);
  }

  static async saveTags(email: EMail, doLock = true) {
    assert(email.dbID, "Need Email DB ID");
    let lock = doLock ? await email.storageLock.lock() : null;
    try {
      await (await getDatabase()).run(sql`
        DELETE FROM emailTag
        WHERE emailID = ${email.dbID}
        `);

      for (let tag of email.tags) {
        await this.saveTag(email, tag);
      }
  } finally {
    lock?.release();
  }
  }

  protected static async saveTag(email: EMail, tag: Tag) {
    assert(email.dbID, "Need to save email before tags");
    await (await getDatabase()).run(sql`
      INSERT OR IGNORE INTO emailTag (
        emailID, tagName
      ) VALUES (
        ${email.dbID}, ${tag.name}
      )`);
  }

  protected static readonly transactionLock = new Lock();

  static async saveMultiple(emails: Collection<EMail>) {
    let lock = await SQLEMail.transactionLock.lock();
    try {
      await (await getDatabase()).run(sql`BEGIN TRANSACTION`);
      for (let email of emails) {
        if (!email.subject) {
          continue;
        }
        await this.save(email);
      }
      await (await getDatabase()).run(sql`END TRANSACTION`);
    } catch (ex) {
      await (await getDatabase()).run(sql`ROLLBACK TRANSACTION`);
      throw ex;
    } finally {
      lock.release();
    }
  }

  static async deleteIt(email: EMail) {
    if (!email.dbID) {
      return;
    }
    let lock = await email.storageLock.lock();
    try {
      let dbID = email.dbID;
      email.dbID = null;
      await (await getDatabase()).run(sql`
        DELETE FROM email
        WHERE id = ${dbID}
        `);
    } finally {
      lock.release();
    }
  }

  static async read(dbID: number, email: EMail, row?: any, recipientRows?: any[], attachmentRows?: any[], tagRows?: any[]): Promise<EMail> {
    if (!row) {
      // <copied to="readAll()" />
      row = await (await getDatabase()).get(sql`
      SELECT
        pID, messageID, parentMsgID,
        size, dateSent, dateReceived,
        outgoing,
        contactEmail, contactName,
        subject, plaintext, html,
        threadID, downloadComplete, json,
        isRead, isStarred, isReplied, isForwarded, isImportant, isDraft, isSpam
      FROM email
      WHERE id = ${dbID}
      `) as any;
      assert(row, `EMail DB ID ${dbID} not found`);
    }
    email.dbID = sanitize.integer(dbID);
    email.pID = typeof(row.pID) == "number"
      ? sanitize.integer(row.pID, null)
      : sanitize.string(row.pID, null);
    email.id = sanitize.nonemptystring(row.messageID, "");
    email.inReplyTo = sanitize.string(row.parentMsgID, null);
    email.size = sanitize.integer(row.size, null);
    email.received = sanitize.date(row.dateReceived * 1000, new Date());
    email.sent = sanitize.date(row.dateSent * 1000, email.received);
    email.outgoing = sanitize.boolean(row.outgoing, false);
    email.subject = sanitize.string(row.subject, null);
    if (row.plaintext != null || row.html != null) {
      email.text = sanitize.string(row.plaintext, null);
      let html = sanitize.string(row.html, null);
      if (html) {
        email.html = html;
      }
    }
    await this.readWritableProps(email, row);
    await this.readRecipients(email, recipientRows);
    this.applyStoredIncomingSender(email, row);
    await this.readAttachments(email, attachmentRows);
    await this.readTags(email, tagRows);
    email.contact = computeEMailContact(email);
    return email;
  }

  /** Read only the most important properties for the msg list view. */
  static async readMainProperties(
    dbID: number,
    email: EMail,
    row: any,
    tagRows?: any[],
  ): Promise<void> {
    email.dbID = sanitize.integer(dbID);
    email.pID = typeof (row.pID) == "number"
      ? sanitize.integer(row.pID, null)
      : sanitize.string(row.pID, null);
    email.id = sanitize.nonemptystring(row.messageID, "");
    email.inReplyTo = sanitize.string(row.parentMsgID, null);
    email.size = sanitize.integer(row.size, null);
    email.sent = sanitize.date(row.dateSent * 1000, new Date());
    email.received = sanitize.date(row.dateReceived * 1000, new Date());
    email.outgoing = sanitize.boolean(row.outgoing, false);
    email.subject = sanitize.string(row.subject, null);

    email.isRead = sanitize.boolean(row.isRead, false);
    email.isStarred = sanitize.boolean(row.isStarred, false);
    email.isReplied = sanitize.boolean(row.isReplied, false);
    email.isForwarded = sanitize.boolean(row.isForwarded, false);
    email.isImportant = sanitize.boolean(row.isImportant, false);
    email.isSpam = sanitize.boolean(row.isSpam, false);
    email.threadID = sanitize.string(row.threadID ?? row.parentMsgID, null);
    email.downloadComplete = sanitize.boolean(row.downloadComplete, false);
    JSONEMail.readLastVerbAt(email, sanitize.json(row.json, {}));

    if (row.contactName || row.contactEmail) {
      email.contact = findOrCreatePersonUID(
        sanitize.emailAddress(row.contactEmail, kDummyPerson.emailAddress),
        sanitize.nonemptylabel(row.contactName, " "));
    } else {
      let contact = computeEMailContact(email);
      if (contact?.emailAddress && contact.emailAddress != kDummyPerson.emailAddress) {
        email.contact = contact;
      }
    }
    this.applyStoredIncomingSender(email, row);
    await this.readTags(email, tagRows);
  }

  /**
   * В старых или частично синхронизированных письмах может отсутствовать
   * связь с `From`, хотя в `email` сохранён входящий корреспондент.
   * Используем эти данные только как запасной вариант и не заменяем
   * полноценную связь с получателем.
   */
  private static applyStoredIncomingSender(email: EMail, row: any): void {
    if (email.outgoing || email.from.emailAddress != kDummyPerson.emailAddress) {
      return;
    }
    const emailAddress = sanitize.emailAddress(row.contactEmail, null);
    if (!emailAddress || emailAddress == kDummyPerson.emailAddress) {
      return;
    }
    email.from = findOrCreatePersonUID(
      emailAddress,
      sanitize.nonemptylabel(row.contactName, null),
    );
  }

  static async readWritableProps(email: EMail, row?: any) {
    if (!row) {
      row = await (await getDatabase()).get(sql`
      SELECT
        isRead, isStarred, isReplied, isForwarded, isImportant, isDraft, isSpam, threadID, downloadComplete, json
      FROM email
      WHERE id = ${email.dbID}
      `) as any;
    }
    if (!row) {
      return;
    }
    email.isRead = sanitize.boolean(row.isRead, false);
    email.isStarred = sanitize.boolean(row.isStarred, false);
    email.isReplied = sanitize.boolean(row.isReplied, false);
    email.isForwarded = sanitize.boolean(row.isForwarded, false);
    email.isImportant = sanitize.boolean(row.isImportant, false);
    email.isDraft = sanitize.boolean(row.isDraft, false);
    email.isSpam = sanitize.boolean(row.isSpam, false);
    email.threadID = sanitize.string(row.threadID ?? row.parentMsgID, null);
    email.downloadComplete = sanitize.boolean(row.downloadComplete, false);
    let json = sanitize.json(row.json, {});
    JSONEMail.readLastVerbAt(email, json);
    JSONEMail.readExtraData(email, json);
    await this.readTags(email);
  }

  protected static async readRecipients(email: EMail, recipientRows?: any[]) {
    if (!recipientRows) {
      // <copied to="readAll()" />
      recipientRows = await (await getDatabase()).all(sql`
        SELECT
          name, emailAddress, recipientType
        FROM emailPersonRel
          LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id)
        WHERE emailID = ${email.dbID}
      `) as any;
    }
    email.to.clear();
    email.cc.clear();
    email.bcc.clear();
    email.replyTo = null;
    let sender: PersonUID | null = null;
    for (let row of recipientRows) {
      try {
        let uid = findOrCreatePersonUID(
          sanitize.emailAddress(row.emailAddress, null),
          sanitize.nonemptylabel(row.name, null));
        if (row.recipientType == 1) {
          email.from = uid;
          continue;
        } else if (row.recipientType == 5) {
          email.replyTo = uid;
          continue;
        } else if (row.recipientType == 6) {
          // Совместимость со старыми хранилищами, где Sender
          // сохранялся отдельно от RFC-получателя From.
          sender ??= uid;
          continue;
        }
        if (row.recipientType == 2) {
          email.to.add(uid);
        } else if (row.recipientType == 3) {
          email.cc.add(uid);
        } else if (row.recipientType == 4) {
          email.bcc.add(uid);
        }
      } catch (ex) {
        email.folder.account.errorCallback(ex);
      }
    }
    if (email.from.emailAddress == kDummyPerson.emailAddress && sender) {
      email.from = sender;
    }
  }

  protected static async readAttachments(email: EMail, attachmentRows?: any[]) {
    if (!attachmentRows) {
      // <copied to="readAll()" />
      attachmentRows = await (await getDatabase()).all(sql`
        SELECT
          filename, filepathLocal, mimeType, size, contentID, disposition, related
        FROM emailAttachment
        WHERE emailID = ${email.dbID}
      `) as any;
    }
    let fallbackID = 0;
    email.attachments.clear();
    for (let row of attachmentRows) {
      try {
        let a = email.newAttachment();
        a.mimeType = sanitize.nonemptystring(row.mimeType, "application/octet-stream");
        a.contentID = sanitize.nonemptystring(row.contentID, "" + ++fallbackID);
        a.filename = sanitize.nonemptystring(row.filename, "attachment-" + fallbackID + "." + fileExtensionForMIMEType(a.mimeType));
        let filepath = sanitize.string(row.filepathLocal, null);
        a.filepathLocal = filepath ? JSONEMail.filesDir + "/" + filepath : null;
        a.size = sanitize.integer(row.size, -1);
        a.disposition = sanitize.translate(row.disposition, {
          attachment: ContentDisposition.attachment,
          inline: ContentDisposition.inline,
        }, ContentDisposition.unknown);
        a.related = sanitize.boolean(row.related, false);
        email.attachments.add(a);
      } catch (ex) {
        email.folder.account.errorCallback(ex);
      }
    }
  }

  protected static async readTags(email: EMail, tagRows?: any[]) {
    if (!tagRows) {
      // <copied to="readAll()" />
      tagRows = await (await getDatabase()).all(sql`
        SELECT
          tagName
        FROM emailTag
        WHERE emailID = ${email.dbID}
      `) as any;
    }
    email.tags.clear();
    for (let row of tagRows) {
      try {
        let name = sanitize.nonemptystring(row.tagName);
        let tag = getTagByName(name);
        email.tags.add(tag);
      } catch (ex) {
        email.folder.account.errorCallback(ex);
      }
    }
  }

  static async readBody(email: EMail): Promise<void> {
    assert(email.dbID, "Need to read email metadata from database first");
    let row = await (await getDatabase()).get(sql`
      SELECT
        plaintext, html
      FROM email
      WHERE id = ${email.dbID}
    `) as any;
    assert(row, "Email DB ID " + email.dbID + " not found in DB");
    let text = sanitize.string(row.plaintext, null)
    if (text) {
      email.text = text;
    }
    let html = sanitize.string(row.html, null);
    if (html) {
      email.html = html;
    }
  }

  /**
   * @param limit Max number of results (optional, default all)
   * @param startWith Do not return the first `startWith` results (optional, default all)
   *
   * Adds the new emails to the folder, and updates existing emails.
   */
  static async readAll(folder: Folder, limit?: number, startWith?: number): Promise<void> {
    if (startWith && !limit) {
      limit = -1;
    }
    await JSONEMail.init();
    // <copied from="read()" />
    let emailRows = await (await getDatabase()).all(sql`
      SELECT
        id, pID, messageID, parentMsgID,
        size, dateSent, dateReceived,
        outgoing,
        contactEmail, contactName,
        subject,
        threadID, downloadComplete, json,
        isRead, isStarred, isReplied, isForwarded, isImportant, isDraft, isSpam
      FROM email
      WHERE folderID = ${folder.dbID}
      ORDER BY dateSent DESC
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      $${startWith ? sql` OFFSET ${startWith} ` : sql``}
    `) as any;
    //console.time("sql read emails");
    // plaintext, html, -- 10x slower, so do this later or on demand
    //console.timeEnd("sql read emails");
    // <copied from="readRecipients()" />
    let folderRecipientRows = await (await getDatabase()).all(sql`
      SELECT
        emailID, name, emailAddress, recipientType
      FROM emailPersonRel
        LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id)
        LEFT JOIN email ON (emailID = email.id)
      WHERE folderID = ${folder.dbID}
    `) as any;
    // <copied from="readAttachments()" />
    let folderAttachmentRows = await (await getDatabase()).all(sql`
      SELECT
        emailID, filename, filepathLocal, mimeType, emailAttachment.size as size, contentID, disposition, related
      FROM emailAttachment
      LEFT JOIN email ON (emailID = email.id)
      WHERE folderID = ${folder.dbID}
    `) as any;
    let folderTagRows = await (await getDatabase()).all(sql`
        SELECT
          emailID, tagName
        FROM emailTag
        LEFT JOIN email ON (emailID = email.id)
        WHERE folderID = ${folder.dbID}
      `) as any;
    let newEmails = new ArrayColl<EMail>();
    let seenPIDs = new Set<string | number>();
    for (let email of folder.messages) {
      if (email.pID != null) {
        seenPIDs.add(email.pID);
      }
    }
    for (let row of emailRows) {
      let email = folder.messages.find(email => email.dbID == row.id);
      if (email) {
        await SQLEMail.readWritableProps(email, row); // TODO needed?
        this.applyStoredIncomingSender(email, row);
      } else {
        // Collapse duplicate rows for the same server item (sync races).
        if (row.pID != null && seenPIDs.has(row.pID)) {
          try {
            await (await getDatabase()).run(sql`DELETE FROM email WHERE id = ${row.id}`);
          } catch {
            // best-effort cleanup
          }
          continue;
        }
        email = folder.newEMail();
        let emailRecipientRows = folderRecipientRows.filter(r => r.emailID == row.id);
        let emailAttachmentRows = folderAttachmentRows.filter(r => r.emailID == row.id);
        let emailTagRows = folderTagRows.filter(r => r.emailID == row.id);
        await SQLEMail.read(row.id, email, row, emailRecipientRows, emailAttachmentRows, emailTagRows);
        if (email.pID != null) {
          seenPIDs.add(email.pID);
        }
        newEmails.add(email);
      }
    }
    folder.messages.addAll(newEmails);
  }

  /**
   * @param limit Max number of results (optional, default all)
   * @param startWith Do not return the first `startWith` results (optional, default all)
   *
   * Reads only the date, subject, read status and maybe the first sender and recipient
   */
  static async readAllMainProperties(folder: Folder, limit?: number, startWith?: number): Promise<void> {
    if (startWith && !limit) {
      limit = -1;
    }
    await JSONEMail.init();
    // <copied from="read()" />
    let emailRows = await (await getDatabase()).all(sql`
      SELECT
        id, pID, messageID, parentMsgID,
        size, dateSent, dateReceived, outgoing,
        subject, threadID, downloadComplete,
        json,
        contactEmail, contactName,
        isRead, isStarred, isReplied, isForwarded, isImportant, isSpam
      FROM email
      WHERE folderID = ${folder.dbID}
      ORDER BY dateSent DESC
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      $${startWith ? sql` OFFSET ${startWith} ` : sql``}
    `) as any;
    let isOutgoingFolder = folder.specialFolder == SpecialFolder.Sent ||
      folder.specialFolder == SpecialFolder.Drafts ||
      folder.specialFolder == SpecialFolder.Outbox;
    // The denormalized contact columns can be stale for old sent messages.
    // Read only their recipient metadata here so chat can classify them without
    // downloading and parsing every MIME body in the folder.
    let emailIDs = emailRows.map(row => row.id);
    let emailIDBatches: any[][] = [];
    for (let index = 0; index < emailIDs.length; index += kReadMainPropertiesBatchSize) {
      emailIDBatches.push(emailIDs.slice(index, index + kReadMainPropertiesBatchSize));
    }
    let db = await getDatabase();
    let outgoingRecipientRows: any[] = [];
    if (isOutgoingFolder) {
      for (let batch of emailIDBatches) {
        let batchRows = await db.all(sql`
          SELECT
            emailID, name, emailAddress, recipientType
          FROM emailPersonRel
            LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id)
          WHERE emailID IN ${batch} AND recipientType IN (2, 3, 4)
        `) as any[];
        outgoingRecipientRows.push(...batchRows);
      }
    }
    let folderTagRows: any[] = [];
    for (let batch of emailIDBatches) {
      let batchRows = await db.all(sql`
        SELECT
          emailID, tagName
        FROM emailTag
        WHERE emailID IN ${batch}
      `) as any[];
      folderTagRows.push(...batchRows);
    }
    let rowsByEmailID = (rows: any[]): Map<string, any[]> => {
      let grouped = new Map<string, any[]>();
      for (let row of rows) {
        let key = String(row.emailID);
        let groupedRows = grouped.get(key);
        if (groupedRows) {
          groupedRows.push(row);
        } else {
          grouped.set(key, [row]);
        }
      }
      return grouped;
    };
    let recipientsByEmailID = rowsByEmailID(outgoingRecipientRows);
    let tagsByEmailID = rowsByEmailID(folderTagRows);
    let newEmails = new ArrayColl<EMail>();
    for (let row of emailRows) {
      let email = folder.messages.find(email => email.dbID == row.id);
      let emailID = String(row.id);
      let recipients = recipientsByEmailID.get(emailID) ?? [];
      let tagRows = tagsByEmailID.get(emailID) ?? [];
      if (email) {
        email.outgoing = sanitize.boolean(row.outgoing, email.outgoing);
        email.isReplied = sanitize.boolean(row.isReplied, email.isReplied);
        email.isForwarded = sanitize.boolean(row.isForwarded, email.isForwarded);
        email.isImportant = sanitize.boolean(row.isImportant, email.isImportant);
        email.isStarred = sanitize.boolean(row.isStarred, email.isStarred);
        email.isRead = sanitize.boolean(row.isRead, email.isRead);
        JSONEMail.readLastVerbAt(email, sanitize.json(row.json, {}));
        if (row.contactName || row.contactEmail) {
          email.contact = findOrCreatePersonUID(
            sanitize.emailAddress(row.contactEmail, kDummyPerson.emailAddress),
            sanitize.nonemptylabel(row.contactName, " "));
        } else {
          let contact = computeEMailContact(email);
          if (contact?.emailAddress && contact.emailAddress != kDummyPerson.emailAddress) {
            email.contact = contact;
          }
        }
        this.applyStoredIncomingSender(email, row);
        if (isOutgoingFolder && recipients.length) {
          await this.readRecipients(email, recipients);
          email.contact = computeEMailContact(email);
        }
        await SQLEMail.readTags(email, tagRows);
        continue;
      }
      email = folder.newEMail();
      await SQLEMail.readMainProperties(row.id, email, row, tagRows);
      if (isOutgoingFolder && recipients.length) {
        await this.readRecipients(email, recipients);
        email.contact = computeEMailContact(email);
      }
      newEmails.add(email);
    }
    folder.messages.addAll(newEmails);
  }
}
