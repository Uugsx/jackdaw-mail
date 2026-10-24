import { get, writable } from "svelte/store";
import { appGlobal } from "../../../logic/app";
import type { EMail } from "../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import {
  shouldNotifyFollowUp,
  snoozeFollowUpDueAt,
  type FollowUpChoice,
  type FollowUpReminder,
} from "../../../logic/Mail/FollowUp/FollowUpReminder";
import {
  cancelFollowUpReminder,
  checkFollowUpReminders,
  markFollowUpNotified,
  snoozeFollowUpReminder,
} from "../../../logic/Mail/FollowUp/FollowUpReminderData";
import {
  followUpReminderEpoch,
  notifyFollowUpRemindersChanged,
  startFollowUpForEMail,
} from "../../../logic/Mail/FollowUp/trackFollowUp";
import { getConfiguredMailAddresses } from "../../../logic/Reports/ResponseMessageAddresses";
import { UserError } from "../../../logic/util/util";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";
import { responseReminderMailEpoch } from "../ResponseReminderWatcher";
import { openPendingResponseMessage } from "../openPendingResponse";
import { NotificationKinds, SystemNotification } from "../../Shared/SystemNotification";
import { notificationSubject } from "../../Shared/notificationText";
import { backgroundError } from "../../Util/error";
import MailIcon from "../../asset/icon/appBar/mail.svg?raw";

const POLL_MS = 60_000;
const INITIAL_DELAY_MS = 3_000;
const CHANGE_DELAY_MS = 300;
/** Почта менялась: не проверяем на каждое письмо пачки синхронизации. */
const MAIL_CHANGE_DELAY_MS = 5_000;
/** После запуска синхронизация скачивает ответы, пришедшие при закрытом
 * приложении. Уведомлять о просрочке раньше — значит сообщить ложно. */
export const FOLLOW_UP_STARTUP_GRACE_MS = 90_000;
const MAX_NOTIFICATIONS_PER_CHECK = 5;

export interface FollowUpSnapshot {
  /** Ждущие ответа, по сроку. */
  reminders: FollowUpReminder[];
  loaded: boolean;
  hasError: boolean;
}

/** Список «Ждут ответа» для левой панели и меню письма. */
export const followUpSnapshot = writable<FollowUpSnapshot>({
  reminders: [],
  loaded: false,
  hasError: false,
});

let watcherStarted = false;
let startedAt = Date.now();
let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Number.POSITIVE_INFINITY;

/** Запускает проверку один раз на время работы главного окна, в том числе
 * сразу при запуске: просроченные за время закрытия напоминания всплывут. */
export function startFollowUpWatcher(): void {
  if (watcherStarted) {
    return;
  }
  watcherStarted = true;
  startedAt = Date.now();
  let firstMailEpoch = true;
  responseReminderMailEpoch.subscribe(() => {
    if (firstMailEpoch) {
      firstMailEpoch = false;
      return;
    }
    schedule(MAIL_CHANGE_DELAY_MS);
  });
  let firstEpoch = true;
  followUpReminderEpoch.subscribe(() => {
    if (firstEpoch) {
      firstEpoch = false;
      return;
    }
    schedule(CHANGE_DELAY_MS);
  });
  setInterval(() => schedule(CHANGE_DELAY_MS), POLL_MS);
  schedule(INITIAL_DELAY_MS);
}

/** Перечитать список сейчас (после действия пользователя в этом окне).
 * Уведомления показывает только главное окно, где запущен наблюдатель. */
export function refreshFollowUps(): void {
  if (watcherStarted) {
    schedule(CHANGE_DELAY_MS);
  } else {
    void evaluate(false).catch(backgroundError);
  }
}

function schedule(delayMs: number): void {
  if (running) {
    pending = true;
    return;
  }
  let at = Date.now() + Math.max(0, delayMs);
  if (timer != null) {
    if (timerAt <= at) {
      return;
    }
    clearTimeout(timer);
  }
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    timerAt = Number.POSITIVE_INFINITY;
    void evaluate().catch(backgroundError);
  }, Math.max(0, delayMs));
}

async function evaluate(notify = true): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    let now = new Date();
    let result = await checkFollowUpReminders(ownMailAddresses(), now);
    followUpSnapshot.set({ reminders: result.waiting, loaded: true, hasError: false });
    if (!notify) {
      return;
    }
    let notBefore = new Date(startedAt + FOLLOW_UP_STARTUP_GRACE_MS);
    let due = result.waiting.filter(reminder => shouldNotifyFollowUp(reminder, now, notBefore));
    for (let reminder of due.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) {
      // Сначала отметка в базе: при сбое показа уведомление не повторится
      // на каждой проверке.
      await markFollowUpNotified(reminder.id, now);
      reminder.notifiedAt = now;
      await showFollowUpNotification(reminder).catch(backgroundError);
    }
    if (due.length > MAX_NOTIFICATIONS_PER_CHECK) {
      pending = true;
    }
    scheduleNextDue(result.waiting, now, notBefore);
  } catch (ex) {
    followUpSnapshot.update(snapshot => ({ ...snapshot, loaded: true, hasError: true }));
    throw ex;
  } finally {
    running = false;
    if (pending) {
      pending = false;
      schedule(CHANGE_DELAY_MS);
    }
  }
}

/** Ставит таймер точно на ближайший срок, если он раньше очередного опроса. */
function scheduleNextDue(reminders: FollowUpReminder[], now: Date, notBefore: Date): void {
  let next = Number.POSITIVE_INFINITY;
  for (let reminder of reminders) {
    if (reminder.notifiedAt && reminder.notifiedAt >= reminder.dueAt) {
      continue;
    }
    next = Math.min(next, Math.max(reminder.dueAt.getTime(), notBefore.getTime()));
  }
  let delay = next - now.getTime();
  if (Number.isFinite(delay) && delay < POLL_MS) {
    schedule(Math.max(delay, 0) + 500);
  }
}

/** Свои адреса во всех ящиках, включая общие и псевдонимы: их письма — не ответ. */
function ownMailAddresses(): string[] {
  let addresses = getConfiguredMailAddresses();
  for (let account of appGlobal.emailAccounts) {
    for (let dependent of account.dependentAccounts?.() ?? []) {
      let address = (dependent as { emailAddress?: string }).emailAddress;
      if (address) {
        addresses.push(address.trim().toLowerCase());
      }
    }
  }
  return [...new Set(addresses)];
}

async function showFollowUpNotification(reminder: FollowUpReminder): Promise<void> {
  let subject = notificationSubject(reminder.subject);
  let notification = new SystemNotification(
    // Напоминание поставил сам пользователь: показываем его независимо от
    // переключателя уведомлений о новой почте.
    new NotificationKinds(["popup", "sound"]),
    gt`No reply yet`,
    gt`Nobody has replied to “${subject}” since ${formatFollowUpDate(reminder.sentAt)}.`,
    `follow-up:${reminder.id}:${reminder.dueAt.getTime()}`,
    "other",
  );
  notification.subtitle = [accountName(reminder.accountId), reminder.recipients.join(", ")]
    .filter(Boolean)
    .join(" · ");
  notification.icon = MailIcon;
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => {
    void openFollowUpMessage(reminder).catch(backgroundError);
  };
  await notification.show();
}

export function accountName(accountId: number): string {
  let account = appGlobal.emailAccounts.find(item => String(item.dbID) == String(accountId));
  return account?.name ?? account?.emailAddress ?? "";
}

/** Открывает отправленное письмо из списка «Ждут ответа» или уведомления. */
export async function openFollowUpMessage(reminder: FollowUpReminder): Promise<void> {
  if (reminder.emailId == null || reminder.folderId == null || reminder.folderAccountId == null) {
    throw new UserError(gt`The sent message is not in the local mailbox yet. Open Sent and try again after it syncs.`);
  }
  await openPendingResponseMessage({
    accountId: reminder.folderAccountId,
    folderId: reminder.folderId,
    emailId: reminder.emailId,
  });
}

/** Можно ли поставить напоминание на это письмо из меню. */
export function canFollowUpMessage(email: EMail | null | undefined): boolean {
  return !!email?.messageID && !email.isDraft &&
    (email.outgoing || email.folder?.specialFolder == SpecialFolder.Sent);
}

/** Ждущее напоминание для письма: по Message-ID или по отправленной копии. */
export function findFollowUpForMessage(
  reminders: readonly FollowUpReminder[],
  email: EMail | null | undefined,
): FollowUpReminder | null {
  if (!email) {
    return null;
  }
  return reminders.find(reminder =>
    (!!email.messageID && reminder.messageID == email.messageID) ||
    (email.dbID != null && reminder.emailId != null && String(reminder.emailId) == String(email.dbID))) ?? null;
}

export async function setFollowUpForMessage(email: EMail, choice: FollowUpChoice): Promise<void> {
  let reminder = await startFollowUpForEMail(email, choice);
  // Напоминание на давно отправленное письмо: ответ мог уже прийти, и тогда
  // оно сразу снимется. Говорим об этом, а не молча убираем из списка.
  let result = await checkFollowUpReminders(ownMailAddresses());
  followUpSnapshot.set({ reminders: result.waiting, loaded: true, hasError: false });
  if (result.replied.some(item => item.id == reminder.id)) {
    throw new UserError(gt`A reply to this message has already arrived, so there is nothing to wait for.`);
  }
}

export async function cancelFollowUp(reminder: FollowUpReminder): Promise<void> {
  await cancelFollowUpReminder(reminder.id);
  removeFromSnapshot(reminder.id);
  notifyFollowUpRemindersChanged();
}

export async function snoozeFollowUp(reminder: FollowUpReminder, days: number): Promise<void> {
  await snoozeFollowUpReminder(reminder.id, snoozeFollowUpDueAt(new Date(), days));
  notifyFollowUpRemindersChanged();
  refreshFollowUps();
}

function removeFromSnapshot(id: number): void {
  let snapshot = get(followUpSnapshot);
  followUpSnapshot.set({
    ...snapshot,
    reminders: snapshot.reminders.filter(reminder => reminder.id != id),
  });
}

export function formatFollowUpDate(date: Date, now = new Date()): string {
  let sameYear = date.getFullYear() == now.getFullYear();
  return new Intl.DateTimeFormat(getDateTimeLocale(), {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
