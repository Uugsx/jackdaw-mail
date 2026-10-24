import { SearchEMail } from "../Store/SearchEMail";
import { SQLEMail } from "./SQLEMail";
import { getDatabase } from "./SQLDatabase";
import type { EMail } from "../EMail";
import { Folder } from "../Folder";
import { appGlobal } from "../../app";
import { backgroundError } from "../../../frontend/Util/error";
import { assert } from "../../util/util";
import { ArrayColl, MapColl } from "svelte-collections";
import sql, { type Query } from "../../../../lib/rs-sqlite";
import { gt } from "../../../l10n/l10n";
import { ServerMailSearch, serverItemKey } from "../Search/ServerMailSearch";
import { htmlMentionsAccount } from "../Mentions/Mentions";

export class SQLSearchEMail extends SearchEMail {
  /** Start a database search based on the critera set on this object */
  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let parseError = backgroundError;
    if (this.folder && this.account) {
      assert(this.account == this.folder.account, "Folder and account need to match");
    }
    if (this.hasAttachmentMIMETypes?.hasItems) {
      this.hasAttachment = true;
    }
    // TODO 1:n relations attachments and recipients

    // Search matching emails directly in the SQL database
    let query = sql`
      SELECT
        email.id as id, folderID
        $${this.mentionsMe === true ? sql`, email.html as html, email.outgoing as outgoing ` : sql``}
      FROM email
      $${this.account?.dbID ? sql` LEFT JOIN folder ON (email.folderID = folder.id) ` : sql``}
      $${this.includesPerson ? sql` LEFT JOIN emailPersonRel ON (email.id = emailPersonRel.emailID) LEFT JOIN emailPerson ON (emailPersonRel.emailPersonID = emailPerson.id) ` : sql``}
      $${this.hasAttachment === true || this.hasAttachment === false ? sql` LEFT JOIN emailAttachment ON (email.id = emailAttachment.emailID) ` : sql``}
      $${this.tags?.hasItems ? sql` LEFT JOIN emailTag ON (email.id = emailTag.emailID) ` : sql``}
      WHERE 1=1
        $${this.account?.dbID ? sql` AND accountID = ${this.account.dbID} ` : sql``}
        $${this.folder?.dbID ? sql` AND folderID = ${this.folder.dbID} ` : sql``}
        $${typeof (this.isOutgoing) == "boolean" ? sql` AND outgoing = ${this.isOutgoing ? 1 : 0} ` : sql``}
        $${typeof (this.isRead) == "boolean" ? sql` AND isRead = ${this.isRead ? 1 : 0} ` : sql``}
        $${typeof (this.isStarred) == "boolean" ? sql` AND isStarred = ${this.isStarred ? 1 : 0} ` : sql``}
        $${this.mentionsMe === true ? sql` AND email.html LIKE ${"%mailto:%"} ` : sql``}
        $${typeof (this.isReplied) == "boolean" ? sql` AND isReplied = ${this.isReplied ? 1 : 0} ` : sql``}
        $${typeof (this.isImportant) == "boolean" ? sql` AND isImportant = ${this.isImportant ? 1 : 0} ` : sql``}
        $${typeof (this.threadID) == "string" ? sql` AND threadID = ${this.threadID} ` : sql``}
        $${typeof (this.messageID) == "string" ? sql` AND messageID = ${this.messageID} ` : sql``}
        $${typeof (this.inReplyToOf) == "string" ? sql` AND parentMsgID = ${this.inReplyToOf} ` : sql``}
        $${this.sizeMin ? sql` AND size >= ${this.sizeMin} ` : sql``}
        $${this.sizeMax ? sql` AND size <= ${this.sizeMax} ` : sql``}
        $${this.includesPerson ? (this.includesPerson?.emailAddresses.hasItems ? sql` AND lower(emailPerson.emailAddress) IN ${this.includesPerson.emailAddresses.contents.map(c => c.value?.toLowerCase())} ` : sql` AND FALSE`) : sql``}
        $${this.hasAttachment === true ? sql` AND emailAttachment.disposition = 'attachment' ` : sql``}
        $${this.hasAttachment === false ? sql` AND emailAttachment.id IS NULL ` : sql``}
        $${this.hasAttachmentMIMETypes?.hasItems ? sql` AND emailAttachment.mimeType IN ${this.hasAttachmentMIMETypes.contents} ` : sql``}
        $${this.tags?.hasItems ? sql` AND emailTag.tagName IN ${this.tags.contents.map(tag => tag.name)} ` : sql``}
        $${this.bodyText ? textSearchClause(this.bodyText) : sql``}
      GROUP BY email.id
      $${this.tags?.hasItems && !this.tagsMatchAny
        ? sql` HAVING COUNT(DISTINCT emailTag.tagName) = ${this.tags.length} `
        : sql``}
      ORDER BY dateSent DESC
      $${limit ? sql` LIMIT ${limit} ` : sql``}
      `;
    //console.log("query string", queryString(query));
    let rows = await (await getDatabase()).all(query) as any;

    // Find existing email obj in `folder.messages`,
    // or create new temporary `EMail` objects for the results
    let cachedFolders = new MapColl<string | number, Folder>(); // dbID -> folder
    const findFolder = (dbID: number): Folder | null => {
      if (!dbID) {
        return null;
      }
      if (this.folder?.dbID == dbID) {
        return this.folder;
      }
      let cached = cachedFolders.get(dbID);
      if (cached) {
        return cached;
      }
      for (let account of appGlobal.emailAccounts) {
        for (let folder of account.getAllFolders()) {
          if (folder.dbID) {
            cachedFolders.set(folder.dbID, folder);
          }
        }
      }
      return cachedFolders.get(dbID) ?? null;
    }
    let randomFolder = this.folder ??
      this.account?.inbox ??
      appGlobal.emailAccounts.first?.inbox;
    assert(randomFolder, gt`Please set up a mail account first`);
    let emails = new ArrayColl<EMail>();
    /* Индекс писем папки по dbID: раньше на каждую найденную строку
     * перебиралась вся папка (тысячи результатов × десятки тысяч писем). */
    let messagesByFolder = new Map<Folder, Map<string, EMail>>();
    let findExisting = (folder: Folder | null, dbID: any): EMail | undefined => {
      if (!folder || dbID == null) {
        return undefined;
      }
      let byDbID = messagesByFolder.get(folder);
      if (!byDbID) {
        byDbID = new Map();
        for (let msg of folder.messages.contents) {
          let key = String(msg.dbID);
          if (msg.dbID != null && !byDbID.has(key)) {
            byDbID.set(key, msg);
          }
        }
        messagesByFolder.set(folder, byDbID);
      }
      return byDbID.get(String(dbID));
    };
    for (let row of rows) {
      let folder = findFolder(row.folderID);
      // Упоминания: ссылку на свой адрес проверяем по HTML из базы — тело письма в памяти может быть не загружено
      if (this.mentionsMe === true && (row.outgoing || !htmlMentionsAccount(row.html, (folder ?? randomFolder)?.account))) {
        continue;
      }
      let existing = findExisting(folder, row.id);
      if (existing) {
        emails.add(existing);
        continue;
      }
      let email = (folder ?? randomFolder).newEMail();
      try {
        await SQLEMail.read(row.id, email); // TODO: Get metadata with query above first, then the email contents?
        // Do *not* add this temp `email` object to `folder.messages`
      } catch (ex) {
        parseError(ex);
      }
      emails.add(email);
    }

    // EWS и OWA: первая страница поиска на сервере — письма, которых нет в локальной базе
    this.serverSearch = null;
    // Сервер ищет только по тексту: с другими условиями он вернул бы лишние письма
    if (this.bodyText?.trim() && this.isTextOnlySearch()) {
      try {
        await this.mergeServerSearch(emails, !this.deferServerSearch);
      } catch (ex) {
        parseError(ex);
      }
    }

    return emails;
  }

  /** Постраничный поиск на сервере после `startSearch()`; null — сервер не участвует */
  serverSearch: ServerMailSearch | null = null;

  get hasMoreOnServer(): boolean {
    return !!this.serverSearch?.hasMore;
  }

  get serverSearchErrors(): readonly unknown[] {
    return this.serverSearch?.errors ?? [];
  }

  async loadMoreFromServer(emails: ArrayColl<EMail>): Promise<number> {
    if (!this.serverSearch?.hasMore) {
      return 0;
    }
    return mergeNewResults(emails, await this.serverSearch.nextPage());
  }

  /** Кроме текста заданы только ящик и папка */
  protected isTextOnlySearch(): boolean {
    let ignored = ["bodyText", "accountID", "folderID", "tagsMatchAny"];
    return Object.entries(this.toJSON()).every(([key, value]) =>
      ignored.includes(key) || value == null || (Array.isArray(value) && !value.length));
  }

  protected async mergeServerSearch(emails: ArrayColl<EMail>, loadFirstPage = true): Promise<void> {
    let accounts = this.account
      ? [this.account]
      : appGlobal.emailAccounts.contents;
    let search = ServerMailSearch.forAccounts(accounts, this.bodyText!, this.folder);
    if (!search.hasMore) {
      return;
    }
    this.serverSearch = search;
    if (!loadFirstPage) {
      return;
    }
    mergeNewResults(emails, await search.nextPage());
    if (search.errors.length) {
      backgroundError(search.errors[0] as Error);
    }
  }
}

/** Добавляет письма с сервера, которых ещё нет в результатах (локальные найдены по тому же ItemId) */
function mergeNewResults(emails: ArrayColl<EMail>, found: EMail[]): number {
  let known = new Set(emails.contents.map(serverItemKey).filter(Boolean));
  let added = found.filter(email => {
    let key = serverItemKey(email);
    if (!key) {
      return !emails.contents.includes(email);
    }
    if (known.has(key)) {
      return false;
    }
    known.add(key);
    return true;
  });
  emails.addAll(added);
  return added.length;
}

/** For debugging, returns the rs-sql SQL query as a string */
function queryString(query: Query): string {
  let str = "";
  let params = query.parameters.slice();
  for (let sourcePart of query.sourceParts) {
    str += sourcePart.trim();
    str += params.shift() ?? "";
  }
  return str;
}

/**
 * SQLite LOWER()/NOCASE only folds ASCII A–Z, so Cyrillic (and other Unicode)
 * case variants never match. Build LIKE clauses for common case forms using JS.
 * Also search sender and HTML body so HTML-only messages are findable.
 */
function textSearchClause(term: string): Query {
  let variants = unicodeSearchVariants(term);
  if (!variants.length) {
    return sql``;
  }
  let combined: Query | null = null;
  for (let variant of variants) {
    let pattern = "%" + variant + "%";
    let part = sql`(
      subject LIKE ${pattern} OR
      ifnull(plaintext, '') LIKE ${pattern} OR
      ifnull(html, '') LIKE ${pattern} OR
      ifnull(contactName, '') LIKE ${pattern} OR
      ifnull(contactEmail, '') LIKE ${pattern}
    )`;
    combined = combined ? sql`$${combined} OR $${part}` : part;
  }
  return sql` AND ($${combined}) `;
}

/** lower / UPPER / Title case — covers typical mail subject capitalization */
export function unicodeSearchVariants(term: string): string[] {
  let trimmed = term?.trim();
  if (!trimmed) {
    return [];
  }
  let lower = trimmed.toLowerCase();
  let upper = trimmed.toUpperCase();
  let title = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([trimmed, lower, upper, title])];
}
