import type { EMail } from "./EMail";
import { findOrCreatePersonUID } from "../Abstract/PersonUID";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";

/** Добавляет отправителя в Cc, если он ещё не указан среди получателей. */
export function addSenderToCC(email: Pick<EMail, "from" | "to" | "cc" | "bcc">): void {
  let senderAddress = sanitize.emailAddress(email.from?.emailAddress, null);
  if (!senderAddress) {
    return;
  }
  let normalizedSenderAddress = senderAddress.toLowerCase();
  let isAlreadyRecipient = [email.to, email.cc, email.bcc].some(recipients =>
    recipients.some(recipient => recipient.emailAddress?.toLowerCase() == normalizedSenderAddress));
  if (isAlreadyRecipient) {
    return;
  }
  email.cc.add(findOrCreatePersonUID(senderAddress, email.from.name));
}

/**
 * Добавляет адреса «Всегда в копии» / «Всегда в скрытой копии» отправителя
 * (как автоматическая копия в Outlook), если их ещё нет среди получателей.
 */
export function addIdentityDefaultRecipients(
  email: Pick<EMail, "to" | "cc" | "bcc">,
  identity: { sendCC?: { contents: string[] }, sendBCC?: { contents: string[] } } | null | undefined,
): void {
  if (!identity) {
    return;
  }
  let present = new Set<string>();
  for (let recipients of [email.to, email.cc, email.bcc]) {
    for (let recipient of recipients.contents) {
      if (recipient.emailAddress) {
        present.add(recipient.emailAddress.toLowerCase());
      }
    }
  }
  let add = (target: typeof email.cc, addresses: string[] | undefined) => {
    for (let raw of addresses ?? []) {
      let address = sanitize.emailAddress(raw, null);
      if (!address || present.has(address.toLowerCase())) {
        continue;
      }
      present.add(address.toLowerCase());
      target.add(findOrCreatePersonUID(address, null));
    }
  };
  add(email.cc, identity.sendCC?.contents);
  add(email.bcc, identity.sendBCC?.contents);
}

/** Слова, по которым понятно, что в письме обещано вложение (русский и английский).
 * Голое «приложение» не учитываем: у интеграторов это обычно программа. */
const kAttachmentMentionRegExp = /(во\s+вложени|в\s+приложени[иею]|прикрепл|прилага|прикладыва|attached|attachment|enclosed)/i;

/** Текст письма пользователя упоминает вложение. */
export function mentionsAttachment(ownText: string | null | undefined): boolean {
  return kAttachmentMentionRegExp.test(ownText ?? "");
}
