import sql, { type Database } from "../../../../lib/rs-sqlite/index";
import { mimeMessageID, normalizeMessageID } from "./Source/mimeMessageID";

/*
 * Проверка целостности локальной базы писем: mail.db (`email` и дочерние
 * таблицы) и mail-backup.db (`emailMIME`, исходники по номеру строки письма).
 *
 * Без зависимостей приложения: используется при запуске приложения
 * (`repairForeignSources()`), в тестах и в скрипте `scripts/db-integrity-check.ts`
 * для копии реальной базы. См. docs/systems/mail-db-integrity.md
 */

/** Инварианты и их описание для отчёта */
export const kIntegrityInvariants = {
  /** Исходник под номером строки письма — от другого письма (Message-ID в колонке) */
  foreignSource: "исходник MIME принадлежит другому письму (колонка messageID)",
  /** То же по заголовку Message-ID самого исходника */
  foreignSourceHeader: "исходник MIME принадлежит другому письму (заголовок Message-ID)",
  /** Колонка messageID исходника не совпадает с его заголовком:
   * старый код пересохранял чужой исходник под Message-ID своего письма */
  sourceColumnMismatch: "колонка messageID исходника не совпадает с его заголовком",
  /** Исходник письма, строки которого уже нет. Безвреден, пока номера не переиспользуются */
  orphanSource: "исходник MIME без строки письма",
  orphanAttachment: "вложение без строки письма",
  orphanTag: "категория без строки письма",
  orphanRecipient: "получатель без строки письма",
  /** Одно письмо в папке сохранено несколько раз */
  duplicateRow: "несколько строк одного письма в папке",
  /** Счётчик номеров отстаёт или нет триггера: номера удалённых писем снова выдаются */
  idCounter: "счётчик номеров писем отстаёт или отсутствует",
} as const;

export type IntegrityInvariant = keyof typeof kIntegrityInvariants;

export interface IntegrityReport {
  emails: number;
  sources: number;
  /** Число нарушений каждого инварианта */
  counts: Record<IntegrityInvariant, number>;
  /** Несколько примеров каждого нарушения */
  examples: Record<IntegrityInvariant, any[]>;
}

export interface SourceScanOptions {
  /** Проверять заголовки исходников с `emailMIME.id` больше этого
   * (-1 — все). null — только колонку messageID: быстро. */
  headersAfterID?: number | null;
  /** Вызывается между пачками чтения заголовков: не занимать базу подряд */
  pause?: () => Promise<void>;
  /** Сколько исходников прочитано */
  onProgress?: (done: number) => void;
}

export interface IntegrityOptions extends SourceScanOptions {
  /** Сколько примеров сохранять на инвариант */
  exampleLimit?: number;
}

/** Номер строки письма → Message-ID (нормализованный, может быть null) */
type EMailMessageIDs = Map<number, string | null>;

interface SourceHeader {
  id: number;
  emailID: number;
  /** Колонка messageID */
  column: string | null;
  /** Заголовок Message-ID исходника */
  header: string | null;
}

const kChunkSize = 500;
/** Строк `emailMIME` без исходника за запрос */
const kSourceChunkSize = 2000;
const kDefaultExampleLimit = 5;
/** Сколько начала исходника читать в поиске заголовка Message-ID.
 * Исходники целиком в сумме — гигабайты; заголовки почти всегда короче. */
const kHeaderScanBytes = 16 * 1024;
/** Сколько символов строки заголовка передавать из базы */
const kHeaderLineLength = 1000;

async function readEMailMessageIDs(mailDB: Database): Promise<EMailMessageIDs> {
  let rows = await mailDB.all(sql`SELECT id, messageID FROM email`) as { id: number, messageID: string | null }[];
  return new Map(rows.map(row => [row.id, normalizeMessageID(row.messageID)]));
}

/** Строки `emailMIME` без самого исходника. Пачками по `id`: таблица
 * с исходниками — гигабайты, и один запрос надолго занял бы базу. */
async function readSourceMessageIDs(sourceDB: Database, pause?: () => Promise<void>): Promise<{ id: number, emailID: number, messageID: string | null }[]> {
  let result: { id: number, emailID: number, messageID: string | null }[] = [];
  let lastID = -1;
  while (true) {
    let rows = await sourceDB.all(sql`
      SELECT id, emailID, messageID
      FROM emailMIME
      WHERE id > ${lastID}
      ORDER BY id
      LIMIT ${kSourceChunkSize}
      `) as any[];
    if (!rows.length) {
      return result;
    }
    result.push(...rows);
    lastID = rows[rows.length - 1].id;
    await pause?.();
  }
}

/**
 * Заголовки Message-ID исходников пачками по возрастанию `emailMIME.id`.
 * Строку заголовка вырезает SQLite: из базы приходит ~1 КБ на исходник,
 * а не исходник целиком. `INSERT OR REPLACE` выдаёт исходнику новый `id`,
 * поэтому новые и пересохранённые исходники всегда идут после проверенных.
 */
async function scanSourceHeaders(sourceDB: Database, afterID: number,
    onBatch: (rows: SourceHeader[]) => void, options: SourceScanOptions = {}): Promise<number> {
  let lastID = afterID;
  let done = 0;
  while (true) {
    let rows = await sourceDB.all(sql`
      SELECT
        id, emailID, messageID,
        instr(head, ${"\n\r\n"}) AS crlfEnd,
        instr(head, ${"\n\n"}) AS lfEnd,
        instr(lower(head), ${"\nmessage-id:"}) AS idPos,
        substr(head, instr(lower(head), ${"\nmessage-id:"}) + 1, ${kHeaderLineLength}) AS idLine
      FROM (
        SELECT
          id, emailID, messageID,
          ${"\n"} || CAST(substr(mime, 1, ${kHeaderScanBytes}) AS TEXT) AS head
        FROM emailMIME
        WHERE id > ${lastID}
        ORDER BY id
        LIMIT ${kChunkSize}
      )
      `) as any[];
    if (!rows.length) {
      break;
    }
    onBatch(rows.map(row => {
      let headerEnd = Math.min(...[row.crlfEnd, row.lfEnd].filter(pos => pos > 0), Infinity);
      // Message-ID только в теле (пересланное письмо) не считается
      let inHeader = row.idPos > 0 && row.idPos < headerEnd;
      return {
        id: row.id,
        emailID: row.emailID,
        column: normalizeMessageID(row.messageID),
        header: inHeader ? mimeMessageID(row.idLine) : null,
      };
    }));
    lastID = rows[rows.length - 1].id;
    done += rows.length;
    options.onProgress?.(done);
    await options.pause?.();
  }
  return lastID;
}

export interface ForeignSources {
  /** Номера строк писем с чужим исходником */
  emailIDs: number[];
  /** `emailMIME.id` чужих исходников */
  sourceIDs: number[];
  /** Последний проверенный `emailMIME.id` по заголовкам (для следующей проверки) */
  lastSourceID: number;
}

/**
 * Исходники, которые лежат под номером строки другого письма: Message-ID
 * исходника (колонка или заголовок) и строки письма есть и разные.
 * Если сравнить нечем — не трогаем.
 */
export async function findForeignSources(mailDB: Database, sourceDB: Database, options: SourceScanOptions = {}): Promise<ForeignSources> {
  let emails = await readEMailMessageIDs(mailDB);
  /** `emailMIME.id` → номер строки письма */
  let foreign = new Map<number, number>();
  let lastSourceID = options.headersAfterID ?? -1;
  for (let source of await readSourceMessageIDs(sourceDB, options.pause)) {
    let own = emails.get(source.emailID);
    let inSource = normalizeMessageID(source.messageID);
    if (own && inSource && own != inSource) {
      foreign.set(source.id, source.emailID);
    }
  }
  if (options.headersAfterID != null) {
    lastSourceID = await scanSourceHeaders(sourceDB, options.headersAfterID, rows => {
      for (let row of rows) {
        let own = emails.get(row.emailID);
        if (own && row.header && own != row.header) {
          foreign.set(row.id, row.emailID);
        }
      }
    }, options);
  }
  return {
    emailIDs: [...new Set(foreign.values())],
    sourceIDs: [...foreign.keys()],
    lastSourceID,
  };
}

/**
 * Лечит письма с чужим исходником: удаляет исходник, сохранённый текст и
 * вложения и снимает `downloadComplete` — при открытии письмо загрузится с
 * сервера заново, в свою строку. Письма без Message-ID не трогает.
 * Исходники удаляются по своему `id`: исходник, который приложение успело
 * пересохранить во время проверки, остаётся.
 */
export async function repairForeignSources(mailDB: Database, sourceDB: Database, options: SourceScanOptions = {}): Promise<ForeignSources> {
  let found = await findForeignSources(mailDB, sourceDB, options);
  for (let batch of chunks(found.sourceIDs)) {
    await sourceDB.run(sql`
      DELETE FROM emailMIME
      WHERE id IN ${batch}
      `);
  }
  for (let batch of chunks(found.emailIDs)) {
    await mailDB.run(sql`
      DELETE FROM emailAttachment
      WHERE emailID IN ${batch}
      `);
    await mailDB.run(sql`
      UPDATE email SET
        plaintext = NULL,
        html = NULL,
        downloadComplete = 0
      WHERE id IN ${batch}
      `);
  }
  return found;
}

/** Проверяет все инварианты. Только читает базы. */
export async function checkMailIntegrity(mailDB: Database, sourceDB: Database | null, options: IntegrityOptions = {}): Promise<IntegrityReport> {
  let exampleLimit = options.exampleLimit ?? kDefaultExampleLimit;
  let counts = {} as Record<IntegrityInvariant, number>;
  let examples = {} as Record<IntegrityInvariant, any[]>;
  for (let invariant of Object.keys(kIntegrityInvariants) as IntegrityInvariant[]) {
    counts[invariant] = 0;
    examples[invariant] = [];
  }
  function add(invariant: IntegrityInvariant, example: any) {
    counts[invariant]++;
    if (examples[invariant].length < exampleLimit) {
      examples[invariant].push(example);
    }
  }

  let emails = await readEMailMessageIDs(mailDB);

  for (let [invariant, query] of [
    ["orphanAttachment", sql`SELECT emailID FROM emailAttachment WHERE emailID NOT IN (SELECT id FROM email)`],
    ["orphanTag", sql`SELECT emailID FROM emailTag WHERE emailID NOT IN (SELECT id FROM email)`],
    ["orphanRecipient", sql`SELECT emailID FROM emailPersonRel WHERE emailID NOT IN (SELECT id FROM email)`],
  ] as const) {
    for (let row of await mailDB.all(query) as { emailID: number }[]) {
      add(invariant, { emailID: row.emailID });
    }
  }

  let duplicates = await mailDB.all(sql`
    SELECT folderID, pID, messageID, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM email
    WHERE pID IS NOT NULL
    GROUP BY folderID, pID
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT folderID, pID, messageID, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
    FROM email
    WHERE pID IS NULL AND messageID IS NOT NULL AND messageID != ''
    GROUP BY folderID, messageID
    HAVING COUNT(*) > 1
    `) as any[];
  for (let row of duplicates) {
    add("duplicateRow", row);
  }

  await checkIDCounter(mailDB, add);

  let sources = 0;
  if (sourceDB) {
    let sourceRows = await readSourceMessageIDs(sourceDB);
    sources = sourceRows.length;
    for (let source of sourceRows) {
      if (!emails.has(source.emailID)) {
        add("orphanSource", { emailID: source.emailID, messageID: source.messageID });
        continue;
      }
      let own = emails.get(source.emailID);
      let inSource = normalizeMessageID(source.messageID);
      if (own && inSource && own != inSource) {
        add("foreignSource", { emailID: source.emailID, email: own, source: inSource });
      }
    }
    if (options.headersAfterID != null) {
      await scanSourceHeaders(sourceDB, options.headersAfterID, rows => {
        for (let row of rows) {
          if (row.header && row.column && row.header != row.column) {
            add("sourceColumnMismatch", { emailID: row.emailID, column: row.column, header: row.header });
          }
          let own = emails.get(row.emailID);
          if (own && row.header && own != row.header) {
            add("foreignSourceHeader", { emailID: row.emailID, email: own, source: row.header });
          }
        }
      }, options);
    }
  }

  return { emails: emails.size, sources, counts, examples };
}

async function checkIDCounter(mailDB: Database, add: (invariant: IntegrityInvariant, example: any) => void) {
  let table = await mailDB.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'emailIDCounter'
    `);
  let trigger = await mailDB.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name = 'emailIDCounterAfterInsert'
    `);
  let maxID = (await mailDB.get(sql`SELECT MAX(id) AS maxID FROM email`) as any)?.maxID ?? 0;
  if (!table || !trigger) {
    add("idCounter", { table: !!table, trigger: !!trigger, maxID });
    return;
  }
  let counter = (await mailDB.get(sql`SELECT MAX(value) AS value FROM emailIDCounter`) as any)?.value;
  if (counter == null || counter < maxID) {
    add("idCounter", { counter, maxID });
  }
}

/** Сумма нарушений, которые портят письма (без безвредных висячих исходников) */
export function harmfulIssueCount(report: IntegrityReport): number {
  return (Object.keys(report.counts) as IntegrityInvariant[])
    .filter(invariant => invariant != "orphanSource")
    .reduce((sum, invariant) => sum + report.counts[invariant], 0);
}

function chunks<Type>(list: Type[], size = kChunkSize): Type[][] {
  let result: Type[][] = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}
