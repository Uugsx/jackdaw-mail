import sql, { type Database } from "../../../../lib/rs-sqlite";

// <copied from="createDatabase.ts">
export const createFolderIDDateSentIndex = sql`
  CREATE INDEX IF NOT EXISTS index_email_folderID_dateSent
  ON email (folderID, dateSent DESC);
`;

/** Индексы для проверки отправленного ответа на входящий запрос. */
export const createReportReplyIndexes = sql`
  CREATE INDEX IF NOT EXISTS index_email_parentMsgID_outgoing_dateSent
  ON email (parentMsgID, outgoing, dateSent);
  CREATE INDEX IF NOT EXISTS index_email_threadID_outgoing_dateSent
  ON email (threadID, outgoing, dateSent);
`;

/** Индекс для частого поиска входящих писем, ожидающих ответа. */
export const createResponseReminderIndexes = sql`
  CREATE INDEX IF NOT EXISTS index_email_folderID_outgoing_dateReceived
  ON email (folderID, outgoing, dateReceived);
`;

/**
 * Совместимость с базами, открытыми первой сборкой отчётов: там следующая
 * старая миграция увеличила user_version до применения этих индексов.
 */
export async function repairReportReplyIndexes(
  database: Database,
): Promise<void> {
  database.execute(createReportReplyIndexes);
}

/** Откат createReportReplyIndexes для инструментов обслуживания базы. */
export const rollbackReportReplyIndexes = sql`
  DROP INDEX IF EXISTS index_email_parentMsgID_outgoing_dateSent;
  DROP INDEX IF EXISTS index_email_threadID_outgoing_dateSent;
`;

/** Откат индекса поиска писем для напоминаний. */
export const rollbackResponseReminderIndexes = sql`
  DROP INDEX IF EXISTS index_email_folderID_outgoing_dateReceived;
`;

/** Add the message status columns to a pre-existing mail.db.
 * Pattern: read source-of-truth via `table_info`, create on miss. */
export async function addEMailStatusColumns(database: Database): Promise<void> {
  let columns = (await database.all(sql`PRAGMA table_info("email")`)) as any[];
  if (!columns.some((column) => column.name == "isForwarded")) {
    await database.execute(
      sql`ALTER TABLE email ADD COLUMN "isForwarded" BOOLEAN default false;`,
    );
  }
  if (!columns.some((column) => column.name == "isImportant")) {
    await database.execute(
      sql`ALTER TABLE email ADD COLUMN "isImportant" BOOLEAN default false;`,
    );
  }
}

/**
 * BUG-202: имя в `emailPerson` хранится как '' вместо NULL, а накопленные
 * дубли адреса объединяются в строку с наименьшим id.
 *
 * С NULL ни поиск `name = ?`, ни `UNIQUE("emailAddress", "name")` не
 * находили уже сохранённый адрес, и каждое письмо добавляло новую строку.
 * Ссылки `emailPersonRel` переводятся на оставшуюся строку до удаления дублей;
 * `personID` берётся у дубля, если у оставшейся строки его не было.
 * Строки без адреса не трогаются: их нельзя сопоставить.
 */
export async function dedupeEMailPersons(database: Database): Promise<void> {
  await database.execute(sql`
    DROP TABLE IF EXISTS temp."emailPersonDuplicate";
    CREATE TEMP TABLE "emailPersonDuplicate" (
      "id" INTEGER PRIMARY KEY,
      "canonicalID" INTEGER not null
    );
    INSERT INTO temp."emailPersonDuplicate" ("id", "canonicalID")
      SELECT person.id, canonical.id
      FROM emailPerson person
      JOIN (
        SELECT emailAddress, COALESCE(name, '') AS name, MIN(id) AS id
        FROM emailPerson
        WHERE emailAddress IS NOT NULL
        GROUP BY emailAddress, COALESCE(name, '')
      ) canonical
        ON canonical.emailAddress = person.emailAddress
        AND canonical.name = COALESCE(person.name, '')
      WHERE person.id != canonical.id;
    CREATE INDEX temp."index_emailPersonDuplicate_canonicalID"
      ON "emailPersonDuplicate" ("canonicalID");

    UPDATE emailPerson SET
      personID = (
        SELECT MAX(duplicate.personID)
        FROM temp."emailPersonDuplicate" map
          JOIN emailPerson duplicate ON (duplicate.id = map.id)
        WHERE map.canonicalID = emailPerson.id
      )
    WHERE personID IS NULL
      AND id IN (SELECT canonicalID FROM temp."emailPersonDuplicate");

    UPDATE emailPersonRel SET
      emailPersonID = (
        SELECT canonicalID
        FROM temp."emailPersonDuplicate" map
        WHERE map.id = emailPersonRel.emailPersonID
      )
    WHERE emailPersonID IN (SELECT id FROM temp."emailPersonDuplicate");

    DELETE FROM emailPerson
    WHERE id IN (SELECT id FROM temp."emailPersonDuplicate");

    UPDATE emailPerson SET name = '' WHERE name IS NULL;

    DROP TABLE temp."emailPersonDuplicate";
  `);
}

/**
 * Откат dedupeEMailPersons: возвращает прежнее хранение пустого имени как NULL,
 * с которым работает старый код. Объединённые дубли не восстанавливаются:
 * они повторяли адрес и имя оставшейся строки и своих данных не несли.
 */
export const rollbackDedupeEMailPersons = sql`
  UPDATE emailPerson SET name = NULL WHERE name = '';
`;

/** Индекс поиска сохранённого письма по pID в папке (`SQLEMail.save()`,
 * в том числе ветка `pID IS NULL` из BUG-203). */
export const createEMailFolderIDPIDIndex = sql`
  CREATE INDEX IF NOT EXISTS index_email_folderID_pID
  ON email (folderID, pID);
`;

/** Откат createEMailFolderIDPIDIndex. */
export const rollbackEMailFolderIDPIDIndex = sql`
  DROP INDEX IF EXISTS index_email_folderID_pID;
`;

/**
 * BUG-203: письма без pID из-за условия `pID = NULL` (всегда ложного)
 * при каждом сохранении вставлялись заново. Оставляем одну строку на
 * (папка, Message-ID): полностью загруженную, а среди равных — последнюю.
 * Письма без Message-ID не трогаются: их нельзя сопоставить.
 *
 * Миграции идут с `foreign_keys = false`, поэтому получателей, вложения
 * и метки дублей удаляем явно, а не каскадом.
 *
 * Отката нет: удалённые строки были копиями оставшейся, и старый код
 * работает с базой без них так же. Откат индекса — rollbackEMailFolderIDPIDIndex.
 */
export const dedupeEMailsWithoutPID = sql`
  DROP TABLE IF EXISTS temp."emailDuplicate";
  CREATE TEMP TABLE "emailDuplicate" ("id" INTEGER PRIMARY KEY);
  INSERT INTO temp."emailDuplicate" ("id")
    SELECT id FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY folderID, messageID
          ORDER BY downloadComplete DESC, id DESC
        ) AS rowNumber
      FROM email
      WHERE pID IS NULL
        AND messageID IS NOT NULL
        AND messageID != ''
    )
    WHERE rowNumber > 1;

  DELETE FROM emailPersonRel WHERE emailID IN (SELECT id FROM temp."emailDuplicate");
  DELETE FROM emailAttachment WHERE emailID IN (SELECT id FROM temp."emailDuplicate");
  DELETE FROM emailTag WHERE emailID IN (SELECT id FROM temp."emailDuplicate");
  DELETE FROM email WHERE id IN (SELECT id FROM temp."emailDuplicate");

  DROP TABLE temp."emailDuplicate";
`;
