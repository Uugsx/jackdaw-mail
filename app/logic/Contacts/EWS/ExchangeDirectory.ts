/**
 * Каталог Exchange (GAL): участники рассылки (`ExpandDL`), руководитель и подчинённые
 * (`ResolveNames` с `ContactDataShape=AllProperties` → `ManagerMailbox`, `DirectReports`).
 *
 * EWS и OWA принимают одни и те же операции: EWS — SOAP, OWA — JSON в `service.svc`.
 * Ответы OWA бывают то массивом, то объектом с вложенным `Mailbox`, как в XML,
 * поэтому разбор терпимый к обоим видам.
 */
import type { MailAccount } from "../../Mail/MailAccount";
import type { EWSAccount } from "../../Mail/EWS/EWSAccount";
import type { OWAAccount } from "../../Mail/OWA/OWAAccount";
import { OWARequest } from "../../Mail/OWA/Request/OWARequest";
import { getDomainForEmailAddress } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ensureArray } from "../../util/util";

export type DirectoryEntryKind = "person" | "group" | "contact" | "other";

/** Получатель из каталога: человек, рассылка, внешний контакт или общая папка */
export interface DirectoryEntry {
  name: string;
  emailAddress: string;
  kind: DirectoryEntryKind;
}

/** Сведения о человеке или рассылке из каталога организации */
export interface DirectoryInfo {
  name: string;
  emailAddress: string;
  kind: DirectoryEntryKind;
  jobTitle: string | null;
  department: string | null;
  office: string | null;
  company: string | null;
  manager: DirectoryEntry | null;
  directReports: DirectoryEntry[];
}

/** Сколько держим ответ каталога, чтобы не спрашивать сервер при каждом открытии карточки */
export const kDirectoryCacheMS = 10 * 60 * 1000;

const kGroupMailboxTypes = ["PublicDL", "PrivateDL", "GroupMailbox"];

// EWS

export function ewsExpandDLRequest(emailAddress: string) {
  return {
    m$ExpandDL: {
      m$Mailbox: {
        t$EmailAddress: emailAddress,
      },
    },
  };
}

/** `SMTP:` — точное совпадение адреса, без поиска по началу имён */
export function ewsResolveDirectoryRequest(emailAddress: string) {
  return {
    m$ResolveNames: {
      ReturnFullContactData: true,
      SearchScope: "ActiveDirectory",
      ContactDataShape: "AllProperties",
      m$UnresolvedEntry: "SMTP:" + emailAddress,
    },
  };
}

// OWA

export function owaExpandDLRequest(emailAddress: string): OWARequest {
  return new OWARequest("ExpandDL", {
    __type: "ExpandDLRequest:#Exchange",
    Mailbox: {
      __type: "EmailAddress:#Exchange",
      EmailAddress: emailAddress,
      RoutingType: "SMTP",
    },
  });
}

export function owaResolveDirectoryRequest(emailAddress: string): OWARequest {
  return new OWARequest("ResolveNames", {
    __type: "ResolveNamesRequest:#Exchange",
    UnresolvedEntry: "SMTP:" + emailAddress,
    ReturnFullContactData: true,
    SearchScope: "ActiveDirectory",
    ContactDataShape: "AllProperties",
  });
}

// Разбор

/** Разбирает ответ `ExpandDL` (EWS после XML2JSON и OWA): `DLExpansion/Mailbox` */
export function parseExpandDL(response: any): DirectoryEntry[] {
  let expansion = response?.DLExpansion;
  let mailboxes = Array.isArray(expansion) ? expansion : ensureArray(expansion?.Mailbox);
  return parseMailboxes(mailboxes);
}

/** Разбирает ответ `ResolveNames` и берёт запись с адресом `emailAddress`.
 * Нет такой записи — `null`. */
export function parseDirectoryInfo(response: any, emailAddress: string): DirectoryInfo | null {
  let set = response?.ResolutionSet;
  let resolutions = Array.isArray(set) ? set : ensureArray(set?.Resolution);
  let resolution = resolutions.find(candidate => sameAddress(candidate?.Mailbox?.EmailAddress, emailAddress))
    ?? (resolutions.length == 1 ? resolutions[0] : null);
  if (!resolution) {
    return null;
  }
  let mailbox = resolution.Mailbox ?? {};
  let contact = resolution.Contact ?? {};
  let reports = contact.DirectReports;
  reports = Array.isArray(reports) ? reports : ensureArray(reports?.Mailbox);
  return {
    name: text(contact.DisplayName) ?? text(mailbox.Name) ?? emailAddress,
    emailAddress: sanitize.emailAddress(mailbox.EmailAddress, emailAddress),
    kind: mailboxKind(mailbox.MailboxType),
    jobTitle: text(contact.JobTitle),
    department: text(contact.Department),
    office: text(contact.OfficeLocation),
    company: text(contact.CompanyName),
    manager: parseMailboxes(ensureArray(contact.ManagerMailbox?.Mailbox ?? contact.ManagerMailbox))[0]
      ?? managerByName(contact.Manager),
    directReports: parseMailboxes(reports)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Старые серверы отдают руководителя только именем, без адреса */
function managerByName(name: any): DirectoryEntry | null {
  let managerName = text(name);
  return managerName ? { name: managerName, emailAddress: "", kind: "person" } : null;
}

function parseMailboxes(mailboxes: any[]): DirectoryEntry[] {
  let entries: DirectoryEntry[] = [];
  for (let mailbox of mailboxes) {
    let emailAddress = sanitize.emailAddress(mailbox?.EmailAddress, null);
    // X.500 (`EX`) без SMTP-адреса письмом не достать
    if (!emailAddress || (mailbox.RoutingType && mailbox.RoutingType != "SMTP")) {
      continue;
    }
    if (entries.some(entry => sameAddress(entry.emailAddress, emailAddress))) {
      continue;
    }
    entries.push({
      emailAddress,
      name: text(mailbox.Name) ?? emailAddress,
      kind: mailboxKind(mailbox.MailboxType),
    });
  }
  return entries;
}

export function mailboxKind(type: any): DirectoryEntryKind {
  if (kGroupMailboxTypes.includes(type)) {
    return "group";
  }
  if (type == "Contact" || type == "OneOff") {
    return "contact";
  }
  if (type == "PublicFolder") {
    return "other";
  }
  return "person";
}

function text(value: any): string | null {
  return sanitize.nonemptystring(value, null)?.trim() || null;
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() == b.toLowerCase();
}

// Ящик для запросов

/**
 * Ящик Exchange, через который спрашиваем каталог. Каталог есть только у EWS и OWA.
 * Сначала — ящик того же домена, что и адрес, затем любой подключённый.
 */
export function findDirectoryAccount(accounts: Iterable<MailAccount>, emailAddress?: string | null): MailAccount | null {
  let candidates = [...accounts].filter(account =>
    (account.protocol == "ews" || account.protocol == "owa") && account.isLoggedIn);
  if (!candidates.length) {
    return null;
  }
  let domain = emailAddress ? getDomainForEmailAddress(emailAddress)?.toLowerCase() : null;
  return candidates.find(account => domain && getDomainForEmailAddress(account.emailAddress ?? "")?.toLowerCase() == domain)
    ?? candidates[0];
}

/** Запросы к каталогу через EWS или OWA, с кэшем на `kDirectoryCacheMS` */
export class ExchangeDirectory {
  protected cache = new Map<string, { time: number, promise: Promise<any> }>();

  constructor(readonly account: MailAccount) {
  }

  async expandGroup(emailAddress: string): Promise<DirectoryEntry[]> {
    return parseExpandDL(await this.cached("dl:" + emailAddress.toLowerCase(), () =>
      this.account.protocol == "owa"
        ? (this.account as OWAAccount).callOWA(owaExpandDLRequest(emailAddress))
        : (this.account as EWSAccount).callEWS(ewsExpandDLRequest(emailAddress))));
  }

  /** `null` — адреса нет в каталоге */
  async getInfo(emailAddress: string): Promise<DirectoryInfo | null> {
    try {
      let response = await this.cached("info:" + emailAddress.toLowerCase(), () =>
        this.account.protocol == "owa"
          ? (this.account as OWAAccount).callOWA(owaResolveDirectoryRequest(emailAddress))
          : (this.account as EWSAccount).callEWS(ewsResolveDirectoryRequest(emailAddress)));
      return parseDirectoryInfo(response, emailAddress);
    } catch (ex) {
      if (ex?.type == "ErrorNameResolutionNoResults") {
        return null;
      }
      throw ex;
    }
  }

  protected cached(key: string, call: () => Promise<any>): Promise<any> {
    let now = Date.now();
    let hit = this.cache.get(key);
    if (hit && now - hit.time < kDirectoryCacheMS) {
      return hit.promise;
    }
    let promise = call();
    this.cache.set(key, { time: now, promise });
    // Ошибку не держим в кэше: следующее открытие спросит ещё раз
    promise.catch(() => this.cache.delete(key));
    return promise;
  }
}

const directories = new WeakMap<MailAccount, ExchangeDirectory>();

/** Каталог для адреса или `null`, если нет подключённого ящика Exchange */
export function getExchangeDirectory(accounts: Iterable<MailAccount>, emailAddress?: string | null): ExchangeDirectory | null {
  let account = findDirectoryAccount(accounts, emailAddress);
  if (!account) {
    return null;
  }
  let directory = directories.get(account);
  if (!directory) {
    directory = new ExchangeDirectory(account);
    directories.set(account, directory);
  }
  return directory;
}
