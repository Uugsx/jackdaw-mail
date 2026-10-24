// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { SQLSearchEMail } from "../../../../logic/Mail/SQL/SQLSearchEMail";
import {
  ServerMailSearch, ewsFindByQueryRequest, kMaxServerSearchFolders, kServerSearchFoldersPerPage,
  owaFindByQueryRequest, parseEWSFindByQuery, parseOWAFindByQuery, serverItemKey,
  serverSearchFolders, serverSearchProtocol,
} from "../../../../logic/Mail/Search/ServerMailSearch";
import { ArrayColl } from "svelte-collections";
import { describe, expect, test, vi } from "vitest";

const kNS = `xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;

function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

/** happy-dom не находит `m:ResponseMessages` по querySelector, поэтому пространство m — по умолчанию */
function ewsResponse(body: string): any {
  body = body.replace(/<(\/?)m:/g, "<$1").replace(` ${kNS}`, ` xmlns="http://schemas.microsoft.com/exchange/services/2006/messages" ${kNS}`);
  let account = new EWSAccount();
  let text = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</s:Body>
</s:Envelope>`;
  return account.checkResponse({ responseXML: account.parseXML(text) }, {} as any);
}

function findItemResponse(ids: string[], root: string): string {
  let items = ids.map(id => `<t:Message><t:ItemId Id="${id}" ChangeKey="ck"/></t:Message>`).join("");
  return `<m:FindItemResponse ${kNS}><m:ResponseMessages>
    <m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
      <m:RootFolder ${root}><t:Items>${items}</t:Items></m:RootFolder>
    </m:FindItemResponseMessage>
  </m:ResponseMessages></m:FindItemResponse>`;
}

function childNames(element: Element): string[] {
  return [...element.children].map(child => child.tagName);
}

interface FakeServer {
  /** ItemId писем в папке на сервере, новые сверху */
  ids: string[];
  /** Запросы FindItem: отступ и запрос */
  calls: Array<{ offset: number, query: string }>;
  fail?: boolean;
}

/** Ящик EWS с папками, где FindItem и GetItem отвечает «сервер» в памяти */
function fakeAccount(folders: Array<{ id: string, special?: SpecialFolder, server?: Partial<FakeServer> }>) {
  let account = new EWSAccount();
  account.id = "ews1";
  let servers = new Map<string, FakeServer>();
  let byID = new Map<string, EWSFolder>();
  for (let spec of folders) {
    let folder = account.newFolder() as EWSFolder;
    folder.id = spec.id;
    folder.name = spec.id;
    if (spec.special) {
      folder.specialFolder = spec.special;
    }
    account.rootFolders.add(folder);
    byID.set(spec.id, folder);
    let server: FakeServer = { ids: [], calls: [], ...spec.server };
    servers.set(spec.id, server);
    folder.getNewMessageHeaders = vi.fn(async (ids: Array<{ Id: string }>) => new ArrayColl(ids.map(({ Id }) => {
      let email = folder.newEMail();
      email.itemID = Id;
      email.subject = Id;
      email.received = new Date(Date.UTC(2026, 0, 1) + Number(Id.replace(/\D/g, "")) * 60_000);
      return email;
    }))) as any;
  }
  account.callEWS = vi.fn(async (request: any) => {
    let find = request.m$FindItem;
    let folderID = find.m$ParentFolderIds.t$FolderId.Id;
    let server = servers.get(folderID)!;
    let offset = find.m$IndexedPageItemView.Offset;
    let limit = find.m$IndexedPageItemView.MaxEntriesReturned;
    server.calls.push({ offset, query: find.m$QueryString });
    if (server.fail) {
      throw new Error("ErrorAccessDenied");
    }
    let page = server.ids.slice(offset, offset + limit);
    return {
      RootFolder: {
        IndexedPagingOffset: String(offset + page.length),
        TotalItemsInView: String(server.ids.length),
        IncludesLastItemInRange: String(offset + page.length >= server.ids.length),
        Items: { Message: page.map(Id => ({ ItemId: { Id } })) },
      },
    };
  }) as any;
  return { account, servers, folder: (id: string) => byID.get(id)! };
}

function ids(count: number, prefix: string): string[] {
  // Новые сверху: у первого письма самый большой номер
  return Array.from({ length: count }, (_, index) => `${prefix}${count - index}`);
}

describe("запрос FindItem с QueryString", () => {
  test("элементы в порядке схемы EWS, отступ и обход папки", () => {
    let xml = requestXML(ewsFindByQueryRequest("folder-1", "отчёт from:anna", 50, 25));
    let find = xml.getElementsByTagName("m:FindItem")[0];
    expect(find.getAttribute("Traversal")).toBe("Shallow");
    expect(childNames(find)).toEqual([
      "m:ItemShape", "m:IndexedPageItemView", "m:SortOrder", "m:ParentFolderIds", "m:QueryString",
    ]);
    let view = find.getElementsByTagName("m:IndexedPageItemView")[0];
    expect(view.getAttribute("Offset")).toBe("50");
    expect(view.getAttribute("MaxEntriesReturned")).toBe("25");
    expect(find.getElementsByTagName("t:FolderId")[0].getAttribute("Id")).toBe("folder-1");
    expect(find.getElementsByTagName("m:QueryString")[0].textContent).toBe("отчёт from:anna");
  });

  test("запрос экранирует служебные символы XML", () => {
    let text = new EWSAccount().request2XML(ewsFindByQueryRequest("f", `"a & b" <c>`, 0));
    expect(text).not.toContain("<c>");
    let xml = new DOMParser().parseFromString(text, "text/xml");
    expect(xml.getElementsByTagName("m:QueryString")[0].textContent).toBe(`"a & b" <c>`);
  });

  test("ответ сервера: ItemId и отступ следующей страницы", () => {
    let result = ewsResponse(findItemResponse(["a", "b"],
      `IndexedPagingOffset="27" TotalItemsInView="60" IncludesLastItemInRange="false"`));
    expect(parseEWSFindByQuery(result, 25)).toEqual({ ids: ["a", "b"], nextOffset: 27 });
  });

  test("последняя страница и пустой ответ — дальше не листаем", () => {
    let last = ewsResponse(findItemResponse(["a"],
      `IndexedPagingOffset="26" TotalItemsInView="26" IncludesLastItemInRange="true"`));
    expect(parseEWSFindByQuery(last, 25)).toEqual({ ids: ["a"], nextOffset: null });
    let empty = ewsResponse(findItemResponse([],
      `IndexedPagingOffset="0" TotalItemsInView="0" IncludesLastItemInRange="true"`));
    expect(parseEWSFindByQuery(empty, 0).nextOffset).toBeNull();
  });

  test("без IndexedPagingOffset отступ считается по числу писем", () => {
    expect(parseEWSFindByQuery({ RootFolder: { Items: { Message: [{ ItemId: { Id: "a" } }] } } }, 10))
      .toEqual({ ids: ["a"], nextOffset: 11 });
    // Отступ дошёл до числа писем в папке — дальше нечего
    expect(parseEWSFindByQuery({ RootFolder: { TotalItemsInView: "11", Items: { Message: { ItemId: { Id: "a" } } } } }, 10).nextOffset)
      .toBeNull();
  });
});

describe("OWA", () => {
  test("запрос с отступом страницы", async () => {
    let request: any = await owaFindByQueryRequest("owa-folder", "счёт", 75, 25);
    expect(request.Body.Paging.Offset).toBe(75);
    expect(request.Body.Paging.MaxEntriesReturned).toBe(25);
    expect(request.Body.QueryString).toBe("счёт");
  });

  test("ответ: ItemId строкой или объектом", () => {
    let result = {
      RootFolder: {
        IndexedPagingOffset: 2, TotalItemsInView: 5, IncludesLastItemInRange: false,
        Items: [{ ItemId: { Id: "x" } }, { ItemId: "y" }, {}],
      },
    };
    expect(parseOWAFindByQuery(result, 0)).toEqual({ ids: ["x", "y"], nextOffset: 2 });
    expect(parseOWAFindByQuery({ RootFolder: { ...result.RootFolder, IncludesLastItemInRange: true } }, 0).nextOffset)
      .toBeNull();
  });
});

describe("папки для поиска на сервере", () => {
  test("выбранная папка — только она", () => {
    let { account, folder } = fakeAccount([{ id: "inbox", special: SpecialFolder.Inbox }, { id: "work" }]);
    expect(serverSearchFolders(account, folder("work"))).toEqual([folder("work")]);
  });

  test("весь ящик: сначала «Входящие», «Отправленные», без «Исходящих»", () => {
    let { account, folder } = fakeAccount([
      { id: "work" },
      { id: "outbox", special: SpecialFolder.Outbox },
      { id: "sent", special: SpecialFolder.Sent },
      { id: "inbox", special: SpecialFolder.Inbox },
      { id: "trash", special: SpecialFolder.Trash },
    ]);
    expect(serverSearchFolders(account).map(f => f.id)).toEqual(["inbox", "sent", "work", "trash"]);
    expect(serverSearchFolders(account)).not.toContain(folder("outbox"));
  });

  test("не больше предела папок", () => {
    let { account } = fakeAccount(Array.from({ length: kMaxServerSearchFolders + 5 }, (_, i) => ({ id: `f${i}` })));
    expect(serverSearchFolders(account)).toHaveLength(kMaxServerSearchFolders);
  });

  test("протокол: EWS и OWA ищут на сервере, остальные — нет", () => {
    expect(serverSearchProtocol({ protocol: "ews" } as any)).toBe("ews");
    expect(serverSearchProtocol({ protocol: "owa" } as any)).toBe("owa");
    expect(serverSearchProtocol({ protocol: "imap" } as any)).toBeNull();
    expect(serverSearchProtocol(null)).toBeNull();
  });

  test("ящики без входа и не Exchange пропускаются", () => {
    let { account } = fakeAccount([{ id: "inbox", special: SpecialFolder.Inbox, server: { ids: ["m1"] } }]);
    Object.defineProperty(account, "isLoggedIn", { value: false });
    expect(ServerMailSearch.forAccounts([account, { protocol: "imap" } as any], "x").hasMore).toBe(false);
  });
});

describe("постраничный поиск на сервере", () => {
  test("страницы по 25 писем, пока сервер не скажет, что всё", async () => {
    let { account, servers, folder } = fakeAccount([{ id: "inbox", special: SpecialFolder.Inbox, server: { ids: ids(60, "m") } }]);
    Object.defineProperty(account, "isLoggedIn", { value: true });
    let search = ServerMailSearch.forAccounts([account], "  отчёт  ");
    let first = await search.nextPage();
    expect(first.map(email => email.itemID)).toEqual(ids(60, "m").slice(0, 25));
    expect(servers.get("inbox")!.calls).toEqual([{ offset: 0, query: "отчёт" }]);
    expect(search.hasMore).toBe(true);
    await search.nextPage();
    let third = await search.nextPage();
    expect(third).toHaveLength(10);
    expect(search.hasMore).toBe(false);
    expect(servers.get("inbox")!.calls.map(call => call.offset)).toEqual([0, 25, 50]);
    // Найденные письма попали в папку и сохранены через GetItem
    expect(folder("inbox").messages.length).toBe(60);
  });

  test("письмо, которое уже есть в папке, не загружается повторно", async () => {
    let { account, folder } = fakeAccount([{ id: "inbox", special: SpecialFolder.Inbox, server: { ids: ["m2", "m1"] } }]);
    let local = folder("inbox").newEMail();
    local.itemID = "m1";
    folder("inbox").messages.add(local);
    let search = new ServerMailSearch([folder("inbox")], "x");
    let found = await search.nextPage();
    expect(found).toContain(local);
    expect(found).toHaveLength(2);
    expect(folder("inbox").getNewMessageHeaders).toHaveBeenCalledWith([{ Id: "m2" }]);
    expect(folder("inbox").messages.length).toBe(2);
    void account;
  });

  test("ошибка одной папки не останавливает остальные и больше не повторяется", async () => {
    let { folder, servers } = fakeAccount([
      { id: "inbox", special: SpecialFolder.Inbox, server: { ids: ids(30, "a") } },
      { id: "secret", server: { ids: ["b1"], fail: true } },
    ]);
    let search = new ServerMailSearch([folder("inbox"), folder("secret")], "x");
    let first = await search.nextPage();
    expect(first).toHaveLength(25);
    expect(search.errors).toHaveLength(1);
    expect(search.hasMore).toBe(true);
    await search.nextPage();
    expect(servers.get("secret")!.calls).toHaveLength(1);
    expect(search.hasMore).toBe(false);
  });

  test("за страницу — не больше заданного числа папок, по порядку важности", async () => {
    let specs = Array.from({ length: kServerSearchFoldersPerPage + 3 }, (_, i) => ({ id: `f${i}`, server: { ids: [`m${i}`] } }));
    let { account, servers } = fakeAccount([...specs, { id: "inbox", special: SpecialFolder.Inbox, server: { ids: ["m100"] } }]);
    Object.defineProperty(account, "isLoggedIn", { value: true });
    let search = ServerMailSearch.forAccounts([account], "x");
    let first = await search.nextPage();
    expect(first).toHaveLength(kServerSearchFoldersPerPage);
    expect(servers.get("inbox")!.calls).toHaveLength(1);
    expect(search.hasMore).toBe(true);
    let second = await search.nextPage();
    expect(second).toHaveLength(4);
    expect(search.hasMore).toBe(false);
  });

  test("результаты страницы — новые сверху", async () => {
    let { folder } = fakeAccount([
      { id: "a", server: { ids: ["m1"] } },
      { id: "b", server: { ids: ["m9"] } },
    ]);
    let found = await new ServerMailSearch([folder("a"), folder("b")], "x").nextPage();
    expect(found.map(email => email.itemID)).toEqual(["m9", "m1"]);
  });

  test("пустой запрос не ищет", () => {
    let { folder } = fakeAccount([{ id: "a" }]);
    expect(new ServerMailSearch([folder("a")], "").hasMore).toBe(false);
  });
});

describe("результаты поиска", () => {
  test("ключ письма — ящик и ItemId", () => {
    let { folder } = fakeAccount([{ id: "a" }]);
    let email = folder("a").newEMail();
    email.itemID = "m1";
    expect(serverItemKey(email)).toBe("ews1|m1");
  });

  test("«Ещё с сервера» добавляет только новые письма", async () => {
    let { folder } = fakeAccount([{ id: "a" }]);
    let make = (id: string) => {
      let email = folder("a").newEMail();
      email.itemID = id;
      return email;
    };
    let local = make("m1");
    let results = new ArrayColl<EMail>([local]);
    let search = new SQLSearchEMail();
    let pages = [[make("m1"), make("m2")], [make("m2"), make("m3")]];
    search.serverSearch = { get hasMore() { return pages.length > 0; }, nextPage: async () => pages.shift(), errors: [] } as any;
    expect(search.hasMoreOnServer).toBe(true);
    expect(await search.loadMoreFromServer(results)).toBe(1);
    expect(await search.loadMoreFromServer(results)).toBe(1);
    expect(results.contents.map(email => (email as any).itemID)).toEqual(["m1", "m2", "m3"]);
    expect(results.contents[0]).toBe(local);
    expect(search.hasMoreOnServer).toBe(false);
    expect(await search.loadMoreFromServer(results)).toBe(0);
  });

  test("сервер участвует только в поиске по тексту", () => {
    let search = new SQLSearchEMail();
    search.bodyText = "отчёт";
    expect((search as any).isTextOnlySearch()).toBe(true);
    search.isRead = false;
    expect((search as any).isTextOnlySearch()).toBe(false);
    search.isRead = null;
    search.hasAttachmentMIMETypes.add("application/pdf");
    expect((search as any).isTextOnlySearch()).toBe(false);
  });
});
