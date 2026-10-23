/**
 * Письма и события календаря в чате. Письмо уходит целиком: файл .eml во вложении сообщения
 * (зашифрован, как любой файл чата) и карточка с темой, автором и датой. Получатель открывает
 * письмо в просмотрщике Jackdaw без доступа к ящику отправителя. Событие — ссылка по UID:
 * открывается своя копия приглашения, если она есть.
 */
import type { EMail } from "../../Mail/EMail";
import type { Event } from "../../Calendar/Event";
import type { Message } from "../../Abstract/Message";
import type { Attachment } from "../../Abstract/Attachment";
import { findMessageByID } from "../../Mail/Store/setStorage";
import { appGlobal } from "../../app";
import type { ChatLinkRef } from "./JackdawChatProtocol";
import { MAX_ATTACHMENT_BYTES } from "./JackdawChatRoom";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { UserError } from "../../util/util";
import { CreateMIME } from "../../Mail/SMTP/CreateMIME";
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

/**
 * Кладёт само письмо (.eml) во вложения сообщения чата и связывает его с карточкой.
 * @returns ссылка с именем вложения. Слишком большое письмо не отправляется: в чате лимит файла 25 МБ.
 */
export async function attachEmailToChatMessage(message: Message, email: EMail, link: Extract<ChatLinkRef, { type: "email" }>):
    Promise<ChatLinkRef> {
  let mime = await emailMIME(email);
  if (!mime?.length) {
    throw new UserError(gt`Could not read this email. Open it and try again.`);
  }
  if (mime.length > MAX_ATTACHMENT_BYTES) {
    throw new UserError(gt`This email is larger than 25 MB, so it cannot be sent to the chat. Forward it by email instead.`);
  }
  let filename = sanitize.filename(email.subject, "email") + ".eml";
  let attachment = message.newAttachment();
  attachment.fromFile(new File([mime as Uint8Array<ArrayBuffer>], filename, { type: "message/rfc822" }));
  message.attachments.add(attachment);
  return { ...link, eml: attachment.filename };
}

/** Исходник письма. У ящиков без исходника (Exchange, демо) — письмо, собранное из темы,
 * адресов, тела и вложений тем же способом, что и при отправке. null — не получилось. */
async function emailMIME(email: EMail): Promise<Uint8Array | null> {
  try {
    await email.loadMIME();
  } catch (ex) {
    // Нет исходника на сервере: соберём сами
  }
  if (email.mime?.length) {
    return email.mime;
  }
  if (email.sml) {
    return null; // сборка для отправки меняет SML письма
  }
  try {
    await email.loadBody();
    await email.loadAttachments();
    return await CreateMIME.getMIME(email);
  } catch (ex) {
    return null;
  }
}

/** Вложение сообщения с самим письмом для карточки. undefined — отправлена только ссылка (старые версии). */
export function linkedEmailAttachment(message: Message, link: ChatLinkRef): Attachment | undefined {
  if (link.type != "email" || !link.eml) {
    return undefined;
  }
  // Получатель очищает имя файла по правилам своей системы: тогда ищем единственное письмо во вложениях
  let emails = message.attachments.contents.filter(attachment =>
    attachment.mimeType == "message/rfc822" || attachment.filename?.toLowerCase().endsWith(".eml"));
  return message.attachments.find(attachment => attachment.filename == link.eml)
    ?? (emails.length == 1 ? emails[0] : undefined);
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
