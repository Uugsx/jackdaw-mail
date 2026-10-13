import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { EMail } from "../../../logic/Mail/EMail";
import type {
  ComposeWindowAttachment,
  ComposeWindowMail,
  ComposeWindowPerson,
} from "../../../logic/Mail/Composer/ComposeWindowProtocol";
import { SMLData } from "../../../logic/Mail/SML/SMLData";
import { assert } from "../../../logic/util/util";
import {
  isMessageWindowPayload,
  type MessageWindowPayload,
} from "../../../logic/Mail/MessageWindowProtocol";
import {
  deserializeComposeMail,
  serializeComposeMail,
} from "../Composer/composeWindow";

const kMaxIDLength = 512;
const kMaxPersonNameLength = 512;
const kMaxSubjectLength = 16_384;
const kMaxBodyLength = 8_000_000;
const kMaxRecipients = 100;
const kMaxReferences = 100;
const kMaxHeaders = 200;
const kMaxAttachments = 100;
const kMaxAttachmentPathLength = 4_096;
const kMaxSMLJSONLength = 4_000_000;

function boundedString(value: unknown, maxLength: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function nullableBoundedString(value: unknown, maxLength: number): string | null {
  return value == null ? null : boundedString(value, maxLength);
}

function normalizeID(value: unknown): string | number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  return typeof value === "string" ? value.slice(0, kMaxIDLength) : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80 || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function normalizePerson(value: ComposeWindowPerson | null | undefined): ComposeWindowPerson {
  return {
    emailAddress: boundedString(value?.emailAddress, 320),
    name: nullableBoundedString(value?.name, kMaxPersonNameLength),
  };
}

function normalizePeople(values: ComposeWindowPerson[]): ComposeWindowPerson[] {
  return values.slice(0, kMaxRecipients).map(normalizePerson);
}

function normalizeAttachment(value: ComposeWindowAttachment): ComposeWindowAttachment {
  let disposition: ComposeWindowAttachment["disposition"] = value.disposition == "inline" || value.disposition == "attachment"
    ? value.disposition
    : "unknown";
  let size = typeof value.size == "number" && Number.isSafeInteger(value.size) && value.size >= 0
    ? value.size
    : null;
  return {
    filename: boundedString(value.filename, 1_024, "attachment"),
    filepathLocal: nullableBoundedString(value.filepathLocal, kMaxAttachmentPathLength),
    mimeType: nullableBoundedString(value.mimeType, 256),
    size,
    disposition,
    related: !!value.related,
    contentID: nullableBoundedString(value.contentID, kMaxIDLength),
    // Для просмотра письма не нужно передавать байты вложений через IPC.
    // Локальный путь остаётся доступен для разрешения CID-ссылок.
    contentBase64: null,
  };
}

function normalizeMessageWindowMail(mail: ComposeWindowMail): { mail: ComposeWindowMail, bodyDeferred: boolean } {
  let html = typeof mail.html === "string" && mail.html.length <= kMaxBodyLength ? mail.html : null;
  let text = typeof mail.text === "string" && mail.text.length <= kMaxBodyLength ? mail.text : null;
  let bodyDeferred = html !== mail.html || text !== mail.text;
  let importanceLevel: ComposeWindowMail["importanceLevel"] = mail.importanceLevel == "high" || mail.importanceLevel == "low"
    ? mail.importanceLevel
    : "normal";
  let references = mail.references
    .slice(0, kMaxReferences)
    .map(reference => boundedString(reference, kMaxIDLength));
  let headers = mail.headers
    .slice(0, kMaxHeaders)
    .map(([name, value]) => [boundedString(name, 512), boundedString(value, kMaxBodyLength)] as [string, string]);

  return {
    bodyDeferred,
    mail: {
      ...mail,
      windowID: boundedString(mail.windowID, 128),
      accountID: boundedString(mail.accountID, kMaxIDLength),
      folderID: nullableBoundedString(mail.folderID, kMaxIDLength),
      identityID: nullableBoundedString(mail.identityID, kMaxIDLength),
      id: nullableBoundedString(mail.id, kMaxIDLength),
      pID: normalizeID(mail.pID),
      dbID: normalizeID(mail.dbID),
      subject: boundedString(mail.subject, kMaxSubjectLength),
      html,
      text,
      from: normalizePerson(mail.from),
      replyTo: mail.replyTo ? normalizePerson(mail.replyTo) : null,
      to: normalizePeople(mail.to),
      cc: normalizePeople(mail.cc),
      bcc: normalizePeople(mail.bcc),
      sent: normalizeDate(mail.sent),
      received: normalizeDate(mail.received),
      inReplyTo: nullableBoundedString(mail.inReplyTo, kMaxIDLength),
      references,
      threadID: nullableBoundedString(mail.threadID, kMaxIDLength),
      importanceLevel,
      signedByKeyID: nullableBoundedString(mail.signedByKeyID, kMaxIDLength),
      headers,
      attachments: mail.attachments.slice(0, kMaxAttachments).map(normalizeAttachment),
      // Просмотрщику не нужен вложенный источник композера. Исключаем его,
      // чтобы некорректное вложенное тело не блокировало открытие окна.
      composeSource: null,
    },
  };
}

function serializeSML(message: EMail): string | null {
  if (message.sml?.sml == null) {
    return null;
  }
  try {
    let json = JSON.stringify(message.sml.sml);
    return typeof json == "string" && json.length <= kMaxSMLJSONLength ? json : null;
  } catch (_ex) {
    return null;
  }
}

function createMessageWindowPayload(
  message: EMail,
  windowID: string,
  mail: ComposeWindowMail,
  bodyDeferred: boolean,
): MessageWindowPayload {
  return {
    windowID,
    mail,
    isSpam: !!message.isSpam,
    isReplied: !!message.isReplied,
    isForwarded: !!message.isForwarded,
    smlJSON: serializeSML(message),
    ...(bodyDeferred ? { bodyDeferred: true } : {}),
  };
}

function createMinimalMessageMail(message: EMail, windowID: string): ComposeWindowMail {
  let account = message.folder?.account ?? message.identity?.account;
  assert(account?.id, "Message window: mail account is missing");
  return {
    windowID,
    accountID: account.id,
    folderID: message.folder?.id ?? null,
    identityID: message.identity?.id ?? null,
    id: message.id ?? null,
    pID: message.pID ?? null,
    dbID: message.dbID ?? null,
    subject: message.subject ?? "",
    html: message.rawHTMLDangerous ?? null,
    text: message.rawText ?? null,
    from: {
      emailAddress: message.from?.emailAddress ?? "",
      name: message.from?.name ?? null,
    },
    replyTo: message.replyTo
      ? { emailAddress: message.replyTo.emailAddress ?? "", name: message.replyTo.name ?? null }
      : null,
    to: message.to.contents.map(person => ({ emailAddress: person.emailAddress ?? "", name: person.name ?? null })),
    cc: message.cc.contents.map(person => ({ emailAddress: person.emailAddress ?? "", name: person.name ?? null })),
    bcc: message.bcc.contents.map(person => ({ emailAddress: person.emailAddress ?? "", name: person.name ?? null })),
    sent: message.sent instanceof Date && !Number.isNaN(message.sent.getTime()) ? message.sent.toISOString() : null,
    received: message.received instanceof Date && !Number.isNaN(message.received.getTime()) ? message.received.toISOString() : null,
    inReplyTo: message.inReplyTo ?? null,
    references: message.references?.slice() ?? [],
    threadID: message.threadID ?? null,
    outgoing: !!message.outgoing,
    isRead: !!message.isRead,
    isStarred: !!message.isStarred,
    isImportant: !!message.isImportant,
    importanceLevel: message.importanceLevel,
    requestReadReceipt: !!message.requestReadReceipt,
    requestDeliveryReceipt: !!message.requestDeliveryReceipt,
    isDraft: !!message.isDraft,
    isDeleted: !!message.isDeleted,
    shouldEncrypt: !!message.shouldEncrypt,
    mustEncrypt: !!message.mustEncrypt,
    wasEncrypted: !!message.wasEncrypted,
    signedByKeyID: message.signedByKeyID ?? null,
    hasAttachmentsFlag: !!message.hasAttachmentsFlag,
    headers: [],
    attachments: [],
    composeSource: null,
  };
}

/** Преобразует письмо в безопасный payload для отдельного окна просмотра. */
export async function serializeMessageWindowMail(
  message: EMail,
  windowID: string,
): Promise<MessageWindowPayload> {
  let hasBodySnapshot = (typeof message.rawHTMLDangerous == "string" && message.rawHTMLDangerous.length > 0) ||
    (typeof message.rawText == "string" && message.rawText.length > 0);
  let bodyDeferred = false;
  try {
    await message.loadBody();
  } catch (_ex) {
    // Просмотрщик повторит загрузку тела в собственном renderer. Из-за этой
    // ошибки один и тот же двойной клик не должен уходить в другой fullscreen UI.
    bodyDeferred = !hasBodySnapshot;
  }

  let mail: ComposeWindowMail;
  try {
    mail = await serializeComposeMail(message, windowID, {
      includeAttachmentContent: false,
      loadBody: false,
      validate: false,
    });
  } catch (_ex) {
    bodyDeferred = true;
    mail = createMinimalMessageMail(message, windowID);
  }

  let payload = createMessageWindowPayload(message, windowID, mail, bodyDeferred);
  if (isMessageWindowPayload(payload)) {
    return payload;
  }

  let normalized = normalizeMessageWindowMail(mail);
  payload = createMessageWindowPayload(
    message,
    windowID,
    normalized.mail,
    bodyDeferred || normalized.bodyDeferred,
  );
  assert(isMessageWindowPayload(payload), "Message window: payload is too large or malformed");
  return payload;
}

/** Восстанавливает объект письма в renderer отдельного окна просмотра. */
export function deserializeMessageWindowMail(
  payload: MessageWindowPayload,
  account: MailAccount,
): EMail {
  let message = deserializeComposeMail(payload.mail, account);
  message.isSpam = payload.isSpam;
  message.isReplied = payload.isReplied;
  message.isForwarded = payload.isForwarded;
  if (payload.smlJSON) {
    try {
      let sml = new SMLData();
      sml.fromJSON(JSON.parse(payload.smlJSON));
      message.sml = sml;
    } catch (_ex) {
      // SML необязателен для отображения письма: повреждённые структурированные
      // данные не должны блокировать обычное окно просмотра.
      message.sml = null;
    }
  }
  if (payload.bodyDeferred) {
    // Перед повторной загрузкой удаляем усечённый snapshot. Иначе короткий
    // текстовый fallback пометит тело как уже загруженное, и EMail.loadBody()
    // не прочитает оригинал из хранилища аккаунта.
    message.text = "";
    message.loadedBody = false;
  }
  return message;
}
