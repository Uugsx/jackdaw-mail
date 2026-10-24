import { OWAOptionsRequest } from "../OWA/Request/OWAOptionsRequest";

/**
 * Серверные правила входящих (Inbox Rules) Exchange.
 * Работают на сервере, даже когда Jackdaw закрыт.
 *
 * Мы понимаем только частые условия и действия. Правило, в котором есть
 * что-то ещё (исключения, другие условия, ответ шаблоном и т. п.), остаётся
 * только для чтения: его нельзя отправить на сервер через `SetRuleOperation`,
 * потому что эта операция заменяет правило целиком и стёрла бы непонятые части.
 */

export type InboxRuleImportance = "Low" | "Normal" | "High";

export interface InboxRuleAddress {
  name: string;
  address: string;
  /** Как пришло с сервера, например `EX` для внутренних адресов Exchange */
  routingType?: string;
  mailboxType?: string;
}

/** Папка из правила: обычная (`id`) или стандартная (`distinguishedId`, например `junkemail`) */
export interface InboxRuleFolder {
  id: string | null;
  distinguishedId: string | null;
  /** OWA называет папку своим ID, но сообщает её имя */
  name?: string;
}

export interface InboxRuleConditions {
  from: InboxRuleAddress[];
  sentTo: InboxRuleAddress[];
  subjectContains: string[];
  bodyContains: string[];
  importance: InboxRuleImportance | null;
  hasAttachments: boolean;
}

export interface InboxRuleActions {
  moveTo: InboxRuleFolder | null;
  copyTo: InboxRuleFolder | null;
  delete: boolean;
  markAsRead: boolean;
  categories: string[];
  forwardTo: InboxRuleAddress[];
  stopProcessing: boolean;
}

export interface InboxRule {
  /** null — новое правило, ещё не на сервере */
  id: string | null;
  name: string;
  /** 1 — выполняется первым */
  priority: number;
  enabled: boolean;
  conditions: InboxRuleConditions;
  actions: InboxRuleActions;
  /** Сервер сообщил, что правило с ошибкой (например, папка удалена) */
  inError: boolean;
  /** Что в правиле мы не понимаем. Непустой список — правило только для чтения. */
  unsupported: string[];
}

export interface InboxRuleList {
  rules: InboxRule[];
  /** Outlook хранит в ящике свои клиентские правила */
  outlookRuleBlobExists: boolean;
}

export type InboxRuleOperation =
  | { kind: "create", rule: InboxRule }
  | { kind: "set", rule: InboxRule }
  | { kind: "delete", id: string };

/** Ошибка сервера: в ящике есть клиентские правила Outlook, и он не даёт их молча удалить */
export const kOutlookRuleBlobExists = "ErrorOutlookRuleBlobExists";

const kImportance: InboxRuleImportance[] = ["Low", "Normal", "High"];

const kConditionKeys = ["FromAddresses", "SentToAddresses", "ContainsSubjectStrings", "ContainsBodyStrings", "Importance", "HasAttachments"];
const kActionKeys = ["MoveToFolder", "CopyToFolder", "Delete", "MarkAsRead", "AssignCategories", "ForwardToRecipients", "StopProcessingRules"];

/** Стандартные папки Exchange, которые бывают в правилах */
export const kDistinguishedFolderNames = ["inbox", "deleteditems", "junkemail", "drafts", "sentitems", "archive", "outbox"] as const;

export function newInboxRule(): InboxRule {
  return {
    id: null,
    name: "",
    priority: 1,
    enabled: true,
    conditions: {
      from: [],
      sentTo: [],
      subjectContains: [],
      bodyContains: [],
      importance: null,
      hasAttachments: false,
    },
    actions: {
      moveTo: null,
      copyTo: null,
      delete: false,
      markAsRead: false,
      categories: [],
      forwardTo: [],
      stopProcessing: false,
    },
    inError: false,
    unsupported: [],
  };
}

export function isInboxRuleReadOnly(rule: InboxRule): boolean {
  return rule.unsupported.length > 0;
}

export function hasInboxRuleCondition(rule: InboxRule): boolean {
  let c = rule.conditions;
  return !!(c.from.length || c.sentTo.length || c.subjectContains.length || c.bodyContains.length ||
    c.importance || c.hasAttachments);
}

export function hasInboxRuleAction(rule: InboxRule): boolean {
  let a = rule.actions;
  return !!(a.moveTo || a.copyTo || a.delete || a.markAsRead || a.categories.length || a.forwardTo.length);
}

/** Сервер с ошибкой «есть клиентские правила Outlook» */
export function isOutlookRuleBlobError(ex: any): boolean {
  return ex?.type == kOutlookRuleBlobExists || ex?.code == kOutlookRuleBlobExists ||
    ex?.error?.ResponseCode == kOutlookRuleBlobExists;
}

/** Список через запятую или точку с запятой → значения без пустых */
export function splitInboxRuleList(text: string): string[] {
  return (text ?? "").split(/[,;\n]/).map(entry => entry.trim()).filter(Boolean);
}

// Разбор

function textValue(value: any): string {
  if (value == null) {
    return "";
  }
  if (typeof value == "object") {
    // XML2JSON: элемент с атрибутами кладёт текст в `Value`
    return textValue(value.Value ?? "");
  }
  return String(value);
}

function isTrue(value: any): boolean {
  return value === true || textValue(value).trim().toLowerCase() == "true";
}

/** Значимые ключи объекта: без служебных `__type` (OWA) и `xmlns` (XML) */
function keysOf(value: any): string[] {
  if (!value || typeof value != "object") {
    return [];
  }
  return Object.keys(value).filter(key => key != "__type" && !key.startsWith("xmlns"));
}

/**
 * Список из EWS (`<t:String>`/`<t:Address>` внутри элемента) или OWA (массив).
 * Пустой элемент XML2JSON отдаёт строкой "".
 */
function listOf(value: any, childName: string): any[] {
  if (value == null || value === "") {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value == "object" && childName in value) {
    let children = value[childName];
    return Array.isArray(children) ? children : [children];
  }
  return [value];
}

function parseStrings(value: any): string[] {
  return listOf(value, "String").map(textValue).filter(Boolean);
}

function parseAddresses(value: any): InboxRuleAddress[] {
  return listOf(value, "Address").map(entry => {
    let address: InboxRuleAddress = {
      name: textValue(entry?.Name),
      address: textValue(entry?.EmailAddress),
    };
    if (entry?.RoutingType) {
      address.routingType = textValue(entry.RoutingType);
    }
    if (entry?.MailboxType) {
      address.mailboxType = textValue(entry.MailboxType);
    }
    return address;
  }).filter(address => address.address || address.name);
}

/** `<t:MoveToFolder><t:FolderId Id="…"/></t:MoveToFolder>` или с `DistinguishedFolderId` */
function parseFolder(value: any): InboxRuleFolder | null {
  if (!value || typeof value != "object") {
    return null;
  }
  let distinguished = value.DistinguishedFolderId;
  if (distinguished) {
    let id = typeof distinguished == "string" ? distinguished : textValue(distinguished.Id);
    return id ? { id: null, distinguishedId: id } : null;
  }
  let folderID = value.FolderId ?? value;
  let id = typeof folderID == "string" ? folderID : textValue(folderID?.Id);
  return id ? { id, distinguishedId: null } : null;
}

/** Разбирает одно правило EWS (XML2JSON) */
export function parseInboxRule(json: any): InboxRule {
  let rule = newInboxRule();
  rule.id = textValue(json?.RuleId) || null;
  rule.name = textValue(json?.DisplayName);
  rule.priority = Number(textValue(json?.Priority)) || 0;
  rule.enabled = isTrue(json?.IsEnabled);
  rule.inError = isTrue(json?.IsInError);
  if (isTrue(json?.IsNotSupported)) {
    rule.unsupported.push("IsNotSupported");
  }

  let conditions = json?.Conditions;
  for (let key of keysOf(conditions)) {
    if (!kConditionKeys.includes(key)) {
      rule.unsupported.push("Conditions." + key);
    }
  }
  if (conditions && typeof conditions == "object") {
    let c = rule.conditions;
    c.from = parseAddresses(conditions.FromAddresses);
    c.sentTo = parseAddresses(conditions.SentToAddresses);
    c.subjectContains = parseStrings(conditions.ContainsSubjectStrings);
    c.bodyContains = parseStrings(conditions.ContainsBodyStrings);
    if (conditions.Importance != null) {
      let importance = textValue(conditions.Importance);
      c.importance = kImportance.find(entry => entry.toLowerCase() == importance.toLowerCase()) ?? null;
      if (!c.importance) {
        rule.unsupported.push("Conditions.Importance");
      }
    }
    if (conditions.HasAttachments != null) {
      c.hasAttachments = isTrue(conditions.HasAttachments);
      if (!c.hasAttachments) {
        // «Без вложений» мы не умеем показать: при сохранении условие пропало бы
        rule.unsupported.push("Conditions.HasAttachments");
      }
    }
  }

  // Исключения не редактируем: сохранили бы правило без них
  for (let key of keysOf(json?.Exceptions)) {
    rule.unsupported.push("Exceptions." + key);
  }

  let actions = json?.Actions;
  for (let key of keysOf(actions)) {
    if (!kActionKeys.includes(key)) {
      rule.unsupported.push("Actions." + key);
    }
  }
  if (actions && typeof actions == "object") {
    let a = rule.actions;
    a.moveTo = parseFolder(actions.MoveToFolder);
    a.copyTo = parseFolder(actions.CopyToFolder);
    if (actions.MoveToFolder && !a.moveTo) {
      rule.unsupported.push("Actions.MoveToFolder");
    }
    if (actions.CopyToFolder && !a.copyTo) {
      rule.unsupported.push("Actions.CopyToFolder");
    }
    a.delete = isTrue(actions.Delete);
    a.markAsRead = isTrue(actions.MarkAsRead);
    a.categories = parseStrings(actions.AssignCategories);
    a.forwardTo = parseAddresses(actions.ForwardToRecipients);
    a.stopProcessing = isTrue(actions.StopProcessingRules);
  }
  return rule;
}

/** Разбирает ответ `GetInboxRules` (EWS) */
export function parseInboxRulesResponse(response: any): InboxRuleList {
  let body = response?.Body ?? response;
  if (!body || typeof body != "object") {
    throw new Error("GetInboxRules: empty response");
  }
  let rules = listOf(body.InboxRules, "Rule").map(parseInboxRule);
  rules.sort((a, b) => a.priority - b.priority);
  return {
    rules,
    outlookRuleBlobExists: isTrue(body.OutlookRuleBlobExists),
  };
}

/** Ошибку `GetInboxRules`/`UpdateInboxRules` сервер кладёт прямо в ответ, с подробностями по правилам */
export function checkInboxRulesResponse(response: any): void {
  let body = response?.Body ?? response;
  if (textValue(body?.ResponseClass) != "Error") {
    return;
  }
  let details = listOf(body.RuleOperationErrors, "RuleOperationError")
    .flatMap(operation => listOf(operation?.ValidationErrors, "Error"))
    .map(error => textValue(error?.ErrorMessage))
    .filter(Boolean);
  let message = [textValue(body.MessageText), ...details].filter(Boolean).join(" ") ||
    textValue(body.ResponseCode) || "Inbox rules request failed";
  let error = new Error(message);
  (error as any).type = (error as any).code = textValue(body.ResponseCode);
  throw error;
}

// Формирование запросов

function checkWritable(operation: InboxRuleOperation): void {
  if (operation.kind == "delete") {
    if (!operation.id) {
      throw new Error("Inbox rule: no ID to delete");
    }
    return;
  }
  let rule = operation.rule;
  if (isInboxRuleReadOnly(rule)) {
    // Защита от порчи: такое правило настроено в Outlook и содержит то, что мы не умеем сохранить
    throw new Error("Inbox rule: rules set up in Outlook can't be changed here");
  }
  if (operation.kind == "set" && !rule.id) {
    throw new Error("Inbox rule: no ID to change");
  }
  if (!rule.name.trim()) {
    throw new Error("Inbox rule: no name");
  }
  if (!hasInboxRuleAction(rule)) {
    throw new Error("Inbox rule: no action");
  }
}

function ewsAddresses(addresses: InboxRuleAddress[]) {
  return {
    t$Address: addresses.map(entry => {
      // Порядок элементов задан схемой EWS
      let address: Record<string, any> = {};
      if (entry.name) {
        address.t$Name = entry.name;
      }
      address.t$EmailAddress = entry.address;
      if (entry.routingType) {
        address.t$RoutingType = entry.routingType;
      }
      if (entry.mailboxType) {
        address.t$MailboxType = entry.mailboxType;
      }
      return address;
    }),
  };
}

function ewsFolder(folder: InboxRuleFolder) {
  return folder.distinguishedId
    ? { t$DistinguishedFolderId: { Id: folder.distinguishedId } }
    : { t$FolderId: { Id: folder.id } };
}

/** `<t:Rule>` для EWS. Порядок элементов задан схемой EWS. */
export function ewsInboxRule(rule: InboxRule, withID: boolean) {
  let c = rule.conditions;
  let conditions: Record<string, any> = {};
  if (c.bodyContains.length) {
    conditions.t$ContainsBodyStrings = { t$String: c.bodyContains };
  }
  if (c.subjectContains.length) {
    conditions.t$ContainsSubjectStrings = { t$String: c.subjectContains };
  }
  if (c.from.length) {
    conditions.t$FromAddresses = ewsAddresses(c.from);
  }
  if (c.hasAttachments) {
    conditions.t$HasAttachments = "true";
  }
  if (c.importance) {
    conditions.t$Importance = c.importance;
  }
  if (c.sentTo.length) {
    conditions.t$SentToAddresses = ewsAddresses(c.sentTo);
  }

  let a = rule.actions;
  let actions: Record<string, any> = {};
  if (a.categories.length) {
    actions.t$AssignCategories = { t$String: a.categories };
  }
  if (a.copyTo) {
    actions.t$CopyToFolder = ewsFolder(a.copyTo);
  }
  if (a.delete) {
    actions.t$Delete = "true";
  }
  if (a.forwardTo.length) {
    actions.t$ForwardToRecipients = ewsAddresses(a.forwardTo);
  }
  if (a.markAsRead) {
    actions.t$MarkAsRead = "true";
  }
  if (a.moveTo) {
    actions.t$MoveToFolder = ewsFolder(a.moveTo);
  }
  if (a.stopProcessing) {
    actions.t$StopProcessingRules = "true";
  }

  let result: Record<string, any> = {};
  if (withID) {
    result.t$RuleId = rule.id;
  }
  result.t$DisplayName = rule.name.trim();
  result.t$Priority = String(Math.max(1, rule.priority || 1));
  result.t$IsEnabled = rule.enabled ? "true" : "false";
  result.t$Conditions = conditions;
  result.t$Actions = actions;
  return result;
}

export function ewsGetInboxRulesRequest() {
  return {
    m$GetInboxRules: {},
  };
}

/**
 * @param removeOutlookRuleBlob Удалить клиентские правила Outlook. Только после согласия пользователя.
 */
export function ewsUpdateInboxRulesRequest(operations: InboxRuleOperation[], removeOutlookRuleBlob = false) {
  operations.forEach(checkWritable);
  let creates = [];
  let sets = [];
  let deletes = [];
  for (let operation of operations) {
    if (operation.kind == "create") {
      creates.push({ t$Rule: ewsInboxRule(operation.rule, false) });
    } else if (operation.kind == "set") {
      sets.push({ t$Rule: ewsInboxRule(operation.rule, true) });
    } else {
      deletes.push({ t$RuleId: operation.id });
    }
  }
  // Одинаковые операции идут подряд: JSON2XML повторяет элемент для массива
  let list: Record<string, any> = {};
  if (creates.length) {
    list.t$CreateRuleOperation = creates;
  }
  if (sets.length) {
    list.t$SetRuleOperation = sets;
  }
  if (deletes.length) {
    list.t$DeleteRuleOperation = deletes;
  }
  return {
    m$UpdateInboxRules: {
      m$RemoveOutlookRuleBlob: removeOutlookRuleBlob ? "true" : "false",
      m$Operations: list,
    },
  };
}

// OWA: команды настроек, как PowerShell `Get-InboxRule`/`New-InboxRule`/`Set-InboxRule`.
// JSON-вариант `GetInboxRules`/`UpdateInboxRules` в service.svc сервер не принимает.

/** Поля, которые сервер заполняет сам или которые только описывают правило */
const kOWAOutputOnly = ["__type", "Identity", "Name", "Priority", "Enabled", "InError", "SupportedByTask",
  "Description", "DescriptionTimeFormat", "DescriptionTimeZone", "WarningMessages"];
const kOWAKnown = ["From", "SentTo", "SubjectContainsWords", "BodyContainsWords", "WithImportance", "HasAttachment",
  "MoveToFolder", "CopyToFolder", "DeleteMessage", "MarkAsRead", "ApplyCategory", "ForwardTo", "StopProcessingRules"];
/** Ответ команды настроек: «Спросить пользователя», единственный вопрос — удалить ли правила Outlook */
const kOWAPromptUser = 4;

function isOWAEmpty(value: any): boolean {
  return value == null || value === false || value === "" || (Array.isArray(value) && !value.length);
}

function owaPeople(value: any): InboxRuleAddress[] {
  return listOf(value, "").map(entry => {
    let address: InboxRuleAddress = {
      name: textValue(entry?.DisplayName),
      address: textValue(entry?.SmtpAddress ?? entry?.EmailAddress),
    };
    if (entry?.RoutingType) {
      address.routingType = textValue(entry.RoutingType);
    }
    return address;
  }).filter(address => address.address || address.name);
}

function owaFolderRef(value: any): InboxRuleFolder | null {
  let id = textValue(value?.RawIdentity);
  if (!id) {
    return null;
  }
  let folder: InboxRuleFolder = { id, distinguishedId: null };
  let name = textValue(value?.DisplayName);
  if (name) {
    folder.name = name;
  }
  return folder;
}

/** Разбирает `InboxRule` из ответа `GetInboxRule` */
export function parseOWAInboxRule(json: any): InboxRule {
  let rule = newInboxRule();
  rule.id = textValue(json?.Identity?.RawIdentity) || null;
  rule.name = textValue(json?.Name);
  rule.priority = Number(json?.Priority) || 0;
  rule.enabled = json?.Enabled !== false;
  rule.inError = json?.InError === true;
  if (json?.SupportedByTask === false) {
    rule.unsupported.push("SupportedByTask");
  }
  for (let key of keysOf(json)) {
    if (!kOWAOutputOnly.includes(key) && !kOWAKnown.includes(key) && !isOWAEmpty(json[key])) {
      rule.unsupported.push(key);
    }
  }
  let c = rule.conditions;
  c.from = owaPeople(json?.From);
  c.sentTo = owaPeople(json?.SentTo);
  c.subjectContains = parseStrings(json?.SubjectContainsWords);
  c.bodyContains = parseStrings(json?.BodyContainsWords);
  if (!isOWAEmpty(json?.WithImportance)) {
    let importance = textValue(json.WithImportance);
    c.importance = kImportance.find(entry => entry.toLowerCase() == importance.toLowerCase()) ?? null;
    if (!c.importance) {
      rule.unsupported.push("WithImportance");
    }
  }
  c.hasAttachments = json?.HasAttachment === true;

  let a = rule.actions;
  a.moveTo = owaFolderRef(json?.MoveToFolder);
  a.copyTo = owaFolderRef(json?.CopyToFolder);
  for (let key of ["MoveToFolder", "CopyToFolder"]) {
    if (!isOWAEmpty(json?.[key]) && !owaFolderRef(json[key])) {
      rule.unsupported.push(key);
    }
  }
  a.delete = json?.DeleteMessage === true;
  a.markAsRead = json?.MarkAsRead === true;
  a.categories = parseStrings(json?.ApplyCategory);
  a.forwardTo = owaPeople(json?.ForwardTo);
  a.stopProcessing = json?.StopProcessingRules === true;
  return rule;
}

/** Разбирает ответ `GetInboxRule` */
export function parseOWAInboxRulesResponse(response: any): InboxRuleList {
  checkOWAInboxRulesResponse(response);
  let rules = listOf(response?.InboxRuleCollection?.InboxRules, "").map(parseOWAInboxRule);
  rules.sort((a, b) => a.priority - b.priority);
  // OWA сообщает о правилах Outlook только в ответ на изменение
  return { rules, outlookRuleBlobExists: false };
}

/** Команды настроек OWA сообщают об ошибке через HTTP 200 и `WasSuccessful: false` */
export function checkOWAInboxRulesResponse(response: any): void {
  if (response?.WasSuccessful !== false) {
    return;
  }
  let promptUser = response.ErrorCode == kOWAPromptUser || response.ErrorCode == "PromptUser";
  let error = new Error(textValue(response.ErrorMessage) || textValue(response.UserPrompt) ||
    "Inbox rules request failed (ErrorCode " + response.ErrorCode + ")");
  (error as any).type = (error as any).code = promptUser ? kOutlookRuleBlobExists : response.ErrorCode;
  throw error;
}

function owaPeopleParameter(addresses: InboxRuleAddress[]) {
  return addresses.length
    ? addresses.map(entry => ({
      SmtpAddress: entry.address,
      DisplayName: entry.name || entry.address,
      RoutingType: entry.routingType ?? "SMTP",
    }))
    : null;
}

function owaFolderParameter(folder: InboxRuleFolder | null) {
  return folder ? { RawIdentity: folder.id ?? folder.distinguishedId, DisplayName: folder.name ?? "" } : null;
}

/**
 * Все параметры, которые мы понимаем. Пустые — `null`/`false`: так `SetInboxRule`
 * убирает условие, которое пользователь стёр. Остальные параметры сервер не трогает.
 */
export function owaInboxRuleParameters(rule: InboxRule): Record<string, any> {
  let c = rule.conditions;
  let a = rule.actions;
  return {
    Name: rule.name.trim(),
    Priority: Math.max(1, rule.priority || 1),
    From: owaPeopleParameter(c.from),
    SentTo: owaPeopleParameter(c.sentTo),
    SubjectContainsWords: c.subjectContains.length ? c.subjectContains : null,
    BodyContainsWords: c.bodyContains.length ? c.bodyContains : null,
    WithImportance: c.importance,
    HasAttachment: c.hasAttachments,
    MoveToFolder: owaFolderParameter(a.moveTo),
    CopyToFolder: owaFolderParameter(a.copyTo),
    DeleteMessage: a.delete,
    MarkAsRead: a.markAsRead,
    ApplyCategory: a.categories.length ? a.categories : null,
    ForwardTo: owaPeopleParameter(a.forwardTo),
    StopProcessingRules: a.stopProcessing,
  };
}

export function owaGetInboxRulesRequest(): OWAOptionsRequest {
  return new OWAOptionsRequest("GetInboxRule");
}

/**
 * Запрос для одной операции. Включение и выключение — отдельной командой:
 * см. `owaEnableInboxRuleRequest()`.
 * @param removeOutlookRuleBlob Удалить клиентские правила Outlook. Только после согласия пользователя.
 */
export function owaInboxRuleRequest(operation: InboxRuleOperation, removeOutlookRuleBlob = false): OWAOptionsRequest {
  checkWritable(operation);
  let outlookRules = { AlwaysDeleteOutlookRulesBlob: removeOutlookRuleBlob, Force: false };
  if (operation.kind == "delete") {
    return new OWAOptionsRequest("RemoveInboxRule", { Identity: { RawIdentity: operation.id }, ...outlookRules });
  }
  let parameters = owaInboxRuleParameters(operation.rule);
  if (operation.kind == "create") {
    // У нового правила пустые параметры не нужны
    for (let [key, value] of Object.entries(parameters)) {
      if (isOWAEmpty(value)) {
        delete parameters[key];
      }
    }
    return new OWAOptionsRequest("NewInboxRule", { InboxRule: parameters, ...outlookRules });
  }
  return new OWAOptionsRequest("SetInboxRule", {
    InboxRule: { Identity: { RawIdentity: operation.rule.id }, ...parameters },
    ...outlookRules,
  });
}

export function owaEnableInboxRuleRequest(id: string, enabled: boolean, removeOutlookRuleBlob = false): OWAOptionsRequest {
  return new OWAOptionsRequest(enabled ? "EnableInboxRule" : "DisableInboxRule", {
    Identity: { RawIdentity: id },
    AlwaysDeleteOutlookRulesBlob: removeOutlookRuleBlob,
    Force: false,
  });
}

/** ID правила из ответа `NewInboxRule` */
export function owaCreatedInboxRuleID(response: any): string | null {
  return textValue(response?.InboxRule?.Identity?.RawIdentity) || null;
}
