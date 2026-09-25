import sql, { type Database } from "../../../lib/rs-sqlite";
import {
  getConfiguredMailAddresses,
  mailAddressDomains,
  normalizeMailAddresses,
} from "./ResponseMessageAddresses";
import { getDatabase as getMailDatabase } from "../Mail/SQL/SQLDatabase";
import type { PendingResponseRequest } from "./ResponseReminder";

export const MAX_PENDING_RESPONSE_REQUESTS = 5_000;
const ignoredFolderKinds = [
  "sent",
  "drafts",
  "trash",
  "junk",
  "spam",
  "outbox",
  "all",
  "search",
];

export interface PendingResponseRequestOptions {
  /** Категории, которые не должны попадать в SLA-контроль. */
  excludedCategoryNames?: readonly string[];
  /** В режиме категорий нужно ли брать письма, которым ещё не назначили категорию. */
  includeUncategorized?: boolean;
  /** Адреса выбранного общего ящика, включая его алиасы. */
  mailboxAddress?: string | null;
  /** Дополнительные адреса личных ящиков сотрудников. */
  knownSenderAddresses?: readonly string[];
}

/**
 * Загружает текущие неотвеченные входящие письма для живого SLA-контроля.
 *
 * Запрос считается отвеченным, если почтовый сервер пометил его как отвеченный
 * или в базе найдено исходящее письмо, связанное через In-Reply-To либо
 * сохранённый идентификатор цепочки. Отправленное письмо может находиться в
 * личном ящике сотрудника или попасть в общий ящик копией, поэтому учитываются
 * также ответы известных адресов внутри домена общего ящика.
 *
 * `categoryNames === null` означает режим профиля: подходят все входящие
 * письма, если они не исключены настройками. Пустой массив означает режим
 * категорий без выбранных сотрудников. `folderId` ограничивает поиск
 * конкретной папкой; null включает все обычные папки выбранного ящика.
 */
export async function loadPendingResponseRequests(
  accountId: number,
  categoryNames: string[] | null,
  now = new Date(),
  database?: Database,
  folderId: number | null = null,
  options: PendingResponseRequestOptions = {},
): Promise<PendingResponseRequest[]> {
  if (
    !Number.isInteger(accountId) ||
    accountId <= 0 ||
    categoryNames?.length === 0
  ) {
    return [];
  }

  const db = database ?? (await getMailDatabase());
  const mailboxAddresses = normalizeMailAddresses([
    options.mailboxAddress,
    ...getConfiguredMailAddresses(accountId),
  ]);
  const knownSenderAddresses = normalizeMailAddresses([
    ...(options.knownSenderAddresses ?? []),
    ...getConfiguredMailAddresses(),
  ]);
  const mailboxDomains = mailAddressDomains(mailboxAddresses);
  const replyKnownSenderPredicate = knownSenderAddresses.length
    ? sql`LOWER(TRIM(COALESCE(reply.contactEmail, ''))) IN ${knownSenderAddresses}`
    : sql`0`;
  const replyDomainSenderPredicate = mailboxDomains.length
    ? sql`
      LOWER(SUBSTR(
        TRIM(COALESCE(reply.contactEmail, '')),
        INSTR(TRIM(COALESCE(reply.contactEmail, '')), '@') + 1
      )) IN ${mailboxDomains}`
    : sql`0`;
  const replyResponseCopyPredicate =
    mailboxAddresses.length &&
    (knownSenderAddresses.length || mailboxDomains.length)
      ? sql`
      (
        (
          $${replyKnownSenderPredicate} OR
          $${replyDomainSenderPredicate}
        )
        AND EXISTS (
          SELECT 1
          FROM emailPersonRel recipientRel
          JOIN emailPerson recipientPerson
            ON recipientPerson.id = recipientRel.emailPersonID
          WHERE recipientRel.emailID = reply.id
            AND recipientRel.recipientType IN (2, 3, 4)
            AND LOWER(TRIM(recipientPerson.emailAddress)) IN ${mailboxAddresses}
        )
        AND (
          (reply.parentMsgID IS NOT NULL AND TRIM(reply.parentMsgID) != '') OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 're:%' OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 'fw:%' OR
          LOWER(TRIM(COALESCE(reply.subject, ''))) LIKE 'fwd:%'
        )
      )`
      : sql`0`;
  // Каждое входящее письмо — отдельный SLA-запрос, включая Re/Fw-копии.
  const incomingMessagePredicate = sql`
    NOT (
      e.outgoing = 1 OR
      LOWER(COALESCE(f.specialUse, '')) IN ('sent', 'outbox')
    )`;
  const replyMessagePredicate = sql`
    (
      reply.outgoing = 1 OR
      LOWER(COALESCE(replyFolder.specialUse, '')) IN ('sent', 'outbox') OR
      $${replyResponseCopyPredicate}
    )`;
  const selectedCategoryPredicate = sql`
    EXISTS (
      SELECT 1
      FROM emailTag selectedTag
      WHERE selectedTag.emailID = e.id
        AND length(TRIM(selectedTag.tagName)) > 0
        AND TRIM(selectedTag.tagName) IN ${categoryNames ?? []}
    )`;
  const uncategorizedPredicate = sql`
    NOT EXISTS (
      SELECT 1
      FROM emailTag uncategorizedTag
      WHERE uncategorizedTag.emailID = e.id
        AND length(TRIM(uncategorizedTag.tagName)) > 0
    )`;
  const categoryPredicate =
    categoryNames == null
      ? sql``
      : options.includeUncategorized === true
        ? sql`
      AND (
        $${selectedCategoryPredicate}
        OR $${uncategorizedPredicate}
      )`
        : sql`
      AND $${selectedCategoryPredicate}`;
  const folderPredicate =
    Number.isInteger(folderId) && folderId > 0
      ? sql`AND e.folderID = ${folderId}`
      : sql``;
  const excludedCategoryNames = normalizeCategoryNames(
    options.excludedCategoryNames,
  );
  const excludedCategoryPredicate = excludedCategoryNames.length
    ? sql`
      AND NOT EXISTS (
        SELECT 1
        FROM emailTag excludedTag
        WHERE excludedTag.emailID = e.id
          AND length(TRIM(excludedTag.tagName)) > 0
          AND TRIM(excludedTag.tagName) IN ${excludedCategoryNames}
      )`
    : sql``;
  const rows = (await db.all(sql`
    SELECT
      e.id AS emailId,
      e.folderID AS folderId,
      e.messageID,
      e.threadID,
      e.subject,
      e.dateReceived,
      e.isRead
    FROM email e
    JOIN folder f ON f.id = e.folderID
    WHERE f.accountID = ${accountId}
      AND $${incomingMessagePredicate}
      AND COALESCE(e.isReplied, 0) != 1
      AND e.dateReceived IS NOT NULL
      AND e.dateReceived <= ${Math.floor(now.getTime() / 1000)}
      AND LOWER(COALESCE(f.specialUse, '')) NOT IN ${ignoredFolderKinds}
      $${folderPredicate}
      $${excludedCategoryPredicate}
      AND NOT EXISTS (
        SELECT 1
        FROM email reply
        JOIN folder replyFolder ON replyFolder.id = reply.folderID
        WHERE (
            $${replyMessagePredicate}
          )
          AND reply.id != e.id
          AND reply.dateSent >= e.dateReceived
          AND (
            (
              e.messageID IS NOT NULL AND
              TRIM(e.messageID) != '' AND
              reply.parentMsgID = e.messageID
            ) OR (
              e.threadID IS NOT NULL AND
              TRIM(e.threadID) != '' AND
              reply.threadID = e.threadID
            )
          )
      )
      $${categoryPredicate}
    ORDER BY e.dateReceived ASC, e.id ASC
    LIMIT ${MAX_PENDING_RESPONSE_REQUESTS}
    `)) as Record<string, unknown>[];

  if (!rows.length) {
    return [];
  }

  const emailIds = rows
    .map((row) => numberValue(row.emailId))
    .filter((id): id is number => id != null);
  const tagsByEmailId = new Map<number, string[]>();
  if (emailIds.length) {
    const tagRows = (await db.all(sql`
      SELECT emailID AS emailId, TRIM(tagName) AS name
      FROM emailTag
      WHERE emailID IN ${emailIds}
        AND length(TRIM(tagName)) > 0
      ORDER BY emailID, id
      `)) as Record<string, unknown>[];
    for (const row of tagRows) {
      const emailId = numberValue(row.emailId);
      const name = textValue(row.name);
      if (emailId == null || !name) {
        continue;
      }
      const names = tagsByEmailId.get(emailId) ?? [];
      if (!names.includes(name)) {
        names.push(name);
        tagsByEmailId.set(emailId, names);
      }
    }
  }

  return rows
    .map((row): PendingResponseRequest | null => {
      const emailId = numberValue(row.emailId);
      const folderId = numberValue(row.folderId);
      const receivedSeconds = numberValue(row.dateReceived);
      if (emailId == null || folderId == null || receivedSeconds == null) {
        return null;
      }
      return {
        accountId,
        folderId,
        emailId,
        messageID: optionalTextValue(row.messageID),
        threadID: optionalTextValue(row.threadID),
        subject: textValue(row.subject) || "(без темы)",
        receivedAt: new Date(receivedSeconds * 1000),
        categoryNames: tagsByEmailId.get(emailId) ?? [],
        isRead: booleanValue(row.isRead),
      };
    })
    .filter((request): request is PendingResponseRequest => request != null);
}

/** Возвращает категории входящих писем для настройки SLA выбранного ящика. */
export async function loadResponseTrackingCategoryNames(
  accountId: number,
  database?: Database,
): Promise<string[]> {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return [];
  }
  const db = database ?? (await getMailDatabase());
  const incomingMessagePredicate = sql`
    NOT (
      e.outgoing = 1 OR
      LOWER(COALESCE(f.specialUse, '')) IN ('sent', 'outbox')
    )`;
  const rows = (await db.all(sql`
    SELECT DISTINCT TRIM(tag.tagName) AS name
    FROM emailTag tag
    JOIN email e ON e.id = tag.emailID
    JOIN folder f ON f.id = e.folderID
    WHERE f.accountID = ${accountId}
      AND $${incomingMessagePredicate}
      AND LOWER(COALESCE(f.specialUse, '')) NOT IN ${ignoredFolderKinds}
      AND length(TRIM(tag.tagName)) > 0
    ORDER BY name COLLATE NOCASE
    `)) as Record<string, unknown>[];
  return rows.map((row) => textValue(row.name)).filter(Boolean);
}

function numberValue(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function textValue(value: unknown): string {
  return typeof value == "string" ? value.trim() : "";
}

function booleanValue(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

function optionalTextValue(value: unknown): string | null {
  const result = textValue(value);
  return result || null;
}

function normalizeCategoryNames(
  value: readonly string[] | undefined,
): string[] {
  return [
    ...new Set(
      (value ?? [])
        .filter((item): item is string => typeof item == "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
