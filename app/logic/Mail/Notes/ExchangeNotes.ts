/**
 * Заметки Exchange (папка «Заметки», элементы IPM.StickyNote), как в Outlook:
 * просмотр, создание, правка, удаление. Своего типа в EWS у заметок нет —
 * это элементы Message с классом IPM.StickyNote; цвет — PidLidNoteColor (PSETID_Note, 0x8B00).
 * Заголовок заметки — первая строка текста, как делает Outlook.
 */
import type { MailAccount } from "../MailAccount";
import { EWSAccount } from "../EWS/EWSAccount";
import { OWAAccount } from "../OWA/OWAAccount";
import { EWSCreateItemRequest } from "../EWS/Request/EWSCreateItemRequest";
import { EWSUpdateItemRequest } from "../EWS/Request/EWSUpdateItemRequest";
import { EWSDeleteItemRequest } from "../EWS/Request/EWSDeleteItemRequest";
import { OWARequest } from "../OWA/Request/OWARequest";
import { OWACreateItemRequest } from "../OWA/Request/OWACreateItemRequest";
import { OWAUpdateItemRequest } from "../OWA/Request/OWAUpdateItemRequest";
import { OWADeleteItemRequest } from "../OWA/Request/OWADeleteItemRequest";
import { assert, ensureArray } from "../../util/util";

export const kNoteItemClass = "IPM.StickyNote";
/** Цвета заметок Outlook (PidLidNoteColor) */
export type NoteColor = "blue" | "green" | "pink" | "yellow" | "white";
export const kNoteColors: NoteColor[] = ["blue", "green", "pink", "yellow", "white"];
export const kDefaultNoteColor: NoteColor = "yellow";
const kNoteColorField = { PropertySetId: "0006200E-0000-0000-C000-000000000046", PropertyId: 0x8B00, PropertyType: "Integer" };

/** Заметок за страницу FindItem и всего */
export const kNotesPageSize = 200;
export const kMaxNotes = 1000;
const kGetBatchSize = 50;
const kSubjectLength = 255;

export interface ExchangeNote {
  itemID: string;
  changeKey: string | null;
  text: string;
  color: NoteColor;
  lastModified: Date | null;
}

/** Первая непустая строка — как заголовок у Outlook */
export function noteTitle(text: string): string {
  return (text ?? "").split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, kSubjectLength) ?? "";
}

export function noteColorFromIndex(value: any): NoteColor {
  let index = Number(value);
  return Number.isInteger(index) && kNoteColors[index] ? kNoteColors[index] : kDefaultNoteColor;
}

const kNoteFields = ["item:Subject", "item:Body", "item:ItemClass", "item:LastModifiedTime"];

function bodyText(body: any): string {
  if (typeof body == "string") {
    return body;
  }
  let value = body?.Value ?? body?._TextContent_;
  return typeof value == "string" ? value : "";
}

function extendedColor(item: any): NoteColor {
  for (let property of ensureArray(item?.ExtendedProperty)) {
    if (Number(property?.ExtendedFieldURI?.PropertyId) == kNoteColorField.PropertyId) {
      return noteColorFromIndex(property.Value);
    }
  }
  return kDefaultNoteColor;
}

/** Элементы ответа FindItem/GetItem любого типа (Message, Item, PostItem…) */
function itemsOf(items: any): any[] {
  if (Array.isArray(items)) {
    return items;
  }
  return items && typeof items == "object" ? Object.values(items).flatMap(value => ensureArray(value as any)) : [];
}

export function parseNote(item: any): ExchangeNote | null {
  let itemID = item?.ItemId?.Id;
  if (typeof itemID != "string" || !itemID) {
    return null;
  }
  if (item.ItemClass && !String(item.ItemClass).startsWith(kNoteItemClass)) {
    return null;
  }
  let text = bodyText(item.Body).replace(/\r\n/g, "\n").trim();
  return {
    itemID,
    changeKey: typeof item.ItemId.ChangeKey == "string" ? item.ItemId.ChangeKey : null,
    text: text || (typeof item.Subject == "string" ? item.Subject : ""),
    color: extendedColor(item),
    lastModified: item.LastModifiedTime ? new Date(item.LastModifiedTime) : null,
  };
}

export function parseFindNotes(result: any): { ids: string[], nextOffset: number | null } {
  let root = result?.RootFolder;
  let ids = itemsOf(root?.Items)
    .map((item: any) => item?.ItemId?.Id)
    .filter((id: any): id is string => typeof id == "string" && !!id);
  let last = root?.IncludesLastItemInRange !== false && String(root?.IncludesLastItemInRange) != "false";
  let nextOffset = Number(root?.IndexedPagingOffset);
  return { ids, nextOffset: last || !Number.isFinite(nextOffset) ? null : nextOffset };
}

/** Ответ GetItem: EWS — массив ответов, OWA — с ResponseMessages или один ответ */
export function parseGetNotes(result: any): ExchangeNote[] {
  let responses = result?.ResponseMessages?.Items ?? result;
  return ensureArray(responses)
    .filter((response: any) => response?.ResponseClass != "Error")
    .flatMap((response: any) => itemsOf(response?.Items))
    .map(parseNote)
    .filter((note): note is ExchangeNote => !!note)
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
}

export function parseCreatedNoteID(result: any): string | null {
  let response = result?.ResponseMessages?.Items?.[0] ?? ensureArray(result)[0] ?? result;
  let id = itemsOf(response?.Items)[0]?.ItemId?.Id;
  return typeof id == "string" && id ? id : null;
}

// ---------- EWS ----------

export function ewsFindNotesRequest(offset = 0): any {
  return {
    m$FindItem: {
      m$ItemShape: { t$BaseShape: "IdOnly" },
      m$IndexedPageItemView: { MaxEntriesReturned: kNotesPageSize, BasePoint: "Beginning", Offset: offset },
      m$ParentFolderIds: { t$DistinguishedFolderId: { Id: "notes" } },
      Traversal: "Shallow",
    },
  };
}

export function ewsGetNotesRequest(ids: string[]): any {
  return {
    m$GetItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
        t$BodyType: "Text",
        t$AdditionalProperties: {
          t$FieldURI: kNoteFields.map(FieldURI => ({ FieldURI })),
          t$ExtendedFieldURI: [{ ...kNoteColorField }],
        },
      },
      m$ItemIds: { t$ItemId: ids.map(Id => ({ Id })) },
    },
  };
}

export function ewsCreateNoteRequest(text: string): EWSCreateItemRequest {
  let request = new EWSCreateItemRequest({
    MessageDisposition: "SaveOnly",
    m$SavedItemFolderId: { t$DistinguishedFolderId: { Id: "notes" } },
  });
  // Порядок полей — как в схеме MessageType: ItemClass, Subject, Body, ExtendedProperty
  request.addField("Message", "ItemClass", kNoteItemClass);
  request.addField("Message", "Subject", noteTitle(text));
  request.addField("Message", "Body", { BodyType: "Text", _TextContent_: text });
  request.addField("Message", "ExtendedProperty", {
    t$ExtendedFieldURI: { ...kNoteColorField },
    t$Value: kNoteColors.indexOf(kDefaultNoteColor),
  });
  return request;
}

export function ewsUpdateNoteRequest(itemID: string, text: string): EWSUpdateItemRequest {
  let request = new EWSUpdateItemRequest(itemID, { MessageDisposition: "SaveOnly" });
  // addField() ставит поля в начало: перечисляем с конца схемы
  request.addField("Message", "Body", { BodyType: "Text", _TextContent_: text }, "item:Body");
  request.addField("Message", "Subject", noteTitle(text), "item:Subject");
  return request;
}

export function ewsDeleteNoteRequest(itemID: string): EWSDeleteItemRequest {
  return new EWSDeleteItemRequest(itemID);
}

// ---------- OWA ----------

export function owaFindNotesRequest(offset = 0): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: { __type: "ItemResponseShape:#Exchange", BaseShape: "IdOnly" },
    ParentFolderIds: [{ __type: "DistinguishedFolderId:#Exchange", Id: "notes" }],
    Traversal: "Shallow",
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: offset,
      MaxEntriesReturned: kNotesPageSize,
    },
  });
}

export function owaGetNotesRequest(ids: string[]): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      BodyType: "Text",
      AdditionalProperties: [
        ...kNoteFields.map(FieldURI => ({ __type: "PropertyUri:#Exchange", FieldURI })),
        { __type: "ExtendedPropertyUri:#Exchange", ...kNoteColorField },
      ],
    },
    ItemIds: ids.map(Id => ({ __type: "ItemId:#Exchange", Id })),
  });
}

function owaBody(text: string): object {
  return { __type: "BodyContentType:#Exchange", BodyType: "Text", Value: text };
}

export function owaCreateNoteRequest(text: string): OWACreateItemRequest {
  let request = new OWACreateItemRequest({
    MessageDisposition: "SaveOnly",
    SavedItemFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: { __type: "DistinguishedFolderId:#Exchange", Id: "notes" },
    },
  });
  request.addField("Message", "ItemClass", kNoteItemClass);
  request.addField("Message", "Subject", noteTitle(text));
  request.addField("Message", "Body", owaBody(text));
  request.addField("Message", "ExtendedProperty", [{
    ExtendedFieldURI: { ...kNoteColorField },
    Value: String(kNoteColors.indexOf(kDefaultNoteColor)),
  }]);
  return request;
}

export function owaUpdateNoteRequest(itemID: string, text: string): OWAUpdateItemRequest {
  let request = new OWAUpdateItemRequest(itemID, { MessageDisposition: "SaveOnly" });
  request.addField("Message", "Body", owaBody(text), "item:Body");
  request.addField("Message", "Subject", noteTitle(text), "item:Subject");
  return request;
}

export function owaDeleteNoteRequest(itemID: string): OWADeleteItemRequest {
  return new OWADeleteItemRequest(itemID);
}

// ---------- Работа с ящиком ----------

export interface ExchangeNoteProtocol {
  call(request: any): Promise<any>;
  findRequest(offset: number): any;
  getRequest(ids: string[]): any;
  createRequest(text: string): any;
  updateRequest(itemID: string, text: string): any;
  deleteRequest(itemID: string): any;
}

export function ewsNoteProtocol(call: (request: any) => Promise<any>): ExchangeNoteProtocol {
  return {
    call, findRequest: ewsFindNotesRequest, getRequest: ewsGetNotesRequest,
    createRequest: ewsCreateNoteRequest, updateRequest: ewsUpdateNoteRequest, deleteRequest: ewsDeleteNoteRequest,
  };
}

export function owaNoteProtocol(call: (request: any) => Promise<any>): ExchangeNoteProtocol {
  return {
    call, findRequest: owaFindNotesRequest, getRequest: owaGetNotesRequest,
    createRequest: owaCreateNoteRequest, updateRequest: owaUpdateNoteRequest, deleteRequest: owaDeleteNoteRequest,
  };
}

/** Свой ящик EWS или OWA: у общих ящиков папки «Заметки» нет */
export function canUseExchangeNotes(account: MailAccount | null | undefined): boolean {
  return (account instanceof EWSAccount || account instanceof OWAAccount) && !account.isDependentAccount;
}

export function noteProtocolFor(account: MailAccount): ExchangeNoteProtocol {
  if (account instanceof EWSAccount && !account.isDependentAccount) {
    return ewsNoteProtocol(request => account.callEWS(request));
  }
  if (account instanceof OWAAccount && !account.isDependentAccount) {
    return owaNoteProtocol(request => account.callOWA(request));
  }
  throw new Error("Notes need an Exchange (EWS or OWA) mailbox");
}

export async function fetchNotes(protocol: ExchangeNoteProtocol): Promise<ExchangeNote[]> {
  let ids: string[] = [];
  let offset: number | null = 0;
  while (offset != null && ids.length < kMaxNotes) {
    let page = parseFindNotes(await protocol.call(protocol.findRequest(offset)));
    ids.push(...page.ids);
    offset = page.ids.length ? page.nextOffset : null;
  }
  ids = [...new Set(ids)].slice(0, kMaxNotes);
  let notes: ExchangeNote[] = [];
  for (let i = 0; i < ids.length; i += kGetBatchSize) {
    notes.push(...parseGetNotes(await protocol.call(protocol.getRequest(ids.slice(i, i + kGetBatchSize)))));
  }
  return notes.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
}

async function fetchNote(protocol: ExchangeNoteProtocol, itemID: string): Promise<ExchangeNote> {
  let [note] = parseGetNotes(await protocol.call(protocol.getRequest([itemID])));
  assert(note, "The server did not return the note");
  return note;
}

export async function createNote(protocol: ExchangeNoteProtocol, text: string): Promise<ExchangeNote> {
  let itemID = parseCreatedNoteID(await protocol.call(protocol.createRequest(text)));
  assert(itemID, "The server did not return the new note");
  return await fetchNote(protocol, itemID);
}

export async function updateNote(protocol: ExchangeNoteProtocol, note: ExchangeNote, text: string): Promise<ExchangeNote> {
  await protocol.call(protocol.updateRequest(note.itemID, text));
  return await fetchNote(protocol, note.itemID);
}

export async function deleteNote(protocol: ExchangeNoteProtocol, note: ExchangeNote): Promise<void> {
  await protocol.call(protocol.deleteRequest(note.itemID));
}
