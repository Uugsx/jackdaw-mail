import type { EMail } from "../EMail";
import type { Folder } from "../Folder";
import { SpecialFolder } from "../Folder";
import type { MailAccount } from "../MailAccount";
import { ensureArray } from "../../util/util";

/**
 * Поиск на сервере Exchange (EWS и OWA), как в Outlook: «больше результатов
 * с сервера». FindItem с QueryString (AQS) по каждой папке ящика —
 * глубокий обход FindItem для обычных папок Exchange не поддерживает.
 * Выдача постраничная: у каждой папки свой отступ; страница — до
 * `kServerSearchFoldersPerPage` папок, где результаты не кончились,
 * в порядке важности (сначала «Входящие», «Отправленные»…).
 * Найденные письма, которых нет в локальной базе, загружаются и сохраняются.
 */

/** Писем с одной папки за страницу */
export const kServerSearchPageSize = 25;
/** Больше папок одного ящика не обходим: остальное — через выбор папки */
export const kMaxServerSearchFolders = 150;
/** Папок за одну страницу: первая страница не ждёт обхода всего ящика */
export const kServerSearchFoldersPerPage = 8;
/** Запросов к серверу одновременно */
const kParallelFolders = 4;

/** Порядок обхода: сначала папки, где обычно ищут */
const kFolderPriority: SpecialFolder[] = [
  SpecialFolder.Inbox, SpecialFolder.Sent, SpecialFolder.Archive, SpecialFolder.Drafts,
];

export type ServerSearchProtocol = "ews" | "owa";

export interface ServerSearchPage {
  /** ItemId найденных писем по порядку */
  ids: string[];
  /** Отступ следующей страницы; null — результаты в папке кончились */
  nextOffset: number | null;
}

/** Протокол серверного поиска ящика; null — сервер не ищет (IMAP, JMAP…) */
export function serverSearchProtocol(account: MailAccount | null | undefined): ServerSearchProtocol | null {
  let protocol = account?.protocol;
  return protocol == "ews" ? "ews" : protocol == "owa" ? "owa" : null;
}

// ---------- EWS ----------

export function ewsFindByQueryRequest(folderID: string, queryString: string, offset: number, limit = kServerSearchPageSize): any {
  // Порядок элементов задан схемой EWS: ItemShape, IndexedPageItemView, SortOrder, ParentFolderIds, QueryString
  return {
    m$FindItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
      },
      m$IndexedPageItemView: {
        MaxEntriesReturned: limit,
        BasePoint: "Beginning",
        Offset: offset,
      },
      m$SortOrder: {
        t$FieldOrder: {
          Order: "Descending",
          t$FieldURI: {
            FieldURI: "item:DateTimeReceived",
          },
        },
      },
      m$ParentFolderIds: {
        t$FolderId: {
          Id: folderID,
        },
      },
      m$QueryString: queryString,
      Traversal: "Shallow",
    },
  };
}

export function parseEWSFindByQuery(result: any, offset: number): ServerSearchPage {
  let root = result?.RootFolder;
  let items = root?.Items && typeof root.Items == "object"
    ? Object.values(root.Items).flatMap(value => ensureArray(value as any))
    : [];
  let ids = items
    .map((item: any) => item?.ItemId?.Id)
    .filter((id: unknown): id is string => typeof id == "string" && !!id);
  return { ids, nextOffset: nextOffset(root, offset, ids.length) };
}

// ---------- OWA ----------

/** Запрос OWA подгружается по требованию: модули OWA тянут классы писем, а поиск грузится раньше */
export async function owaFindByQueryRequest(folderID: string, queryString: string, offset: number, limit = kServerSearchPageSize) {
  const { owaFindMsgsByQueryRequest } = await import("../OWA/Request/OWAFolderRequests");
  let request = owaFindMsgsByQueryRequest(folderID, queryString, limit);
  (request as any).Body.Paging.Offset = offset;
  return request;
}

export function parseOWAFindByQuery(result: any, offset: number): ServerSearchPage {
  let root = result?.RootFolder;
  let ids = ensureArray(root?.Items)
    .map((item: any) => item?.ItemId?.Id ?? item?.ItemId)
    .filter((id: unknown): id is string => typeof id == "string" && !!id);
  return { ids, nextOffset: nextOffset(root, offset, ids.length) };
}

/** Общее для EWS и OWA: IncludesLastItemInRange, IndexedPagingOffset, TotalItemsInView */
function nextOffset(root: any, offset: number, count: number): number | null {
  if (!root || !count) {
    return null;
  }
  let last = root.IncludesLastItemInRange;
  if (last === true || String(last) == "true") {
    return null;
  }
  let next = Number(root.IndexedPagingOffset);
  if (!Number.isFinite(next) || next <= offset) {
    next = offset + count;
  }
  let total = Number(root.TotalItemsInView);
  if (Number.isFinite(total) && total > 0 && next >= total) {
    return null;
  }
  return next;
}

// ---------- Папки ----------

/** Папки для серверного поиска: выбранная или все папки писем ящика, кроме «Исходящих» */
export function serverSearchFolders(account: MailAccount, folder?: Folder | null): Folder[] {
  if (folder) {
    return folder.id ? [folder] : [];
  }
  let folders = [...account.getAllFolders()]
    .filter(candidate => !!candidate.id && candidate.specialFolder != SpecialFolder.Outbox);
  return folders
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => folderRank(a.candidate) - folderRank(b.candidate) || a.index - b.index)
    .map(entry => entry.candidate)
    .slice(0, kMaxServerSearchFolders);
}

function folderRank(folder: Folder): number {
  let index = kFolderPriority.indexOf(folder.specialFolder);
  return index < 0 ? kFolderPriority.length : index;
}

type SearchableFolder = Folder & {
  getEmailByItemID(id: string): EMail | undefined;
  getNewMessageHeaders(ids: any[]): Promise<Iterable<EMail>>;
};

/** Одна страница поиска в папке; новые письма загружаются, сохраняются и попадают в папку */
async function searchFolderPage(folder: Folder, queryString: string, offset: number): Promise<{ emails: EMail[], nextOffset: number | null }> {
  let account = folder.account as any;
  let protocol = serverSearchProtocol(folder.account);
  let page: ServerSearchPage;
  if (protocol == "ews") {
    page = parseEWSFindByQuery(await account.callEWS(ewsFindByQueryRequest(folder.id, queryString, offset)), offset);
  } else if (protocol == "owa") {
    page = parseOWAFindByQuery(await account.callOWA(await owaFindByQueryRequest(folder.id, queryString, offset)), offset);
  } else {
    return { emails: [], nextOffset: null };
  }
  let searchable = folder as SearchableFolder;
  let emails: EMail[] = [];
  let missing: string[] = [];
  for (let id of page.ids) {
    let existing = searchable.getEmailByItemID(id);
    if (existing) {
      emails.push(existing);
    } else {
      missing.push(id);
    }
  }
  if (missing.length) {
    // EWS ждёт ItemId-объекты, OWA — строки
    let request = protocol == "ews" ? missing.map(Id => ({ Id })) : missing;
    let loaded = [...await searchable.getNewMessageHeaders(request)]
      .filter(email => !searchable.getEmailByItemID((email as any).itemID));
    // В папку: иначе следующая синхронизация создала бы второй объект того же письма
    folder.messages.addAll(loaded);
    emails.push(...loaded);
  }
  return { emails, nextOffset: page.nextOffset };
}

// ---------- Сеанс поиска ----------

interface FolderCursor {
  folder: Folder;
  offset: number | null;
}

/**
 * Постраничный поиск на сервере по нескольким папкам и ящикам.
 * Ошибка одной папки не останавливает остальные: её отдаёт `errors`.
 */
export class ServerMailSearch {
  protected cursors: FolderCursor[];
  readonly errors: unknown[] = [];

  constructor(folders: Folder[], readonly queryString: string) {
    this.cursors = folders.map(folder => ({ folder, offset: 0 }));
  }

  /** Для всех подходящих ящиков (или одного), в выбранной папке или во всех */
  static forAccounts(accounts: Iterable<MailAccount>, queryString: string, folder?: Folder | null): ServerMailSearch {
    let folders: Folder[] = [];
    for (let account of accounts) {
      if (!serverSearchProtocol(account) || !(account as any).isLoggedIn) {
        continue;
      }
      if (folder && folder.account != account) {
        continue;
      }
      folders.push(...serverSearchFolders(account, folder));
    }
    // Несколько ящиков: сначала «Входящие» всех ящиков, потом «Отправленные»…
    let ranked = folders
      .map((candidate, index) => ({ candidate, index, rank: folderRank(candidate) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(entry => entry.candidate);
    return new ServerMailSearch(ranked, queryString.trim());
  }

  get hasMore(): boolean {
    return !!this.queryString && this.cursors.some(cursor => cursor.offset != null);
  }

  /** Следующая страница: до `foldersPerPage` папок, письма — новые сверху */
  async nextPage(foldersPerPage = kServerSearchFoldersPerPage): Promise<EMail[]> {
    let pending = this.cursors
      .filter(cursor => cursor.offset != null)
      .slice(0, Math.max(1, foldersPerPage));
    let found: EMail[] = [];
    let next = 0;
    let worker = async () => {
      while (next < pending.length) {
        let cursor = pending[next++];
        try {
          let page = await searchFolderPage(cursor.folder, this.queryString, cursor.offset!);
          cursor.offset = page.nextOffset;
          found.push(...page.emails);
        } catch (ex) {
          // Папку больше не спрашиваем: повторять одну и ту же ошибку на каждой странице незачем
          cursor.offset = null;
          this.errors.push(ex);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(kParallelFolders, pending.length) }, worker));
    return found.sort((a, b) => (b.received?.getTime() ?? 0) - (a.received?.getTime() ?? 0));
  }
}

/** Ключ для сравнения писем из локальной базы и с сервера */
export function serverItemKey(email: EMail): string | null {
  let id = (email as any).itemID ?? email.pID;
  return id ? `${email.folder?.account?.id ?? ""}|${id}` : null;
}
