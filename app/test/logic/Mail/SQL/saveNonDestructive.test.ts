// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { beforeAll, expect, test, vi } from "vitest";
import sql from "../../../../../lib/rs-sqlite";
import { reloadRecentExchangeBodies } from "../../../../logic/Mail/SQL/SQLEMailMigrate";

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    getFilesDir: async () => "/tmp/jackdaw-mail-test",
  }));
});

function newFullEMail(): EMail {
  let email = newTestEMail(folder);
  email.text = "Hello";
  addTestAttachment(email, "photo.jpg", "<cid1>");
  return email;
}

test("Partial then full saves of the same email don't destroy each other", async () => {
  let db = await getDatabase();

  // Full download: body, attachment, downloadComplete, and the attachment file path
  let email = newFullEMail();
  await SQLEMail.save(email);
  email.downloadComplete = true;
  await SQLEMail.saveWritableProps(email);
  email.attachments.first.filepathLocal = "files/email/alice/1-Test/photo-0.jpg";
  await SQLEMail.saveAttachmentFilename(email, email.attachments.first);

  // Same message listed again as seemingly new, e.g. when the in-memory
  // message list was incomplete: a partial email, just the envelope data
  let phantom = newTestEMail(folder);
  await SQLEMail.save(phantom);
  expect(phantom.dbID).toBe(email.dbID); // deduplicated with existing record

  let row = await db.get(sql`
    SELECT plaintext, downloadComplete FROM email WHERE id = ${email.dbID}`) as any;
  expect(row.plaintext).toBe("Hello"); // body kept
  expect(row.downloadComplete).toBe(1); // still marked complete
  let attachmentRows = await db.all(sql`
    SELECT filename, filepathLocal FROM emailAttachment WHERE emailID = ${email.dbID}`) as any[];
  expect(attachmentRows.length).toBe(1); // attachment record kept
  expect(attachmentRows[0].filepathLocal).toBe("files/email/alice/1-Test/photo-0.jpg");

  // Re-download: full email again, but the attachment file path is not known
  let redownload = newFullEMail();
  await SQLEMail.save(redownload);
  expect(redownload.dbID).toBe(email.dbID);

  attachmentRows = await db.all(sql`
    SELECT filename, filepathLocal FROM emailAttachment WHERE emailID = ${email.dbID}`) as any[];
  expect(attachmentRows.length).toBe(1);
  expect(attachmentRows[0].filepathLocal).toBe("files/email/alice/1-Test/photo-0.jpg"); // kept

  // Changed attachments, e.g. decryption replaced them: records are replaced
  let decrypted = newTestEMail(folder);
  decrypted.text = "Hello";
  addTestAttachment(decrypted, "contract.pdf", "<cid2>");
  await SQLEMail.save(decrypted);

  attachmentRows = await db.all(sql`
    SELECT filename, filepathLocal FROM emailAttachment WHERE emailID = ${email.dbID}`) as any[];
  expect(attachmentRows.length).toBe(1);
  expect(attachmentRows[0].filename).toBe("contract.pdf");
});

test("Metadata-only save of a complete email preserves its body", async () => {
  let db = await getDatabase();
  let email = newTestEMail(folder, "move@example.com");
  email.text = "Body";
  await SQLEMail.save(email);
  email.downloadComplete = true;
  await SQLEMail.saveWritableProps(email);

  let metadataOnly = newTestEMail(folder, "move@example.com");
  metadataOnly.dbID = email.dbID;
  metadataOnly.downloadComplete = true;
  metadataOnly.subject = "Moved";
  await SQLEMail.save(metadataOnly);

  let row = await db.get(sql`
    SELECT subject, plaintext, downloadComplete FROM email WHERE id = ${email.dbID}`) as any;
  expect(row.subject).toBe("Moved");
  expect(row.plaintext).toBe("Body");
  expect(row.downloadComplete).toBe(1);
});

test("A new email marked complete still requires a body", async () => {
  let email = newTestEMail(folder, "missing-body@example.com");
  email.downloadComplete = true;
  await expect(SQLEMail.save(email)).rejects.toThrow("An email without body is not complete");
});

test("Recovers an incoming sender from denormalized contact metadata", async () => {
  let db = await getDatabase();
  let email = newTestEMail(folder, "missing-from-relation@example.com");
  await SQLEMail.save(email);
  await db.run(sql`
    DELETE FROM emailPersonRel
    WHERE emailID = ${email.dbID} AND recipientType = 1
  `);
  await db.run(sql`
    UPDATE email
    SET outgoing = 0,
        contactEmail = ${"recovered@example.com"},
        contactName = ${"Recovered sender"}
    WHERE id = ${email.dbID}
  `);

  let reloaded = folder.newEMail();
  await SQLEMail.read(email.dbID as number, reloaded);

  expect(reloaded.from.emailAddress).toBe("recovered@example.com");
  expect(reloaded.from.name).toBe("Recovered sender");
  expect(reloaded.contact.emailAddress).toBe("recovered@example.com");

  let listEmail = folder.newEMail();
  listEmail.dbID = email.dbID;
  folder.messages.add(listEmail);
  await SQLEMail.readAllMainProperties(folder);

  expect(listEmail.from.emailAddress).toBe("recovered@example.com");
});

test("Uses the MIME Sender header when From is absent", async () => {
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode([
    "Sender: sender-header@example.com",
    "To: user@example.com",
    "Subject: Sender header fallback",
    "Date: Tue, 14 Jul 2026 10:00:00 +0300",
    "",
    "Body",
  ].join("\r\n"));

  await email.parseMIME();

  expect(email.from.emailAddress).toBe("sender-header@example.com");
});

test("Reads folder tags in one query and keeps them on list rows", async () => {
  let db = await getDatabase();
  let taggedEmails = [
    newTestEMail(folder, "tagged-first@example.com"),
    newTestEMail(folder, "tagged-second@example.com"),
  ];
  taggedEmails[0].tags.add(getTagByName("Shared-folder-first-tag"));
  taggedEmails[1].tags.add(getTagByName("Shared-folder-second-tag"));
  for (let email of taggedEmails) {
    await SQLEMail.save(email);
  }

  let loadedFolder = new Folder(folder.account);
  loadedFolder.dbID = folder.dbID;
  let originalAll = db.all.bind(db);
  let tagQueries = 0;
  let spy = vi.spyOn(db, "all").mockImplementation((query: any) => {
    if (query.sourceParts.join("").includes("FROM emailTag")) {
      tagQueries++;
    }
    return originalAll(query);
  });
  try {
    await SQLEMail.readAllMainProperties(loadedFolder);
  } finally {
    spy.mockRestore();
  }

  expect(tagQueries).toBe(1);
  expect(loadedFolder.messages.find(message => message.id == taggedEmails[0].id)?.tags.first?.name)
    .toBe("Shared-folder-first-tag");
  expect(loadedFolder.messages.find(message => message.id == taggedEmails[1].id)?.tags.first?.name)
    .toBe("Shared-folder-second-tag");
});

test("Флаги и категории письма, строку которого уже удалили, сохраняются без ошибки внешнего ключа", async () => {
  let db = await getDatabase();
  let email = newTestEMail(folder);
  await SQLEMail.save(email);
  let rowID = email.dbID;
  // Строку удалили (синхронизация, чистка дублей), а объект в памяти держит старый dbID
  await db.run(sql`DELETE FROM email WHERE id = ${rowID}`);
  email.isStarred = true;
  email.tags.add(getTagByName("$label1"));
  await expect(SQLEMail.saveWritableProps(email)).resolves.toBeUndefined();
  await expect(SQLEMail.saveWritablePropsAll([email])).resolves.toBeUndefined();
  expect(await db.all(sql`SELECT * FROM emailTag WHERE emailID = ${rowID}`)).toEqual([]);
});

test("Номер удалённой строки достался другому письму: сохранение не переписывает чужое письмо", async () => {
  let db = await getDatabase();
  let stale = newTestEMail(folder);
  stale.subject = "Перенос даты доставки";
  await SQLEMail.save(stale);
  let rowID = stale.dbID;
  // Строку удалили, а объект в памяти держит её номер
  await db.run(sql`DELETE FROM email WHERE id = ${rowID}`);
  // Новое письмо получает тот же номер строки (INTEGER PRIMARY KEY без AUTOINCREMENT)
  await db.run(sql`
    INSERT INTO email (id, messageID, folderID, pID, dateSent, dateReceived, subject, html)
    VALUES (${rowID}, ${"<returns@example.com>"}, ${folder.dbID}, ${"other-item"}, 0, 0,
      ${"Возвратные заказы"}, ${"<p>Клиент Спортмастер, возвратные заказы во вложении</p>"})`);

  // Чужой текст не читается: письмо забывает номер и загрузится заново
  let reader = newTestEMail(folder);
  reader.pID = stale.pID;
  reader.id = stale.id;
  reader.dbID = rowID;
  await SQLEMail.readBody(reader);
  expect(reader.dbID).toBeNull();
  expect(reader.rawHTMLDangerous ?? null).toBeNull();

  // Флажок и категории не пишутся в чужую строку
  stale.isStarred = true;
  stale.tags.add(getTagByName("$label1"));
  await SQLEMail.saveWritableProps(stale);
  await SQLEMail.saveWritablePropsAll([stale]);
  let other = await db.get(sql`SELECT subject, isStarred, html FROM email WHERE id = ${rowID}`) as any;
  expect(other.isStarred).toBe(0);
  expect(await db.all(sql`SELECT * FROM emailTag WHERE emailID = ${rowID}`)).toEqual([]);

  // Полное сохранение пишет письмо в свою (новую) строку, чужое остаётся целым
  await SQLEMail.save(stale);
  expect(stale.dbID).not.toBe(rowID);
  other = await db.get(sql`SELECT subject, html FROM email WHERE id = ${rowID}`) as any;
  expect(other.subject).toBe("Возвратные заказы");
  let own = await db.get(sql`SELECT subject, pID FROM email WHERE id = ${stale.dbID}`) as any;
  expect(own.subject).toBe("Перенос даты доставки");
  expect(own.pID).toBe(stale.pID);
});

test("Миграция: письма Exchange с 08.11.2026 заново загружаются с сервера, остальные не трогаются", async () => {
  let db = await getDatabase();
  let exchangeID = "AAMkAGI2" + "x".repeat(140);
  let insert = (pID: string, received: number) => db.run(sql`
    INSERT INTO email (messageID, folderID, pID, dateSent, dateReceived, subject, plaintext, html, downloadComplete)
    VALUES (${"<" + pID.slice(0, 12) + received + "@x>"}, ${folder.dbID}, ${pID}, ${received}, ${received},
      ${"s"}, ${"text"}, ${"<p>text</p>"}, 1)`);
  let recent = (await insert(exchangeID + "1", 1794200000)).lastInsertRowid;
  let old = (await insert(exchangeID + "2", 1794000000)).lastInsertRowid;
  let imap = (await insert("4711", 1794200000)).lastInsertRowid;
  await db.run(sql`INSERT INTO emailAttachment (emailID, filename, mimeType) VALUES (${recent}, ${"ReturnGoods.xml"}, ${"text/xml"})`);
  await db.execute(reloadRecentExchangeBodies);
  let rows = await db.all(sql`SELECT id, html, plaintext, downloadComplete FROM email WHERE id IN ${[recent, old, imap]} ORDER BY id`) as any[];
  let byID = new Map(rows.map(row => [row.id, row]));
  expect(byID.get(recent)).toMatchObject({ html: null, plaintext: null, downloadComplete: 0 });
  expect(byID.get(old)).toMatchObject({ html: "<p>text</p>", downloadComplete: 1 });
  expect(byID.get(imap)).toMatchObject({ html: "<p>text</p>", downloadComplete: 1 });
  expect(await db.all(sql`SELECT * FROM emailAttachment WHERE emailID = ${recent}`)).toEqual([]);
});

test("Номер удалённого письма не достаётся новому, даже если удалено последнее письмо", async () => {
  let db = await getDatabase();
  let first = newTestEMail(folder, "counter1@example.com");
  await SQLEMail.save(first);
  let last = newTestEMail(folder, "counter2@example.com");
  await SQLEMail.save(last);
  let lastID = last.dbID as number;
  await SQLEMail.deleteIt(last);
  let next = newTestEMail(folder, "counter3@example.com");
  await SQLEMail.save(next);
  expect(next.dbID).toBeGreaterThan(lastID);
  // Пачка новых писем тоже получает разные растущие номера
  let batch = [newTestEMail(folder, "counter4@example.com"), newTestEMail(folder, "counter5@example.com"), newTestEMail(folder, "counter6@example.com")];
  await SQLEMail.saveAll(batch);
  let ids = batch.map(email => email.dbID as number);
  expect(new Set(ids).size).toBe(3);
  expect(Math.min(...ids)).toBeGreaterThan(next.dbID as number);
  let counter = await db.get(sql`SELECT value FROM emailIDCounter`) as any;
  expect(counter.value).toBe(Math.max(...ids));
});
