// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import {
  addEWSDeferredSend, cancelEWSDeferred, ewsDeferredSendProperties, ewsFindDeferredRequest,
  ewsSystemTime, kScheduledSendIDProperty, parseEWSFindDeferred,
} from "../../../../logic/Mail/SendLater/EWSDeferredSend";
import { describe, expect, test, vi } from "vitest";

const kNS = `xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"`;
const kDeferred = { sendAt: new Date("2026-10-26T05:00:00.123Z"), queueID: "q-1" };

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

function childNames(element: Element): string[] {
  return [...element.children].map(child => child.tagName);
}

/** Аккаунт, который вместо сервера запоминает запросы */
function fakeAccount(): { account: EWSAccount, requests: any[] } {
  let account = new EWSAccount();
  account.emailAddress = "me@example.com";
  let requests: any[] = [];
  account.callEWS = vi.fn(async (request: any) => {
    requests.push(request);
    return {};
  }) as any;
  return { account, requests };
}

function outgoingMail(account: EWSAccount) {
  let folder = account.newFolder() as EWSFolder;
  folder.id = "sent-folder";
  let mail = folder.newEMail();
  mail.subject = "Отчёт";
  mail.html = "<p>Текст</p>";
  mail.from = new PersonUID("me@example.com", "Я");
  mail.to.add(new PersonUID("anna@example.com", "Анна"));
  mail.cc.add(new PersonUID("boss@example.com", "Босс"));
  return mail;
}

describe("свойства отложенной отправки", () => {
  test("PidTagDeferredSendTime в UTC и свой ID записи", () => {
    expect(ewsSystemTime(kDeferred.sendAt)).toBe("2026-10-26T05:00:00Z");
    let xml = requestXML({ t$Message: { t$ExtendedProperty: ewsDeferredSendProperties(kDeferred) } });
    let properties = [...xml.getElementsByTagName("t:ExtendedProperty")];
    expect(properties).toHaveLength(2);
    let time = properties[0].getElementsByTagName("t:ExtendedFieldURI")[0];
    expect(time.getAttribute("PropertyTag")).toBe("0x3FEF");
    expect(time.getAttribute("PropertyType")).toBe("SystemTime");
    expect(properties[0].getElementsByTagName("t:Value")[0].textContent).toBe("2026-10-26T05:00:00Z");
    let id = properties[1].getElementsByTagName("t:ExtendedFieldURI")[0];
    expect(id.getAttribute("DistinguishedPropertySetId")).toBe("PublicStrings");
    expect(id.getAttribute("PropertyName")).toBe(kScheduledSendIDProperty);
    expect(properties[1].getElementsByTagName("t:Value")[0].textContent).toBe("q-1");
  });

  test("без заголовков свойства встают до получателей", () => {
    let message: Record<string, any> = {
      t$MimeContent: "abc",
      t$BccRecipients: { t$Mailbox: [] },
      t$From: {},
    };
    addEWSDeferredSend(message, kDeferred);
    expect(Object.keys(message)).toEqual(["t$MimeContent", "t$ExtendedProperty", "t$BccRecipients", "t$From"]);
  });

  test("с заголовками дописываются в тот же ExtendedProperty", () => {
    let header = { t$ExtendedFieldURI: { PropertyName: "user-agent" }, t$Value: "Jackdaw" };
    let message: Record<string, any> = { t$Subject: "x", t$ExtendedProperty: [header], t$ToRecipients: {} };
    addEWSDeferredSend(message, kDeferred);
    expect(Object.keys(message)).toEqual(["t$Subject", "t$ExtendedProperty", "t$ToRecipients"]);
    expect(message.t$ExtendedProperty).toHaveLength(3);
    expect(message.t$ExtendedProperty[0]).toBe(header);
  });
});

describe("отправка через EWS", () => {
  test("обычная отправка — без отложенных свойств", async () => {
    let { account, requests } = fakeAccount();
    let mail = outgoingMail(account);
    mail.headers.set("User-Agent", "Jackdaw");
    await account.send(mail);
    let xml = requestXML(requests[0]);
    expect(xml.getElementsByTagName("m:CreateItem")[0].getAttribute("MessageDisposition")).toBe("SendAndSaveCopy");
    expect(new EWSAccount().request2XML(requests[0])).not.toContain("0x3FEF");
  });

  test("отложенная: время и ID до получателей", async () => {
    let { account, requests } = fakeAccount();
    let mail = outgoingMail(account);
    mail.headers.set("User-Agent", "Jackdaw");
    await account.send(mail, kDeferred);
    let xml = requestXML(requests[0]);
    let message = xml.getElementsByTagName("t:Message")[0];
    let names = childNames(message);
    expect(names.indexOf("t:ExtendedProperty")).toBeLessThan(names.indexOf("t:ToRecipients"));
    let uris = [...message.getElementsByTagName("t:ExtendedFieldURI")];
    expect(uris.map(uri => uri.getAttribute("PropertyTag") ?? uri.getAttribute("PropertyName")))
      .toEqual(["User-Agent", "0x3FEF", kScheduledSendIDProperty]);
    expect(xml.getElementsByTagName("m:CreateItem")[0].getAttribute("MessageDisposition")).toBe("SendAndSaveCopy");
  });

  test("отложенная с готовым MIME (шифрование)", async () => {
    let { account, requests } = fakeAccount();
    let mail = outgoingMail(account);
    mail.sendRawMIME = "Subject: x\r\n\r\nencrypted";
    mail.bcc.add(new PersonUID("hidden@example.com"));
    await account.send(mail, kDeferred);
    let names = childNames(requestXML(requests[0]).getElementsByTagName("t:Message")[0]);
    expect(names.slice(0, 2)).toEqual(["t:MimeContent", "t:ExtendedProperty"]);
    expect(names.indexOf("t:ExtendedProperty")).toBeLessThan(names.indexOf("t:BccRecipients"));
  });

  test("сервер умеет отложенную отправку, базовый аккаунт — нет", () => {
    expect(new EWSAccount().canDeferSendOnServer).toBe(true);
  });
});

describe("поиск и отмена на сервере", () => {
  test("ищем в «Исходящих» и «Черновиках» со своим свойством", () => {
    let xml = requestXML(ewsFindDeferredRequest());
    let folders = [...xml.getElementsByTagName("t:DistinguishedFolderId")].map(folder => folder.getAttribute("Id"));
    expect(folders).toEqual(["outbox", "drafts"]);
    let uri = xml.getElementsByTagName("t:AdditionalProperties")[0].getElementsByTagName("t:ExtendedFieldURI")[0];
    expect(uri.getAttribute("PropertyName")).toBe(kScheduledSendIDProperty);
  });

  const kFindResponse = `<m:FindItemResponse ${kNS}>
    <m:ResponseMessages>
      <m:FindItemResponseMessage ResponseClass="Success">
        <m:ResponseCode>NoError</m:ResponseCode>
        <m:RootFolder TotalItemsInView="3" IncludesLastItemInRange="true">
          <t:Items>
            <t:Message>
              <t:ItemId Id="mine" ChangeKey="c1"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="${kScheduledSendIDProperty}" PropertyType="String"/>
                <t:Value>q-1</t:Value>
              </t:ExtendedProperty>
            </t:Message>
            <t:Message>
              <t:ItemId Id="other" ChangeKey="c2"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="${kScheduledSendIDProperty}" PropertyType="String"/>
                <t:Value>q-2</t:Value>
              </t:ExtendedProperty>
            </t:Message>
            <t:Message>
              <t:ItemId Id="plain-draft" ChangeKey="c3"/>
            </t:Message>
          </t:Items>
        </m:RootFolder>
      </m:FindItemResponseMessage>
    </m:ResponseMessages>
  </m:FindItemResponse>`;

  test("разбор ответа находит только своё письмо", () => {
    let response = ewsResponse(kFindResponse);
    expect(parseEWSFindDeferred(response, "q-1")).toEqual(["mine"]);
    expect(parseEWSFindDeferred(response, "q-3")).toEqual([]);
    expect(parseEWSFindDeferred({}, "q-1")).toEqual([]);
    expect(parseEWSFindDeferred(null, "q-1")).toEqual([]);
  });

  test("отмена удаляет найденное; если письма нет — оно уже ушло", async () => {
    let response = ewsResponse(kFindResponse);
    let calls: any[] = [];
    let callEWS = async (request: any) => {
      calls.push(request);
      return request.m$FindItem ? response : {};
    };
    expect(await cancelEWSDeferred(callEWS, "q-1")).toBe(true);
    let deleteXML = requestXML(calls[1]);
    expect(deleteXML.getElementsByTagName("t:ItemId")[0].getAttribute("Id")).toBe("mine");
    expect(deleteXML.getElementsByTagName("m:DeleteItem")[0].getAttribute("DeleteType")).toBe("SoftDelete");

    calls = [];
    expect(await cancelEWSDeferred(callEWS, "q-gone")).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
