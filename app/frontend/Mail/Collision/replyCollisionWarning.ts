/**
 * Предупреждение перед ответом на письмо общего ящика, на которое уже отвечает
 * или недавно ответил коллега. Ничего не блокирует: можно всё равно ответить.
 */
import type { EMail } from "../../../logic/Mail/EMail";
import ConfirmDialog from "../../Shared/ConfirmDialog.svelte";
import { getSharedMailboxPresence, replySource, chatColleague, colleagueName, repliedTime, openColleagueChat } from "./collisionPresence";
import { backgroundError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";

export type ReplyCollisionChoice = "reply" | "chat" | "cancel";

/** null — предупреждать не о чем */
export function replyCollisionWarning(reply: EMail): { title: string; message: string; chat: boolean } | null {
  let source = replySource(reply);
  let presence = getSharedMailboxPresence();
  let status = source && presence.isWatching(source.mailbox) ? presence.statusFor(source.mailbox, source.messageID) : null;
  if (!status || (!status.replying.length && !status.replied)) return null;
  let message: string;
  if (status.replying.length) {
    let who = status.replying.map(colleagueName).join(", ");
    message = gt`${who} is already writing a reply to this message from the shared mailbox. Two replies may reach the customer.`;
  } else {
    message = gt`${colleagueName(status.replied)} already replied to this message from the shared mailbox at ${repliedTime(status.replied)}.`;
  }
  return { title: gt`A colleague is on it`, message, chat: !!chatColleague(status) };
}

/** Показывает предупреждение, если оно нужно. @returns отвечать ли сейчас */
export async function confirmReplyCollision(reply: EMail): Promise<boolean> {
  let warning = replyCollisionWarning(reply);
  if (!warning) return true;
  let choice = await askReplyCollision(warning);
  if (choice == "chat") {
    let source = replySource(reply);
    let colleague = source ? chatColleague(getSharedMailboxPresence().statusFor(source.mailbox, source.messageID)) : null;
    if (colleague) openColleagueChat(colleague).catch(backgroundError);
  }
  return choice == "reply";
}

function askReplyCollision(warning: { title: string; message: string; chat: boolean }): Promise<ReplyCollisionChoice> {
  return new Promise(resolve => {
    let dialog = new ConfirmDialog({
      target: document.body,
      props: {
        open: true,
        title: warning.title,
        message: warning.message,
        confirmLabel: gt`Reply anyway`,
        cancelLabel: gt`Cancel`,
        extraLabel: warning.chat ? gt`Open chat with colleague` : null,
      },
    });
    let finish = (choice: ReplyCollisionChoice) => {
      resolve(choice);
      // После закрытия: диалог возвращает фокус туда, где он был.
      queueMicrotask(() => dialog.$destroy());
    };
    dialog.$on("confirm", () => finish("reply"));
    dialog.$on("extra", () => finish("chat"));
    dialog.$on("cancel", () => finish("cancel"));
  });
}
