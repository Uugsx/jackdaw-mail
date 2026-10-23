// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import type { EMail } from "../../../../logic/Mail/EMail";
import {
  ewsDeferredSendProperties, ewsDeleteScheduledRequest, ewsFindOutboxRequest, exchangeTimeValue,
  owaDeleteScheduledRequest, owaFindOutboxRequest, parseEWSOutbox, parseOWAOutbox,
} from "../../../../logic/Mail/Scheduled/DeferredSendRequests";
import {
  canDeferOnServer, cancelServerScheduled, ewsDeferredSendProtocol, owaDeferredSendProtocol,
} from "../../../../logic/Mail/Scheduled/DeferredSendServer";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { describe, expect, test } from "vitest";

const kNS = `xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;
const kSendAt = new Date("2026-10-26T05:00:00.123Z");
const kDeferred = { sendAt: kSendAt, scheduleID: "sched-1" };

/** happy-dom теряет пространства имён у `createDocument()`, поэтому ищем по префиксам `m:` и `t:` */
function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

function tags(doc: Document | Element, name: string): Element[] {
  return [...doc.getElementsByTagName(name)];
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

function newMail(account: EWSAccount | OWAAccount): EMail {
  account.storage = new DummyMailStorage();
  let sent = account.newFolder();
  sent.id = "sent-folder";
  sent.specialFolder = SpecialFolder.Sent;
  let mail = sent.newEMail();
  mail.subject = "Отчёт";
  mail.html = "<p>Привет</p>";
  mail.from = new PersonUID("me@example.com", "Я");
  mail.to.add(new PersonUID("boss@example.com", "Шеф"));
  mail.headers.set("User-Agent", "Jackdaw Mail/1");
  return mail;
}

/** ExtendedProperty из XML: имя или тег свойства → значение */
function extendedProperties(doc: Document): Map<string, string> {
  let result = new Map<string, string>();
  for (let property of tags(doc, "t:ExtendedProperty")) {
    let uri = tags(property, "t:ExtendedFieldURI")[0];
    let key = uri.getAttribute("PropertyTag") ?? uri.getAttribute("PropertyName");
    result.set(`${uri.getAttribute("DistinguishedPropertySetId") ?? ""}/${key}/${uri.getAttribute("PropertyType")}`,
      tags(property, "t:Value")[0].textContent);
  }
  return result;
}

describe("PidTagDeferredSendTime в CreateItem", () => {
  test("время — UTC без миллисекунд", () => {
    expect(exchangeTimeValue(kSendAt)).toBe("2026-10-26T05:00:00Z");
  });

  test("EWS: письмо с отложенной доставкой несёт 0x3FEF и метку, заголовки не теряются", async () => {
    let account = new EWSAccount();
    let mail = newMail(account);
    mail.deferredSend = kDeferred;
    let requests: any[] = [];
    account.callEWS = async (request: any) => {
      requests.push(request);
      return {};
    };
    await account.send(mail);

    expect(requests).toHaveLength(1);
    let doc = requestXML(requests[0]);
    expect(tags(doc, "m:CreateItem")[0].getAttribute("MessageDisposition")).toBe("SendAndSaveCopy");
    expect(tags(doc, "t:FolderId")[0].getAttribute("Id")).toBe("sent-folder");
    let properties = extendedProperties(doc);
    expect(properties.get("/0x3FEF/SystemTime")).toBe("2026-10-26T05:00:00Z");
    expect(properties.get("PublicStrings/JackdawScheduleID/String")).toBe("sched-1");
    expect(properties.get("InternetHeaders/User-Agent/String")).toBe("Jackdaw Mail/1");
    // Все свойства — в одном элементе Message, как требует схема
    expect(tags(doc, "t:Message")).toHaveLength(1);
  });

  test("EWS: обычная отправка — без свойств отложенной доставки, как раньше", async () => {
    let account = new EWSAccount();
    let mail = newMail(account);
    let requests: any[] = [];
    account.callEWS = async (request: any) => {
      requests.push(request);
      return {};
    };
    await account.send(mail);

    let properties = extendedProperties(requestXML(requests[0]));
    expect([...properties.keys()]).toEqual(["InternetHeaders/User-Agent/String"]);
  });

  test("EWS: зашифрованное письмо (готовый MIME) тоже откладывается", async () => {
    let account = new EWSAccount();
    let mail = newMail(account);
    mail.sendRawMIME = "Subject: x\r\n\r\nbody";
    mail.deferredSend = kDeferred;
    let requests: any[] = [];
    account.callEWS = async (request: any) => {
      requests.push(request);
      return {};
    };
    await account.send(mail);

    let doc = requestXML(requests[0]);
    expect(tags(doc, "t:MimeContent")).toHaveLength(1);
    let properties = extendedProperties(doc);
    expect(properties.get("/0x3FEF/SystemTime")).toBe("2026-10-26T05:00:00Z");
    expect(properties.get("PublicStrings/JackdawScheduleID/String")).toBe("sched-1");
  });

  test("OWA: свойства в ExtendedProperty рядом с заголовками", async () => {
    appGlobal.remoteApp = { OWA: {} };
    let account = new OWAAccount();
    let mail = newMail(account);
    mail.deferredSend = kDeferred;
    let requests: any[] = [];
    (account as any).callOWA = async (request: any) => {
      requests.push(request);
      return {};
    };
    (account as any).refreshAfterSend = async () => {};
    await account.send(mail);

    let item = requests[0].Body.Items[0];
    expect(requests[0].action).toBe("CreateItem");
    expect(requests[0].Body.MessageDisposition).toBe("SendAndSaveCopy");
    expect(item.ExtendedProperty).toEqual([
      {
        ExtendedFieldURI: { PropertyName: "User-Agent", DistinguishedPropertySetId: "InternetHeaders", PropertyType: "String" },
        Value: "Jackdaw Mail/1",
      },
      { ExtendedFieldURI: { PropertyTag: "0x3FEF", PropertyType: "SystemTime" }, Value: "2026-10-26T05:00:00Z" },
      {
        ExtendedFieldURI: { DistinguishedPropertySetId: "PublicStrings", PropertyName: "JackdawScheduleID", PropertyType: "String" },
        Value: "sched-1",
      },
    ]);
  });

  test("OWA: без отложенной доставки — только заголовки", async () => {
    appGlobal.remoteApp = { OWA: {} };
    let account = new OWAAccount();
    let mail = newMail(account);
    let requests: any[] = [];
    (account as any).callOWA = async (request: any) => {
      requests.push(request);
      return {};
    };
    (account as any).refreshAfterSend = async () => {};
    await account.send(mail);

    expect(requests[0].Body.Items[0].ExtendedProperty).toHaveLength(1);
  });

  test("свойства EWS для CreateItem", () => {
    expect(ewsDeferredSendProperties(kDeferred)).toEqual([
      { t$ExtendedFieldURI: { PropertyTag: "0x3FEF", PropertyType: "SystemTime" }, t$Value: "2026-10-26T05:00:00Z" },
      {
        t$ExtendedFieldURI: { DistinguishedPropertySetId: "PublicStrings", PropertyName: "JackdawScheduleID", PropertyType: "String" },
        t$Value: "sched-1",
      },
    ]);
  });
});

describe("«Исходящие» сервера: поиск и отмена", () => {
  test("EWS FindItem: папка outbox и оба свойства в AdditionalProperties", () => {
    let doc = requestXML(ewsFindOutboxRequest());
    expect(tags(doc, "t:DistinguishedFolderId")[0].getAttribute("Id")).toBe("outbox");
    expect(tags(doc, "t:BaseShape")[0].textContent).toBe("IdOnly");
    let uris = tags(doc, "t:ExtendedFieldURI");
    expect(uris.map(uri => uri.getAttribute("PropertyTag") ?? uri.getAttribute("PropertyName")))
      .toEqual(["0x3FEF", "JackdawScheduleID"]);
    expect(tags(doc, "m:FindItem")[0].getAttribute("Traversal")).toBe("Shallow");
  });

  test("EWS: разбор ответа FindItem — тег строчными, письма без метки тоже видны", () => {
    let result = ewsResponse(`<m:FindItemResponse ${kNS}>
      <m:ResponseMessages>
        <m:FindItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:RootFolder TotalItemsInView="2" IncludesLastItemInRange="true">
            <t:Items>
              <t:Message>
                <t:ItemId Id="out-1" ChangeKey="ck"/>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI PropertyTag="0x3fef" PropertyType="SystemTime"/>
                  <t:Value>2026-10-26T05:00:00Z</t:Value>
                </t:ExtendedProperty>
                <t:ExtendedProperty>
                  <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="JackdawScheduleID" PropertyType="String"/>
                  <t:Value>sched-1</t:Value>
                </t:ExtendedProperty>
              </t:Message>
              <t:Message>
                <t:ItemId Id="out-2" ChangeKey="ck"/>
              </t:Message>
            </t:Items>
          </m:RootFolder>
        </m:FindItemResponseMessage>
      </m:ResponseMessages>
    </m:FindItemResponse>`);
    expect(parseEWSOutbox(result)).toEqual([
      { itemID: "out-1", scheduleID: "sched-1", sendAt: new Date("2026-10-26T05:00:00Z") },
      { itemID: "out-2", scheduleID: null, sendAt: null },
    ]);
  });

  test("OWA FindItem и разбор: тег десятичным числом", () => {
    let request = owaFindOutboxRequest();
    expect(request.action).toBe("FindItem");
    expect(request.Body.ParentFolderIds[0].Id).toBe("outbox");
    expect(request.Body.ItemShape.AdditionalProperties).toEqual([
      { __type: "ExtendedPropertyUri:#Exchange", PropertyTag: "0x3FEF", PropertyType: "SystemTime" },
      { __type: "ExtendedPropertyUri:#Exchange", DistinguishedPropertySetId: "PublicStrings", PropertyName: "JackdawScheduleID", PropertyType: "String" },
    ]);
    expect(parseOWAOutbox({
      RootFolder: {
        Items: [{
          __type: "Message:#Exchange",
          ItemId: { Id: "owa-1" },
          ExtendedProperty: [
            { ExtendedFieldURI: { PropertyTag: "16367", PropertyType: "SystemTime" }, Value: "2026-10-26T08:00:00+03:00" },
            { ExtendedFieldURI: { PropertyName: "JackdawScheduleID" }, Value: "sched-2" },
          ],
        }, { ItemId: {} }],
      },
    })).toEqual([{ itemID: "owa-1", scheduleID: "sched-2", sendAt: new Date("2026-10-26T05:00:00Z") }]);
  });

  test("удаление в «Удалённые», а не насовсем", () => {
    let doc = requestXML(ewsDeleteScheduledRequest("out-1"));
    expect(tags(doc, "m:DeleteItem")[0].getAttribute("DeleteType")).toBe("MoveToDeletedItems");
    expect(tags(doc, "t:ItemId")[0].getAttribute("Id")).toBe("out-1");
    let owa = owaDeleteScheduledRequest("owa-1");
    expect(owa.Body.DeleteType).toBe("MoveToDeletedItems");
    expect(owa.Body.ItemIds).toEqual([{ __type: "ItemId:#Exchange", Id: "owa-1" }]);
  });

  test("отмена удаляет только письмо со своей меткой", async () => {
    let calls: any[] = [];
    let protocol = owaDeferredSendProtocol(async request => {
      calls.push(request);
      if (request.action == "FindItem") {
        return {
          RootFolder: {
            Items: [
              { ItemId: { Id: "other" }, ExtendedProperty: [{ ExtendedFieldURI: { PropertyName: "JackdawScheduleID" }, Value: "sched-9" }] },
              { ItemId: { Id: "mine" }, ExtendedProperty: [{ ExtendedFieldURI: { PropertyName: "JackdawScheduleID" }, Value: "sched-1" }] },
              { ItemId: { Id: "outlook" } },
            ],
          },
        };
      }
      return {};
    });
    expect(await cancelServerScheduled(protocol, "sched-1")).toBe(true);
    expect(calls.map(call => call.action)).toEqual(["FindItem", "DeleteItem"]);
    expect(calls[1].Body.ItemIds[0].Id).toBe("mine");
  });

  test("письма уже нет в «Исходящих» — false, ничего не удаляется", async () => {
    let calls: any[] = [];
    let protocol = ewsDeferredSendProtocol(async request => {
      calls.push(request);
      return { RootFolder: { Items: {} } };
    });
    expect(await cancelServerScheduled(protocol, "sched-1")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].m$FindItem).toBeDefined();
  });

  test("серверная отложенная доставка — только свой ящик EWS или OWA", () => {
    let ews = new EWSAccount();
    let owa = new OWAAccount();
    let shared = new EWSAccount();
    shared.mainAccount = ews;
    expect(canDeferOnServer(ews)).toBe(true);
    expect(canDeferOnServer(owa)).toBe(true);
    expect(canDeferOnServer(shared)).toBe(false);
    expect(canDeferOnServer(new MailAccount())).toBe(false);
    expect(canDeferOnServer(null)).toBe(false);
  });
});
