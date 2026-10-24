/**
 * «Отсортированные / Другие» во «Входящих», как в Outlook.
 *
 * 1. Правило пользователя по отправителю («Всегда в Других / в Отсортированных»).
 * 2. Классификация Exchange (`item:InferenceClassification`): одним запросом FindItem берём
 *    ID писем «Другие». Старые серверы такого поля не знают — тогда остаётся пункт 3.
 * 3. Своя эвристика (IMAP и прочие): рассылки и автоматические отправители — в «Другие»,
 *    знакомые и письма лично вам — в «Отсортированные».
 */
import type { EMail } from "../EMail";
import type { Folder } from "../Folder";
import type { EWSAccount } from "../EWS/EWSAccount";
import type { OWAAccount } from "../OWA/OWAAccount";
import { OWARequest } from "../OWA/Request/OWARequest";
import { findPerson } from "../../Abstract/PersonUID";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { ensureArray } from "../../util/util";
import { writable } from "svelte/store";

export type FocusedTab = "focused" | "other";

export const kFocusedEnabledKey = "mail.focusedInbox.enabled";
export const kFocusedOverridesKey = "mail.focusedInbox.overrides.v1";
/** Сколько писем «Другие» спрашиваем у сервера */
export const kServerOtherLimit = 1000;

/** Меняется, когда меняются правила или пришла классификация сервера: список пересобирается */
export const focusedClassificationChanged = writable(0);
function changed() {
  focusedClassificationChanged.update(count => count + 1);
}

// Эвристика

const kAutomatedLocalParts = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|noreply|newsletters?|news|notifications?|notify|alerts?|mailer(-daemon)?|postmaster|bounces?|marketing|promo(tions)?|digest|updates?|info|hello|team|support|billing|robot|automailer)([-+_.].*)?$/i;
const kAutomatedDomains = /(^|\.)(mailchimp|mcsv|sendgrid|amazonses|mailgun|sparkpost|sendpulse|unisender|mandrillapp|constantcontact|hubspot|list-manage)\./i;

export function isAutomatedSender(address: string | null | undefined): boolean {
  let value = (address ?? "").toLowerCase();
  let at = value.lastIndexOf("@");
  if (at < 1) {
    return false;
  }
  return kAutomatedLocalParts.test(value.slice(0, at)) || kAutomatedDomains.test(value.slice(at + 1) + ".");
}

/** Своя оценка, без сервера */
export function heuristicClassification(email: EMail, isKnownSender: (address: string) => boolean = address => !!findPerson(address)): FocusedTab {
  if (email.outgoing || email.isImportant || email.isStarred || email.isReplied) {
    return "focused";
  }
  let sender = email.from?.emailAddress;
  if (isAutomatedSender(sender)) {
    return "other";
  }
  if (sender && isKnownSender(sender)) {
    return "focused";
  }
  let account = email.folder?.account;
  let isMine = (address: string) => !!address && (account?.isMyEMailAddress?.(address) ?? false);
  if (email.to?.some(person => isMine(person.emailAddress))) {
    return "focused";
  }
  // Ни в «Кому», ни в «Копии» — значит, письмо пришло через рассылку
  if (!email.cc?.some(person => isMine(person.emailAddress))) {
    return "other";
  }
  return "focused";
}

// Правила по отправителю

function overrides(): Record<string, FocusedTab> {
  let value = getLocalStorage<Record<string, FocusedTab>>(kFocusedOverridesKey, {}).value;
  return value && typeof value == "object" ? { ...value } : {};
}

export function senderOverride(address: string | null | undefined): FocusedTab | null {
  let value = overrides()[(address ?? "").toLowerCase()];
  return value == "focused" || value == "other" ? value : null;
}

/** «Всегда перемещать в …» для отправителя; `null` — убрать правило */
export function setSenderOverride(address: string, tab: FocusedTab | null): void {
  let all = overrides();
  let key = address.toLowerCase();
  if (tab) {
    all[key] = tab;
  } else {
    delete all[key];
  }
  getLocalStorage<Record<string, FocusedTab>>(kFocusedOverridesKey, {}).value = all;
  changed();
}

// Классификация сервера

/** ID писем «Другие» по папке; папки нет — сервер не спрашивали или он не умеет */
const serverOther = new Map<Folder, Set<string>>();
const serverUnsupported = new WeakSet<Folder>();

export function ewsFindOtherRequest(folderID: string, limit = kServerOtherLimit): any {
  // Порядок элементов по схеме: ItemShape, IndexedPageItemView, Restriction, SortOrder, ParentFolderIds
  return {
    m$FindItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
      },
      m$IndexedPageItemView: {
        MaxEntriesReturned: limit,
        BasePoint: "Beginning",
        Offset: 0,
      },
      m$Restriction: {
        t$IsEqualTo: {
          t$FieldURI: {
            FieldURI: "item:InferenceClassification",
          },
          t$FieldURIOrConstant: {
            t$Constant: {
              Value: "Other",
            },
          },
        },
      },
      m$SortOrder: {
        t$FieldOrder: {
          Order: "Descending",
          t$FieldURI: {
            FieldURI: "item:DateTimeReceived",
          },
        },
      },
      m$ParentFolderIds: {
        t$FolderId: {
          Id: folderID,
        },
      },
      Traversal: "Shallow",
    },
  };
}

export function owaFindOtherRequest(folderID: string, limit = kServerOtherLimit): OWARequest {
  return new OWARequest("FindItem", {
    __type: "FindItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
    },
    IndexedPageItemView: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      Offset: 0,
      MaxEntriesReturned: limit,
    },
    Restriction: {
      __type: "RestrictionType:#Exchange",
      Item: {
        __type: "IsEqualTo:#Exchange",
        Item: {
          __type: "PropertyUri:#Exchange",
          FieldURI: "InferenceClassification",
        },
        FieldURIOrConstant: {
          __type: "FieldURIOrConstantType:#Exchange",
          Item: {
            __type: "Constant:#Exchange",
            Value: "Other",
          },
        },
      },
    },
    ParentFolderIds: [{
      __type: "FolderId:#Exchange",
      Id: folderID,
    }],
    Traversal: "Shallow",
  });
}

/** ID писем из ответа FindItem (EWS после XML2JSON и OWA) */
export function parseFindItemIDs(response: any): string[] {
  let root = response?.RootFolder;
  let items = root?.Items;
  let list: any[] = Array.isArray(items)
    ? items
    : items && typeof items == "object" ? Object.values(items).flatMap(value => ensureArray(value as any)) : [];
  return list.map(item => item?.ItemId?.Id).filter((id): id is string => typeof id == "string" && !!id);
}

/** Спрашивает у Exchange, какие письма папки — «Другие». Без поддержки — запоминает и молчит. */
export async function loadServerClassification(folder: Folder): Promise<boolean> {
  let account = folder.account;
  if ((account.protocol != "ews" && account.protocol != "owa") || serverUnsupported.has(folder) || !folder.id) {
    return false;
  }
  try {
    let response = account.protocol == "owa"
      ? await (account as OWAAccount).callOWA(owaFindOtherRequest(folder.id))
      : await (account as EWSAccount).callEWS(ewsFindOtherRequest(folder.id));
    serverOther.set(folder, new Set(parseFindItemIDs(response)));
    changed();
    return true;
  } catch (ex) {
    // Exchange 2013 и старше: ErrorInvalidPropertyRequest / ErrorSchemaValidation
    serverUnsupported.add(folder);
    console.warn("Focused Inbox: server classification is not available", ex?.message ?? ex);
    return false;
  }
}

export function hasServerClassification(folder: Folder | null | undefined): boolean {
  return !!folder && serverOther.has(folder);
}

/** Для тестов */
export function setServerClassification(folder: Folder, otherIDs: string[] | null): void {
  if (otherIDs) {
    serverOther.set(folder, new Set(otherIDs));
  } else {
    serverOther.delete(folder);
  }
  changed();
}

// Итог

export function classifyMessage(email: EMail, isKnownSender?: (address: string) => boolean): FocusedTab {
  let override = senderOverride(email.from?.emailAddress);
  if (override) {
    return override;
  }
  let other = email.folder ? serverOther.get(email.folder) : undefined;
  let itemID = (email as any).itemID as string | undefined;
  if (other && itemID) {
    return other.has(itemID) ? "other" : "focused";
  }
  return heuristicClassification(email, isKnownSender);
}

/** Классификатор для одного списка: поиск отправителя в адресных книгах кэшируется */
export function createClassifier(): (email: EMail) => FocusedTab {
  let known = new Map<string, boolean>();
  let isKnownSender = (address: string) => {
    let key = address.toLowerCase();
    let value = known.get(key);
    if (value === undefined) {
      value = !!findPerson(address);
      known.set(key, value);
    }
    return value;
  };
  return email => classifyMessage(email, isKnownSender);
}

export function focusedInboxEnabled() {
  return getLocalStorage<boolean>(kFocusedEnabledKey, false);
}
