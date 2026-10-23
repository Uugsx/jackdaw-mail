import {
  ewsDayValue, owaDayValue, parseExchangeDate, parseExchangeDay, sanitizeTaskImportance, sanitizeTaskStatus,
  type ExchangeTask, type ExchangeTaskInput, type MailFlagState,
} from "./ExchangeTask";
import { EWSCreateItemRequest } from "../EWS/Request/EWSCreateItemRequest";
import { EWSUpdateItemRequest } from "../EWS/Request/EWSUpdateItemRequest";
import { EWSDeleteItemRequest } from "../EWS/Request/EWSDeleteItemRequest";
import { OWARequest } from "../OWA/Request/OWARequest";
import { OWACreateItemRequest } from "../OWA/Request/OWACreateItemRequest";
import { OWAUpdateItemRequest } from "../OWA/Request/OWAUpdateItemRequest";
import { OWADeleteItemRequest } from "../OWA/Request/OWADeleteItemRequest";
import { ensureArray } from "../../util/util";

/** Задач за одну страницу FindItem */
export const kTasksPageSize = 200;
/** Больше задач не читаем: список для человека, а не архив */
export const kMaxTasks = 2000;

const kTaskFields = [
  "item:Subject",
  "item:Body",
  "item:Importance",
  "item:LastModifiedTime",
  "task:StartDate",
  "task:DueDate",
  "task:CompleteDate",
  "task:Status",
];

// ---------- EWS ----------

export function ewsFindTasksRequest(offset = 0): any {
  return {
    m$FindItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
      },
      m$IndexedPageItemView: {
        MaxEntriesReturned: kTasksPageSize,
        BasePoint: "Beginning",
        Offset: offset,
      },
      m$ParentFolderIds: {
        t$DistinguishedFolderId: {
          Id: "tasks",
        },
      },
      Traversal: "Shallow",
    },
  };
}

/** @returns ID задач страницы и смещение следующей страницы (null — последняя) */
export function parseEWSFindTasks(result: any): { ids: string[], nextOffset: number | null } {
  let root = result?.RootFolder;
  let ids = ensureArray(root?.Items?.Task)
    .map((item: any) => item?.ItemId?.Id)
    .filter((id: any): id is string => typeof id == "string" && !!id);
  let last = String(root?.IncludesLastItemInRange) != "false";
  let nextOffset = Number(root?.IndexedPagingOffset);
  return { ids, nextOffset: last || !Number.isFinite(nextOffset) ? null : nextOffset };
}

export function ewsGetTasksRequest(ids: string[]): any {
  return {
    m$GetItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
        t$BodyType: "Text",
        t$AdditionalProperties: {
          t$FieldURI: kTaskFields.map(FieldURI => ({ FieldURI })),
        },
      },
      m$ItemIds: {
        t$ItemId: ids.map(Id => ({ Id })),
      },
    },
  };
}

/** Ответ GetItem: одна задача или массив ответов. Задачи с ошибкой пропускаются. */
export function parseEWSGetTasks(result: any): ExchangeTask[] {
  return ensureArray(result)
    .filter((response: any) => response?.ResponseClass != "Error")
    .flatMap((response: any) => ensureArray(response?.Items?.Task))
    .map(parseEWSTask)
    .filter((task): task is ExchangeTask => !!task);
}

export function parseEWSTask(xmljs: any): ExchangeTask | null {
  let itemID = xmljs?.ItemId?.Id;
  if (typeof itemID != "string" || !itemID) {
    return null;
  }
  return {
    itemID,
    changeKey: typeof xmljs.ItemId.ChangeKey == "string" ? xmljs.ItemId.ChangeKey : null,
    subject: typeof xmljs.Subject == "string" ? xmljs.Subject : "",
    notes: bodyText(xmljs.Body),
    startDay: parseExchangeDay(xmljs.StartDate),
    dueDay: parseExchangeDay(xmljs.DueDate),
    completedAt: xmljs.Status == "Completed" ? parseExchangeDate(xmljs.CompleteDate) ?? new Date() : null,
    importance: sanitizeTaskImportance(xmljs.Importance),
    status: sanitizeTaskStatus(xmljs.Status),
    lastModified: parseExchangeDate(xmljs.LastModifiedTime),
  };
}

function bodyText(body: any): string {
  if (typeof body == "string") {
    return body.trim();
  }
  let value = body?.Value ?? body?._TextContent_;
  return typeof value == "string" ? value.trim() : "";
}

export function ewsCreateTaskRequest(input: ExchangeTaskInput): EWSCreateItemRequest {
  let request = new EWSCreateItemRequest({
    m$SavedItemFolderId: { t$DistinguishedFolderId: { Id: "tasks" } },
  });
  // Порядок полей — как в схеме TaskType: Subject, Body, Importance, DueDate, StartDate, Status
  request.addField("Task", "Subject", input.subject.trim());
  request.addField("Task", "Body", { BodyType: "Text", _TextContent_: input.notes ?? "" });
  request.addField("Task", "Importance", input.importance);
  request.addField("Task", "DueDate", input.dueDay ? ewsDayValue(input.dueDay) : null);
  request.addField("Task", "StartDate", input.startDay ? ewsDayValue(input.startDay) : null);
  request.addField("Task", "Status", "NotStarted");
  return request;
}

export function parseEWSCreatedTaskID(result: any): string | null {
  let id = ensureArray(result?.Items?.Task)[0]?.ItemId?.Id;
  return typeof id == "string" && id ? id : null;
}

export function ewsUpdateTaskRequest(itemID: string, input: ExchangeTaskInput): EWSUpdateItemRequest {
  let request = new EWSUpdateItemRequest(itemID);
  // addField() ставит поля в начало: перечисляем с конца схемы
  request.addField("Task", "StartDate", input.startDay ? ewsDayValue(input.startDay) : null, "task:StartDate");
  request.addField("Task", "DueDate", input.dueDay ? ewsDayValue(input.dueDay) : null, "task:DueDate");
  request.addField("Task", "Importance", input.importance, "item:Importance");
  request.addField("Task", "Body", { BodyType: "Text", _TextContent_: input.notes ?? "" }, "item:Body");
  request.addField("Task", "Subject", input.subject.trim(), "item:Subject");
  return request;
}

/** Выполнена / снова в работе. Дату выполнения сервер ставит сам. */
export function ewsCompleteTaskRequest(itemID: string, completed: boolean): EWSUpdateItemRequest {
  let request = new EWSUpdateItemRequest(itemID);
  request.addField("Task", "Status", completed ? "Completed" : "NotStarted", "task:Status");
  return request;
}

export function ewsDeleteTaskRequest(itemID: string): EWSDeleteItemRequest {
  // Для задач AffectedTaskOccurrences обязателен
  return new EWSDeleteItemRequest(itemID, { AffectedTaskOccurrences: "AllOccurrences" });
}

/** Флажок письма для EWS: даты только парой, дата выполнения — только у выполненного */
export function ewsFlagValue(flag: MailFlagState): any {
  if (flag.completedAt) {
    return {
      t$FlagStatus: "Complete",
      t$CompleteDate: flag.completedAt.toISOString(),
    };
  }
  if (!flag.flagged) {
    return { t$FlagStatus: "NotFlagged" };
  }
  let value: any = { t$FlagStatus: "Flagged" };
  if (flag.dueDay) {
    value.t$StartDate = ewsDayValue(flag.startDay ?? flag.dueDay);
    value.t$DueDate = ewsDayValue(flag.dueDay);
  }
  return value;
}

export function ewsSetMailFlagRequest(itemID: string, flag: MailFlagState): EWSUpdateItemRequest {
  let request = new EWSUpdateItemRequest(itemID, {
    MessageDisposition: "SaveOnly",
    SendMeetingInvitationsOrCancellations: "SendToNone",
    SuppressReadReceipts: true,
  });
  request.addField("Message", "Flag", ewsFlagValue(flag), "item:Flag");
  return request;
}

// ---------- OWA ----------

function owaPropertyPaths(fields: string[]): object[] {
  return fields.map(FieldURI => ({ __type: "PropertyUri:#Exchange", FieldURI }));
}

export function owaFindTasksRequest(offset = 0): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
    },
    ParentFolderIds: [{
      __type: "DistinguishedFolderId:#Exchange",
      Id: "tasks",
    }],
    Traversal: "Shallow",
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: offset,
      MaxEntriesReturned: kTasksPageSize,
    },
  });
}

export function parseOWAFindTasks(result: any): { ids: string[], nextOffset: number | null } {
  let root = result?.RootFolder;
  let ids = ensureArray(root?.Items)
    .filter((item: any) => !item?.__type || /^Task:/.test(item.__type))
    .map((item: any) => item?.ItemId?.Id)
    .filter((id: any): id is string => typeof id == "string" && !!id);
  let last = root?.IncludesLastItemInRange !== false && String(root?.IncludesLastItemInRange) != "false";
  let nextOffset = Number(root?.IndexedPagingOffset);
  return { ids, nextOffset: last || !Number.isFinite(nextOffset) ? null : nextOffset };
}

export function owaGetTasksRequest(ids: string[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      BodyType: "Text",
      AdditionalProperties: owaPropertyPaths(kTaskFields),
    },
    ItemIds: ids.map(Id => ({ __type: "ItemId:#Exchange", Id })),
  });
}

/** Одна задача приходит без ResponseMessages (callOWA раскрывает единственный ответ) */
export function parseOWAGetTasks(result: any): ExchangeTask[] {
  let responses = result?.ResponseMessages?.Items ?? [result];
  return ensureArray(responses)
    .filter((response: any) => response?.ResponseClass != "Error")
    .flatMap((response: any) => ensureArray(response?.Items))
    .map(parseOWATask)
    .filter((task): task is ExchangeTask => !!task);
}

export function parseOWATask(json: any): ExchangeTask | null {
  // Формат полей тот же, что у EWS после XML2JSON
  return parseEWSTask(json);
}

function owaBody(notes: string): object {
  return { __type: "BodyContentType:#Exchange", BodyType: "Text", Value: notes ?? "" };
}

export function owaCreateTaskRequest(input: ExchangeTaskInput): OWACreateItemRequest {
  let request = new OWACreateItemRequest({
    SavedItemFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: { __type: "DistinguishedFolderId:#Exchange", Id: "tasks" },
    },
  });
  request.addField("Task", "Subject", input.subject.trim());
  request.addField("Task", "Body", owaBody(input.notes));
  request.addField("Task", "Importance", input.importance);
  request.addField("Task", "DueDate", input.dueDay ? owaDayValue(input.dueDay) : null);
  request.addField("Task", "StartDate", input.startDay ? owaDayValue(input.startDay) : null);
  request.addField("Task", "Status", "NotStarted");
  return request;
}

export function parseOWACreatedTaskID(result: any): string | null {
  let item = result?.Items?.[0] ?? result?.ResponseMessages?.Items?.[0]?.Items?.[0];
  let id = item?.ItemId?.Id;
  return typeof id == "string" && id ? id : null;
}

export function owaUpdateTaskRequest(itemID: string, input: ExchangeTaskInput): OWAUpdateItemRequest {
  let request = new OWAUpdateItemRequest(itemID);
  request.addField("Task", "StartDate", input.startDay ? owaDayValue(input.startDay) : null, "task:StartDate");
  request.addField("Task", "DueDate", input.dueDay ? owaDayValue(input.dueDay) : null, "task:DueDate");
  request.addField("Task", "Importance", input.importance, "item:Importance");
  request.addField("Task", "Body", owaBody(input.notes), "item:Body");
  request.addField("Task", "Subject", input.subject.trim(), "item:Subject");
  return request;
}

export function owaCompleteTaskRequest(itemID: string, completed: boolean): OWAUpdateItemRequest {
  let request = new OWAUpdateItemRequest(itemID);
  request.addField("Task", "Status", completed ? "Completed" : "NotStarted", "task:Status");
  return request;
}

export function owaDeleteTaskRequest(itemID: string): OWADeleteItemRequest {
  return new OWADeleteItemRequest(itemID, { AffectedTaskOccurrences: "AllOccurrences" });
}

export function owaFlagValue(flag: MailFlagState): any {
  let value: any = { __type: "FlagType:#Exchange" };
  if (flag.completedAt) {
    value.FlagStatus = "Complete";
    value.CompleteDate = flag.completedAt.toISOString();
  } else if (!flag.flagged) {
    value.FlagStatus = "NotFlagged";
  } else {
    value.FlagStatus = "Flagged";
    if (flag.dueDay) {
      value.StartDate = owaDayValue(flag.startDay ?? flag.dueDay);
      value.DueDate = owaDayValue(flag.dueDay);
    }
  }
  return value;
}

export function owaSetMailFlagRequest(itemID: string, flag: MailFlagState): OWAUpdateItemRequest {
  let request = new OWAUpdateItemRequest(itemID, {
    MessageDisposition: "SaveOnly",
    SendCalendarInvitationsOrCancellations: "SendToNone",
    SuppressReadReceipts: true,
  });
  request.addField("Message", "Flag", owaFlagValue(flag), "item:Flag");
  return request;
}

/** Флажок из ответа сервера (EWS после XML2JSON или OWA JSON) */
export function parseExchangeFlag(flag: any): MailFlagState {
  let status = flag?.FlagStatus;
  let completedAt = status == "Complete" ? parseExchangeDate(flag.CompleteDate) ?? new Date(0) : null;
  let dueDay = status == "Flagged" ? parseExchangeDay(flag.DueDate) : null;
  let startDay = status == "Flagged" ? parseExchangeDay(flag.StartDate) : null;
  return { flagged: status == "Flagged", startDay, dueDay, completedAt };
}
