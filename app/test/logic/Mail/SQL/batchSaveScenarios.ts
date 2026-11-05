// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { ArrayColl } from "svelte-collections";
import { beforeAll, expect, test } from "vitest";
import sql from "../../../../../lib/rs-sqlite";
import type { InProcessSQLiteHost } from "../../util/hostedSQLite";

export type BatchSaveBackend = {
  /** Как `appGlobal.remoteApp.getSQLiteDatabase` */
  getSQLiteDatabase(filename: string): any;
  /** Пакет — одна транзакция (десктоп) или шаги по очереди (запасной путь) */
  atomic: boolean;
  sqlite?: InProcessSQLiteHost;
};

/** Сценарии пакетного сохранения для конкретного бэкенда базы. */
export function defineBatchSaveTests(backend: BatchSaveBackend) {
  let folder: Folder;
  let counter = 0;

  beforeAll(async () => {
    ({ folder } = await setupTestFolder({
      getSQLiteDatabase: backend.getSQLiteDatabase,
      getFilesDir: async () => "/tmp/jackdaw-mail-test",
    }));
    folder.account.storage = new SQLMailStorage();
  });

  function newEMail(options: { pID?: string | null, messageID?: string } = {}): EMail {
    let id = options.messageID ?? `batch-${++counter}@example.com`;
    let email = newTestEMail(folder, id);
    email.pID = options.pID === undefined ? `item-${counter}` : options.pID;
    // Адрес без имени, как его создают разборщики протоколов (BUG-202)
    email.cc.add(new PersonUID("bob@example.com"));
    return email;
  }

  async function countRows(table: string, where = sql``): Promise<number> {
    let db = await getDatabase();
    let row = await db.get(sql`SELECT COUNT(*) AS n FROM $${{ sourceParts: [table], parameters: [] }} $${where}`) as any;
    return row.n;
  }

  test("saveAll: страница новых писем сохраняется целиком, адреса не дублируются", async () => {
    let emails = [...Array(25)].map(() => newEMail());
    let before = backend.sqlite?.requests.length ?? 0;
    await SQLEMail.saveAll(emails);
    if (backend.sqlite) {
      // Поиск писем, адресов и одна транзакция записи — вместо 10–20 запросов на письмо
      expect(backend.sqlite.countRequests(before)).toBeLessThanOrEqual(4);
    }
    let ids = emails.map(email => email.dbID);
    expect(ids.every(id => typeof id == "number" && id > 0)).toBe(true);
    expect(new Set(ids).size).toBe(emails.length);

    let db = await getDatabase();
    let bobRows = await db.all(sql`
      SELECT name FROM emailPerson WHERE emailAddress = ${"bob@example.com"}`) as any[];
    expect(bobRows).toEqual([{ name: "" }]);
    let aliceRows = await db.all(sql`
      SELECT name FROM emailPerson WHERE emailAddress = ${"alice@example.com"}`) as any[];
    expect(aliceRows).toEqual([{ name: "Alice" }]);

    let read = await SQLEMail.read(emails[3].dbID, folder.newEMail());
    expect(read.from.emailAddress).toBe("alice@example.com");
    expect(read.to.contents.map(person => person.emailAddress)).toEqual(["user@example.com"]);
    // Пустое имя читается как отсутствующее, как раньше NULL
    expect(read.cc.contents.map(person => [person.emailAddress, person.name])).toEqual([["bob@example.com", "bob@example.com"]]);
  });

  test("saveAll: письмо с тем же pID дважды в пачке даёт одну строку", async () => {
    let first = newEMail({ pID: "dup-in-batch" });
    let second = newEMail({ pID: "dup-in-batch" });
    second.isRead = true;
    await SQLEMail.saveAll([first, second]);
    expect(second.dbID).toBe(first.dbID);
    expect(await countRows("email", sql`WHERE pID = ${"dup-in-batch"}`)).toBe(1);
    let row = await (await getDatabase()).get(sql`SELECT isRead FROM email WHERE id = ${first.dbID}`) as any;
    expect(row.isRead).toBe(1); // как при последовательном сохранении: последнее состояние
  });

  test("saveAll: повторный заголовок без dbID находит строку по pID и не стирает тело и вложения", async () => {
    let full = newEMail({ pID: "existing-item" });
    full.text = "Body";
    addTestAttachment(full, "doc.pdf", "<cid-doc>");
    await SQLEMail.save(full);
    full.attachments.first.filepathLocal = "files/doc.pdf";
    await SQLEMail.saveAttachmentFilename(full, full.attachments.first);

    let header = newEMail({ pID: "existing-item", messageID: full.id });
    let other = newEMail();
    await SQLEMail.saveAll([header, other]);
    expect(header.dbID).toBe(full.dbID);
    let db = await getDatabase();
    let row = await db.get(sql`SELECT plaintext FROM email WHERE id = ${full.dbID}`) as any;
    expect(row.plaintext).toBe("Body");
    let attachments = await db.all(sql`
      SELECT filename, filepathLocal FROM emailAttachment WHERE emailID = ${full.dbID}`) as any[];
    expect(attachments).toEqual([{ filename: "doc.pdf", filepathLocal: "files/doc.pdf" }]);

    // Полное письмо ещё раз: вложение обновляется, путь к файлу остаётся
    let again = newEMail({ pID: "existing-item", messageID: full.id });
    again.text = "Body";
    addTestAttachment(again, "doc.pdf", "<cid-doc-2>");
    await SQLEMail.saveAll([again, newEMail()]);
    attachments = await db.all(sql`
      SELECT contentID, filepathLocal FROM emailAttachment WHERE emailID = ${full.dbID}`) as any[];
    expect(attachments).toEqual([{ contentID: "<cid-doc-2>", filepathLocal: "files/doc.pdf" }]);
  });

  test("BUG-203: письмо без pID находится по Message-ID, пустой Message-ID письма не склеивает", async () => {
    let first = newEMail({ pID: null, messageID: "local-draft@example.com" });
    await SQLEMail.save(first);
    let again = newEMail({ pID: null, messageID: "local-draft@example.com" });
    await SQLEMail.save(again);
    expect(again.dbID).toBe(first.dbID);
    let inBatch = newEMail({ pID: null, messageID: "local-draft@example.com" });
    await SQLEMail.saveAll([inBatch, newEMail({ pID: null })]);
    expect(inBatch.dbID).toBe(first.dbID);
    expect(await countRows("email", sql`WHERE messageID = ${"local-draft@example.com"}`)).toBe(1);

    let noID1 = newEMail({ pID: null, messageID: "" });
    let noID2 = newEMail({ pID: null, messageID: "" });
    await SQLEMail.save(noID1);
    await SQLEMail.save(noID2);
    expect(noID2.dbID).not.toBe(noID1.dbID);
  });

  test("BUG-202: адрес без имени не добавляет emailPerson при каждом сохранении", async () => {
    let carol = new PersonUID("carol@example.com");
    for (let i = 0; i < 3; i++) {
      let email = newEMail();
      email.to.add(carol);
      await SQLEMail.save(email);
    }
    let rows = await (await getDatabase()).all(sql`
      SELECT id, name FROM emailPerson WHERE emailAddress = ${"carol@example.com"}`) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("");
    expect(await countRows("emailPersonRel", sql`WHERE emailPersonID = ${rows[0].id}`)).toBe(3);
  });

  test("saveWritablePropsAll: флаги и метки нескольких писем", async () => {
    let emails = [newEMail(), newEMail(), newEMail()];
    await SQLEMail.saveAll(emails);
    emails[0].isStarred = true;
    emails[1].isRead = true;
    emails[2].tags.add(getTagByName("$label1"));
    let before = backend.sqlite?.requests.length ?? 0;
    await SQLEMail.saveWritablePropsAll(emails);
    if (backend.sqlite) {
      expect(backend.sqlite.countRequests(before)).toBe(1);
    }
    let db = await getDatabase();
    let rows = await db.all(sql`
      SELECT id, isStarred, isRead FROM email WHERE id IN ${emails.map(email => email.dbID)} ORDER BY id`) as any[];
    expect(rows.map(row => [row.isStarred, row.isRead])).toEqual([[1, 0], [0, 1], [0, 0]]);
    let tags = await db.all(sql`SELECT tagName FROM emailTag WHERE emailID = ${emails[2].dbID}`) as any[];
    expect(tags).toEqual([{ tagName: "$label1" }]);
  });

  test("deleteAll: строки писем, получатели и метки удалены", async () => {
    let emails = [...Array(5)].map(() => newEMail());
    emails[0].tags.add(getTagByName("$label1"));
    await SQLEMail.saveAll(emails);
    let ids = emails.map(email => email.dbID);
    await SQLEMail.deleteAll(emails);
    expect(emails.every(email => email.dbID == null)).toBe(true);
    expect(await countRows("email", sql`WHERE id IN ${ids}`)).toBe(0);
    expect(await countRows("emailPersonRel", sql`WHERE emailID IN ${ids}`)).toBe(0);
    expect(await countRows("emailTag", sql`WHERE emailID IN ${ids}`)).toBe(0);
  });

  test("saveAll: ошибка письма " + (backend.atomic ? "откатывает всю пачку" : "не теряет dbID уже сохранённых при повторе"), async () => {
    let good = newEMail();
    let bad = newEMail();
    bad.subject = null as any; // NOT NULL в схеме
    await expect(SQLEMail.saveAll([good, bad])).rejects.toThrow();
    expect(good.dbID).toBeFalsy();
    if (backend.atomic) {
      expect(await countRows("email", sql`WHERE pID = ${good.pID}`)).toBe(0);
    }
    // Повтор по одному (как в Folder.saveMessagesMetadataLocally) не создаёт дублей
    let errors: unknown[] = [];
    let saved = await folder.saveMessagesMetadataLocally([good, bad], ex => errors.push(ex));
    expect(saved).toEqual([good]);
    expect(errors.length).toBe(1);
    expect(await countRows("email", sql`WHERE pID = ${good.pID}`)).toBe(1);
  });

  test("Folder.markAllRead/markAllUnread: один UPDATE на папку, включая письма не в памяти", async () => {
    let inMemory = [newEMail(), newEMail()];
    await SQLEMail.saveAll(inMemory);
    let onlyInDB = newEMail();
    await SQLEMail.save(onlyInDB);
    folder.messages.clear();
    folder.messages.addAll(inMemory);
    folder.countUnread = 3;

    let before = backend.sqlite?.requests.length ?? 0;
    await folder.markAllRead();
    if (backend.sqlite) {
      expect(backend.sqlite.countRequests(before)).toBe(1);
    }
    expect(inMemory.every(email => email.isRead)).toBe(true);
    expect(folder.countUnread).toBe(0);
    expect(await countRows("email", sql`WHERE folderID = ${folder.dbID} AND isRead = 0`)).toBe(0);

    await folder.markAllUnread();
    expect(inMemory.every(email => !email.isRead)).toBe(true);
    expect(folder.countUnread).toBe(2);
    expect(await countRows("email", sql`WHERE folderID = ${folder.dbID} AND isRead = 1`)).toBe(0);
    folder.messages.clear();
  });

  test("Folder.deleteMessagesLocally: письма убраны из папки и из базы", async () => {
    let emails = [newEMail(), newEMail(), newEMail()];
    await SQLEMail.saveAll(emails);
    let ids = emails.map(email => email.dbID);
    folder.messages.addAll(emails);
    await folder.deleteMessagesLocally(new ArrayColl(emails));
    expect(emails.every(email => email.isDeleted)).toBe(true);
    expect(folder.messages.contents.some(email => emails.includes(email))).toBe(false);
    expect(await countRows("email", sql`WHERE id IN ${ids}`)).toBe(0);
  });

  test("saveMultiple: письма без темы пропускаются, как раньше", async () => {
    let withSubject = newEMail();
    let withoutSubject = newEMail();
    withoutSubject.subject = "";
    await SQLEMail.saveMultiple(new ArrayColl([withSubject, withoutSubject]));
    expect(withSubject.dbID).toBeTruthy();
    expect(withoutSubject.dbID).toBeFalsy();
  });

}
