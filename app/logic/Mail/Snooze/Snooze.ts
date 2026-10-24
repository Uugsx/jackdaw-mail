/**
 * «Отложить письмо», как в Outlook: письмо уходит в папку «Отложенные» ящика
 * и в назначенное время возвращается во «Входящие» непрочитанным.
 *
 * Папка — обычная папка ящика, поэтому работает для всех протоколов и видна на других
 * устройствах; срок хранится здесь (`mail.snooze.v1`), по Message-ID письма.
 * Если пока приложение закрыто срок прошёл — письмо вернётся при следующем запуске.
 */
import type { EMail } from "../EMail";
import type { MailAccount } from "../MailAccount";
import type { Folder } from "../Folder";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export interface SnoozeRecord {
  accountID: string;
  messageID: string;
  /** ISO-время возврата */
  until: string;
  subject: string;
}

export const kSnoozeKey = "mail.snooze.v1";
/** ID папки «Отложенные» по ящикам */
export const kSnoozeFolderKey = "mail.snooze.folders.v1";
/** Как часто проверяем сроки */
export const kSnoozeCheckMS = 60 * 1000;

export function getSnoozes(): SnoozeRecord[] {
  let value = getLocalStorage<SnoozeRecord[]>(kSnoozeKey, []).value;
  return Array.isArray(value)
    ? value.filter(record => record?.accountID && record.messageID && !isNaN(new Date(record.until).getTime()))
    : [];
}

function setSnoozes(records: SnoozeRecord[]): void {
  getLocalStorage<SnoozeRecord[]>(kSnoozeKey, []).value = records;
}

function removeSnooze(accountID: string, messageID: string): void {
  setSnoozes(getSnoozes().filter(record => !(record.accountID == accountID && record.messageID == messageID)));
}

export function findSnooze(email: EMail): SnoozeRecord | null {
  let accountID = email.folder?.account?.id;
  return getSnoozes().find(record => record.accountID == accountID && record.messageID == email.messageID) ?? null;
}

// Варианты сроков, как в Outlook

export type SnoozePreset = "later-today" | "tomorrow" | "weekend" | "next-week";
export const kSnoozePresets: SnoozePreset[] = ["later-today", "tomorrow", "weekend", "next-week"];
/** Час начала рабочего дня для «Завтра», «В выходные», «На следующей неделе» */
export const kSnoozeMorningHour = 8;
const kLaterTodayHours = 3;

export function snoozePresetTime(preset: SnoozePreset, now = new Date()): Date {
  let date = new Date(now);
  if (preset == "later-today") {
    date.setHours(date.getHours() + kLaterTodayHours, 0, 0, 0);
    return date;
  }
  date.setHours(kSnoozeMorningHour, 0, 0, 0);
  if (preset == "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else if (preset == "weekend") {
    // Ближайшая суббота; в субботу — следующая
    let days = (6 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + days);
  } else {
    // Следующий понедельник
    let days = (1 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + days);
  }
  return date;
}

// Папка

function folderIDs(): Record<string, string> {
  let value = getLocalStorage<Record<string, string>>(kSnoozeFolderKey, {}).value;
  return value && typeof value == "object" ? value : {};
}

export function findSnoozeFolder(account: MailAccount): Folder | null {
  let id = folderIDs()[account.id];
  let name = gt`Snoozed`;
  return account.findFolder(folder => id ? folder.id == id : false)
    ?? account.rootFolders.find(folder => folder.name == name)
    ?? null;
}

async function getOrCreateSnoozeFolder(account: MailAccount): Promise<Folder> {
  let folder = findSnoozeFolder(account) ?? await account.createToplevelFolder(gt`Snoozed`);
  let ids = folderIDs();
  if (folder.id && ids[account.id] != folder.id) {
    ids[account.id] = folder.id;
    getLocalStorage<Record<string, string>>(kSnoozeFolderKey, {}).value = ids;
  }
  return folder;
}

// Действия

/** Убирает письмо в «Отложенные» до `until` */
export async function snoozeMessage(email: EMail, until: Date): Promise<void> {
  if (!(until.getTime() > Date.now())) {
    throw new UserError(gt`Please pick a time in the future`);
  }
  let account = email.folder?.account;
  if (!account || !email.messageID) {
    throw new UserError(gt`This message cannot be snoozed`);
  }
  let folder = await getOrCreateSnoozeFolder(account);
  if (email.folder != folder) {
    await folder.moveMessageHere(email);
  }
  removeSnooze(account.id, email.messageID);
  let records = getSnoozes();
  records.push({ accountID: account.id, messageID: email.messageID, until: until.toISOString(), subject: email.subject ?? "" });
  setSnoozes(records);
}

/** Возвращает письмо во «Входящие» сейчас, непрочитанным. Письмо не нашлось — срок снимается. */
export async function unsnoozeRecord(record: SnoozeRecord, accounts: Iterable<MailAccount>): Promise<boolean> {
  let account = [...accounts].find(candidate => candidate.id == record.accountID);
  if (!account) {
    // Ящик удалён
    removeSnooze(record.accountID, record.messageID);
    return false;
  }
  if (!account.isLoggedIn) {
    return false;
  }
  let folder = findSnoozeFolder(account);
  let find = () => folder?.messages.find(message => message.messageID == record.messageID);
  let email = find();
  if (!email && folder) {
    await folder.listMessages();
    email = find();
  }
  let done = () => removeSnooze(record.accountID, record.messageID);
  if (!email) {
    // Письмо уже перенесли или удалили вручную
    done();
    return false;
  }
  let inbox = account.inbox;
  if (!inbox) {
    return false;
  }
  await inbox.moveMessageHere(email);
  done();
  let moved = inbox.messages.find(message => message.messageID == record.messageID) ?? email;
  if (moved.isRead) {
    await moved.markRead(false);
  }
  return true;
}

export async function unsnoozeMessage(email: EMail, accounts: Iterable<MailAccount>): Promise<void> {
  let record = findSnooze(email);
  if (record) {
    await unsnoozeRecord(record, accounts);
  }
}

/** Возвращает письма, срок которых прошёл. Ошибка одного письма не мешает остальным. */
export async function wakeDueSnoozes(accounts: Iterable<MailAccount>, now = new Date()): Promise<number> {
  let woken = 0;
  let list = [...accounts];
  for (let record of getSnoozes()) {
    if (new Date(record.until) > now) {
      continue;
    }
    try {
      if (await unsnoozeRecord(record, list)) {
        woken++;
      }
    } catch (ex) {
      console.error(ex);
    }
  }
  return woken;
}
