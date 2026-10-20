import type { EMail } from "../../logic/Mail/EMail";
import type { Folder } from "../../logic/Mail/Folder";

export function messagesRepresentSameMail(a: EMail, b: EMail): boolean {
  if (a == b) {
    return true;
  }
  if (a.dbID != null && b.dbID != null) {
    return a.dbID == b.dbID;
  }
  if (a.pID != null && b.pID != null) {
    return a.pID == b.pID;
  }
  if (a.id != null && b.id != null) {
    return a.id == b.id;
  }
  return false;
}

/**
 * Индекс писем для проверки «это то же письмо?» без перебора всех: кандидаты
 * берутся по dbID/pID/id, а решает тот же `messagesRepresentSameMail`.
 * Раньше каждое письмо сравнивалось со всеми: закрытие инцидента в 20 тыс.
 * писем — это 2·10⁸ сравнений и зависание интерфейса.
 */
export class MailIdentityIndex {
  protected readonly objects = new Set<EMail>();
  protected readonly byField = new Map<unknown, EMail[]>();

  add(message: EMail): void {
    this.objects.add(message);
    for (let value of [message.dbID, message.pID, message.id]) {
      if (value == null) {
        continue;
      }
      let list = this.byField.get(value);
      if (list) {
        list.push(message);
      } else {
        this.byField.set(value, [message]);
      }
    }
  }

  has(message: EMail): boolean {
    if (this.objects.has(message)) {
      return true;
    }
    for (let value of [message.dbID, message.pID, message.id]) {
      if (value == null) {
        continue;
      }
      for (let existing of this.byField.get(value) ?? []) {
        if (messagesRepresentSameMail(existing, message)) {
          return true;
        }
      }
    }
    return false;
  }
}

/** Письма без повторов, в порядке первого появления. */
export function uniqueMessagesByIdentity(messages: readonly EMail[]): EMail[] {
  let index = new MailIdentityIndex();
  let uniqueMessages: EMail[] = [];
  for (let message of messages) {
    if (!index.has(message)) {
      index.add(message);
      uniqueMessages.push(message);
    }
  }
  return uniqueMessages;
}

/**
 * Меняет состояние всех выбранных писем одновременно и ждёт завершения
 * каждого запроса перед передачей ошибки вызывающему коду.
 */
export async function markMessagesRead(messages: readonly EMail[], read: boolean): Promise<void> {
  let uniqueMessages = uniqueMessagesByIdentity(messages);
  let byFolder = new Map<Folder, EMail[]>();
  let individualMessages: EMail[] = [];
  for (let message of uniqueMessages) {
    if (message.folder && typeof (message.folder as any).markMessagesRead === "function") {
      let list = byFolder.get(message.folder);
      if (!list) {
        list = [];
        byFolder.set(message.folder, list);
      }
      list.push(message);
    } else {
      individualMessages.push(message);
    }
  }

  type TaskEntry = {
    messages: EMail[];
    promise: Promise<void>;
  };
  let taskEntries: TaskEntry[] = [];
  for (let [folder, folderMsgs] of byFolder) {
    taskEntries.push({
      messages: folderMsgs,
      promise: folder.markMessagesRead(folderMsgs, read),
    });
  }
  for (let message of individualMessages) {
    taskEntries.push({
      messages: [message],
      promise: message.markRead(read),
    });
  }

  let results = await Promise.allSettled(taskEntries.map(entry => entry.promise));
  let succeeded = new MailIdentityIndex();
  for (let i = 0; i < taskEntries.length; i++) {
    if (results[i].status != "fulfilled") {
      continue;
    }
    for (let unique of taskEntries[i].messages) {
      succeeded.add(unique);
    }
  }
  for (let message of messages) {
    if (succeeded.has(message)) {
      message.isRead = read;
    }
  }

  let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
  if (failed) {
    throw failed.reason;
  }
}
