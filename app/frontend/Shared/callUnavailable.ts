import { getJackdawCallClient } from "../../logic/Meet/Jackdaw/JackdawCalls";
import { gt } from "../../l10n/l10n";

/**
 * Почему сейчас нельзя позвонить через Jackdaw на эти адреса собеседника.
 * Для неактивной кнопки звонка: пользователь видит кнопку и понимает, что сделать.
 */
export function jackdawCallUnavailableReason(emails: string[]): string {
  let callClient = getJackdawCallClient();
  if (callClient.status == "disabled" || callClient.status == "rejected") {
    return gt`Calls need an active Jackdaw Pro license or trial on this device.`;
  }
  if (!callClient.isOnline) {
    return gt`No connection to the Jackdaw server. Calls will be available when it is restored.`;
  }
  if (!callClient.verifiedEmails.length) {
    return gt`Confirm your email address in Settings → Jackdaw Pro → Calls and chat to make calls.`;
  }
  if (emails.length && emails.every(email => callClient.verifiedEmails.includes(email))) {
    return gt`This is your own address.`;
  }
  if (!emails.length) {
    return gt`The contact has no email address. Calls between Jackdaw Mail users go by email address.`;
  }
  return gt`You can call when the contact is online in Jackdaw Mail.`;
}
