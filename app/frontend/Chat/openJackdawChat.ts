import type { JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
import type { ChatRoom } from "../../logic/Chat/ChatRoom";
import { UserError } from "../../logic/util/util";
import { gt } from "../../l10n/l10n";

/** Похоже на email: для кнопки «Написать на этот адрес» в поиске чата */
export function looksLikeEmail(text: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text?.trim() ?? "");
}

/**
 * Личный чат Jackdaw по адресу. Создаётся и сохраняется сразу, чтобы появиться в списке.
 * Только с тем, кто пользуется чатом Jackdaw: иначе получился бы чат, в который нельзя написать.
 * @returns null для пустого адреса
 */
export async function openJackdawChat(account: JackdawChatAccount, email: string): Promise<ChatRoom | null> {
  let address = email?.trim();
  if (!address) {
    return null;
  }
  let existing = account.findRoomByID(`direct:${address.toLowerCase()}`);
  if (!existing && !account.isOnline) {
    // Ошибка с причиной: её баннер сам уходит, когда чат подключится (иначе висел и после подтверждения адреса)
    if (account.connectionProblem()) {
      account.requireOnline();
    }
    throw new UserError(gt`Jackdaw chat is not connected on this device. Confirm your address for calls and chat in the settings.`);
  }
  if (!existing && !await account.canChatWith(address)) {
    throw new UserError(account.isOwnEmail(address.toLowerCase())
      ? gt`This is your own address. To chat, choose another contact.`
      : gt`${address} does not use Jackdaw chat yet, or has not confirmed this address. You can send an email instead.`);
  }
  return existing ?? await account.getDirectRoom(address);
}
