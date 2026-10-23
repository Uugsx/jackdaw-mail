import type { MailAccount } from "../MailAccount";
import { EWSAccount } from "../EWS/EWSAccount";
import { OWAAccount } from "../OWA/OWAAccount";
import {
  ewsDeleteScheduledRequest, ewsFindOutboxRequest, owaDeleteScheduledRequest, owaFindOutboxRequest,
  parseEWSOutbox, parseOWAOutbox, type OutboxScheduledItem,
} from "./DeferredSendRequests";

/** Запросы к «Исходящим» для одного протокола. Отдельно от аккаунта — для тестов. */
export interface DeferredSendProtocol {
  call(request: any): Promise<any>;
  findRequest(): any;
  parseFind(result: any): OutboxScheduledItem[];
  deleteRequest(itemID: string): any;
}

export function ewsDeferredSendProtocol(call: (request: any) => Promise<any>): DeferredSendProtocol {
  return { call, findRequest: ewsFindOutboxRequest, parseFind: parseEWSOutbox, deleteRequest: ewsDeleteScheduledRequest };
}

export function owaDeferredSendProtocol(call: (request: any) => Promise<any>): DeferredSendProtocol {
  return { call, findRequest: owaFindOutboxRequest, parseFind: parseOWAOutbox, deleteRequest: owaDeleteScheduledRequest };
}

/**
 * Отложенную доставку на сервере используем только у своего ящика EWS или OWA.
 * Общий ящик отправляет через основной, и «Исходящие» у них разные — там локальная очередь.
 */
export function canDeferOnServer(account: MailAccount | null | undefined): boolean {
  return (account instanceof EWSAccount || account instanceof OWAAccount) && !account.isDependentAccount;
}

export function deferredSendProtocolFor(account: MailAccount): DeferredSendProtocol {
  if (account instanceof EWSAccount && !account.isDependentAccount) {
    return ewsDeferredSendProtocol(request => account.callEWS(request));
  }
  if (account instanceof OWAAccount && !account.isDependentAccount) {
    return owaDeferredSendProtocol(request => account.callOWA(request));
  }
  throw new Error("Server-side delayed delivery needs an Exchange (EWS or OWA) mailbox");
}

/**
 * Убирает запланированное письмо из «Исходящих» сервера.
 * @returns false — письма там уже нет: сервер его отправил
 */
export async function cancelServerScheduled(protocol: DeferredSendProtocol, scheduleID: string): Promise<boolean> {
  let items = protocol.parseFind(await protocol.call(protocol.findRequest()));
  let found = items.filter(item => item.scheduleID == scheduleID);
  for (let item of found) {
    await protocol.call(protocol.deleteRequest(item.itemID));
  }
  return found.length > 0;
}
