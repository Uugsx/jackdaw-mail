/**
 * Предупреждение о коллизии в общих ящиках: связывает письма, настройки и интерфейс
 * с `SharedMailboxPresence` (logic/Mail/Collision).
 *
 * По умолчанию включено только для общих ящиков (зависимые почтовые аккаунты OWA и EWS),
 * для личных — выключено. Пользователь меняет это для каждого ящика или выключает целиком.
 */
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { appGlobal } from "../../../logic/app";
import { getJackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCalls";
import { normalizeCallEmail } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import {
  SharedMailboxPresence,
  type CollisionActivity,
  type CollisionColleague,
  type CollisionStatus,
} from "../../../logic/Mail/Collision/SharedMailboxPresence";
import { getJackdawChatAccount } from "../../../logic/Chat/Jackdaw/JackdawChats";
import { openChatRoomFromOtherApp } from "../../Chat/open";
import { getLocalStorage } from "../../Util/LocalStorage";
import { getDateTimeString } from "../../Util/date";
import { gt } from "../../../l10n/l10n";

export type { CollisionStatus, CollisionColleague } from "../../../logic/Mail/Collision/SharedMailboxPresence";

/** Выключатель функции целиком */
export const collisionEnabledSetting = getLocalStorage("mail.collision.enabled", true);
/** Явный выбор по ящикам: адрес → включено. Нет записи — по умолчанию (общий ящик — да) */
export const collisionMailboxesSetting = getLocalStorage<Record<string, boolean>>("mail.collision.mailboxes", {});

/** Сколько имён показывать в строке, остальные — «+N» */
const MAX_NAMES = 2;

let presence: SharedMailboxPresence | null = null;

/** Общий ящик: отдельный почтовый аккаунт, открытый через основной (OWA, EWS) */
export function isSharedMailboxAccount(account: MailAccount | null | undefined): boolean {
  if (!account?.isDependentAccount) return false;
  let main = account.mainAccount as MailAccount;
  let own = normalizeCallEmail(account.emailAddress);
  return !!own && !!main && "emailAddress" in main && normalizeCallEmail(main.emailAddress) != own;
}

export function isCollisionEnabledFor(account: MailAccount | null | undefined): boolean {
  let mailbox = normalizeCallEmail(account?.emailAddress);
  if (!mailbox || !collisionEnabledSetting.value) return false;
  return collisionMailboxesSetting.value?.[mailbox] ?? isSharedMailboxAccount(account);
}

export function setCollisionEnabledFor(account: MailAccount, enabled: boolean): void {
  let mailbox = normalizeCallEmail(account.emailAddress);
  if (!mailbox) return;
  let choices = { ...collisionMailboxesSetting.value };
  if (enabled == isSharedMailboxAccount(account)) {
    delete choices[mailbox]; // совпадает с умолчанием
  } else {
    choices[mailbox] = enabled;
  }
  collisionMailboxesSetting.value = choices;
}

function enabledMailboxes(): string[] {
  return appGlobal.emailAccounts.contents
    .filter(account => isCollisionEnabledFor(account))
    .map(account => normalizeCallEmail(account.emailAddress))
    .filter((email): email is string => !!email);
}

/** Свой адрес для чата: адрес основного аккаунта, если он подтверждён для звонков */
function replyAddress(mailbox: string): string | null {
  let verified = getJackdawCallClient().verifiedEmails;
  let account = appGlobal.emailAccounts.find(a => normalizeCallEmail(a.emailAddress) == mailbox);
  let candidates = [
    account?.isDependentAccount ? (account.mainAccount as MailAccount)?.emailAddress : null,
    ...appGlobal.emailAccounts.contents.filter(a => !isSharedMailboxAccount(a)).map(a => a.emailAddress),
  ];
  for (let candidate of candidates) {
    let email = normalizeCallEmail(candidate);
    if (email && email != mailbox && verified.includes(email)) return email;
  }
  return null;
}

export function getSharedMailboxPresence(): SharedMailboxPresence {
  presence ??= new SharedMailboxPresence(getJackdawCallClient(), { enabledMailboxes, replyAddress });
  return presence;
}

/** Запуск вместе со звонками: присутствие идёт по тому же соединению. @returns остановка */
export function startSharedMailboxPresence(): () => void {
  let current = getSharedMailboxPresence();
  let stop = current.start();
  let refresh = () => current.refreshMailboxes();
  let unsubscribers = [
    collisionEnabledSetting.subscribe(refresh),
    collisionMailboxesSetting.subscribe(refresh),
    appGlobal.emailAccounts.subscribe(refresh),
  ];
  return () => {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    stop();
  };
}

/** Ящик письма, если для него включено присутствие */
export function collisionMailbox(message: EMail | null | undefined): string | null {
  let account = message?.folder?.account as MailAccount | undefined;
  if (!account || !presence) return null;
  let mailbox = normalizeCallEmail(account.emailAddress);
  // Ящики, которые не смотрим, отсеиваются здесь без чтения настроек: строк в списке много.
  return mailbox && presence.isWatching(mailbox) ? mailbox : null;
}

export function collisionStatusFor(message: EMail | null | undefined): CollisionStatus | null {
  let mailbox = collisionMailbox(message);
  return mailbox ? presence.statusFor(mailbox, message.messageID) : null;
}

/** @returns снятие состояния */
export function beginCollisionActivity(message: EMail | null | undefined, activity: CollisionActivity): () => void {
  let account = message?.folder?.account as MailAccount | undefined;
  let mailbox = normalizeCallEmail(account?.emailAddress);
  if (!mailbox || !message.messageID || !isCollisionEnabledFor(account)) return () => {};
  return getSharedMailboxPresence().begin(mailbox, message.messageID, activity);
}

/** Исходное письмо ответа: само `composeSource` или найденное по ящику черновика */
export function replySource(reply: EMail): { mailbox: string; messageID: string } | null {
  if (!reply.inReplyTo) return null;
  let account = (reply.composeSource?.folder?.account ?? reply.folder?.account) as MailAccount | undefined;
  let mailbox = normalizeCallEmail(account?.emailAddress);
  if (!mailbox || !isCollisionEnabledFor(account)) return null;
  return { mailbox, messageID: reply.composeSource?.messageID ?? reply.inReplyTo };
}

/** Ответ отправлен: коллеги увидят «Ответил» */
export function markCollisionReplied(reply: EMail): void {
  let source = replySource(reply);
  if (source && presence) {
    presence.markReplied(source.mailbox, source.messageID);
  }
}

// --- тексты ----------------------------------------------------------------

function names(colleagues: CollisionColleague[]): string {
  let shown = colleagues.slice(0, MAX_NAMES).map(colleagueName);
  let rest = colleagues.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

export function colleagueName(colleague: CollisionColleague): string {
  return colleague.name || colleague.email || gt`A colleague`;
}

export function repliedTime(colleague: CollisionColleague): string {
  return getDateTimeString(new Date(colleague.at * 1000));
}

/** Главное в одну строку: кто отвечает важнее того, кто ответил, а тот — важнее читающих */
export function collisionLabel(status: CollisionStatus): { kind: "replying" | "replied" | "viewing"; text: string } {
  if (status.replying.length) {
    return { kind: "replying", text: gt`Replying: ${names(status.replying)} *=> a colleague is writing a reply to this shared mailbox message` };
  }
  if (status.replied) {
    return { kind: "replied", text: gt`Replied: ${colleagueName(status.replied)}, ${repliedTime(status.replied)} *=> a colleague already replied to this shared mailbox message; name, time` };
  }
  return { kind: "viewing", text: gt`Reading: ${names(status.viewing)} *=> a colleague has this shared mailbox message open` };
}

/** Подробно, для подсказки и чтения с экрана */
export function collisionDetails(status: CollisionStatus): string {
  let lines: string[] = [];
  if (status.replying.length) {
    lines.push(gt`Replying: ${status.replying.map(colleagueName).join(", ")} *=> a colleague is writing a reply to this shared mailbox message`);
  }
  if (status.replied) {
    lines.push(gt`Replied: ${colleagueName(status.replied)}, ${repliedTime(status.replied)} *=> a colleague already replied to this shared mailbox message; name, time`);
  }
  if (status.viewing.length) {
    lines.push(gt`Reading: ${status.viewing.map(colleagueName).join(", ")} *=> a colleague has this shared mailbox message open`);
  }
  return lines.join("\n");
}

/** Коллега, с которым можно открыть чат: сначала отвечающий, затем ответивший */
export function chatColleague(status: CollisionStatus | null): CollisionColleague | null {
  if (!status) return null;
  return status.replying.find(c => c.email) ?? (status.replied?.email ? status.replied : null) ?? status.viewing.find(c => c.email) ?? null;
}

export async function openColleagueChat(colleague: CollisionColleague): Promise<void> {
  let account = getJackdawChatAccount();
  if (!account || !colleague.email) return;
  openChatRoomFromOtherApp(await account.getDirectRoom(colleague.email));
}
