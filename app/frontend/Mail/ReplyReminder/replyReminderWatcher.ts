import {
  getReplyReminders, isReplyReminderDue, kReplyReminderCheckMS, markReplyReminderNotified,
  removeReplyReminderRecord, type ReplyReminderRecord,
} from "../../../logic/Mail/ReplyReminder/ReplyReminder";
import type { EMail } from "../../../logic/Mail/EMail";
import { appGlobal } from "../../../logic/app";
import { openEMailMessage } from "../open";
import { NotificationKinds, SystemNotification } from "../../Shared/SystemNotification";
import { notificationSubject } from "../../Shared/notificationText";
import { backgroundError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";
import MailIcon from "../../asset/icon/appBar/mail.svg?raw";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Письмо из напоминания, если оно уже загружено в ящик */
function findMessage(record: ReplyReminderRecord): EMail | null {
  let account = [...appGlobal.emailAccounts].find(item => item.id == record.accountID);
  let found: EMail | undefined;
  account?.findFolder(folder => {
    found ??= folder.messages.find(message => message.messageID == record.messageID);
    return false;
  });
  return found ?? null;
}

/** Показывает уведомления о наступивших напоминаниях. Если на письмо уже ответили — молча снимает. */
export async function checkReplyReminders(now = new Date()): Promise<number> {
  let shown = 0;
  for (let record of getReplyReminders()) {
    if (!isReplyReminderDue(record, now)) {
      continue;
    }
    let email = findMessage(record);
    if (email?.isReplied) {
      removeReplyReminderRecord(record);
      continue;
    }
    // Сначала отметка: при сбое показа уведомление не повторится каждую проверку
    markReplyReminderNotified(record, now);
    await showNotification(record, email).catch(backgroundError);
    shown++;
  }
  return shown;
}

async function showNotification(record: ReplyReminderRecord, email: EMail | null): Promise<void> {
  let subject = notificationSubject(record.subject);
  let notification = new SystemNotification(
    // Напоминание поставил сам пользователь: показываем независимо от настройки уведомлений о новой почте
    new NotificationKinds(["popup", "sound"]),
    gt`Time to reply`,
    gt`Reply to the message “${subject}”`,
    `reply-reminder:${record.accountID}:${record.messageID}:${record.at}`,
    "other",
  );
  notification.icon = MailIcon;
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => {
    let target = email ?? findMessage(record);
    if (target) {
      void openEMailMessage(target).catch(backgroundError);
    }
  };
  await notification.show();
}

/** Раз в полминуты проверяет, не пора ли напомнить об ответе */
export function startReplyReminderWatcher(): void {
  if (timer) {
    return;
  }
  let check = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await checkReplyReminders();
    } catch (ex) {
      backgroundError(ex);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void check(), kReplyReminderCheckMS);
  setTimeout(() => void check(), 5_000);
}
