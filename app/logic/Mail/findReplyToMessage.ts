import type { EMail } from "./EMail";
import { SpecialFolder } from "./Folder";
import type { MailAccount } from "./MailAccount";
import { newSearchEMail } from "./Store/setStorage";

/** Последний доступный локально ответ НАШЕГО аккаунта на это письмо (чужие ответы в цепочке игнорируются), или undefined. */
export async function findReplyToMessage(original: EMail): Promise<EMail | undefined> {
  if (!original.isReplied || !original.messageID) {
    return undefined;
  }
  let account = original.folder?.account;
  if (!account) {
    return undefined;
  }
  let fromMemory = findReplyInAccount(original.messageID, account);
  if (fromMemory) {
    return fromMemory;
  }
  try {
    let search = newSearchEMail();
    search.account = account;
    search.inReplyToOf = original.messageID;
    search.isOutgoing = true;
    let sent = account.findSpecialFolder(SpecialFolder.Sent);
    if (sent) {
      search.folder = sent;
      let results = await search.startSearch(20);
      let reply = pickLatestReply(results.contents, original.messageID);
      if (reply) {
        return reply;
      }
    }
    search.folder = null;
    let results = await search.startSearch(20);
    return pickLatestReply(results.contents, original.messageID);
  } catch {
    return undefined;
  }
}

function findReplyInAccount(parentMessageID: string, account: MailAccount): EMail | undefined {
  let candidates: EMail[] = [];
  for (let folder of account.getAllFolders()) {
    for (let message of folder.messages) {
      if (message.inReplyTo == parentMessageID && message.outgoing) {
        candidates.push(message);
      }
    }
  }
  return pickLatestReply(candidates, parentMessageID);
}

function pickLatestReply(messages: readonly EMail[], parentMessageID: string): EMail | undefined {
  let replies = messages.filter(message => message.inReplyTo == parentMessageID && message.outgoing);
  if (!replies.length) {
    return undefined;
  }
  return replies.reduce((latest, message) =>
    (message.sent?.getTime() ?? 0) >= (latest.sent?.getTime() ?? 0) ? message : latest);
}
