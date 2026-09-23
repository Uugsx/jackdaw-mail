import type { EMail } from "../../logic/Mail/EMail";

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
  let results = await Promise.allSettled(uniqueMessages.map(message => message.markRead(read)));
  for (let i = 0; i < uniqueMessages.length; i++) {
    if (results[i].status != "fulfilled") {
      continue;
    }
    for (let message of messages) {
      if (messagesRepresentSameMail(uniqueMessages[i], message)) {
        message.isRead = read;
      }
    }
  }
  let failed = results.find((result): result is PromiseRejectedResult => result.status == "rejected");
  if (failed) {
    throw failed.reason;
  }
}
