/**
 * «Напомнить ответить»: письмо остаётся во «Входящих», в назначенное время приходит
 * уведомление, пока срок не наступил или письмо не отмечено отвеченным — в списке стоит значок.
 *
 * В отличие от «Отложить» письмо никуда не прячется. Срок хранится здесь (`mail.replyReminder.v1`)
 * по ящику и Message-ID и на сервер не уходит. Сроки — те же пресеты, что у «Отложить».
 */
import type { EMail } from "../EMail";
import { snoozePresetTime, type SnoozePreset } from "../Snooze/Snooze";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { writable } from "svelte/store";

export interface ReplyReminderRecord {
  accountID: string;
  messageID: string;
  /** ISO-время напоминания */
  at: string;
  subject: string;
  /** ISO-время показанного уведомления; пока нет — напоминание ещё не сработало */
  notifiedAt?: string;
}

export const kReplyReminderKey = "mail.replyReminder.v1";
/** Как часто проверяем сроки */
export const kReplyReminderCheckMS = 30 * 1000;

/** Меняется при каждой правке: списки пересчитывают значок */
export const replyRemindersChanged = writable(0);

export type ReplyReminderPreset = SnoozePreset;
export const replyReminderTime = snoozePresetTime;

export function getReplyReminders(): ReplyReminderRecord[] {
  let value = getLocalStorage<ReplyReminderRecord[]>(kReplyReminderKey, []).value;
  return Array.isArray(value)
    ? value.filter(record => record?.accountID && record.messageID && !isNaN(new Date(record.at).getTime()))
    : [];
}

function setReplyReminders(records: ReplyReminderRecord[]): void {
  getLocalStorage<ReplyReminderRecord[]>(kReplyReminderKey, []).value = records;
  replyRemindersChanged.update(count => count + 1);
}

function sameMessage(record: ReplyReminderRecord, accountID: string | undefined, messageID: string | undefined): boolean {
  return record.accountID == accountID && record.messageID == messageID;
}

export function findReplyReminder(email: EMail): ReplyReminderRecord | null {
  let accountID = email.folder?.account?.id;
  if (!accountID || !email.messageID) {
    return null;
  }
  return getReplyReminders().find(record => sameMessage(record, accountID, email.messageID)) ?? null;
}

/** Ставит напоминание; уже стоящее для этого письма заменяется */
export function setReplyReminder(email: EMail, at: Date): void {
  if (!(at.getTime() > Date.now())) {
    throw new UserError(gt`Please pick a time in the future`);
  }
  let accountID = email.folder?.account?.id;
  if (!accountID || !email.messageID) {
    throw new UserError(gt`This message cannot have a reminder`);
  }
  let records = getReplyReminders().filter(record => !sameMessage(record, accountID, email.messageID));
  records.push({ accountID, messageID: email.messageID, at: at.toISOString(), subject: email.subject ?? "" });
  setReplyReminders(records);
}

export function clearReplyReminder(email: EMail): void {
  let accountID = email.folder?.account?.id;
  let records = getReplyReminders();
  let rest = records.filter(record => !sameMessage(record, accountID, email.messageID));
  if (rest.length != records.length) {
    setReplyReminders(rest);
  }
}

/** Напоминание, срок которого наступил, но уведомление ещё не показано */
export function isReplyReminderDue(record: ReplyReminderRecord, now = new Date()): boolean {
  return !record.notifiedAt && new Date(record.at) <= now;
}

export function markReplyReminderNotified(record: ReplyReminderRecord, now = new Date()): void {
  setReplyReminders(getReplyReminders().map(item =>
    sameMessage(item, record.accountID, record.messageID) ? { ...item, notifiedAt: now.toISOString() } : item));
}

export function removeReplyReminderRecord(record: ReplyReminderRecord): void {
  setReplyReminders(getReplyReminders().filter(item => !sameMessage(item, record.accountID, record.messageID)));
}
