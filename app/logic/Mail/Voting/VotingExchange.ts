/**
 * Голосование в Exchange: свойства PidLidVerbStream и PidLidVerbResponse при отправке
 * (EWS и OWA) и чтение вариантов голосования полученного письма.
 */
import type { EMail } from "../EMail";
import type { EWSAccount } from "../EWS/EWSAccount";
import type { OWAAccount } from "../OWA/OWAAccount";
import { OWARequest } from "../OWA/Request/OWARequest";
import {
  base64ToBytes, buildVerbStream, bytesToBase64, kVerbResponseField, kVerbStreamField, kVoteHeader, kVotingHeader,
  parseVerbStream, parseVotingHeader,
} from "./Voting";
import { ensureArray } from "../../util/util";

/** Значение заголовка письма без учёта регистра имени */
export function headerValue(email: EMail, name: string): string | null {
  let lower = name.toLowerCase();
  for (let [key, value] of email.headers.entries()) {
    if (key.toLowerCase() == lower) {
      return value;
    }
  }
  return null;
}

export function outgoingVotingOptions(email: EMail): string[] {
  return parseVotingHeader(headerValue(email, kVotingHeader));
}

export function outgoingVote(email: EMail): string | null {
  let value = headerValue(email, kVoteHeader);
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value).trim() || null;
  } catch {
    return null;
  }
}

/** Свойства для `t$ExtendedProperty` CreateItem в EWS */
export function ewsVotingProperties(email: EMail): any[] {
  let properties: any[] = [];
  let options = outgoingVotingOptions(email);
  if (options.length) {
    properties.push({ t$ExtendedFieldURI: { ...kVerbStreamField }, t$Value: bytesToBase64(buildVerbStream(options)) });
  }
  let vote = outgoingVote(email);
  if (vote) {
    properties.push({ t$ExtendedFieldURI: { ...kVerbResponseField }, t$Value: vote });
  }
  return properties;
}

/** То же для OWA (JSON без префиксов) */
export function owaVotingProperties(email: EMail): any[] {
  return ewsVotingProperties(email).map(property => ({
    ExtendedFieldURI: property.t$ExtendedFieldURI,
    Value: property.t$Value,
  }));
}

function extendedValue(item: any, propertyId: number): string | null {
  for (let property of ensureArray(item?.ExtendedProperty)) {
    let uri = property?.ExtendedFieldURI;
    let id = Number(uri?.PropertyId);
    if (id == propertyId) {
      return typeof property.Value == "string" ? property.Value : null;
    }
  }
  return null;
}

export function ewsVotingRequest(itemID: string): any {
  return {
    m$GetItem: {
      m$ItemShape: {
        t$BaseShape: "IdOnly",
        t$AdditionalProperties: {
          t$ExtendedFieldURI: [{ ...kVerbStreamField }, { ...kVerbResponseField }],
        },
      },
      m$ItemIds: {
        t$ItemId: [{ Id: itemID }],
      },
    },
  };
}

export function owaVotingRequest(itemID: string): OWARequest {
  return new OWARequest("GetItem", {
    __type: "GetItemRequest:#Exchange",
    ItemShape: {
      __type: "ItemResponseShape:#Exchange",
      BaseShape: "IdOnly",
      AdditionalProperties: [kVerbStreamField, kVerbResponseField].map(field => ({
        __type: "ExtendedPropertyUri:#Exchange",
        ...field,
      })),
    },
    ItemIds: [{ __type: "ItemId:#Exchange", Id: itemID }],
  });
}

/** Первое письмо из ответа GetItem (EWS после XML2JSON и OWA) */
function firstItem(response: any): any {
  let message = ensureArray(response?.ResponseMessages?.Items ?? response)[0] ?? response;
  let items = message?.Items;
  if (Array.isArray(items)) {
    return items[0];
  }
  return items && typeof items == "object" ? ensureArray(Object.values(items)[0] as any)[0] : null;
}

export interface ExchangeVoting {
  options: string[];
  /** Выбранный вариант, если это ответ на голосование */
  vote: string | null;
}

export function parseExchangeVoting(response: any): ExchangeVoting {
  let item = firstItem(response);
  let stream = extendedValue(item, kVerbStreamField.PropertyId);
  let options: string[] = [];
  if (stream) {
    try {
      options = parseVerbStream(base64ToBytes(stream));
    } catch {
      options = [];
    }
  }
  return { options, vote: extendedValue(item, kVerbResponseField.PropertyId)?.trim() || null };
}

/** Спрашивает у Exchange варианты голосования письма; не Exchange — пусто */
export async function loadExchangeVoting(email: EMail): Promise<ExchangeVoting | null> {
  let account = email.folder?.account;
  let itemID = (email as any).itemID as string | undefined;
  if (!account || !itemID || (account.protocol != "ews" && account.protocol != "owa")) {
    return null;
  }
  let response = account.protocol == "owa"
    ? await (account as OWAAccount).callOWA(owaVotingRequest(itemID))
    : await (account as EWSAccount).callEWS(ewsVotingRequest(itemID));
  return parseExchangeVoting(response);
}
