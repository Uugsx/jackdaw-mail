import { writable } from "svelte/store";
import type { EMail } from "../EMail";
import { getWorkingHoursSchedule } from "../../../frontend/Reports/WorkingHoursSettings";
import {
  computeFollowUpDueAt,
  normalizeFollowUpAddresses,
  type FollowUpChoice,
  type FollowUpReminder,
} from "./FollowUpReminder";
import { saveFollowUpReminder } from "./FollowUpReminderData";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Растёт при каждом изменении напоминаний: список «Ждут ответа» перечитывает базу. */
export const followUpReminderEpoch = writable(0);

export function notifyFollowUpRemindersChanged(): void {
  followUpReminderEpoch.update(epoch => epoch + 1);
}

/**
 * Ставит «Напомнить, если не ответят» на отправленное письмо: сразу после
 * отправки из редактора или позже из меню отправленного письма.
 * `accountId` — ящик отправителя; по его расписанию считается рабочий срок.
 * Срок отсчитывается от момента постановки (`now`): «через 3 дня» для письма,
 * отправленного неделю назад, — это через 3 дня, а не уже прошедшая дата.
 * Ответы ищутся с момента отправки `sentAt`.
 */
export async function startFollowUpForEMail(
  email: EMail,
  choice: FollowUpChoice,
  options: {
    sentAt?: Date;
    accountId?: number | string | null;
    /** Отправленная копия в базе. Из редактора — null: dbID там у черновика. */
    emailId?: number | null;
    now?: Date;
  } = {},
): Promise<FollowUpReminder> {
  const accountId = Number(options.accountId ??
    email.folder?.account?.dbID ?? email.identity?.account?.dbID);
  const messageID = email.messageID?.trim();
  if (!Number.isInteger(accountId) || accountId <= 0 || !messageID) {
    throw new UserError(gt`This message cannot be tracked for a reply yet. Try again after it appears in Sent.`);
  }
  const now = options.now ?? new Date();
  const sentAt = validDate(options.sentAt) ?? validDate(email.sent) ?? now;
  const dueAt = computeFollowUpDueAt(choice, now, getWorkingHoursSchedule(accountId));
  if (!dueAt) {
    throw new UserError(gt`The mailbox working hours have no working days. Set them up in the reports settings or pick a date.`);
  }
  if (dueAt.getTime() <= now.getTime()) {
    throw new UserError(gt`The reminder time has already passed. Pick a later time.`);
  }
  const recipients = normalizeFollowUpAddresses([
    ...email.to.contents,
    ...email.cc.contents,
    ...email.bcc.contents,
  ].map(person => person?.emailAddress));
  const reminder = await saveFollowUpReminder({
    accountId,
    messageID,
    threadID: email.threadID,
    emailId: options.emailId !== undefined
      ? options.emailId
      : email.dbID == null ? null : Number(email.dbID),
    subject: email.subject ?? "",
    recipients,
    sentAt,
    dueAt,
    scheduleMode: choice.mode,
    durationDays: choice.mode == "date" ? null : choice.days,
  }, now);
  notifyFollowUpRemindersChanged();
  return reminder;
}

function validDate(value: Date | null | undefined): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}
