// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { beforeAll, expect, test } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { SQLSourceEMail } from "../../../../logic/Mail/SQL/Source/SQLSourceEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { getDatabase as getSourceDatabase } from "../../../../logic/Mail/SQL/Source/SQLSourceDatabase";
import { dedupeEMailsWithoutPID } from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import { checkMailIntegrity, findForeignSources, harmfulIssueCount, repairForeignSources } from "../../../../logic/Mail/SQL/SQLIntegrity";
import { normalizeMessageID, mimeMessageID } from "../../../../logic/Mail/SQL/Source/mimeMessageID";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import sql, { type Database } from "../../../../../lib/rs-sqlite";

/*
 * Случайные последовательности операций над базой писем, как их делает
 * приложение: письма приходят, удаляются (в том числе другим объектом, пока
 * этот держит старый dbID), переносятся, синхронизируются заново, чистятся
 * дубли, сохраняются флажки, категории и исходник MIME. После каждого шага —
 * проверка, что ни одна строка не получила чужой текст, вложения, категории
 * или исходник и что номера удалённых писем не выдаются снова.
 *
 * Инцидент 2026-11-09 (PR #175–#178): номер удалённой строки доставался новому
 * письму, а объект в памяти со старым dbID писал в неё и читал из неё.
 */

const kSeeds = 30;
const kSteps = 45;

let inbox: Folder;
let archive: Folder;
let folders: Folder[];
let db: Database;
let sourceDB: Database;
let hasIDCounter = false;

beforeAll(async () => {
  let tempDir = "";
  ({ folder: inbox, tempDir } = await setupTestFolder({
    getConfigDir: async () => tempDir,
    getFilesDir: async () => path.join(tempDir, "files"),
    path: { join: async (...parts: string[]) => path.join(...parts) },
    fs: { mkdir: async () => mkdirSync(path.join(tempDir, "backup"), { recursive: true }) },
  }));
  db = await getDatabase();
  sourceDB = await getSourceDatabase();
  archive = new Folder(inbox.account);
  archive.name = "Archive";
  archive.id = "Archive";
  let accountID = (await db.get(sql`SELECT accountID FROM folder WHERE id = ${inbox.dbID}`) as any).accountID;
  archive.dbID = (await db.run(sql`
    INSERT INTO folder (accountID, name, path) VALUES (${accountID}, ${"Archive"}, ${"Archive"})`)).lastInsertRowid;
  folders = [inbox, archive];
  hasIDCounter = !!await db.get(sql`SELECT name FROM sqlite_schema WHERE name = 'emailIDCounter'`);
});

/** Письмо на сервере — то, чему должна соответствовать строка базы */
interface Msg {
  n: number;
  messageID: string;
  /** Текущий pID; null — письмо без pID (ищется по Message-ID) */
  pID: string | null;
  /** Все pID, которые были у письма (после переноса — новый) */
  pIDs: Set<string>;
  folder: Folder;
  text: string;
  sender: string;
  attachments: string[];
  tagPool: string[];
  mime: Uint8Array;
}

/** Объект письма в памяти приложения. Может держать устаревший dbID. */
interface Obj {
  email: EMail;
  msg: Msg;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class Run {
  random: () => number;
  msgs: Msg[] = [];
  objs: Obj[] = [];
  byMessageID = new Map<string, Msg>();
  /** Номера строк, которые были в базе и исчезли */
  deletedIDs = new Set<number>();
  liveIDs = new Set<number>();
  log: string[] = [];
  pIDCounter = 0;

  constructor(readonly seed: number) {
    this.random = mulberry32(seed);
  }

  int(n: number) {
    return Math.floor(this.random() * n);
  }
  pick<T>(list: T[]): T | undefined {
    return list.length ? list[this.int(list.length)] : undefined;
  }
  chance(p: number) {
    return this.random() < p;
  }

  newPID(n: number): string {
    // Как ItemID Exchange: длинная строка
    return `AAMkAD-${this.seed}-${n}-${++this.pIDCounter}-` + "x".repeat(40);
  }

  newMsg(): Msg {
    let n = this.msgs.length + 1;
    let messageID = `m${n}.s${this.seed}@example.com`;
    let pID = this.chance(0.3) ? null : this.newPID(n);
    let text = `Текст письма ${n} (seed ${this.seed})`;
    let msg: Msg = {
      n, messageID, pID,
      pIDs: new Set(pID ? [pID] : []),
      folder: this.pick(folders) as Folder,
      text,
      sender: `sender${n}@example.com`,
      attachments: [`m${n}-a.pdf`, `m${n}-b.jpg`].slice(0, 1 + this.int(2)),
      tagPool: [`tag-${n}-a`, `tag-${n}-b`],
      mime: new TextEncoder().encode(
        `Message-ID: <${messageID}>\r\nFrom: ${`sender${n}@example.com`}\r\nSubject: s${n}\r\n\r\n${text}\r\n`),
    };
    this.msgs.push(msg);
    this.byMessageID.set(normalizeMessageID(messageID) as string, msg);
    return msg;
  }

  /** Объект, как его создаёт синхронизация: конверт или полное письмо */
  newObj(msg: Msg, full: boolean): Obj {
    let email = newTestEMail(msg.folder, msg.messageID);
    email.pID = msg.pID;
    email.subject = `s${msg.n}`;
    email.from = findOrCreatePersonUID(msg.sender, `Sender ${msg.n}`);
    email.contact = email.from;
    if (full) {
      email.text = msg.text;
      for (let filename of msg.attachments) {
        addTestAttachment(email, filename, `<${filename}>`);
      }
    }
    let obj = { email, msg };
    this.objs.push(obj);
    return obj;
  }

  async rowIDs(): Promise<number[]> {
    return (await db.all(sql`SELECT id FROM email`) as any[]).map(row => row.id);
  }

  /** Строки, чьи номера держат объекты */
  objsWithDBID(): Obj[] {
    return this.objs.filter(obj => !!obj.email.dbID);
  }

  async step() {
    let ops: [number, string, () => Promise<void>][] = [
      [5, "arrive", async () => {
        let msg = this.newMsg();
        await SQLEMail.save(this.newObj(msg, this.chance(0.6)).email);
      }],
      [2, "arriveBatch", async () => {
        let emails = [0, 1, 2].slice(0, 1 + this.int(3)).map(() => this.newObj(this.newMsg(), this.chance(0.5)).email);
        await SQLEMail.saveAll(emails);
      }],
      [3, "resync", async () => {
        // Синхронизация снова видит письмо и создаёт новый объект для него
        let msg = this.pick(this.msgs);
        if (msg) {
          await SQLEMail.save(this.newObj(msg, this.chance(0.5)).email);
        }
      }],
      [3, "delete", async () => {
        // Как EMail.deleteMessageLocally(): сначала строка, потом исходник
        let obj = this.pick(this.objsWithDBID());
        if (obj) {
          if (this.chance(0.5)) {
            await SQLEMail.deleteIt(obj.email);
          } else {
            await SQLEMail.deleteAll([obj.email]);
          }
          await new SQLSourceEMail().deleteIt(obj.email);
        }
      }],
      [4, "deleteElsewhere", async () => {
        // Строку удалил другой путь (другой объект, синхронизация удалений,
        // чистка дублей), а объекты в памяти держат её dbID
        let id = this.pick(await this.rowIDs());
        if (id != null) {
          await db.run(sql`DELETE FROM email WHERE id = ${id}`);
        }
      }],
      [2, "deleteLast", async () => {
        // Удаление письма с самым большим номером: раньше этот номер получало следующее
        let row = await db.get(sql`SELECT MAX(id) AS id FROM email`) as any;
        if (row?.id != null) {
          await db.run(sql`DELETE FROM email WHERE id = ${row.id}`);
        }
      }],
      [2, "moveOnServer", async () => {
        // Перенос на сервере: строка в старой папке удаляется, письмо приходит в новую с новым pID
        let obj = this.pick(this.objsWithDBID());
        if (!obj) {
          return;
        }
        let msg = obj.msg;
        await SQLEMail.deleteIt(obj.email);
        msg.folder = folders.find(f => f !== msg.folder) as Folder;
        if (msg.pID) {
          msg.pID = this.newPID(msg.n);
          msg.pIDs.add(msg.pID);
        }
        await SQLEMail.save(this.newObj(msg, this.chance(0.5)).email);
      }],
      [2, "moveLocally", async () => {
        // Перенос, сохранённый тем же объектом: новая папка и pID в той же строке
        let obj = this.pick(this.objsWithDBID());
        if (!obj) {
          return;
        }
        let msg = obj.msg;
        msg.folder = folders.find(f => f !== obj.email.folder) as Folder;
        obj.email.folder = msg.folder;
        if (msg.pID) {
          msg.pID = this.newPID(msg.n);
          msg.pIDs.add(msg.pID);
          obj.email.pID = msg.pID;
        }
        await SQLEMail.save(obj.email);
      }],
      [5, "flags", async () => {
        // Флажки и категории сохраняет любой объект, в том числе с устаревшим dbID
        let list = this.objsWithDBID();
        let chosen = [this.pick(list), this.pick(list)].filter(Boolean) as Obj[];
        if (!chosen.length) {
          return;
        }
        for (let obj of chosen) {
          obj.email.isRead = this.chance(0.5);
          obj.email.isStarred = this.chance(0.3);
          obj.email.tags.clear();
          for (let tagName of obj.msg.tagPool) {
            if (this.chance(0.5)) {
              obj.email.tags.add(getTagByName(tagName));
            }
          }
        }
        let how = this.int(3);
        if (how == 0) {
          await SQLEMail.saveWritableProps(chosen[0].email);
        } else if (how == 1) {
          await SQLEMail.saveTags(chosen[0].email);
        } else {
          await SQLEMail.saveWritablePropsAll(chosen.map(obj => obj.email));
        }
      }],
      [3, "downloadComplete", async () => {
        // Письмо загружено: объект (возможно, устаревший) сохраняет текст,
        // вложения, исходник MIME и downloadComplete
        let obj = this.pick(this.objs);
        if (!obj) {
          return;
        }
        let email = obj.email;
        email.text = obj.msg.text;
        email.attachments.clear();
        for (let filename of obj.msg.attachments) {
          addTestAttachment(email, filename, `<${filename}>`);
        }
        email.mime = obj.msg.mime;
        await SQLEMail.save(email);
        await new SQLSourceEMail().save(email);
        email.downloadComplete = true;
        await SQLEMail.saveWritableProps(email);
      }],
      [2, "saveSource", async () => {
        // Только исходник MIME — объектом, который мог устареть
        let obj = this.pick(this.objs);
        if (obj) {
          obj.email.mime = obj.msg.mime;
          await new SQLSourceEMail().save(obj.email);
        }
      }],
      [2, "dedupe", async () => {
        // Дубль письма без pID (как до BUG-203) и чистка дублей миграцией
        let obj = this.pick(this.objsWithDBID().filter(obj => obj.msg.pID == null));
        if (!obj) {
          return;
        }
        let newID = hasIDCounter ? sql`(SELECT value + 1 FROM emailIDCounter)` : sql`NULL`;
        await db.run(sql`
          INSERT INTO email (id, folderID, pID, messageID, dateSent, dateReceived, subject, plaintext, html, downloadComplete)
          SELECT $${newID}, folderID, pID, messageID, dateSent, dateReceived, subject, plaintext, html, downloadComplete
          FROM email WHERE id = ${obj.email.dbID}`);
        await db.execute(dedupeEMailsWithoutPID);
      }],
      [5, "open", async () => {
        // Пользователь открывает письмо: текст из базы и исходник из mail-backup.db
        let obj = this.pick(this.objsWithDBID());
        if (!obj) {
          return;
        }
        let email = obj.email;
        email.text = "";
        email.html = "";
        email.mime = null;
        await SQLEMail.readBody(email);
        if (email.dbID) {
          await new SQLSourceEMail().read(email);
        }
        let shownText = email.rawText;
        if (shownText) {
          this.assert(shownText == obj.msg.text,
            `письмо ${obj.msg.messageID} показало чужой текст: «${shownText}»`);
        }
        if (email.mime) {
          let inMIME = mimeMessageID(email.mime);
          this.assert(inMIME == normalizeMessageID(obj.msg.messageID),
            `письмо ${obj.msg.messageID} прочитало исходник письма ${inMIME}`);
        }
      }],
      [2, "reload", async () => {
        // Перезапуск: объект читается из строки базы
        let id = this.pick(await this.rowIDs());
        if (id == null) {
          return;
        }
        let row = await db.get(sql`SELECT messageID, folderID FROM email WHERE id = ${id}`) as any;
        let msg = this.byMessageID.get(normalizeMessageID(row.messageID) as string);
        let folder = folders.find(f => f.dbID == row.folderID) as Folder;
        if (msg && folder) {
          let email = await SQLEMail.read(id, folder.newEMail());
          this.objs.push({ email, msg });
        }
      }],
    ];
    let total = ops.reduce((sum, [weight]) => sum + weight, 0);
    let r = this.int(total);
    for (let [weight, name, run] of ops) {
      if (r < weight) {
        this.log.push(name);
        await run();
        return;
      }
      r -= weight;
    }
  }

  assert(ok: boolean, message: string) {
    if (!ok) {
      throw new Error(`seed ${this.seed}, шаг ${this.log.length} (${this.log.slice(-8).join(" → ")}): ${message}`);
    }
  }

  async checkInvariants() {
    // Номера удалённых строк не выдаются снова
    let ids = await this.rowIDs();
    let now = new Set(ids);
    for (let id of this.liveIDs) {
      if (!now.has(id)) {
        this.deletedIDs.add(id);
      }
    }
    for (let id of now) {
      this.assert(!this.deletedIDs.has(id), `номер удалённого письма ${id} выдан снова`);
    }
    this.liveIDs = now;

    // Каждая строка — одно письмо: текст, pID, вложения, категории, отправитель — его
    let rows = await db.all(sql`SELECT id, pID, messageID, plaintext FROM email`) as any[];
    for (let row of rows) {
      let msg = this.byMessageID.get(normalizeMessageID(row.messageID) as string);
      this.assert(!!msg, `строка ${row.id} с неизвестным Message-ID ${row.messageID}`);
      if (!msg) {
        continue;
      }
      if (row.pID != null) {
        this.assert(msg.pIDs.has(row.pID), `строка ${row.id} письма ${msg.messageID} с pID чужого письма`);
      }
      if (row.plaintext) {
        this.assert(row.plaintext == msg.text, `строка ${row.id} письма ${msg.messageID} с чужим текстом «${row.plaintext}»`);
      }
      let attachments = await db.all(sql`SELECT filename FROM emailAttachment WHERE emailID = ${row.id}`) as any[];
      for (let a of attachments) {
        this.assert(msg.attachments.includes(a.filename), `строка ${row.id} письма ${msg.messageID} с чужим вложением ${a.filename}`);
      }
      let tags = await db.all(sql`SELECT tagName FROM emailTag WHERE emailID = ${row.id}`) as any[];
      for (let tag of tags) {
        this.assert(msg.tagPool.includes(tag.tagName), `строка ${row.id} письма ${msg.messageID} с чужой категорией ${tag.tagName}`);
      }
      let senders = await db.all(sql`
        SELECT emailAddress FROM emailPersonRel
          JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id)
        WHERE emailID = ${row.id} AND recipientType = 1`) as any[];
      for (let sender of senders) {
        this.assert(sender.emailAddress == msg.sender, `строка ${row.id} письма ${msg.messageID} с чужим отправителем ${sender.emailAddress}`);
      }
    }

    // Общие инварианты — те же, что проверяет скрипт и запуск приложения
    let report = await checkMailIntegrity(db, sourceDB, { headersAfterID: -1 });
    this.assert(harmfulIssueCount(report) == 0,
      `нарушения целостности: ${JSON.stringify(Object.fromEntries(
        Object.entries(report.counts).filter(([key, count]) => count && key != "orphanSource")))} ` +
      JSON.stringify(report.examples));
  }
}

test("Случайные операции над базой писем не дают письмам чужой текст, вложения, категории и исходник", async () => {
  for (let seed = 1; seed <= kSeeds; seed++) {
    // Каждый прогон — с пустой базы: строки прошлых прогонов ему неизвестны
    await db.run(sql`DELETE FROM email`);
    await sourceDB.run(sql`DELETE FROM emailMIME`);
    let run = new Run(seed);
    for (let i = 0; i < kSteps; i++) {
      await run.step();
      await run.checkInvariants();
    }
  }
}, 120_000);

test("Проверка при запуске сбрасывает тело письма с чужим исходником и не трогает письма без Message-ID", async () => {
  let own = newTestEMail(inbox, "own.repair@example.com");
  own.text = "Свой текст";
  addTestAttachment(own, "own.pdf", "<own.pdf>");
  await SQLEMail.save(own);
  let foreign = newTestEMail(inbox, "victim.repair@example.com");
  foreign.text = "Чужой текст";
  addTestAttachment(foreign, "returns.xlsx", "<returns.xlsx>");
  await SQLEMail.save(foreign);
  await db.run(sql`UPDATE email SET downloadComplete = 1 WHERE id IN (${own.dbID}, ${foreign.dbID})`);
  let noID = newTestEMail(inbox, "");
  noID.pID = "no-message-id";
  noID.text = "Без Message-ID";
  await SQLEMail.save(noID);

  // Исходник пересохранён старым кодом под Message-ID своего письма, но внутри — чужое письмо
  let resaved = newTestEMail(inbox, "resaved.repair@example.com");
  resaved.text = "Текст чужого письма";
  await SQLEMail.save(resaved);
  await db.run(sql`UPDATE email SET downloadComplete = 1 WHERE id IN (${own.dbID}, ${foreign.dbID}, ${resaved.dbID})`);

  let mime = (id: string) => new TextEncoder().encode(
    `Received: from mx\r\nMessage-Id:\r\n <${id}>\r\nSubject: s\r\n\r\nbody\r\n` +
    // Пересланное письмо в теле: его Message-ID не считается
    `Message-ID: <forwarded@example.com>\r\n`);
  let insertSource = (emailID: any, column: string, header: string) => sourceDB.run(sql`
    INSERT OR REPLACE INTO emailMIME (emailID, messageID, mime) VALUES (${emailID}, ${column}, ${mime(header)})`);
  await insertSource(own.dbID, "own.repair@example.com", "own.repair@example.com");
  // Исходник удалённого письма под номером строки другого письма
  await insertSource(foreign.dbID, "<deleted.returns@example.com>", "deleted.returns@example.com");
  await insertSource(noID.dbID, "other@example.com", "other@example.com");
  let lastChecked = (await sourceDB.get(sql`SELECT MAX(id) AS id FROM emailMIME`) as any).id;
  await insertSource(resaved.dbID, "resaved.repair@example.com", "deleted.contract@example.com");

  // Только колонка — быстро, но пересохранённый исходник не виден
  expect((await findForeignSources(db, sourceDB)).emailIDs).toEqual([foreign.dbID]);
  // Заголовки только новых исходников — его видно
  let found = await findForeignSources(db, sourceDB, { headersAfterID: lastChecked });
  expect(found.emailIDs.sort()).toEqual([foreign.dbID, resaved.dbID].sort());
  expect(found.lastSourceID).toBeGreaterThan(lastChecked);

  let repaired = await repairForeignSources(db, sourceDB, { headersAfterID: -1 });
  expect(repaired.emailIDs.length).toBe(2);

  let ids = [own.dbID, foreign.dbID, noID.dbID, resaved.dbID];
  let rows = await db.all(sql`
    SELECT id, plaintext, downloadComplete FROM email WHERE id IN ${ids} ORDER BY id`) as any[];
  expect(rows).toEqual([
    { id: own.dbID, plaintext: "Свой текст", downloadComplete: 1 },
    { id: foreign.dbID, plaintext: null, downloadComplete: 0 },
    { id: noID.dbID, plaintext: "Без Message-ID", downloadComplete: 0 },
    { id: resaved.dbID, plaintext: null, downloadComplete: 0 },
  ]);
  expect(await db.all(sql`SELECT filename FROM emailAttachment WHERE emailID = ${foreign.dbID}`)).toEqual([]);
  expect(await db.all(sql`SELECT filename FROM emailAttachment WHERE emailID = ${own.dbID}`)).toEqual([{ filename: "own.pdf" }]);
  expect(await sourceDB.all(sql`SELECT emailID FROM emailMIME WHERE emailID IN ${ids} ORDER BY emailID`))
    .toEqual([{ emailID: own.dbID }, { emailID: noID.dbID }]);
  // Повторный запуск ничего не находит
  expect((await repairForeignSources(db, sourceDB, { headersAfterID: -1 })).emailIDs).toEqual([]);
});
