// @vitest-environment happy-dom

import "../../../../logic/app"; // Avoid import cycle
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import {
  checkOutOfOfficeResponse, ewsGetOutOfOfficeRequest, ewsSetOutOfOfficeRequest, isOutOfOfficeActive,
  newOutOfOfficeSettings, outOfOfficeHTMLToText, outOfOfficeTextToHTML, owaGetOutOfOfficeRequest,
  owaSetOutOfOfficeRequest, parseExchangeDate, parseOutOfOfficeResponse, type OutOfOfficeSettings,
} from "../../../../logic/Mail/EWS/OutOfOffice";
import { describe, expect, test } from "vitest";

const kTypes = "http://schemas.microsoft.com/exchange/services/2006/types";
const kMessages = "http://schemas.microsoft.com/exchange/services/2006/messages";

function scheduled(): OutOfOfficeSettings {
  return {
    ...newOutOfOfficeSettings(),
    state: "Scheduled",
    externalAudience: "Known",
    start: new Date("2026-11-02T06:00:00Z"),
    end: new Date("2026-11-09T18:30:00Z"),
    internalReply: "<p>В отпуске &amp; без почты</p>",
    externalReply: "<p>On vacation</p>",
  };
}

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

describe("EWS: формирование XML", () => {
  test("GetUserOofSettings", () => {
    let doc = requestXML(ewsGetOutOfOfficeRequest("ivan@example.com"));
    let request = doc.getElementsByTagName("m:GetUserOofSettingsRequest")[0];
    expect(request).toBeTruthy();
    let address = request.getElementsByTagName("t:Address")[0];
    expect(address.parentElement.tagName).toBe("t:Mailbox");
    expect(address.textContent).toBe("ivan@example.com");
  });

  test("SetUserOofSettings: порядок полей по схеме, даты в UTC, HTML экранирован", () => {
    let xml = new EWSAccount().request2XML(ewsSetOutOfOfficeRequest("ivan@example.com", scheduled()));
    let doc = requestXML(ewsSetOutOfOfficeRequest("ivan@example.com", scheduled()));
    let request = doc.getElementsByTagName("m:SetUserOofSettingsRequest")[0];
    expect([...request.children].map(child => child.tagName)).toEqual(["t:Mailbox", "t:UserOofSettings"]);
    let oof = request.getElementsByTagName("t:UserOofSettings")[0];
    expect([...oof.children].map(child => child.tagName))
      .toEqual(["t:OofState", "t:ExternalAudience", "t:Duration", "t:InternalReply", "t:ExternalReply"]);
    expect(oof.getElementsByTagName("t:OofState")[0].textContent).toBe("Scheduled");
    expect(oof.getElementsByTagName("t:ExternalAudience")[0].textContent).toBe("Known");
    expect(oof.getElementsByTagName("t:StartTime")[0].textContent).toBe("2026-11-02T06:00:00Z");
    expect(oof.getElementsByTagName("t:EndTime")[0].textContent).toBe("2026-11-09T18:30:00Z");
    let internal = oof.getElementsByTagName("t:InternalReply")[0];
    expect(internal.getElementsByTagName("t:Message")[0].textContent).toBe("<p>В отпуске &amp; без почты</p>");
    expect(xml).toContain("&lt;p&gt;В отпуске &amp;amp; без почты&lt;/p&gt;");
  });

  test("SetUserOofSettings без расписания не шлёт Duration", () => {
    let settings = { ...newOutOfOfficeSettings(), state: "Enabled" as const, internalReply: "x" };
    let request = ewsSetOutOfOfficeRequest("ivan@example.com", settings);
    expect(request.m$SetUserOofSettingsRequest.t$UserOofSettings.t$Duration).toBeUndefined();
  });

  test("выключенный автоответ с неверным периодом не шлёт Duration", () => {
    let settings = { ...scheduled(), state: "Disabled" as const, end: new Date("2026-11-01T00:00:00Z") };
    expect(ewsSetOutOfOfficeRequest("ivan@example.com", settings).m$SetUserOofSettingsRequest.t$UserOofSettings.t$Duration).toBeUndefined();
    expect(owaSetOutOfOfficeRequest("ivan@example.com", settings).Body.UserOofSettings.Duration).toBeUndefined();
  });

  test("расписание с концом раньше начала не отправляется", () => {
    let settings = { ...scheduled(), end: new Date("2026-11-01T00:00:00Z") };
    expect(() => ewsSetOutOfOfficeRequest("ivan@example.com", settings)).toThrow(RangeError);
    expect(() => owaSetOutOfOfficeRequest("ivan@example.com", { ...scheduled(), start: null })).toThrow(RangeError);
  });
});

describe("EWS: разбор ответа", () => {
  test("GetUserOofSettingsResponse", () => {
    let response = ewsResponse(`
      <GetUserOofSettingsResponse xmlns="${kMessages}">
        <ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage>
        <OofSettings xmlns="${kTypes}">
          <OofState>Scheduled</OofState>
          <ExternalAudience>All</ExternalAudience>
          <Duration>
            <StartTime>2026-11-02T06:00:00</StartTime>
            <EndTime>2026-11-09T18:30:00</EndTime>
          </Duration>
          <InternalReply xml:lang="ru-RU"><Message>&lt;html&gt;&lt;body&gt;Я в отпуске&lt;/body&gt;&lt;/html&gt;</Message></InternalReply>
          <ExternalReply xml:lang="en-US"><Message>Away</Message></ExternalReply>
        </OofSettings>
        <AllowExternalOof>Known</AllowExternalOof>
      </GetUserOofSettingsResponse>`);
    checkOutOfOfficeResponse(response);
    let settings = parseOutOfOfficeResponse(response);
    expect(settings).toEqual({
      state: "Scheduled",
      externalAudience: "All",
      start: new Date("2026-11-02T06:00:00Z"),
      end: new Date("2026-11-09T18:30:00Z"),
      internalReply: "<html><body>Я в отпуске</body></html>",
      externalReply: "Away",
      allowExternal: "Known",
    });
  });

  test("пустые ответы и выключенный автоответ", () => {
    let response = ewsResponse(`
      <GetUserOofSettingsResponse xmlns="${kMessages}">
        <ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage>
        <OofSettings xmlns="${kTypes}">
          <OofState>Disabled</OofState>
          <ExternalAudience>None</ExternalAudience>
          <InternalReply><Message/></InternalReply>
          <ExternalReply/>
        </OofSettings>
      </GetUserOofSettingsResponse>`);
    let settings = parseOutOfOfficeResponse(response);
    expect(settings.state).toBe("Disabled");
    expect(settings.externalAudience).toBe("None");
    expect(settings.start).toBeNull();
    expect(settings.internalReply).toBe("");
    expect(settings.externalReply).toBe("");
    expect(settings.allowExternal).toBe("All");
  });

  test("ошибка сервера", () => {
    expect(() => ewsResponse(`
      <SetUserOofSettingsResponse xmlns="${kMessages}">
        <ResponseMessage ResponseClass="Error">
          <MessageText>The specified time period is invalid.</MessageText>
          <ResponseCode>ErrorOofDurationInvalid</ResponseCode>
        </ResponseMessage>
      </SetUserOofSettingsResponse>`)).toThrow(EWSItemError);
  });

  test("успешный SetUserOofSettingsResponse", () => {
    let response = ewsResponse(`
      <SetUserOofSettingsResponse xmlns="${kMessages}">
        <ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage>
      </SetUserOofSettingsResponse>`);
    expect(() => checkOutOfOfficeResponse(response)).not.toThrow();
  });
});

describe("OWA: JSON", () => {
  test("GetUserOofSettings", () => {
    let request = owaGetOutOfOfficeRequest("ivan@example.com");
    expect(request.action).toBe("GetUserOofSettings");
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      __type: "GetUserOofSettingsJsonRequest:#Exchange",
      Header: { __type: "JsonRequestHeaders:#Exchange", RequestServerVersion: "Exchange2013" },
      Body: {
        __type: "GetUserOofSettingsRequest:#Exchange",
        Mailbox: { __type: "EmailAddress:#Exchange", Address: "ivan@example.com" },
      },
    });
  });

  test("SetUserOofSettings", () => {
    let request = owaSetOutOfOfficeRequest("ivan@example.com", scheduled());
    expect(request.action).toBe("SetUserOofSettings");
    expect(request.Body).toEqual({
      __type: "SetUserOofSettingsRequest:#Exchange",
      Mailbox: { __type: "EmailAddress:#Exchange", Address: "ivan@example.com" },
      UserOofSettings: {
        __type: "UserOofSettings:#Exchange",
        OofState: "Scheduled",
        ExternalAudience: "Known",
        Duration: { __type: "Duration:#Exchange", StartTime: "2026-11-02T06:00:00Z", EndTime: "2026-11-09T18:30:00Z" },
        InternalReply: { __type: "ReplyBody:#Exchange", Message: "<p>В отпуске &amp; без почты</p>" },
        ExternalReply: { __type: "ReplyBody:#Exchange", Message: "<p>On vacation</p>" },
      },
    });
  });

  test("разбор ответа: Body, даты со смещением, регистр значений", () => {
    let settings = parseOutOfOfficeResponse({
      Body: {
        ResponseMessage: { ResponseClass: "Success" },
        OofSettings: {
          OofState: "enabled",
          ExternalAudience: "Known",
          Duration: { StartTime: "2026-11-02T09:00:00+03:00", EndTime: "/Date(1794300000000)/" },
          InternalReply: { Message: "Внутренний" },
          ExternalReply: { Message: "Внешний" },
        },
        AllowExternalOof: "None",
      },
    });
    expect(settings.state).toBe("Enabled");
    expect(settings.externalAudience).toBe("Known");
    expect(settings.start).toEqual(new Date("2026-11-02T06:00:00Z"));
    expect(settings.end).toEqual(new Date(1794300000000));
    expect(settings.internalReply).toBe("Внутренний");
    expect(settings.allowExternal).toBe("None");
  });

  test("ошибка во вложенном ResponseMessage", () => {
    expect(() => checkOutOfOfficeResponse({
      ResponseMessage: { ResponseClass: "Error", ResponseCode: "ErrorAccessDenied", MessageText: "Access is denied." },
    })).toThrow("Access is denied.");
    expect(() => parseOutOfOfficeResponse({ ResponseClass: "Success" })).toThrow();
  });
});

describe("состояние и тексты", () => {
  test("включён ли автоответ сейчас", () => {
    let now = new Date("2026-11-05T12:00:00Z");
    expect(isOutOfOfficeActive(null, now)).toBe(false);
    expect(isOutOfOfficeActive(newOutOfOfficeSettings(), now)).toBe(false);
    expect(isOutOfOfficeActive({ ...newOutOfOfficeSettings(), state: "Enabled" }, now)).toBe(true);
    expect(isOutOfOfficeActive(scheduled(), now)).toBe(true);
    expect(isOutOfOfficeActive(scheduled(), new Date("2026-11-10T00:00:00Z"))).toBe(false);
    expect(isOutOfOfficeActive(scheduled(), new Date("2026-11-01T00:00:00Z"))).toBe(false);
  });

  test("текст ↔ HTML", () => {
    let html = outOfOfficeTextToHTML("Меня нет <до> понедельника\nПишите Пете & Ко");
    expect(html).toBe("<html><body><div>Меня нет &lt;до&gt; понедельника<br>Пишите Пете &amp; Ко</div></body></html>");
    expect(outOfOfficeHTMLToText(html)).toBe("Меня нет <до> понедельника\nПишите Пете & Ко");
    expect(outOfOfficeTextToHTML("  \n ")).toBe("");
    expect(outOfOfficeHTMLToText("Просто текст")).toBe("Просто текст");
    expect(outOfOfficeHTMLToText(
      "<html><head><style>p{color:red}</style></head><body><p>Первая</p><p>Вторая&nbsp;строка</p></body></html>"))
      .toBe("Первая\nВторая строка");
  });

  test("даты Exchange", () => {
    expect(parseExchangeDate("2026-11-02T06:00:00")).toEqual(new Date("2026-11-02T06:00:00Z"));
    expect(parseExchangeDate("2026-11-02T06:00:00.000Z")).toEqual(new Date("2026-11-02T06:00:00Z"));
    expect(parseExchangeDate("")).toBeNull();
    expect(parseExchangeDate("мусор")).toBeNull();
    expect(parseExchangeDate(undefined)).toBeNull();
  });
});
