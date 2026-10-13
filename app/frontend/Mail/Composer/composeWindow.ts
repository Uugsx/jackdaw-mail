import type { Attachment } from "../../../logic/Abstract/Attachment";
import { ContentDisposition } from "../../../logic/Abstract/Attachment";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import {
  composeWindowMaxAttachmentBytes,
  isComposeWindowPayload,
  type ComposeWindowAttachment,
  type ComposeWindowMail,
  type ComposeWindowPerson,
  type ComposeWindowSource,
} from "../../../logic/Mail/Composer/ComposeWindowProtocol";
import { blobToBase64, assert, base64ToUint8Array } from "../../../logic/util/util";

function serializeDate(date: Date | null | undefined): string | null {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function deserializeDate(date: string | null): Date | null {
  if (!date) {
    return null;
  }
  let result = new Date(date);
  return Number.isNaN(result.getTime()) ? null : result;
}

function serializePerson(person: PersonUID | null | undefined): ComposeWindowPerson {
  return {
    emailAddress: person?.emailAddress ?? "",
    name: person?.name ?? null,
  };
}

function deserializePerson(person: ComposeWindowPerson): PersonUID {
  return new PersonUID(person.emailAddress, person.name ?? undefined);
}

async function serializeAttachment(attachment: Attachment, includeContent = true): Promise<ComposeWindowAttachment> {
  let contentBase64: string | null = null;
  if (includeContent && attachment.content) {
    if (attachment.content.size > composeWindowMaxAttachmentBytes) {
      throw new Error(`Attachment is too large for a separate compose window: ${attachment.filename}`);
    }
    contentBase64 = await blobToBase64(attachment.content);
  } else if (includeContent && !attachment.filepathLocal) {
    // У пересланных и загруженных вложений обычно есть данные в памяти
    // или локальный путь. Для остальных даём хранилищу одну попытку загрузки.
    attachment = await attachment.load();
    if (attachment.content) {
      if (attachment.content.size > composeWindowMaxAttachmentBytes) {
        throw new Error(`Attachment is too large for a separate compose window: ${attachment.filename}`);
      }
      contentBase64 = await blobToBase64(attachment.content);
    }
  }
  return {
    filename: attachment.filename ?? "attachment",
    filepathLocal: attachment.filepathLocal ?? null,
    mimeType: attachment.mimeType ?? null,
    size: attachment.size ?? attachment.content?.size ?? null,
    disposition: attachment.disposition ?? ContentDisposition.unknown,
    related: !!attachment.related,
    contentID: attachment.contentID ?? null,
    contentBase64,
  };
}

function serializeSource(source: EMail): ComposeWindowSource {
  return {
    id: source.id ?? null,
    dbID: source.dbID ?? null,
    subject: source.subject ?? "",
    html: source.html ?? null,
    text: source.rawText ?? null,
    loadExternalImages: source.loadExternalImages,
    from: serializePerson(source.from),
    sent: serializeDate(source.sent),
    received: serializeDate(source.received),
  };
}

/** Преобразует объект письма в данные для передачи через Electron IPC. */
export async function serializeComposeMail(
  mail: EMail,
  windowID: string,
  options: { includeAttachmentContent?: boolean } = {},
): Promise<ComposeWindowMail> {
  await mail.loadBody();
  if (mail.composeSource) {
    await mail.composeSource.loadBody();
  }
  let account = mail.folder?.account ?? mail.identity?.account;
  assert(account, "Compose window: mail account is missing");
  assert(account.id, "Compose window: mail account ID is missing");

  let attachments: ComposeWindowAttachment[] = [];
  for (let attachment of mail.attachments) {
    attachments.push(await serializeAttachment(attachment, options.includeAttachmentContent ?? true));
  }
  let headers: [string, string][] = [];
  for (let name of mail.headers.keys()) {
    headers.push([name, mail.headers.get(name)]);
  }
  let payload: ComposeWindowMail = {
    windowID,
    accountID: account.id,
    folderID: mail.folder?.id ?? null,
    identityID: mail.identity?.id ?? null,
    id: mail.id ?? null,
    pID: mail.pID ?? null,
    dbID: mail.dbID ?? null,
    subject: mail.subject ?? "",
    html: mail.rawHTMLDangerous ?? null,
    text: mail.rawText ?? null,
    from: serializePerson(mail.from),
    replyTo: mail.replyTo ? serializePerson(mail.replyTo) : null,
    to: mail.to.contents.map(serializePerson),
    cc: mail.cc.contents.map(serializePerson),
    bcc: mail.bcc.contents.map(serializePerson),
    sent: serializeDate(mail.sent),
    received: serializeDate(mail.received),
    inReplyTo: mail.inReplyTo ?? null,
    references: mail.references?.slice() ?? [],
    threadID: mail.threadID ?? null,
    outgoing: !!mail.outgoing,
    isRead: !!mail.isRead,
    isStarred: !!mail.isStarred,
    isImportant: !!mail.isImportant,
    importanceLevel: mail.importanceLevel,
    requestReadReceipt: !!mail.requestReadReceipt,
    requestDeliveryReceipt: !!mail.requestDeliveryReceipt,
    isDraft: !!mail.isDraft,
    isDeleted: !!mail.isDeleted,
    shouldEncrypt: !!mail.shouldEncrypt,
    mustEncrypt: !!mail.mustEncrypt,
    wasEncrypted: !!mail.wasEncrypted,
    signedByKeyID: mail.signedByKeyID ?? null,
    hasAttachmentsFlag: !!mail.hasAttachmentsFlag,
    headers,
    attachments,
    composeSource: mail.composeSource ? serializeSource(mail.composeSource) : null,
  };
  assert(isComposeWindowPayload(payload), "Compose window: payload is too large or malformed");
  return payload;
}

function deserializeSource(folder: ReturnType<MailAccount["getSpecialFolder"]>, source: ComposeWindowSource): EMail {
  let result = folder.newEMail();
  result.id = source.id ?? "";
  result.dbID = source.dbID;
  result.subject = source.subject;
  result.from = deserializePerson(source.from);
  result.sent = deserializeDate(source.sent) ?? deserializeDate(source.received) ?? new Date(0);
  result.received = deserializeDate(source.received) ?? result.sent;
  result.loadExternalImages = source.loadExternalImages;
  if (source.html !== null) {
    result.html = source.html;
  } else if (source.text !== null) {
    result.text = source.text;
  }
  result.loadedBody = true;
  return result;
}

/** Восстанавливает объект письма в renderer отдельного окна. */
export function deserializeComposeMail(payload: ComposeWindowMail, account: MailAccount): EMail {
  let folder = payload.folderID
    ? account.findFolder(candidate => candidate.id === payload.folderID)
    : null;
  folder ??= account.findSpecialFolder(SpecialFolder.Sent) ?? account.inbox;
  assert(folder, "Compose window: target folder is missing");

  let mail = folder.newEMail();
  applyComposeMailPayload(mail, payload);
  mail.composeSource = payload.composeSource ? deserializeSource(folder, payload.composeSource) : null;
  return mail;
}

/** Applies edits from the detached composer to the already-owned mail object. */
export function applyComposeMailPayload(mail: EMail, payload: ComposeWindowMail): void {
  let account = mail.folder?.account ?? mail.identity?.account;
  assert(account?.id === payload.accountID, "Compose window: mail account changed");

  if (payload.id !== null) {
    mail.id = payload.id;
  }
  mail.pID = payload.pID;
  mail.dbID = payload.dbID;
  mail.subject = payload.subject;
  mail.from = deserializePerson(payload.from);
  mail.replyTo = payload.replyTo ? deserializePerson(payload.replyTo) : null;
  mail.to.clear();
  mail.to.addAll(payload.to.map(deserializePerson));
  mail.cc.clear();
  mail.cc.addAll(payload.cc.map(deserializePerson));
  mail.bcc.clear();
  mail.bcc.addAll(payload.bcc.map(deserializePerson));
  mail.sent = deserializeDate(payload.sent);
  mail.received = deserializeDate(payload.received);
  mail.inReplyTo = payload.inReplyTo;
  mail.references = payload.references.slice();
  mail.threadID = payload.threadID;
  mail.outgoing = payload.outgoing;
  mail.isRead = payload.isRead;
  mail.isStarred = payload.isStarred;
  mail.isImportant = payload.isImportant;
  mail.importanceLevel = payload.importanceLevel;
  mail.requestReadReceipt = payload.requestReadReceipt;
  mail.requestDeliveryReceipt = payload.requestDeliveryReceipt;
  mail.isDraft = payload.isDraft;
  mail.isDeleted = payload.isDeleted;
  mail.shouldEncrypt = payload.shouldEncrypt;
  mail.mustEncrypt = payload.mustEncrypt;
  mail.wasEncrypted = payload.wasEncrypted;
  mail.signedByKeyID = payload.signedByKeyID;
  mail.hasAttachmentsFlag = payload.hasAttachmentsFlag;

  mail.headers.clear();
  for (let [name, value] of payload.headers) {
    mail.headers.set(name, value);
  }
  if (payload.html !== null) {
    mail.html = payload.html;
  } else {
    mail.text = payload.text ?? "";
  }

  mail.attachments.clear();
  for (let item of payload.attachments) {
    let attachment = mail.newAttachment();
    attachment.filename = item.filename;
    attachment.filepathLocal = item.filepathLocal;
    attachment.mimeType = item.mimeType ?? "application/octet-stream";
    attachment.size = item.size;
    attachment.disposition = item.disposition as ContentDisposition;
    attachment.related = item.related;
    attachment.contentID = item.contentID;
    if (item.contentBase64 !== null) {
      attachment.content = new File([
        base64ToUint8Array(item.contentBase64),
      ], item.filename, { type: attachment.mimeType });
      attachment.size = attachment.content.size;
    }
    mail.attachments.add(attachment);
  }

  mail.identity = account.identities.find(identity => identity.id === payload.identityID)
    ?? account.identities.find(identity => identity.isEMailAddress(payload.from.emailAddress))
    ?? account.identities.first;
  mail.loadedBody = true;
}
