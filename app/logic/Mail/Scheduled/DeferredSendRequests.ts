import { EWSDeleteItemRequest } from "../EWS/Request/EWSDeleteItemRequest";
import { OWARequest } from "../OWA/Request/OWARequest";
import { OWADeleteItemRequest } from "../OWA/Request/OWADeleteItemRequest";
import { ensureArray } from "../../util/util";

/**
 * Отложенная доставка Exchange: письмо с PidTagDeferredSendTime сервер держит
 * в «Исходящих» и отправляет сам в указанное время, даже если компьютер выключен.
 */
export const kDeferredSendTimeTag = "0x3FEF";
/** Своё именованное свойство: по нему письмо находится в «Исходящих» для отмены */
export const kScheduleIDPropertyName = "JackdawScheduleID";
/** Писем в «Исходящих» читаем не больше: там обычно единицы */
export const kOutboxPageSize = 200;

/** Отложенная отправка конкретного письма */
export interface DeferredSend {
  sendAt: Date;
  scheduleID: string;
}

/** Запланированное письмо в «Исходящих» сервера */
export interface OutboxScheduledItem {
  itemID: string;
  scheduleID: string | null;
  sendAt: Date | null;
}

/** SystemTime для Exchange: UTC без миллисекунд */
export function exchangeTimeValue(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------- EWS ----------

const kEWSDeferredTimeURI = { PropertyTag: kDeferredSendTimeTag, PropertyType: "SystemTime" };
const kEWSScheduleIDURI = { DistinguishedPropertySetId: "PublicStrings", PropertyName: kScheduleIDPropertyName, PropertyType: "String" };

/** Элементы ExtendedProperty для CreateItem: время отправки и метка письма */
export function ewsDeferredSendProperties(deferred: DeferredSend): any[] {
  return [
    { t$ExtendedFieldURI: kEWSDeferredTimeURI, t$Value: exchangeTimeValue(deferred.sendAt) },
    { t$ExtendedFieldURI: kEWSScheduleIDURI, t$Value: deferred.scheduleID },
  ];
}

export function ewsFindOutboxRequest(): any {
  return {
    m$FindItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
        t$AdditionalProperties: {
          t$ExtendedFieldURI: [kEWSDeferredTimeURI, kEWSScheduleIDURI],
        },
      },
      m$IndexedPageItemView: {
        MaxEntriesReturned: kOutboxPageSize,
        BasePoint: "Beginning",
        Offset: 0,
      },
      m$ParentFolderIds: {
        t$DistinguishedFolderId: {
          Id: "outbox",
        },
      },
      Traversal: "Shallow",
    },
  };
}

export function parseEWSOutbox(result: any): OutboxScheduledItem[] {
  let items = result?.RootFolder?.Items;
  return [...ensureArray(items?.Message), ...ensureArray(items?.Item)]
    .map(parseOutboxItem)
    .filter((item): item is OutboxScheduledItem => !!item);
}

export function ewsDeleteScheduledRequest(itemID: string): EWSDeleteItemRequest {
  // В «Удалённые», а не насовсем: копия для редактора хранится у нас, но мало ли
  return new EWSDeleteItemRequest(itemID);
}

// ---------- OWA ----------

const kOWADeferredTimeURI = { __type: "ExtendedPropertyUri:#Exchange", ...kEWSDeferredTimeURI };
const kOWAScheduleIDURI = { __type: "ExtendedPropertyUri:#Exchange", ...kEWSScheduleIDURI };

/** Как у заголовков письма в OWAAccount.send(): ExtendedFieldURI без __type */
export function owaDeferredSendProperties(deferred: DeferredSend): any[] {
  return [
    { ExtendedFieldURI: kEWSDeferredTimeURI, Value: exchangeTimeValue(deferred.sendAt) },
    { ExtendedFieldURI: kEWSScheduleIDURI, Value: deferred.scheduleID },
  ];
}

export function owaFindOutboxRequest(): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [kOWADeferredTimeURI, kOWAScheduleIDURI],
    },
    ParentFolderIds: [{
      __type: "DistinguishedFolderId:#Exchange",
      Id: "outbox",
    }],
    Traversal: "Shallow",
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: kOutboxPageSize,
    },
  });
}

export function parseOWAOutbox(result: any): OutboxScheduledItem[] {
  return ensureArray(result?.RootFolder?.Items)
    .map(parseOutboxItem)
    .filter((item): item is OutboxScheduledItem => !!item);
}

export function owaDeleteScheduledRequest(itemID: string): OWADeleteItemRequest {
  return new OWADeleteItemRequest(itemID);
}

// ---------- общий разбор ----------

/** Формат элемента одинаков у EWS (после XML2JSON) и OWA JSON */
function parseOutboxItem(item: any): OutboxScheduledItem | null {
  let itemID = item?.ItemId?.Id;
  if (typeof itemID != "string" || !itemID) {
    return null;
  }
  let scheduleID: string | null = null;
  let sendAt: Date | null = null;
  for (let property of ensureArray(item.ExtendedProperty)) {
    let uri = property?.ExtendedFieldURI;
    let value = property?.Value;
    if (typeof value != "string") {
      continue;
    }
    if (uri?.PropertyName == kScheduleIDPropertyName) {
      scheduleID = value;
    } else if (uri?.PropertyTag != null && Number(uri.PropertyTag) == Number(kDeferredSendTimeTag)) {
      // Сервер может вернуть тег строчными буквами («0x3fef») или десятичным числом
      let date = new Date(value);
      sendAt = Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return { itemID, scheduleID, sendAt };
}
