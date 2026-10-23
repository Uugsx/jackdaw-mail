// @vitest-environment happy-dom

import { appGlobal } from "../../../../logic/app"; // Avoid import cycle
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import {
  checkInboxRulesResponse, checkOWAInboxRulesResponse, ewsGetInboxRulesRequest, ewsUpdateInboxRulesRequest,
  hasInboxRuleAction, hasInboxRuleCondition, isInboxRuleReadOnly, isOutlookRuleBlobError, newInboxRule,
  owaCreatedInboxRuleID, owaEnableInboxRuleRequest, owaGetInboxRulesRequest, owaInboxRuleRequest, parseInboxRule,
  parseInboxRulesResponse, parseOWAInboxRulesResponse, splitInboxRuleList, type InboxRule,
} from "../../../../logic/Mail/EWS/InboxRules";
import { describe, expect, test } from "vitest";

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

function childTags(element: Element): string[] {
  return [...element.children].map(child => child.tagName);
}

function simpleRule(): InboxRule {
  let rule = newInboxRule();
  rule.id = "AQAAAAAAAA1";
  rule.name = "Счета";
  rule.priority = 2;
  rule.conditions.from = [{ name: "Бухгалтерия", address: "buh@example.com" }];
  rule.conditions.subjectContains = ["счёт", "invoice"];
  rule.conditions.hasAttachments = true;
  rule.conditions.importance = "High";
  rule.actions.moveTo = { id: "AAMkFolder1", distinguishedId: null };
  rule.actions.markAsRead = true;
  rule.actions.categories = ["Финансы"];
  rule.actions.stopProcessing = true;
  return rule;
}

const kGetInboxRules = `
<GetInboxRulesResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
  <ResponseCode>NoError</ResponseCode>
  <OutlookRuleBlobExists>true</OutlookRuleBlobExists>
  <InboxRules>
    <t:Rule xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <t:RuleId>RULE-2</t:RuleId>
      <t:DisplayName>Рассылки</t:DisplayName>
      <t:Priority>2</t:Priority>
      <t:IsEnabled>false</t:IsEnabled>
      <t:IsNotSupported>false</t:IsNotSupported>
      <t:IsInError>false</t:IsInError>
      <t:Conditions>
        <t:ContainsSubjectStrings><t:String>[news]</t:String></t:ContainsSubjectStrings>
        <t:SentToAddresses>
          <t:Address><t:Name>Отдел</t:Name><t:EmailAddress>team@example.com</t:EmailAddress><t:RoutingType>SMTP</t:RoutingType></t:Address>
          <t:Address><t:EmailAddress>all@example.com</t:EmailAddress></t:Address>
        </t:SentToAddresses>
      </t:Conditions>
      <t:Exceptions />
      <t:Actions>
        <t:MoveToFolder><t:DistinguishedFolderId Id="junkemail" /></t:MoveToFolder>
        <t:ForwardToRecipients><t:Address><t:EmailAddress>me@example.org</t:EmailAddress></t:Address></t:ForwardToRecipients>
      </t:Actions>
    </t:Rule>
    <t:Rule xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <t:RuleId>RULE-1</t:RuleId>
      <t:DisplayName>Счета</t:DisplayName>
      <t:Priority>1</t:Priority>
      <t:IsEnabled>true</t:IsEnabled>
      <t:Conditions>
        <t:ContainsBodyStrings><t:String>оплата</t:String><t:String>счёт</t:String></t:ContainsBodyStrings>
        <t:FromAddresses><t:Address><t:Name>Бухгалтерия</t:Name><t:EmailAddress>buh@example.com</t:EmailAddress></t:Address></t:FromAddresses>
        <t:HasAttachments>true</t:HasAttachments>
        <t:Importance>High</t:Importance>
      </t:Conditions>
      <t:Actions>
        <t:AssignCategories><t:String>Финансы</t:String></t:AssignCategories>
        <t:CopyToFolder><t:FolderId Id="AAMkFolder1" ChangeKey="CK1" /></t:CopyToFolder>
        <t:Delete>true</t:Delete>
        <t:MarkAsRead>true</t:MarkAsRead>
        <t:StopProcessingRules>true</t:StopProcessingRules>
      </t:Actions>
    </t:Rule>
    <t:Rule xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
      <t:RuleId>RULE-3</t:RuleId>
      <t:DisplayName>Из Outlook</t:DisplayName>
      <t:Priority>3</t:Priority>
      <t:IsEnabled>true</t:IsEnabled>
      <t:Conditions>
        <t:IsMeetingRequest>true</t:IsMeetingRequest>
      </t:Conditions>
      <t:Exceptions>
        <t:ContainsSubjectStrings><t:String>важно</t:String></t:ContainsSubjectStrings>
      </t:Exceptions>
      <t:Actions>
        <t:ServerReplyWithMessage><t:ItemId Id="TPL" /></t:ServerReplyWithMessage>
      </t:Actions>
    </t:Rule>
  </InboxRules>
</GetInboxRulesResponse>`;

describe("EWS: разбор GetInboxRules", () => {
  test("правила по порядку, все поддержанные условия и действия", () => {
    let list = parseInboxRulesResponse(ewsResponse(kGetInboxRules));
    expect(list.outlookRuleBlobExists).toBe(true);
    expect(list.rules.map(rule => rule.id)).toEqual(["RULE-1", "RULE-2", "RULE-3"]);

    let [bills, news] = list.rules;
    expect(bills.name).toBe("Счета");
    expect(bills.enabled).toBe(true);
    expect(bills.conditions).toEqual({
      from: [{ name: "Бухгалтерия", address: "buh@example.com" }],
      sentTo: [],
      subjectContains: [],
      bodyContains: ["оплата", "счёт"],
      importance: "High",
      hasAttachments: true,
    });
    expect(bills.actions).toEqual({
      moveTo: null,
      copyTo: { id: "AAMkFolder1", distinguishedId: null },
      delete: true,
      markAsRead: true,
      categories: ["Финансы"],
      forwardTo: [],
      stopProcessing: true,
    });
    expect(isInboxRuleReadOnly(bills)).toBe(false);

    expect(news.enabled).toBe(false);
    expect(news.conditions.subjectContains).toEqual(["[news]"]);
    expect(news.conditions.sentTo).toEqual([
      { name: "Отдел", address: "team@example.com", routingType: "SMTP" },
      { name: "", address: "all@example.com" },
    ]);
    expect(news.actions.moveTo).toEqual({ id: null, distinguishedId: "junkemail" });
    expect(news.actions.forwardTo).toEqual([{ name: "", address: "me@example.org" }]);
    expect(isInboxRuleReadOnly(news)).toBe(false);
  });

  test("непонятые условия, исключения и действия — только чтение", () => {
    let outlook = parseInboxRulesResponse(ewsResponse(kGetInboxRules)).rules[2];
    expect(isInboxRuleReadOnly(outlook)).toBe(true);
    expect(outlook.unsupported).toEqual([
      "Conditions.IsMeetingRequest",
      "Exceptions.ContainsSubjectStrings",
      "Actions.ServerReplyWithMessage",
    ]);
  });

  test("IsNotSupported, «без вложений» и неизвестная важность — только чтение", () => {
    expect(isInboxRuleReadOnly(parseInboxRule({ RuleId: "1", IsNotSupported: "true", Actions: { Delete: "true" } }))).toBe(true);
    expect(isInboxRuleReadOnly(parseInboxRule({ RuleId: "1", Conditions: { HasAttachments: "false" } }))).toBe(true);
    expect(isInboxRuleReadOnly(parseInboxRule({ RuleId: "1", Conditions: { Importance: "Urgent" } }))).toBe(true);
  });

  test("пустой список правил", () => {
    let list = parseInboxRulesResponse(ewsResponse(`
<GetInboxRulesResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
  <ResponseCode>NoError</ResponseCode>
  <OutlookRuleBlobExists>false</OutlookRuleBlobExists>
  <InboxRules />
</GetInboxRulesResponse>`));
    expect(list).toEqual({ rules: [], outlookRuleBlobExists: false });
  });

  test("ошибка UpdateInboxRules: EWSItemError с кодом, клиентские правила Outlook узнаются", () => {
    let error: any;
    try {
      ewsResponse(`
<UpdateInboxRulesResponse ResponseClass="Error" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
  <MessageText>Outlook rule blob exists.</MessageText>
  <ResponseCode>ErrorOutlookRuleBlobExists</ResponseCode>
</UpdateInboxRulesResponse>`);
    } catch (ex) {
      error = ex;
    }
    expect(error).toBeInstanceOf(EWSItemError);
    expect(error.type).toBe("ErrorOutlookRuleBlobExists");
    expect(isOutlookRuleBlobError(error)).toBe(true);
    expect(isOutlookRuleBlobError(new Error("x"))).toBe(false);
  });

  test("ошибка проверки правила по EWS: текст сервера с подробностями", () => {
    expect(() => ewsResponse(`
<UpdateInboxRulesResponse ResponseClass="Error" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
  <MessageText>Validation error.</MessageText>
  <ResponseCode>ErrorInboxRulesValidationError</ResponseCode>
  <RuleOperationErrors><RuleOperationError><OperationIndex>0</OperationIndex><ValidationErrors>
    <Error><FieldURI>MoveToFolder</FieldURI><ErrorCode>InvalidValue</ErrorCode><ErrorMessage>Folder not found.</ErrorMessage></Error>
  </ValidationErrors></RuleOperationError></RuleOperationErrors>
</UpdateInboxRulesResponse>`)).toThrow("Validation error. Folder not found.");
  });

  test("checkInboxRulesResponse: текст ошибок проверки правил", () => {
    expect(() => checkInboxRulesResponse({
      ResponseClass: "Error",
      ResponseCode: "ErrorInboxRulesValidationError",
      MessageText: "Validation error.",
      RuleOperationErrors: {
        RuleOperationError: {
          OperationIndex: "0",
          ValidationErrors: { Error: { FieldURI: "MoveToFolder", ErrorCode: "InvalidValue", ErrorMessage: "Folder not found." } },
        },
      },
    })).toThrow("Validation error. Folder not found.");
    expect(() => checkInboxRulesResponse({ ResponseClass: "Success" })).not.toThrow();
  });
});

describe("EWS: формирование XML", () => {
  test("GetInboxRules", () => {
    let doc = requestXML(ewsGetInboxRulesRequest());
    expect(doc.getElementsByTagName("m:GetInboxRules")[0]).toBeTruthy();
  });

  test("SetRuleOperation: порядок элементов по схеме", () => {
    let doc = requestXML(ewsUpdateInboxRulesRequest([{ kind: "set", rule: simpleRule() }]));
    let update = doc.getElementsByTagName("m:UpdateInboxRules")[0];
    expect(childTags(update)).toEqual(["m:RemoveOutlookRuleBlob", "m:Operations"]);
    expect(update.getElementsByTagName("m:RemoveOutlookRuleBlob")[0].textContent).toBe("false");
    let rule = update.getElementsByTagName("t:SetRuleOperation")[0].getElementsByTagName("t:Rule")[0];
    expect(childTags(rule)).toEqual(["t:RuleId", "t:DisplayName", "t:Priority", "t:IsEnabled", "t:Conditions", "t:Actions"]);
    expect(rule.getElementsByTagName("t:RuleId")[0].textContent).toBe("AQAAAAAAAA1");
    expect(rule.getElementsByTagName("t:Priority")[0].textContent).toBe("2");
    let conditions = rule.getElementsByTagName("t:Conditions")[0];
    expect(childTags(conditions)).toEqual(["t:ContainsSubjectStrings", "t:FromAddresses", "t:HasAttachments", "t:Importance"]);
    expect([...conditions.getElementsByTagName("t:String")].map(e => e.textContent)).toEqual(["счёт", "invoice"]);
    let from = conditions.getElementsByTagName("t:Address")[0];
    expect(childTags(from)).toEqual(["t:Name", "t:EmailAddress"]);
    expect(from.getElementsByTagName("t:EmailAddress")[0].textContent).toBe("buh@example.com");
    let actions = rule.getElementsByTagName("t:Actions")[0];
    expect(childTags(actions)).toEqual(["t:AssignCategories", "t:MarkAsRead", "t:MoveToFolder", "t:StopProcessingRules"]);
    let folder = actions.getElementsByTagName("t:MoveToFolder")[0].firstElementChild;
    expect(folder.tagName).toBe("t:FolderId");
    expect(folder.getAttribute("Id")).toBe("AAMkFolder1");
  });

  test("все действия: порядок по схеме, стандартная папка", () => {
    let rule = simpleRule();
    rule.actions.copyTo = { id: null, distinguishedId: "archive" };
    rule.actions.delete = true;
    rule.actions.forwardTo = [{ name: "", address: "boss@example.com", routingType: "SMTP" }];
    rule.conditions.bodyContains = ["оплата"];
    rule.conditions.sentTo = [{ name: "", address: "me@example.com" }];
    let doc = requestXML(ewsUpdateInboxRulesRequest([{ kind: "create", rule }]));
    let created = doc.getElementsByTagName("t:CreateRuleOperation")[0].getElementsByTagName("t:Rule")[0];
    expect(childTags(created)[0]).toBe("t:DisplayName"); // без RuleId
    expect(childTags(created.getElementsByTagName("t:Conditions")[0])).toEqual([
      "t:ContainsBodyStrings", "t:ContainsSubjectStrings", "t:FromAddresses", "t:HasAttachments", "t:Importance", "t:SentToAddresses",
    ]);
    expect(childTags(created.getElementsByTagName("t:Actions")[0])).toEqual([
      "t:AssignCategories", "t:CopyToFolder", "t:Delete", "t:ForwardToRecipients", "t:MarkAsRead", "t:MoveToFolder", "t:StopProcessingRules",
    ]);
    let copy = created.getElementsByTagName("t:CopyToFolder")[0].firstElementChild;
    expect(copy.tagName).toBe("t:DistinguishedFolderId");
    expect(copy.getAttribute("Id")).toBe("archive");
    let forward = created.getElementsByTagName("t:ForwardToRecipients")[0].getElementsByTagName("t:Address")[0];
    expect(childTags(forward)).toEqual(["t:EmailAddress", "t:RoutingType"]);
  });

  test("создание, изменение и удаление в одном запросе; согласие на удаление правил Outlook", () => {
    let created = simpleRule();
    created.id = null;
    let doc = requestXML(ewsUpdateInboxRulesRequest([
      { kind: "delete", id: "RULE-9" },
      { kind: "create", rule: created },
      { kind: "set", rule: simpleRule() },
    ], true));
    let operations = doc.getElementsByTagName("m:Operations")[0];
    expect(childTags(operations)).toEqual(["t:CreateRuleOperation", "t:SetRuleOperation", "t:DeleteRuleOperation"]);
    expect(operations.getElementsByTagName("t:DeleteRuleOperation")[0].textContent).toBe("RULE-9");
    expect(doc.getElementsByTagName("m:RemoveOutlookRuleBlob")[0].textContent).toBe("true");
  });

  test("правило из Outlook не отправляется: оно стёрло бы непонятые части", () => {
    let outlook = parseInboxRulesResponse(ewsResponse(kGetInboxRules)).rules[2];
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "set", rule: { ...outlook, enabled: false } }])).toThrow();
    expect(() => owaInboxRuleRequest({ kind: "set", rule: outlook })).toThrow();
    // Удалять можно
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "delete", id: outlook.id }])).not.toThrow();
  });

  test("без названия, без действия или без ID для изменения — ошибка", () => {
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "set", rule: { ...simpleRule(), name: " " } }])).toThrow();
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "set", rule: { ...simpleRule(), id: null } }])).toThrow();
    let noAction = simpleRule();
    noAction.actions = newInboxRule().actions;
    noAction.actions.stopProcessing = true;
    expect(hasInboxRuleAction(noAction)).toBe(false);
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "create", rule: noAction }])).toThrow();
    expect(() => ewsUpdateInboxRulesRequest([{ kind: "delete", id: "" }])).toThrow();
  });

  test("разбор и формирование не теряют поддержанных полей", () => {
    let parsed = parseInboxRulesResponse(ewsResponse(kGetInboxRules)).rules;
    for (let rule of parsed.filter(rule => !isInboxRuleReadOnly(rule))) {
      let xml = new EWSAccount().request2XML(ewsUpdateInboxRulesRequest([{ kind: "set", rule }]));
      let ruleXML = xml.slice(xml.indexOf("<t:Rule>"), xml.indexOf("</t:Rule>") + "</t:Rule>".length)
        .replace(/<(\/?)t:/g, "<$1");
      let reparsed = parseInboxRule(new EWSAccount().checkResponse({
        responseXML: new EWSAccount().parseXML(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
<GetInboxRulesResponse ResponseClass="Success"><InboxRules>${ruleXML}</InboxRules></GetInboxRulesResponse></s:Body></s:Envelope>`),
      }, {} as any).InboxRules.Rule);
      expect(reparsed).toEqual(rule);
    }
  });
});

describe("OWA: команды настроек", () => {
  const kGetInboxRule = {
    WasSuccessful: true,
    InboxRuleCollection: {
      InboxRules: [{
        Identity: { RawIdentity: "ivan\\2" },
        Name: "Без поддержки",
        Priority: 2,
        Enabled: false,
        SupportedByTask: true,
        RecipientAddressContainsWords: ["list"],
        MarkAsRead: true,
        From: null,
        HasAttachment: false,
      }, {
        Identity: { RawIdentity: "ivan\\1" },
        Name: "Шеф",
        Priority: 1,
        Enabled: true,
        InError: false,
        SupportedByTask: true,
        Description: "If the message: from Шеф...",
        From: [{ SmtpAddress: "boss@example.com", DisplayName: "Шеф", RoutingType: "SMTP" }],
        SubjectContainsWords: ["срочно"],
        WithImportance: "High",
        HasAttachment: true,
        MoveToFolder: { RawIdentity: "LgAAAA1", DisplayName: "Важное" },
        ApplyCategory: ["Красная"],
        ForwardTo: [{ SmtpAddress: "me@example.org", DisplayName: "me@example.org" }],
        StopProcessingRules: true,
        DeleteMessage: false,
        CopyToFolder: null,
      }, {
        Identity: { RawIdentity: "ivan\\3" },
        Name: "Из Outlook",
        Priority: 3,
        SupportedByTask: false,
        MarkAsRead: true,
      }],
    },
  };

  test("GetInboxRule: запрос без Body, параметры рядом с Header", () => {
    let request = owaGetInboxRulesRequest();
    expect(request.action).toBe("GetInboxRule");
    expect(request.__type).toBe("GetInboxRuleRequest:#Exchange");
    expect(JSON.parse(JSON.stringify(request))).toEqual({
      __type: "GetInboxRuleRequest:#Exchange",
      Header: { __type: "JsonRequestHeaders:#Exchange", RequestServerVersion: "Exchange2013" },
    });
  });

  test("разбор GetInboxRule: порядок, поддержанные поля, только чтение", () => {
    let list = parseOWAInboxRulesResponse(kGetInboxRule);
    expect(list.outlookRuleBlobExists).toBe(false);
    let [boss, unknown, outlook] = list.rules;
    expect(boss.id).toBe("ivan\\1");
    expect(boss.enabled).toBe(true);
    expect(isInboxRuleReadOnly(boss)).toBe(false);
    expect(boss.conditions).toEqual({
      from: [{ name: "Шеф", address: "boss@example.com", routingType: "SMTP" }],
      sentTo: [],
      subjectContains: ["срочно"],
      bodyContains: [],
      importance: "High",
      hasAttachments: true,
    });
    expect(boss.actions).toEqual({
      moveTo: { id: "LgAAAA1", distinguishedId: null, name: "Важное" },
      copyTo: null,
      delete: false,
      markAsRead: false,
      categories: ["Красная"],
      forwardTo: [{ name: "me@example.org", address: "me@example.org" }],
      stopProcessing: true,
    });
    expect(unknown.enabled).toBe(false);
    expect(unknown.unsupported).toEqual(["RecipientAddressContainsWords"]);
    expect(outlook.unsupported).toEqual(["SupportedByTask"]);
  });

  test("ошибка и вопрос про правила Outlook", () => {
    expect(() => checkOWAInboxRulesResponse({ WasSuccessful: false, ErrorCode: 1, ErrorMessage: "Нет папки" }))
      .toThrow("Нет папки");
    let error: any;
    try {
      checkOWAInboxRulesResponse({ WasSuccessful: false, ErrorCode: 4, UserPrompt: "Delete Outlook rules?" });
    } catch (ex) {
      error = ex;
    }
    expect(isOutlookRuleBlobError(error)).toBe(true);
    expect(() => checkOWAInboxRulesResponse({ WasSuccessful: true })).not.toThrow();
  });

  test("SetInboxRule: все понятые параметры, пустые — чтобы стереть, правила Outlook не трогаем", () => {
    let rule = parseOWAInboxRulesResponse(kGetInboxRule).rules[0];
    rule.conditions.importance = null;
    rule.actions.moveTo = { id: "LgAAAA1", distinguishedId: null, name: "Важное" };
    let request: any = owaInboxRuleRequest({ kind: "set", rule });
    expect(request.action).toBe("SetInboxRule");
    expect(request.__type).toBe("SetInboxRuleRequest:#Exchange");
    expect(request.AlwaysDeleteOutlookRulesBlob).toBe(false);
    expect(request.Force).toBe(false);
    expect(request.InboxRule).toEqual({
      Identity: { RawIdentity: "ivan\\1" },
      Name: "Шеф",
      Priority: 1,
      From: [{ SmtpAddress: "boss@example.com", DisplayName: "Шеф", RoutingType: "SMTP" }],
      SentTo: null,
      SubjectContainsWords: ["срочно"],
      BodyContainsWords: null,
      WithImportance: null,
      HasAttachment: true,
      MoveToFolder: { RawIdentity: "LgAAAA1", DisplayName: "Важное" },
      CopyToFolder: null,
      DeleteMessage: false,
      MarkAsRead: false,
      ApplyCategory: ["Красная"],
      ForwardTo: [{ SmtpAddress: "me@example.org", DisplayName: "me@example.org", RoutingType: "SMTP" }],
      StopProcessingRules: true,
    });
    expect((owaInboxRuleRequest({ kind: "set", rule }, true) as any).AlwaysDeleteOutlookRulesBlob).toBe(true);
  });

  test("NewInboxRule без пустых параметров; RemoveInboxRule; включение", () => {
    let rule = simpleRule();
    rule.id = null;
    let created: any = owaInboxRuleRequest({ kind: "create", rule });
    expect(created.action).toBe("NewInboxRule");
    expect(Object.keys(created.InboxRule)).toEqual([
      "Name", "Priority", "From", "SubjectContainsWords", "WithImportance", "HasAttachment", "MoveToFolder",
      "MarkAsRead", "ApplyCategory", "StopProcessingRules",
    ]);
    expect(owaCreatedInboxRuleID({ WasSuccessful: true, InboxRule: { Identity: { RawIdentity: "ivan\\9" } } })).toBe("ivan\\9");

    let removed: any = owaInboxRuleRequest({ kind: "delete", id: "ivan\\2" });
    expect(removed.action).toBe("RemoveInboxRule");
    expect(removed.Identity).toEqual({ RawIdentity: "ivan\\2" });

    expect(owaEnableInboxRuleRequest("ivan\\2", false).action).toBe("DisableInboxRule");
    expect((owaEnableInboxRuleRequest("ivan\\2", true) as any).Identity).toEqual({ RawIdentity: "ivan\\2" });
  });

  test("разбор того, что мы отправили, даёт то же правило", () => {
    let rule = parseOWAInboxRulesResponse(kGetInboxRule).rules[0];
    let request: any = owaInboxRuleRequest({ kind: "set", rule });
    let echoed = parseOWAInboxRulesResponse({
      InboxRuleCollection: { InboxRules: [{ ...request.InboxRule, Enabled: true, SupportedByTask: true }] },
    }).rules[0];
    expect(echoed).toEqual({
      ...rule,
      actions: { ...rule.actions, forwardTo: [{ ...rule.actions.forwardTo[0], routingType: "SMTP" }] },
    });
  });
});

describe("OWAAccount: цепочка команд", () => {
  function stubAccount(responses: any[]) {
    appGlobal.remoteApp ??= { OWA: {} } as any;
    let account = new OWAAccount();
    let calls: any[] = [];
    (account as any).callOWA = async (request: any) => {
      calls.push(JSON.parse(JSON.stringify({ action: request.action, ...request })));
      return responses.shift() ?? { WasSuccessful: true };
    };
    return { account, calls };
  }

  test("новое выключенное правило: NewInboxRule, затем DisableInboxRule с ID от сервера", async () => {
    let rule = simpleRule();
    rule.id = null;
    rule.enabled = false;
    let { account, calls } = stubAccount([{ WasSuccessful: true, InboxRule: { Identity: { RawIdentity: "ivan\\7" } } }]);
    await account.updateInboxRules([{ kind: "create", rule }]);
    expect(calls.map(call => call.action)).toEqual(["NewInboxRule", "DisableInboxRule"]);
    expect(calls[1].Identity).toEqual({ RawIdentity: "ivan\\7" });
  });

  test("изменение: SetInboxRule и включение; удаление: только RemoveInboxRule", async () => {
    let { account, calls } = stubAccount([]);
    await account.updateInboxRules([{ kind: "set", rule: simpleRule() }, { kind: "delete", id: "ivan\\2" }]);
    expect(calls.map(call => call.action)).toEqual(["SetInboxRule", "EnableInboxRule", "RemoveInboxRule"]);
  });

  test("вопрос про правила Outlook останавливает цепочку", async () => {
    let { account, calls } = stubAccount([{ WasSuccessful: false, ErrorCode: 4, UserPrompt: "?" }]);
    let error: any;
    try {
      await account.updateInboxRules([{ kind: "set", rule: simpleRule() }, { kind: "delete", id: "x" }]);
    } catch (ex) {
      error = ex;
    }
    expect(isOutlookRuleBlobError(error)).toBe(true);
    expect(calls.map(call => call.action)).toEqual(["SetInboxRule"]);
  });

  test("загрузка: GetInboxRule", async () => {
    let { account, calls } = stubAccount([{ WasSuccessful: true, InboxRuleCollection: { InboxRules: [] } }]);
    expect(await account.loadInboxRules()).toEqual({ rules: [], outlookRuleBlobExists: false });
    expect(calls[0].action).toBe("GetInboxRule");
  });
});

describe("вспомогательные", () => {
  test("splitInboxRuleList", () => {
    expect(splitInboxRuleList(" a@b.c, Иван <i@b.c>; ,\nx ")).toEqual(["a@b.c", "Иван <i@b.c>", "x"]);
    expect(splitInboxRuleList("")).toEqual([]);
  });

  test("hasInboxRuleCondition", () => {
    expect(hasInboxRuleCondition(newInboxRule())).toBe(false);
    expect(hasInboxRuleCondition(simpleRule())).toBe(true);
  });
});
