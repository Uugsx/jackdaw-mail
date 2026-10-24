/**
 * Надёжные и заблокированные отправители (как «Нежелательная почта → Параметры» в Outlook)
 * и «Сообщить о фишинге».
 *
 * - OWA: списки живут на сервере (`Get/SetMailboxJunkEmailConfiguration`, как в Outlook в браузере),
 *   здесь — копия для показа и проверки.
 * - EWS: отдельной операции для списков нет. `MarkAsJunk` с `IsJunk=true/false` сам добавляет
 *   отправителя в заблокированные/надёжные на сервере, а полный список виден только здесь, локально.
 * - IMAP и прочие: только локальный список; входящие от заблокированных уходят в «Спам»,
 *   от надёжных — возвращаются из «Спама».
 *
 * Запись — адрес (`anna@example.com`) или домен (`example.com`, `@example.com`).
 * Надёжный отправитель важнее заблокированного, как в Exchange.
 */
import type { EMail } from "../EMail";
import type { MailAccount } from "../MailAccount";
import type { OWAAccount } from "../OWA/OWAAccount";
import { SpecialFolder } from "../Folder";
import { PersonUID } from "../../Abstract/PersonUID";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export interface SenderLists {
  trusted: string[];
  blocked: string[];
}

export type SenderVerdict = "trusted" | "blocked" | null;

export const kSenderListsKey = "mail.junk.senderLists.v1";
export const kPhishingAddressKey = "mail.junk.phishingReportAddress";

const kEmailRE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const kDomainRE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Приводит запись к виду Exchange: адрес или домен без `@`. Неверная — `null`. */
export function normalizeSenderEntry(entry: string | null | undefined): string | null {
  let value = (entry ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  if (value.startsWith("@")) {
    value = value.slice(1);
  }
  if (kEmailRE.test(value) || kDomainRE.test(value)) {
    return value;
  }
  return null;
}

export function sanitizeSenderLists(lists: any): SenderLists {
  let clean = (values: any): string[] => {
    let result: string[] = [];
    for (let value of Array.isArray(values) ? values : []) {
      let entry = normalizeSenderEntry(typeof value == "string" ? value : null);
      if (entry && !result.includes(entry)) {
        result.push(entry);
      }
    }
    return result.sort();
  };
  return { trusted: clean(lists?.trusted), blocked: clean(lists?.blocked) };
}

function entryMatches(entry: string, address: string): boolean {
  if (entry.includes("@")) {
    return entry == address;
  }
  let domain = address.slice(address.lastIndexOf("@") + 1);
  return domain == entry || domain.endsWith("." + entry);
}

/** Что списки говорят про отправителя `address` */
export function senderVerdict(lists: SenderLists, address: string | null | undefined): SenderVerdict {
  let sender = (address ?? "").trim().toLowerCase();
  if (!sender.includes("@")) {
    return null;
  }
  if (lists.trusted.some(entry => entryMatches(entry, sender))) {
    return "trusted";
  }
  if (lists.blocked.some(entry => entryMatches(entry, sender))) {
    return "blocked";
  }
  return null;
}

/** Добавляет запись в один список и убирает из другого */
export function addSenderEntry(lists: SenderLists, list: keyof SenderLists, entry: string): SenderLists {
  let value = normalizeSenderEntry(entry);
  if (!value) {
    throw new UserError(gt`${entry} is not an email address or domain`);
  }
  let other: keyof SenderLists = list == "trusted" ? "blocked" : "trusted";
  return sanitizeSenderLists({
    [list]: [...lists[list], value],
    [other]: lists[other].filter(existing => existing != value),
  });
}

export function removeSenderEntry(lists: SenderLists, list: keyof SenderLists, entry: string): SenderLists {
  return sanitizeSenderLists({ ...lists, [list]: lists[list].filter(existing => existing != entry) });
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

// Локальное хранение

function allLocalLists(): Record<string, SenderLists> {
  let value = getLocalStorage<Record<string, SenderLists>>(kSenderListsKey, {}).value;
  return value && typeof value == "object" ? { ...value } : {};
}

export function getLocalSenderLists(account: MailAccount): SenderLists {
  return sanitizeSenderLists(allLocalLists()[account.id]);
}

export function setLocalSenderLists(account: MailAccount, lists: SenderLists): void {
  let all = allLocalLists();
  all[account.id] = sanitizeSenderLists(lists);
  getLocalStorage<Record<string, SenderLists>>(kSenderListsKey, {}).value = all;
}

// OWA

export class OWAGetJunkEmailRequest {
  get action() {
    return "GetMailboxJunkEmailConfiguration";
  }
}

export class OWASetJunkEmailRequest {
  readonly __type = "SetMailboxJunkEmailConfigurationRequest:#Exchange";
  readonly Header = {
    __type: "JsonRequestHeaders:#Exchange",
    RequestServerVersion: "Exchange2013",
  };
  readonly Options: Record<string, any>;

  constructor(lists: SenderLists) {
    this.Options = {
      __type: "MailboxJunkEmailConfigurationOptions:#Exchange",
      TrustedSendersAndDomains: lists.trusted,
      BlockedSendersAndDomains: lists.blocked,
    };
  }

  get action() {
    return "SetMailboxJunkEmailConfiguration";
  }
}

/** Ошибку эти вызовы OWA возвращают с HTTP 200 и `WasSuccessful: false` */
export function checkOWAJunkEmailResponse(response: any): void {
  if (response?.WasSuccessful === false) {
    let message = response.ErrorMessage;
    throw new Error((typeof message == "string" && message) || "Junk email request failed (ErrorCode " + response.ErrorCode + ")");
  }
}

export function parseOWAJunkEmailResponse(response: any): SenderLists {
  checkOWAJunkEmailResponse(response);
  let options = (response?.Body ?? response)?.Options;
  if (!options || typeof options != "object") {
    throw new Error("GetMailboxJunkEmailConfiguration: no Options in the response");
  }
  let list = (value: any) => Array.isArray(value) ? value : Array.isArray(value?.String) ? value.String : [];
  return sanitizeSenderLists({
    trusted: list(options.TrustedSendersAndDomains),
    blocked: list(options.BlockedSendersAndDomains),
  });
}

/** У OWA списки на сервере, у остальных — только здесь */
export function hasServerSenderLists(account: MailAccount): boolean {
  return account.protocol == "owa";
}

/** Списки ящика: у OWA — с сервера (и копия локально), у остальных — локальные */
export async function loadSenderLists(account: MailAccount): Promise<SenderLists> {
  if (hasServerSenderLists(account)) {
    let lists = parseOWAJunkEmailResponse(await (account as OWAAccount).callOWA(new OWAGetJunkEmailRequest()));
    setLocalSenderLists(account, lists);
    return lists;
  }
  return getLocalSenderLists(account);
}

export async function saveSenderLists(account: MailAccount, lists: SenderLists): Promise<void> {
  lists = sanitizeSenderLists(lists);
  if (hasServerSenderLists(account)) {
    checkOWAJunkEmailResponse(await (account as OWAAccount).callOWA(new OWASetJunkEmailRequest(lists)));
  }
  setLocalSenderLists(account, lists);
}

// Действия с письмом

async function changeLists(account: MailAccount, change: (lists: SenderLists) => SenderLists): Promise<void> {
  let lists = hasServerSenderLists(account) ? await loadSenderLists(account) : getLocalSenderLists(account);
  await saveSenderLists(account, change(lists));
}

/** «Заблокировать отправителя»: в заблокированные и письмо — в «Спам».
 * EWS/OWA `MarkAsJunk` в `treatSpam()` и сам вносит адрес в список на сервере. */
export async function blockSender(email: EMail): Promise<void> {
  let address = email.from?.emailAddress;
  if (!address) {
    throw new UserError(gt`This message has no sender address`);
  }
  await changeLists(email.folder.account, lists => addSenderEntry(lists, "blocked", address));
  if (!email.isSpam || email.folder?.specialFolder != SpecialFolder.Spam) {
    await email.treatSpam(true);
  }
}

/** «Никогда не блокировать отправителя / домен»: в надёжные и письмо — из «Спама» */
export async function trustSender(email: EMail, wholeDomain = false): Promise<void> {
  let address = email.from?.emailAddress;
  if (!address) {
    throw new UserError(gt`This message has no sender address`);
  }
  let entry = wholeDomain ? domainOf(address) : address;
  await changeLists(email.folder.account, lists => addSenderEntry(lists, "trusted", entry));
  if (email.isSpam || email.folder?.specialFolder == SpecialFolder.Spam) {
    await email.treatSpam(false);
  }
}

/**
 * Входящее письмо по локальным спискам: от заблокированного — в «Спам»,
 * от надёжного — из «Спама» во «Входящие». OWA и EWS сортирует сам сервер,
 * поэтому только для остальных протоколов. Возвращает, что сделали.
 */
export async function applySenderLists(email: EMail): Promise<SenderVerdict> {
  let account = email.folder?.account;
  if (!account || account.protocol == "owa" || account.protocol == "ews" || email.outgoing) {
    return null;
  }
  let special = email.folder.specialFolder;
  let verdict = senderVerdict(getLocalSenderLists(account), email.from?.emailAddress);
  if (verdict == "blocked" && special == SpecialFolder.Inbox && !email.isSpam) {
    await email.treatSpam(true);
    return verdict;
  }
  if (verdict == "trusted" && special == SpecialFolder.Spam) {
    await email.treatSpam(false);
    return verdict;
  }
  return null;
}

// Фишинг

export function getPhishingReportAddress(): string | null {
  let value = getLocalStorage<string>(kPhishingAddressKey, "").value;
  return normalizeSenderEntry(value)?.includes("@") ? value.trim() : null;
}

/** «Сообщить о фишинге»: пересылает письмо вложением (.eml) на адрес из настроек
 * и переносит в «Спам». Без адреса ничего не делает и просит его указать. */
export async function reportPhishing(email: EMail): Promise<void> {
  let address = getPhishingReportAddress();
  if (!address) {
    throw new UserError(gt`Please set the address for phishing reports in Settings → Mail → Junk mail`);
  }
  let report = await email.compose.forwardAsAttachment();
  // Не помечаем подозрительное письмо как «переслано»
  report.composeSource = null;
  report.subject = "Phishing: " + (email.subject ?? ""); // Do *not* localize: читает служба безопасности
  report.to.add(new PersonUID(address));
  report.html = `<p>${gt`Reported as phishing from Jackdaw Mail.`}</p>`;
  await report.compose.send();
  if (!email.isSpam || email.folder?.specialFolder != SpecialFolder.Spam) {
    await email.treatSpam(true);
  }
}
