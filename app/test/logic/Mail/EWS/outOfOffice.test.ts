// @vitest-environment happy-dom

import { appGlobal } from "../../../../logic/app"; // Avoid import cycle
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import {
  checkOutOfOfficeResponse, ewsGetOutOfOfficeRequest, ewsSetOutOfOfficeRequest, isOutOfOfficeActive,
  newOutOfOfficeSettings, outOfOfficeHTMLToText, outOfOfficeTextToHTML, owaGetOutOfOfficeRequest,
  owaSetOutOfOfficeRequest, parseExchangeDate, parseOutOfOfficeResponse, type OutOfOfficeSettings,
  checkOWAOutOfOfficeResponse, parseOWAOutOfOfficeResponse,
} from "../../../../logic/Mail/EWS/OutOfOffice";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
    expect(owaSetOutOfOfficeRequest(settings).Options.StartTime).toBeUndefined();
  });

  test("расписание с концом раньше начала не отправляется", () => {
    let settings = { ...scheduled(), end: new Date("2026-11-01T00:00:00Z") };
    expect(() => ewsSetOutOfOfficeRequest("ivan@example.com", settings)).toThrow(RangeError);
    expect(() => owaSetOutOfOfficeRequest({ ...scheduled(), start: null })).toThrow(RangeError);
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
  // Exchange 2019, как его присылает Outlook в браузере
  const kGetResponse = {
    Header: { ServerVersionInfo: { MajorVersion: 15, MinorVersion: 2, Version: "V2017_07_11" } },
    ErrorCode: 0,
    ErrorMessage: null,
    IsUserError: false,
    UserPrompt: null,
    WasSuccessful: true,
    Options: {
      AutoReplyState: 2,
      StartTime: "2026-10-05T09:00:00+02:00",
      EndTime: "2026-10-19T16:00:00Z",
      ExternalAudience: 1,
      ExternalMessage: "<p>I am out of office.</p>",
      ExternalMessageText: "I am out of office.\r\n",
      InternalMessage: "<html><body><p>Вернусь <b>19-го</b>.</p></body></html>",
      InternalMessageText: "Вернусь 19-го.\r\n",
    },
  };

  test("чтение: GetMailboxAutoReplyConfiguration с пустым телом", () => {
    let request = owaGetOutOfOfficeRequest();
    expect(request.action).toBe("GetMailboxAutoReplyConfiguration");
    expect(JSON.stringify(request)).toBe("{}");
  });

  test("запись: SetMailboxAutoReplyConfiguration", () => {
    let request = owaSetOutOfOfficeRequest(scheduled());
    expect(request.action).toBe("SetMailboxAutoReplyConfiguration");
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      __type: "SetMailboxAutoReplyConfigurationRequest:#Exchange",
      Header: { __type: "JsonRequestHeaders:#Exchange", RequestServerVersion: "Exchange2013" },
      Options: {
        __type: "MailboxAutoReplyConfigurationOptions:#Exchange",
        AutoReplyState: 2,
        ExternalAudience: 1,
        StartTime: "2026-11-02T06:00:00Z",
        EndTime: "2026-11-09T18:30:00Z",
        InternalMessage: "<p>В отпуске &amp; без почты</p>",
        ExternalMessage: "<p>On vacation</p>",
      },
    });
  });

  test("запись без расписания не шлёт время", () => {
    let request = owaSetOutOfOfficeRequest({ ...scheduled(), state: "Disabled" });
    expect(request.Options.AutoReplyState).toBe(0);
    expect(request.Options.StartTime).toBeUndefined();
    expect(request.Options.EndTime).toBeUndefined();
    expect(owaSetOutOfOfficeRequest({ ...scheduled(), state: "Enabled", externalAudience: "All" }).Options)
      .toMatchObject({ AutoReplyState: 1, ExternalAudience: 2 });
  });

  test("разбор ответа Exchange 2019: числа, HTML, время со смещением", () => {
    expect(parseOWAOutOfOfficeResponse(kGetResponse)).toEqual({
      state: "Scheduled",
      externalAudience: "Known",
      start: new Date("2026-10-05T07:00:00Z"),
      end: new Date("2026-10-19T16:00:00Z"),
      internalReply: "<html><body><p>Вернусь <b>19-го</b>.</p></body></html>",
      externalReply: "<p>I am out of office.</p>",
      allowExternal: "All",
    });
  });

  test("разбор ответа Exchange 2013", () => {
    let response = JSON.parse(String.raw`{"Header":{"ServerVersionInfo":{"MajorVersion":15,"MinorVersion":0,"MajorBuildNumber":1497,"MinorBuildNumber":0,"Version":"V2_23"}},"ErrorCode":0,"ErrorMessage":null,"UserPrompt":null,"WasSuccessful":true,"Options":{"AutoReplyState":0,"EndTime":"2026-10-23T16:00:00Z","ExternalAudience":2,"ExternalMessage":"","ExternalMessageText":"\u000d\u000a","InternalMessage":"","InternalMessageText":"\u000d\u000a","StartTime":"2026-10-22T16:00:00Z"}}`);
    let settings = parseOWAOutOfOfficeResponse(response);
    expect(settings.state).toBe("Disabled");
    expect(settings.externalAudience).toBe("All");
    expect(settings.internalReply).toBe("");
    expect(settings.start).toEqual(new Date("2026-10-22T16:00:00Z"));
  });

  test("ошибка: WasSuccessful false", () => {
    let failed = { ErrorCode: 5, ErrorMessage: "Access is denied.", WasSuccessful: false };
    expect(() => parseOWAOutOfOfficeResponse(failed)).toThrow("Access is denied.");
    expect(() => checkOWAOutOfOfficeResponse(failed)).toThrow("Access is denied.");
    expect(() => checkOWAOutOfOfficeResponse({ ErrorCode: 0, WasSuccessful: true })).not.toThrow();
    expect(() => parseOWAOutOfOfficeResponse({ WasSuccessful: true })).toThrow();
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

describe("OWA: запросы через OWAAccount", () => {
  let calls: { url: string, action: string, body: string }[] = [];
  let responses: any[] = [];

  beforeEach(() => {
    appGlobal.remoteApp = { OWA: {} } as any;
    calls = [];
    vi.stubGlobal("fetch", async (url: string, options: any) => {
      calls.push({ url, action: options.headers.Action, body: options.body });
      let json = responses.shift();
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        headers: new Headers({ "Content-Type": "application/json; charset=utf-8" }),
        text: async () => JSON.stringify(json),
        json: async () => json,
      };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function newAccount(): OWAAccount {
    let account = new OWAAccount();
    (account as any).hasLoggedIn = true;
    account.url = "https://mail.example.com/owa/";
    account.emailAddress = "ivan@example.com";
    account.authorizationHeader = "Bearer TEST";
    return account;
  }

  test("читает, выключает и сохраняет", async () => {
    let account = newAccount();
    responses = [{ WasSuccessful: true, ErrorCode: 0, Options: { AutoReplyState: 1, ExternalAudience: 2, InternalMessage: "<p>Нет</p>", ExternalMessage: "" } }];
    let settings = await account.loadOutOfOffice();
    expect(calls[0].url).toBe("https://mail.example.com/owa/service.svc?action=GetMailboxAutoReplyConfiguration&EP=1");
    expect(calls[0].action).toBe("GetMailboxAutoReplyConfiguration");
    expect(calls[0].body).toBe("{}");
    expect(settings.state).toBe("Enabled");
    expect(isOutOfOfficeActive(account.outOfOffice)).toBe(true);

    responses = [{ WasSuccessful: true, ErrorCode: 0 }];
    await account.turnOffOutOfOffice();
    expect(calls[1].action).toBe("SetMailboxAutoReplyConfiguration");
    expect(JSON.parse(calls[1].body).Options).toMatchObject({ AutoReplyState: 0, ExternalAudience: 2, InternalMessage: "<p>Нет</p>" });
    expect(account.outOfOffice.state).toBe("Disabled");
  });

  test("ошибка сохранения не меняет состояние", async () => {
    let account = newAccount();
    responses = [{ WasSuccessful: true, ErrorCode: 0, Options: { AutoReplyState: 1, ExternalAudience: 0 } }];
    await account.loadOutOfOffice();
    responses = [{ WasSuccessful: false, ErrorCode: 7, ErrorMessage: "Access is denied." }];
    await expect(account.turnOffOutOfOffice()).rejects.toThrow("Access is denied.");
    expect(account.outOfOffice.state).toBe("Enabled");
  });
});
