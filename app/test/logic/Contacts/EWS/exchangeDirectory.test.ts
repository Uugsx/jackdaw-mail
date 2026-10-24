// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import {
  ExchangeDirectory, ewsExpandDLRequest, ewsResolveDirectoryRequest, findDirectoryAccount, kDirectoryCacheMS,
  mailboxKind, owaExpandDLRequest, owaResolveDirectoryRequest, parseDirectoryInfo, parseExpandDL,
} from "../../../../logic/Contacts/EWS/ExchangeDirectory";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { describe, expect, test, vi } from "vitest";

/** happy-dom теряет пространства имён у `createDocument()`, поэтому ищем по префиксам `m:` и `t:` */
function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

function ewsResponse(body: string): any {
  let account = new EWSAccount();
  let text = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</s:Body>
</s:Envelope>`;
  return account.checkResponse({ responseXML: account.parseXML(text) }, {} as any);
}

const kNS = `xmlns="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;

describe("EWS: запросы", () => {
  test("ExpandDL с адресом рассылки", () => {
    let xml = requestXML(ewsExpandDLRequest("all@example.com"));
    let mailbox = xml.getElementsByTagName("m:ExpandDL")[0].getElementsByTagName("m:Mailbox")[0];
    expect(mailbox.getElementsByTagName("t:EmailAddress")[0].textContent).toBe("all@example.com");
  });

  test("ResolveNames: точный адрес, все свойства, только каталог", () => {
    let xml = requestXML(ewsResolveDirectoryRequest("anna@example.com"));
    let resolve = xml.getElementsByTagName("m:ResolveNames")[0];
    expect(resolve.getAttribute("ContactDataShape")).toBe("AllProperties");
    expect(resolve.getAttribute("ReturnFullContactData")).toBe("true");
    expect(resolve.getAttribute("SearchScope")).toBe("ActiveDirectory");
    expect(resolve.getElementsByTagName("m:UnresolvedEntry")[0].textContent).toBe("SMTP:anna@example.com");
  });
});

describe("EWS: разбор ответов", () => {
  test("ExpandDL: люди, вложенная рассылка, X.500 и дубли", () => {
    let response = ewsResponse(`<ExpandDLResponse ${kNS}><ResponseMessages>
      <ExpandDLResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode>
        <DLExpansion TotalItemsInView="4" IncludesLastItemInRange="true">
          <t:Mailbox><t:Name>Анна Петрова</t:Name><t:EmailAddress>anna@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
          <t:Mailbox><t:Name>Отдел продаж</t:Name><t:EmailAddress>sales@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>PublicDL</t:MailboxType></t:Mailbox>
          <t:Mailbox><t:Name>Старый</t:Name><t:EmailAddress>/o=Org/cn=old</t:EmailAddress><t:RoutingType>EX</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
          <t:Mailbox><t:Name>Анна</t:Name><t:EmailAddress>ANNA@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
        </DLExpansion>
      </ExpandDLResponseMessage></ResponseMessages></ExpandDLResponse>`);
    expect(parseExpandDL(response)).toEqual([
      { name: "Анна Петрова", emailAddress: "anna@example.com", kind: "person" },
      { name: "Отдел продаж", emailAddress: "sales@example.com", kind: "group" },
    ]);
  });

  test("ExpandDL: пустая рассылка", () => {
    let response = ewsResponse(`<ExpandDLResponse ${kNS}><ResponseMessages>
      <ExpandDLResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode>
        <DLExpansion TotalItemsInView="0" IncludesLastItemInRange="true" />
      </ExpandDLResponseMessage></ResponseMessages></ExpandDLResponse>`);
    expect(parseExpandDL(response)).toEqual([]);
  });

  test("ResolveNames: должность, руководитель, подчинённые", () => {
    let response = ewsResponse(`<ResolveNamesResponse ${kNS}><ResponseMessages>
      <ResolveNamesResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode>
        <ResolutionSet TotalItemsInView="1" IncludesLastItemInRange="true"><t:Resolution>
          <t:Mailbox><t:Name>Анна Петрова</t:Name><t:EmailAddress>anna@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
          <t:Contact>
            <t:DisplayName>Анна Петрова</t:DisplayName>
            <t:CompanyName>Пример</t:CompanyName>
            <t:Department>Продажи</t:Department>
            <t:JobTitle>Руководитель отдела</t:JobTitle>
            <t:Manager>Иван Иванов</t:Manager>
            <t:OfficeLocation>Москва, 5 этаж</t:OfficeLocation>
            <t:ManagerMailbox><t:Mailbox><t:Name>Иван Иванов</t:Name><t:EmailAddress>ivan@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox></t:ManagerMailbox>
            <t:DirectReports>
              <t:Mailbox><t:Name>Пётр</t:Name><t:EmailAddress>petr@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
              <t:Mailbox><t:Name>Борис</t:Name><t:EmailAddress>boris@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>Mailbox</t:MailboxType></t:Mailbox>
            </t:DirectReports>
          </t:Contact>
        </t:Resolution></ResolutionSet>
      </ResolveNamesResponseMessage></ResponseMessages></ResolveNamesResponse>`);
    expect(parseDirectoryInfo(response, "anna@example.com")).toEqual({
      name: "Анна Петрова",
      emailAddress: "anna@example.com",
      kind: "person",
      jobTitle: "Руководитель отдела",
      department: "Продажи",
      office: "Москва, 5 этаж",
      company: "Пример",
      manager: { name: "Иван Иванов", emailAddress: "ivan@example.com", kind: "person" },
      directReports: [
        { name: "Борис", emailAddress: "boris@example.com", kind: "person" },
        { name: "Пётр", emailAddress: "petr@example.com", kind: "person" },
      ],
    });
  });

  test("ResolveNames: рассылка; руководитель только именем", () => {
    let response = ewsResponse(`<ResolveNamesResponse ${kNS}><ResponseMessages>
      <ResolveNamesResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode>
        <ResolutionSet TotalItemsInView="1" IncludesLastItemInRange="true"><t:Resolution>
          <t:Mailbox><t:Name>Все</t:Name><t:EmailAddress>all@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType><t:MailboxType>PublicDL</t:MailboxType></t:Mailbox>
          <t:Contact><t:DisplayName>Все сотрудники</t:DisplayName><t:Manager>Иван Иванов</t:Manager></t:Contact>
        </t:Resolution></ResolutionSet>
      </ResolveNamesResponseMessage></ResponseMessages></ResolveNamesResponse>`);
    let info = parseDirectoryInfo(response, "all@example.com");
    expect(info.kind).toBe("group");
    expect(info.name).toBe("Все сотрудники");
    expect(info.manager).toEqual({ name: "Иван Иванов", emailAddress: "", kind: "person" });
    expect(info.directReports).toEqual([]);
  });

  test("ResolveNames: несколько совпадений, нужного нет", () => {
    let response = {
      ResolutionSet: { Resolution: [
        { Mailbox: { Name: "А", EmailAddress: "a@example.com", RoutingType: "SMTP" } },
        { Mailbox: { Name: "Б", EmailAddress: "b@example.com", RoutingType: "SMTP" } },
      ] },
    };
    expect(parseDirectoryInfo(response, "c@example.com")).toBeNull();
    expect(parseDirectoryInfo(response, "B@example.com").name).toBe("Б");
    expect(parseDirectoryInfo({}, "c@example.com")).toBeNull();
  });

  test("Типы ящиков", () => {
    expect(mailboxKind("PublicDL")).toBe("group");
    expect(mailboxKind("PrivateDL")).toBe("group");
    expect(mailboxKind("GroupMailbox")).toBe("group");
    expect(mailboxKind("Contact")).toBe("contact");
    expect(mailboxKind("OneOff")).toBe("contact");
    expect(mailboxKind("PublicFolder")).toBe("other");
    expect(mailboxKind("Mailbox")).toBe("person");
    expect(mailboxKind(undefined)).toBe("person");
  });
});

describe("OWA", () => {
  test("Запросы", () => {
    let expand = owaExpandDLRequest("all@example.com");
    expect(expand.action).toBe("ExpandDL");
    expect(expand.Body.Mailbox.EmailAddress).toBe("all@example.com");
    let resolve = owaResolveDirectoryRequest("anna@example.com");
    expect(resolve.action).toBe("ResolveNames");
    expect(resolve.Body.UnresolvedEntry).toBe("SMTP:anna@example.com");
    expect(resolve.Body.ContactDataShape).toBe("AllProperties");
  });

  test("ExpandDL: массив или объект с Mailbox", () => {
    let mailbox = { Name: "Анна", EmailAddress: "anna@example.com", RoutingType: "SMTP", MailboxType: "Mailbox" };
    let expected = [{ name: "Анна", emailAddress: "anna@example.com", kind: "person" }];
    expect(parseExpandDL({ DLExpansion: [mailbox] })).toEqual(expected);
    expect(parseExpandDL({ DLExpansion: { Mailbox: [mailbox] } })).toEqual(expected);
    expect(parseExpandDL({})).toEqual([]);
  });

  test("ResolveNames: ResolutionSet массивом, DirectReports массивом", () => {
    let info = parseDirectoryInfo({
      ResolutionSet: [{
        Mailbox: { Name: "Анна", EmailAddress: "anna@example.com", RoutingType: "SMTP", MailboxType: "Mailbox" },
        Contact: {
          JobTitle: "Инженер",
          ManagerMailbox: { Name: "Иван", EmailAddress: "ivan@example.com", RoutingType: "SMTP" },
          DirectReports: [{ Name: "Пётр", EmailAddress: "petr@example.com", RoutingType: "SMTP" }],
        },
      }],
    }, "anna@example.com");
    expect(info.jobTitle).toBe("Инженер");
    expect(info.manager.emailAddress).toBe("ivan@example.com");
    expect(info.directReports.map(entry => entry.emailAddress)).toEqual(["petr@example.com"]);
  });
});

function fakeAccount(protocol: string, emailAddress: string, isLoggedIn = true): MailAccount {
  return { protocol, emailAddress, isLoggedIn } as any as MailAccount;
}

describe("Выбор ящика", () => {
  test("Только EWS/OWA с входом, сначала тот же домен", () => {
    let imap = fakeAccount("imap", "me@example.com");
    let ewsOther = fakeAccount("ews", "me@other.com");
    let owaSame = fakeAccount("owa", "me@example.com");
    let offline = fakeAccount("ews", "me@example.com", false);
    expect(findDirectoryAccount([imap, offline, ewsOther, owaSame], "anna@EXAMPLE.com")).toBe(owaSame);
    expect(findDirectoryAccount([imap, ewsOther], "anna@example.com")).toBe(ewsOther);
    expect(findDirectoryAccount([imap, offline], "anna@example.com")).toBeNull();
    expect(findDirectoryAccount([], null)).toBeNull();
  });
});

describe("ExchangeDirectory", () => {
  test("EWS: кэш, ошибка не кэшируется, «не найдено» — null", async () => {
    let account = new EWSAccount();
    let callEWS = vi.spyOn(account, "callEWS");
    callEWS.mockResolvedValueOnce({ DLExpansion: { Mailbox: [{ Name: "А", EmailAddress: "a@example.com", RoutingType: "SMTP" }] } });
    let directory = new ExchangeDirectory(account);
    expect(await directory.expandGroup("all@example.com")).toHaveLength(1);
    expect(await directory.expandGroup("ALL@example.com")).toHaveLength(1);
    expect(callEWS).toHaveBeenCalledTimes(1);

    callEWS.mockRejectedValueOnce(new Error("сеть"));
    await expect(directory.getInfo("b@example.com")).rejects.toThrow("сеть");
    callEWS.mockRejectedValueOnce(new EWSItemError({ ResponseCode: "ErrorNameResolutionNoResults", MessageText: "нет" }, {} as any));
    expect(await directory.getInfo("b@example.com")).toBeNull();
    expect(callEWS).toHaveBeenCalledTimes(3);
  });

  test("Кэш устаревает", async () => {
    vi.useFakeTimers();
    try {
      let account = new EWSAccount();
      let callEWS = vi.spyOn(account, "callEWS").mockResolvedValue({ DLExpansion: {} });
      let directory = new ExchangeDirectory(account);
      await directory.expandGroup("all@example.com");
      vi.advanceTimersByTime(kDirectoryCacheMS + 1);
      await directory.expandGroup("all@example.com");
      expect(callEWS).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
