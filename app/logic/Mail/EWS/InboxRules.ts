import { OWARequest } from "../OWA/Request/OWARequest";

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
  // OWA: `{ BaseFolderId: { __type: "DistinguishedFolderId:#Exchange", Id } }`
  let base = value.BaseFolderId;
  if (base && typeof base == "object") {
    value = String(base.__type).startsWith("DistinguishedFolderId")
      ? { DistinguishedFolderId: base }
      : { FolderId: base };
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

/** Разбирает одно правило из EWS (XML2JSON) или OWA (JSON): поля называются одинаково */
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

/** Разбирает ответ `GetInboxRules` (EWS или OWA) */
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

function owaAddresses(addresses: InboxRuleAddress[]) {
  return addresses.map(entry => {
    let address: Record<string, any> = {
      __type: "EmailAddress:#Exchange",
      EmailAddress: entry.address,
    };
    if (entry.name) {
      address.Name = entry.name;
    }
    if (entry.routingType) {
      address.RoutingType = entry.routingType;
    }
    if (entry.mailboxType) {
      address.MailboxType = entry.mailboxType;
    }
    return address;
  });
}

function owaFolder(folder: InboxRuleFolder) {
  return {
    __type: "TargetFolderId:#Exchange",
    BaseFolderId: folder.distinguishedId
      ? { __type: "DistinguishedFolderId:#Exchange", Id: folder.distinguishedId }
      : { __type: "FolderId:#Exchange", Id: folder.id },
  };
}

/** Правило для OWA (JSON service.svc) */
export function owaInboxRule(rule: InboxRule, withID: boolean) {
  let c = rule.conditions;
  let conditions: Record<string, any> = { __type: "RulePredicates:#Exchange" };
  if (c.bodyContains.length) {
    conditions.ContainsBodyStrings = c.bodyContains;
  }
  if (c.subjectContains.length) {
    conditions.ContainsSubjectStrings = c.subjectContains;
  }
  if (c.from.length) {
    conditions.FromAddresses = owaAddresses(c.from);
  }
  if (c.hasAttachments) {
    conditions.HasAttachments = true;
  }
  if (c.importance) {
    conditions.Importance = c.importance;
  }
  if (c.sentTo.length) {
    conditions.SentToAddresses = owaAddresses(c.sentTo);
  }

  let a = rule.actions;
  let actions: Record<string, any> = { __type: "RuleActions:#Exchange" };
  if (a.categories.length) {
    actions.AssignCategories = a.categories;
  }
  if (a.copyTo) {
    actions.CopyToFolder = owaFolder(a.copyTo);
  }
  if (a.delete) {
    actions.Delete = true;
  }
  if (a.forwardTo.length) {
    actions.ForwardToRecipients = owaAddresses(a.forwardTo);
  }
  if (a.markAsRead) {
    actions.MarkAsRead = true;
  }
  if (a.moveTo) {
    actions.MoveToFolder = owaFolder(a.moveTo);
  }
  if (a.stopProcessing) {
    actions.StopProcessingRules = true;
  }

  let result: Record<string, any> = { __type: "Rule:#Exchange" };
  if (withID) {
    result.RuleId = rule.id;
  }
  result.DisplayName = rule.name.trim();
  result.Priority = Math.max(1, rule.priority || 1);
  result.IsEnabled = rule.enabled;
  result.Conditions = conditions;
  result.Actions = actions;
  return result;
}

export function owaGetInboxRulesRequest(): OWARequest {
  return new OWARequest("GetInboxRules", {
    __type: "GetInboxRulesRequest:#Exchange",
  });
}

export function owaUpdateInboxRulesRequest(operations: InboxRuleOperation[], removeOutlookRuleBlob = false): OWARequest {
  operations.forEach(checkWritable);
  return new OWARequest("UpdateInboxRules", {
    __type: "UpdateInboxRulesRequest:#Exchange",
    RemoveOutlookRuleBlob: removeOutlookRuleBlob,
    Operations: operations.map(operation => {
      if (operation.kind == "create") {
        return { __type: "CreateRuleOperation:#Exchange", Rule: owaInboxRule(operation.rule, false) };
      } else if (operation.kind == "set") {
        return { __type: "SetRuleOperation:#Exchange", Rule: owaInboxRule(operation.rule, true) };
      }
      return { __type: "DeleteRuleOperation:#Exchange", RuleId: operation.id };
    }),
  });
}
