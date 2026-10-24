import type { EMail } from "../EMail";
import { computeEMailContact, differentSender } from "../EMail";
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
import { ArrayColl, Collection, CollectionObserver } from "svelte-collections";
import sql, { type Database } from "../../../../lib/rs-sqlite";
import { batchRef, runBatch, supportsBatch, type BatchRef, type BatchStep } from "../../../../lib/rs-sqlite/batch";

/** Stay below SQLite's portable bound-parameter limit when loading large folders. */
const kReadMainPropertiesBatchSize = 500;
/** Сколько id в одном `IN (…)` при пакетных выборках и удалениях
 * (ниже переносимого лимита SQLite на число параметров). */
const kSQLInListSize = 500;
/** Предел кэша id `emailPerson`: при переполнении кэш просто сбрасывается. */
const kEmailPersonCacheMaxSize = 20_000;

/** id строки `email`: известный или ссылка на INSERT в том же пакете. */
type EMailRowID = NonNullable<EMail["dbID"]> | BatchRef;

/** Строка `emailAttachment`, нужная для сохранения вложений. */
type ExistingAttachmentRow = { id: number, filename: string };

/**
 * id адресов `emailPerson` по ключу (адрес, имя). Адреса повторяются от письма
 * к письму, поэтому без кэша каждое сохранение начиналось бы с поиска.
 * Строки `emailPerson` приложение не удаляет; кэш привязан к экземпляру базы
 * и сбрасывается при любой ошибке сохранения.
 */
const emailPersonIDs = new Map<string, number>();
let emailPersonIDsDatabase: Database | null = null;

/** Порядок захвата блокировок писем в пакетных операциях: всегда один и тот же,
 * чтобы два пакета с общими письмами не ждали друг друга по кругу. */
const lockOrder = new WeakMap<EMail, number>();
let nextLockOrder = 1;

function emailLockOrder(email: EMail): number {
  let order = lockOrder.get(email);
  if (!order) {
    order = nextLockOrder++;
    lockOrder.set(email, order);
  }
  return order;
}

/** Блокирует письма в общем порядке. Повторы в списке игнорируются. */
async function lockEMails(emails: EMail[]): Promise<{ release(): void }[]> {
  let locks: { release(): void }[] = [];
  try {
    for (let email of [...new Set(emails)].sort((a, b) => emailLockOrder(a) - emailLockOrder(b))) {
      locks.push(await email.storageLock.lock());
    }
  } catch (ex) {
    releaseAll(locks);
    throw ex;
  }
  return locks;
}

function releaseAll(locks: { release(): void }[]): void {
  for (let lock of locks) {
    lock.release();
  }
}

function chunks<Type>(list: Type[], size = kSQLInListSize): Type[][] {
  let result: Type[][] = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
}

/**
 * Имя в `emailPerson` хранится как '' вместо NULL (BUG-202): с NULL ни
 * `name = ?`, ни `UNIQUE(emailAddress, name)` не находили уже сохранённый адрес,
 * и каждое письмо добавляло дубль.
 */
function emailPersonName(puid: PersonUID): string {
  return puid.name ?? "";
}

/** Ключ кэша или null, если адреса нет: такие строки не дедуплицируются. */
function emailPersonKey(puid: PersonUID): string | null {
  return puid.emailAddress == null ? null : `${puid.emailAddress}\u0000${emailPersonName(puid)}`;
}

/** Ключ поиска письма в папке, как в `SQLEMail.save()`. */
function existingEMailKey(email: EMail): string | null {
  if (email.pID != null) {
    return `p:${typeof email.pID}:${email.pID}`;
  }
  // Без pID письмо узнаём по Message-ID. Пустой ID не годится:
  // иначе все такие письма папки слились бы в одну строку.
  return email.id ? `m:${email.id}` : null;
}

function existingRowKey(row: { pID: any, messageID: any }): string {
  return row.pID != null ? `p:${typeof row.pID}:${row.pID}` : `m:${row.messageID}`;
}

export class SQLEMail {
  /**
   * Save complete emails and metadata updates for already persisted emails.
   */
  static async save(email: EMail) {
    this.assertSavable(email);
    let lock = await email.storageLock.lock();
    try {
      await this.saveLocked([email]);
    } finally {
      lock.release();
    }
  }

  /**
   * Сохраняет письма так же, как `save()`, но одной транзакцией: несколько
   * обращений к базе на всю пачку вместо 10–20 на каждое письмо.
   * Ошибка любого письма откатывает всю пачку; новым письмам `dbID`
   * присваивается только после успешной записи.
   */
  static async saveAll(emails: Iterable<EMail>) {
    let list = [...new Set(emails)];
    if (!list.length) {
      return;
    }
    for (let email of list) {
      this.assertSavable(email);
    }
    let locks = await lockEMails(list);
    try {
      await this.saveLocked(list);
    } finally {
      releaseAll(locks);
    }
  }

  protected static assertSavable(email: EMail) {
    assert(!email.downloadComplete || !!email.dbID || !!email.rawText || !!email.rawHTMLDangerous, "An email without body is not complete");
  }

  /** Блокировки писем уже взяты вызывающим. */
  protected static async saveLocked(emails: EMail[]) {
    for (let folder of new Set(emails.map(email => email.folder))) {
      if (!folder.dbID) {
        await folder.save();
      }
    }
    let db = await getDatabase();
    try {
      await this.findExistingEMailIDs(db, emails.filter(email => !email.dbID));
      for (let email of emails) {
        if (!email.sent) {
          email.sent = new Date();
        }
        if (!email.received) {
          email.received = email.sent;
        }
      }
      let attachmentRows = await this.readAttachmentRows(db,
        emails.filter(email => !!email.dbID && email.attachments.hasItems));
      let personIDs = await this.findEmailPersonIDs(db, emails);

      let steps: BatchStep[] = [];
      /** Шаг INSERT нового письма */
      let inserts = new Map<EMail, number>();
      /** Новые письма пачки по ключу поиска: повторное письмо с тем же pID
       * обновляет строку первого, как при последовательном сохранении. */
      let insertsByKey = new Map<string, number>();
      /** Шаг upsert нового адреса `emailPerson` по ключу */
      let newPersons = new Map<string, number>();
      for (let email of emails) {
        let rowID: EMailRowID;
        let key = email.dbID ? null : existingEMailKey(email);
        let batchKey = key ? `${email.folder.dbID}|${key}` : null;
        let earlierInsert = batchKey ? insertsByKey.get(batchKey) : undefined;
        if (email.dbID || earlierInsert != null) {
          rowID = email.dbID ?? batchRef(earlierInsert as number);
          if (earlierInsert != null) {
            inserts.set(email, earlierInsert);
          }
          steps.push({ query: this.updateEMailQuery(email, rowID) });
        } else {
          inserts.set(email, steps.length);
          if (batchKey) {
            insertsByKey.set(batchKey, steps.length);
          }
          rowID = batchRef(steps.length);
          steps.push({ query: this.insertEMailQuery(email) });
        }
        steps.push(...this.writablePropsSteps(email, rowID));
        this.addRecipientsSteps(steps, email, rowID, personIDs, newPersons);
        this.addAttachmentsSteps(steps, email, rowID,
          email.dbID ? attachmentRows.get(email.dbID) ?? [] : []);
      }

      let results = await runBatch(db, steps);
      for (let [email, stepIndex] of inserts) {
        email.dbID = results[stepIndex].lastInsertRowid;
      }
      for (let [key, stepIndex] of newPersons) {
        this.rememberEmailPersonID(key, results[stepIndex].id);
      }
    } catch (ex) {
      // В кэше мог остаться id, которого уже нет: следующая попытка ищет заново
      emailPersonIDs.clear();
      throw ex;
    }
  }

  /** Находит уже сохранённые строки писем без `dbID`, как раньше делал
   * `save()` для каждого письма, но одним запросом на ≤500 писем папки. */
  protected static async findExistingEMailIDs(db: Database, emails: EMail[]) {
    let byFolder = new Map<number, EMail[]>();
    for (let email of emails) {
      if (!existingEMailKey(email)) {
        continue;
      }
      let folderID = email.folder.dbID as number;
      let folderEmails = byFolder.get(folderID);
      if (folderEmails) {
        folderEmails.push(email);
      } else {
        byFolder.set(folderID, [email]);
      }
    }
    for (let [folderID, folderEmails] of byFolder) {
      let rowIDs = new Map<string, number>();
      let withPID = folderEmails.filter(email => email.pID != null);
      for (let batch of chunks(withPID)) {
        let rows = await db.all(sql`
          SELECT
            id, pID, messageID
          FROM email
          WHERE
            folderID = ${folderID} AND
            pID IN ${batch.map(email => email.pID)}
          ORDER BY id
          `) as any[];
        for (let row of rows) {
          let key = existingRowKey(row);
          if (!rowIDs.has(key)) {
            rowIDs.set(key, row.id);
          }
        }
      }
      // BUG-203: раньше здесь стояло `pID = NULL`, которое всегда ложно,
      // и письмо без pID при каждом сохранении вставлялось заново.
      let withoutPID = folderEmails.filter(email => email.pID == null);
      for (let batch of chunks(withoutPID)) {
        let rows = await db.all(sql`
          SELECT
            id, pID, messageID
          FROM email
          WHERE
            folderID = ${folderID} AND
            pID IS NULL AND
            messageID IN ${batch.map(email => email.id)}
          ORDER BY id
          `) as any[];
        for (let row of rows) {
          let key = existingRowKey(row);
          if (!rowIDs.has(key)) {
            rowIDs.set(key, row.id);
          }
        }
      }
      for (let email of folderEmails) {
        let id = rowIDs.get(existingEMailKey(email) as string);
        if (id) {
          email.dbID = id;
        }
      }
    }
  }

  protected static insertEMailQuery(email: EMail) {
    let contact = email.contact as PersonUID;
    // Index HTML-only bodies so global search can find them
    let plaintext = email.rawText
      ?? (email.rawHTMLDangerous ? convertHTMLToText(email.rawHTMLDangerous) : null);
    return sql`
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
      )`;
  }

  /** This might be an update with only metadata, so don't overwrite content */
  protected static updateEMailQuery(email: EMail, rowID: EMailRowID) {
    let contact = email.contact as PersonUID;
    let plaintext = email.rawText
      ?? (email.rawHTMLDangerous ? convertHTMLToText(email.rawHTMLDangerous) : null);
    return sql`
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
      WHERE id = ${rowID}
    `;
  }

  static async saveWritableProps(email: EMail, doLock = true) {
    assert(email.dbID, "Need Email DB ID to save props");
    let lock = doLock ? await email.storageLock.lock() : null;
    try {
      assert(email.dbID, "Need Email DB ID to save props");
      await runBatch(await getDatabase(), this.writablePropsSteps(email, email.dbID));
    } finally {
      lock?.release();
    }
  }

  /**
   * `saveWritableProps()` для многих писем одной транзакцией.
   * Письма, которые удалили из базы, пока ждали блокировку, пропускаются.
   */
  static async saveWritablePropsAll(emails: Iterable<EMail>) {
    let list = [...new Set(emails)];
    for (let email of list) {
      assert(email.dbID, "Need Email DB ID to save props");
    }
    if (!list.length) {
      return;
    }
    let locks = await lockEMails(list);
    try {
      let steps = list
        .filter(email => !!email.dbID)
        .flatMap(email => this.writablePropsSteps(email, email.dbID as NonNullable<EMail["dbID"]>));
      await runBatch(await getDatabase(), steps);
    } finally {
      releaseAll(locks);
    }
  }

  protected static writablePropsSteps(email: EMail, rowID: EMailRowID): BatchStep[] {
    let json = {} as any;
    JSONEMail.saveExtraData(email, json);
    let jsonStr = Object.keys(json).length
      ? JSON.stringify(json, null, 2)
      : null;

    return [
      // This might be an update with only metadata, so don't overwrite content
      { query: sql`
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
        WHERE id = ${rowID}
        ` },
      ...this.tagsSteps(email, rowID),
    ];
  }

  /** Отправитель и получатели в порядке сохранения: тип 1 = from, 2 = to, 3 = cc, 4 = bcc, 5 = reply-to, 6 = sender (от имени), 7 = Disposition-Notification-To */
  protected static recipientsOf(email: EMail): [PersonUID, number][] {
    let recipients: [PersonUID, number][] = [[email.from, 1]];
    for (let recipient of email.to) {
      recipients.push([recipient, 2]);
    }
    for (let recipient of email.cc) {
      recipients.push([recipient, 3]);
    }
    for (let recipient of email.bcc) {
      recipients.push([recipient, 4]);
    }
    if (email.replyTo?.emailAddress) {
      recipients.push([email.replyTo, 5]);
    }
    if (email.sender?.emailAddress) {
      recipients.push([email.sender, 6]);
    }
    if (email.readReceiptTo?.emailAddress) {
      recipients.push([email.readReceiptTo, 7]);
    }
    return recipients;
  }

  protected static addRecipientsSteps(steps: BatchStep[], email: EMail, rowID: EMailRowID,
      personIDs: Map<string, number>, newPersons: Map<string, number>) {
    // See comment in `addAttachmentsSteps()` below
    steps.push({ query: sql`
      DELETE FROM emailPersonRel
      WHERE emailID = ${rowID}
      ` });
    for (let [puid, recipientType] of this.recipientsOf(email)) {
      let key = emailPersonKey(puid);
      let personID: number | BatchRef | undefined = key ? personIDs.get(key) : undefined;
      if (personID == null) {
        let stepIndex = key ? newPersons.get(key) : undefined;
        if (stepIndex == null) {
          stepIndex = steps.length;
          // BUG-202: при конфликте RETURNING всё равно отдаёт id существующей
          // строки. С INSERT OR IGNORE lastInsertRowid был чужим.
          steps.push({ mode: "get", query: sql`
            INSERT INTO emailPerson (
              name, emailAddress, personID
            ) VALUES (
              ${emailPersonName(puid)}, ${puid.emailAddress}, ${puid.person?.dbID}
            )
            ON CONFLICT (emailAddress, name) DO UPDATE SET name = excluded.name
            RETURNING id
            ` });
          if (key) {
            newPersons.set(key, stepIndex);
          }
        }
        personID = batchRef(stepIndex, "id");
      }
      steps.push({ query: sql`
        INSERT INTO emailPersonRel (
          emailID, emailPersonID, recipientType
        ) VALUES (
          ${rowID}, ${personID}, ${recipientType}
        )` });
    }
  }

  /** id уже сохранённых адресов всех отправителей и получателей пачки: сначала кэш,
   * остальное — одним запросом на ≤500 адресов. */
  protected static async findEmailPersonIDs(db: Database, emails: EMail[]): Promise<Map<string, number>> {
    if (emailPersonIDsDatabase !== db) {
      emailPersonIDs.clear();
      emailPersonIDsDatabase = db;
    }
    let found = new Map<string, number>();
    let missingAddresses = new Set<string>();
    let missingKeys = new Set<string>();
    for (let email of emails) {
      for (let [puid] of this.recipientsOf(email)) {
        let key = emailPersonKey(puid);
        if (!key) {
          continue;
        }
        let cached = emailPersonIDs.get(key);
        if (cached) {
          found.set(key, cached);
        } else {
          missingKeys.add(key);
          missingAddresses.add(puid.emailAddress);
        }
      }
    }
    for (let batch of chunks([...missingAddresses])) {
      let rows = await db.all(sql`
        SELECT
          id, emailAddress, name
        FROM emailPerson
        WHERE emailAddress IN ${batch}
        ORDER BY id
        `) as any[];
      for (let row of rows) {
        let key = `${row.emailAddress}\u0000${row.name ?? ""}`;
        if (missingKeys.has(key) && !found.has(key)) {
          found.set(key, row.id);
          this.rememberEmailPersonID(key, row.id);
        }
      }
    }
    return found;
  }

  protected static rememberEmailPersonID(key: string, id: number) {
    if (!id) {
      return;
    }
    if (emailPersonIDs.size >= kEmailPersonCacheMaxSize) {
      emailPersonIDs.clear();
    }
    emailPersonIDs.set(key, id);
  }

  /** Уже сохранённые вложения писем, по `dbID` письма. */
  protected static async readAttachmentRows(db: Database, emails: EMail[]): Promise<Map<EMail["dbID"], ExistingAttachmentRow[]>> {
    let rowsByEMail = new Map<EMail["dbID"], ExistingAttachmentRow[]>();
    for (let batch of chunks(emails.map(email => email.dbID))) {
      let rows = await db.all(sql`
        SELECT
          id, emailID, filename
        FROM emailAttachment
        WHERE emailID IN ${batch}
        ORDER BY id
        `) as any[];
      for (let row of rows) {
        let emailRows = rowsByEMail.get(row.emailID);
        if (emailRows) {
          emailRows.push(row);
        } else {
          rowsByEMail.set(row.emailID, [row]);
        }
      }
    }
    return rowsByEMail;
  }

  protected static addAttachmentsSteps(steps: BatchStep[], email: EMail, rowID: EMailRowID, existingRows: ExistingAttachmentRow[]) {
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
    let remainingRows = existingRows;
    for (let attachment of email.attachments) {
      let row = remainingRows.find(row => row.filename == attachment.filename);
      if (row) {
        remainingRows = remainingRows.filter(r => r != row);
        steps.push({ query: this.updateAttachmentQuery(attachment, row.id) });
      } else {
        steps.push({ query: this.insertAttachmentQuery(rowID, attachment) });
      }
    }
    for (let row of remainingRows) {
      steps.push({ query: sql`
        DELETE FROM emailAttachment
        WHERE id = ${row.id}
        ` });
    }
  }

  protected static insertAttachmentQuery(rowID: EMailRowID, a: Attachment) {
    let filepath = a.filepathLocal?.replace(JSONEMail.filesDir + "/", "");
    return sql`
      INSERT OR IGNORE INTO emailAttachment (
        emailID, filename, filepathLocal, mimeType, size, contentID, disposition, related
      ) VALUES (
        ${rowID}, ${a.filename}, ${filepath}, ${a.mimeType}, ${a.size},
        ${a.contentID}, ${a.disposition}, ${a.related ? 1 : 0}
      )`;
  }

  protected static updateAttachmentQuery(a: Attachment, rowID: number) {
    let filepath = a.filepathLocal?.replace(JSONEMail.filesDir + "/", "");
    return sql`
      UPDATE emailAttachment SET
        contentID = ${a.contentID},
        mimeType = ${a.mimeType},
        size = ${a.size},
        disposition = ${a.disposition},
        related = ${a.related ? 1 : 0},
        filepathLocal = COALESCE(${filepath}, filepathLocal)
      WHERE id = ${rowID}
      `;
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
      assert(email.dbID, "Need Email DB ID");
      await runBatch(await getDatabase(), this.tagsSteps(email, email.dbID));
    } finally {
      lock?.release();
    }
  }

  protected static tagsSteps(email: EMail, rowID: EMailRowID): BatchStep[] {
    let steps: BatchStep[] = [{ query: sql`
      DELETE FROM emailTag
      WHERE emailID = ${rowID}
      ` }];
    for (let tag of email.tags) {
      steps.push({ query: sql`
        INSERT OR IGNORE INTO emailTag (
          emailID, tagName
        ) VALUES (
          ${rowID}, ${tag.name}
        )` });
    }
    return steps;
  }

  protected static readonly transactionLock = new Lock();

  static async saveMultiple(emails: Collection<EMail>) {
    let lock = await SQLEMail.transactionLock.lock();
    try {
      let db = await getDatabase();
      if (supportsBatch(db)) {
        // Пакет — уже одна транзакция, без BEGIN/END вокруг асинхронных вызовов
        await this.saveAll([...emails].filter(email => !!email.subject));
        return;
      }
      try {
        await db.run(sql`BEGIN TRANSACTION`);
        for (let email of emails) {
          if (!email.subject) {
            continue;
          }
          await this.save(email);
        }
        await db.run(sql`END TRANSACTION`);
      } catch (ex) {
        await db.run(sql`ROLLBACK TRANSACTION`);
        throw ex;
      }
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

  /** `deleteIt()` для многих писем: `DELETE … WHERE id IN (…)` пачками по ≤500
   * в одной транзакции. Получатели, вложения и метки удаляются каскадом. */
  static async deleteAll(emails: Iterable<EMail>) {
    let list = [...new Set(emails)].filter(email => !!email.dbID);
    if (!list.length) {
      return;
    }
    let locks = await lockEMails(list);
    try {
      let dbIDs: EMail["dbID"][] = [];
      for (let email of list) {
        if (email.dbID) {
          dbIDs.push(email.dbID);
          email.dbID = null;
        }
      }
      await runBatch(await getDatabase(), chunks(dbIDs).map(batch => ({ query: sql`
        DELETE FROM email
        WHERE id IN ${batch}
        ` })));
    } finally {
      releaseAll(locks);
    }
  }

  /** Отмечает прочитанными (или непрочитанными) все письма папки одним UPDATE,
   * включая ещё не загруженные в память. */
  static async markFolderRead(folder: Folder, isRead: boolean) {
    assert(folder.dbID, "Need folder DB ID");
    let flag = isRead ? 1 : 0;
    await (await getDatabase()).run(sql`
      UPDATE email SET
        isRead = ${flag}
      WHERE folderID = ${folder.dbID}
        AND isRead IS NOT ${flag}
      `);
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
    let rowJSON = sanitize.json(row.json, {});
    JSONEMail.readLastVerbAt(email, rowJSON);
    JSONEMail.readFlag(email, rowJSON);

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
    JSONEMail.readFlag(email, json);
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
    email.sender = null;
    email.readReceiptTo = null;
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
        } else if (row.recipientType == 7) {
          email.readReceiptTo = uid;
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
    } else {
      email.sender = differentSender(email.from, sender
        ? { address: sender.emailAddress, name: sender.name }
        : null);
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
    /* Индекс по dbID вместо `find()` на каждую строку: O(n) вместо O(n²).
     * Синхронизация может менять папку во время загрузки (между await),
     * поэтому любое изменение помечает индекс устаревшим. */
    let cachedByDbID: Map<string, EMail> | null = null;
    let invalidateCache = new class extends CollectionObserver<EMail> {
      added() {
        cachedByDbID = null;
      }
      removed() {
        cachedByDbID = null;
      }
    };
    let findCached = (dbID: any): EMail | undefined => {
      if (!cachedByDbID) {
        cachedByDbID = new Map();
        for (let cached of folder.messages.contents) {
          let key = String(cached.dbID);
          if (cached.dbID != null && !cachedByDbID.has(key)) {
            cachedByDbID.set(key, cached);
          }
        }
      }
      return dbID == null ? undefined : cachedByDbID.get(String(dbID));
    };
    folder.messages.registerObserver(invalidateCache);
    try {
      for (let row of emailRows) {
        let email = findCached(row.id);
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
          let rowJSON = sanitize.json(row.json, {});
          JSONEMail.readLastVerbAt(email, rowJSON);
          JSONEMail.readFlag(email, rowJSON);
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
    } finally {
      folder.messages.unregisterObserver(invalidateCache);
    }
    folder.messages.addAll(newEmails);
  }
}
