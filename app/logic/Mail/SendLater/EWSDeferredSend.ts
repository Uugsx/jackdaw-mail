import { EWSDeleteItemRequest } from "../EWS/Request/EWSDeleteItemRequest";
import { ensureArray } from "../../util/util";

/**
 * Отложенная отправка на сервере Exchange (EWS).
 *
 * Письмо создаётся через CreateItem + SendAndSaveCopy со свойством
 * PidTagDeferredSendTime (0x3FEF): Exchange держит его до этого времени
 * и отправляет сам, даже когда приложение закрыто.
 * Чтобы отменить, письмо находим по своему именованному свойству
 * (оно не попадает в заголовки письма) в «Исходящих» или «Черновиках»
 * и удаляем: копия для правки хранится в локальной очереди.
 */

/** PidTagDeferredSendTime */
export const kDeferredSendTimeTag = "0x3FEF";
/** Своё свойство письма (PS_PUBLIC_STRINGS) — ID записи очереди */
export const kScheduledSendIDProperty = "JackdawScheduledSendID";
/** Писем в «Исходящих» и «Черновиках» за один запрос поиска */
const kFindPageSize = 500;

export interface EWSDeferredSend {
  sendAt: Date;
  queueID: string;
}

const kScheduledSendIDField = {
  DistinguishedPropertySetId: "PublicStrings",
  PropertyName: kScheduledSendIDProperty,
  PropertyType: "String",
};

/** Время для EWS: UTC без долей секунды */
export function ewsSystemTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Свойства для `t$ExtendedProperty` письма в CreateItem */
export function ewsDeferredSendProperties(deferred: EWSDeferredSend): any[] {
  return [{
    t$ExtendedFieldURI: {
      PropertyTag: kDeferredSendTimeTag,
      PropertyType: "SystemTime",
    },
    t$Value: ewsSystemTime(deferred.sendAt),
  }, {
    t$ExtendedFieldURI: kScheduledSendIDField,
    t$Value: deferred.queueID,
  }];
}

/**
 * Добавляет свойства отложенной отправки в уже собранный CreateItem.
 * Порядок элементов важен для старых Exchange: если `ExtendedProperty` уже
 * есть (заголовки письма), дописываем в него, иначе он встаёт после тела,
 * но до получателей — их добавляют позже.
 */
export function addEWSDeferredSend(message: Record<string, any>, deferred: EWSDeferredSend): void {
  addEWSExtendedProperties(message, ewsDeferredSendProperties(deferred));
}

/** Дописывает свойства в `t$ExtendedProperty` письма CreateItem, соблюдая порядок элементов схемы */
export function addEWSExtendedProperties(message: Record<string, any>, properties: any[]): void {
  if (message.t$ExtendedProperty != null) {
    message.t$ExtendedProperty = [...ensureArray(message.t$ExtendedProperty), ...properties];
    return;
  }
  // Ключи объекта задают порядок элементов XML: вставляем перед получателями
  let entries = Object.entries(message);
  let position = entries.findIndex(([key]) => kAfterExtendedProperty.includes(key));
  entries.splice(position < 0 ? entries.length : position, 0, ["t$ExtendedProperty", properties]);
  for (let key of Object.keys(message)) {
    delete message[key];
  }
  Object.assign(message, Object.fromEntries(entries));
}

/** Элементы Message, которые по схеме EWS идут после ExtendedProperty */
const kAfterExtendedProperty = [
  "t$Sender", "t$ToRecipients", "t$CcRecipients", "t$BccRecipients",
  "t$IsReadReceiptRequested", "t$IsDeliveryReceiptRequested", "t$From", "t$ReplyTo",
];

/** Поиск писем с нашим свойством в «Исходящих» и «Черновиках» */
export function ewsFindDeferredRequest(): any {
  return {
    m$FindItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
        t$AdditionalProperties: {
          t$ExtendedFieldURI: kScheduledSendIDField,
        },
      },
      m$IndexedPageItemView: {
        MaxEntriesReturned: kFindPageSize,
        BasePoint: "Beginning",
        Offset: 0,
      },
      m$ParentFolderIds: {
        t$DistinguishedFolderId: [{ Id: "outbox" }, { Id: "drafts" }],
      },
      Traversal: "Shallow",
    },
  };
}

/** @returns ItemId писем, у которых наше свойство равно `queueID` */
export function parseEWSFindDeferred(result: any, queueID: string): string[] {
  let items = ensureArray(result).flatMap((response: any) => {
    let found = response?.RootFolder?.Items;
    if (!found || typeof found != "object") {
      return [];
    }
    return Object.values(found).flatMap(value => ensureArray(value as any));
  });
  return items
    .filter((item: any) => ensureArray(item?.ExtendedProperty).some((property: any) =>
      property?.ExtendedFieldURI?.PropertyName == kScheduledSendIDProperty &&
      String(property?.Value ?? "") == queueID))
    .map((item: any) => item?.ItemId?.Id)
    .filter((id: unknown): id is string => typeof id == "string" && !!id);
}

/** Отменённое письмо удаляем без «Удалённых»: копия для правки есть в очереди */
export function ewsDeleteDeferredRequest(itemID: string): EWSDeleteItemRequest {
  return new EWSDeleteItemRequest(itemID, { DeleteType: "SoftDelete" });
}

type CallEWS = (request: any) => Promise<any>;

/** Есть ли ещё письмо на сервере (не ушло ли) */
export async function findEWSDeferred(callEWS: CallEWS, queueID: string): Promise<string[]> {
  return parseEWSFindDeferred(await callEWS(ewsFindDeferredRequest()), queueID);
}

/**
 * Отменяет отложенную отправку на сервере.
 * @returns false — письма на сервере уже нет: скорее всего, оно ушло
 */
export async function cancelEWSDeferred(callEWS: CallEWS, queueID: string): Promise<boolean> {
  let ids = await findEWSDeferred(callEWS, queueID);
  for (let id of ids) {
    await callEWS(ewsDeleteDeferredRequest(id));
  }
  return ids.length > 0;
}
