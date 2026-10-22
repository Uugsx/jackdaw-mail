/**
 * Письма и события календаря в чате: отправитель делится ссылкой, получатель открывает свою копию.
 * Содержимое письма не пересылается: только Message-ID, тема, автор и дата. Копия есть у получателя,
 * если письмо пришло и ему (переписка в команде), иначе он видит карточку с темой и автором.
 */
import type { EMail } from "../../Mail/EMail";
import type { Event } from "../../Calendar/Event";
import { findMessageByID } from "../../Mail/Store/setStorage";
import { appGlobal } from "../../app";
import type { ChatLinkRef } from "./JackdawChatProtocol";
import { gt } from "../../../l10n/l10n";

export function emailLink(email: EMail): ChatLinkRef {
  return {
    type: "email",
    messageID: email.messageID,
    subject: email.subject || gt`No subject`,
    from: email.from?.name || email.from?.emailAddress || "",
    date: (email.sent ?? email.received ?? new Date()).getTime(),
  };
}

export function eventLink(event: Event): ChatLinkRef {
  return {
    type: "event",
    uid: event.calUID ?? event.id,
    title: event.title || gt`No title`,
    start: event.startTime.getTime(),
    end: (event.endTime ?? event.startTime).getTime(),
    location: event.location ?? "",
  };
}

/** Текст сообщения для старых версий и для превью в списке чатов */
export function linkText(link: ChatLinkRef): string {
  if (link.type == "email") {
    return gt`Email: ${link.subject}` + (link.from ? ` — ${link.from}` : "");
  }
  return gt`Event: ${link.title}` + `, ${new Date(link.start).toLocaleString()}`;
}

/** Своя копия письма по Message-ID. undefined — у нас этого письма нет. */
export async function findLinkedEmail(link: Extract<ChatLinkRef, { type: "email" }>): Promise<EMail | undefined> {
  /* Сначала загруженные папки: письмо может ещё не попасть в локальную базу (или ящик без базы) */
  for (let account of appGlobal.emailAccounts.contents) {
    for (let folder of account.getAllFolders().contents) {
      let email = folder.messages.find(message => message.messageID == link.messageID);
      if (email) {
        return email;
      }
    }
  }
  return await findMessageByID(link.messageID);
}

/** Своё событие с тем же UID (приглашение на ту же встречу). undefined — нет в наших календарях. */
export function findLinkedEvent(link: Extract<ChatLinkRef, { type: "event" }>): Event | undefined {
  for (let calendar of appGlobal.calendars.contents) {
    let event = calendar.events.find(candidate => (candidate.calUID ?? candidate.id) == link.uid);
    if (event) {
      return event;
    }
  }
  return undefined;
}
