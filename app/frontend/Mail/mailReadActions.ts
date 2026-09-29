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
 * Меняет состояние всех выбранных писем одновременно и ждёт завершения
 * каждого запроса перед передачей ошибки вызывающему коду.
 */
export async function markMessagesRead(messages: readonly EMail[], read: boolean): Promise<void> {
  let uniqueMessages: EMail[] = [];
  for (let message of messages) {
    if (!uniqueMessages.some(existing => messagesRepresentSameMail(existing, message))) {
      uniqueMessages.push(message);
    }
  }
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
  for (let i = 0; i < taskEntries.length; i++) {
    if (results[i].status != "fulfilled") {
      continue;
    }
    for (let unique of taskEntries[i].messages) {
      for (let message of messages) {
        if (messagesRepresentSameMail(unique, message)) {
          message.isRead = read;
        }
      }
    }
  }

  let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
  if (failed) {
    throw failed.reason;
  }
}
