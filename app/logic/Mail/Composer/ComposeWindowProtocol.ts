/** IPC-контракт между главным процессом и отдельным окном создания письма. */
export const composeWindowOpenChannel = "compose-window:open";
export const composeWindowFocusChannel = "compose-window:focus";
export const composeWindowCloseChannel = "compose-window:close";
export const composeWindowDataChannel = "compose-window:data";
export const composeWindowClosedChannel = "compose-window:closed";
export const composeWindowSendChannel = "compose-window:send";
export const composeWindowSendRequestChannel = "compose-window:send-request";
export const composeWindowSendResponseChannel = "compose-window:send-response";
export const composeWindowSearchContactsChannel = "compose-window:search-contacts";
export const composeWindowSearchContactsRequestChannel = "compose-window:search-contacts-request";
export const composeWindowSearchContactsResponseChannel = "compose-window:search-contacts-response";

export type ComposeWindowSendResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export function isComposeWindowSendResult(value: unknown): value is ComposeWindowSendResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  let result = value as Record<string, unknown>;
  return result.ok === true ||
    (result.ok === false && typeof result.errorMessage === "string" && result.errorMessage.length <= 8_000);
}

export function isComposeWindowPerson(value: unknown): value is ComposeWindowPerson {
  if (!value || typeof value !== "object") {
    return false;
  }
  let person = value as Record<string, unknown>;
  return typeof person.emailAddress === "string" && person.emailAddress.length <= 320 &&
    (person.name === null || (typeof person.name === "string" && person.name.length <= 512));
}

export function isComposeWindowPersonArray(value: unknown): value is ComposeWindowPerson[] {
  return Array.isArray(value) && value.length <= 100 && value.every(isComposeWindowPerson);
}

export interface ComposeWindowPerson {
  emailAddress: string;
  name: string | null;
}

export type ComposeWindowFollowUp =
  | { mode: "calendar" | "working"; days: number }
  | { mode: "date"; dueAt: string };

export interface ComposeWindowAttachment {
  filename: string;
  filepathLocal: string | null;
  mimeType: string | null;
  size: number | null;
  disposition: "unknown" | "inline" | "attachment";
  related: boolean;
  contentID: string | null;
  contentBase64: string | null;
}

export interface ComposeWindowSource {
  id: string | null;
  dbID: string | number | null;
  subject: string;
  /** Безопасный HTML исходного письма для отображения в окне ответа. */
  html: string | null;
  text: string | null;
  loadExternalImages: boolean;
  from: ComposeWindowPerson;
  sent: string | null;
  received: string | null;
}

export interface ComposeWindowMail {
  windowID: string;
  accountID: string;
  folderID: string | null;
  identityID: string | null;
  id: string | null;
  pID: string | number | null;
  dbID: string | number | null;
  subject: string;
  html: string | null;
  text: string | null;
  from: ComposeWindowPerson;
  replyTo: ComposeWindowPerson | null;
  to: ComposeWindowPerson[];
  cc: ComposeWindowPerson[];
  bcc: ComposeWindowPerson[];
  sent: string | null;
  received: string | null;
  inReplyTo: string | null;
  references: string[];
  threadID: string | null;
  outgoing: boolean;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  importanceLevel: "high" | "normal" | "low";
  requestReadReceipt: boolean;
  requestDeliveryReceipt: boolean;
  /** Необязательно: старые окна редактора его не передают */
  signatureRemovedByUser?: boolean;
  /** «Напомнить, если не ответят». Необязательно: старые окна его не передают */
  followUpReminder?: ComposeWindowFollowUp | null;
  /** «Отправить позже» из отдельного окна: время отправки (ISO). Необязательно: старые окна его не передают */
  scheduledSendAt?: string | null;
  isDraft: boolean;
  isDeleted: boolean;
  shouldEncrypt: boolean;
  mustEncrypt: boolean;
  wasEncrypted: boolean;
  signedByKeyID: string | null;
  hasAttachmentsFlag: boolean;
  headers: [string, string][];
  attachments: ComposeWindowAttachment[];
  composeSource: ComposeWindowSource | null;
}

const kMaxIDLength = 512;
const kMaxPersonNameLength = 512;
const kMaxSubjectLength = 16_384;
const kMaxBodyLength = 8_000_000;
const kMaxRecipients = 100;
const kMaxReferences = 100;
const kMaxHeaders = 200;
const kMaxAttachments = 100;
const kMaxAttachmentPathLength = 4_096;
export const composeWindowMaxAttachmentBytes = 24_000_000;
const kMaxAttachmentContentLength = 32_000_000;

function isString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || isString(value, maxLength);
}

function isID(value: unknown): value is string | number | null {
  return value === null || isString(value, kMaxIDLength) ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

function isDate(value: unknown): value is string | null {
  return value === null || (isString(value, 80) && !Number.isNaN(Date.parse(value)));
}

function isPerson(value: unknown): value is ComposeWindowPerson {
  if (!value || typeof value !== "object") {
    return false;
  }
  let person = value as Record<string, unknown>;
  return isString(person.emailAddress, 320) &&
    isNullableString(person.name, kMaxPersonNameLength);
}

function isPersonArray(value: unknown): value is ComposeWindowPerson[] {
  return Array.isArray(value) && value.length <= kMaxRecipients && value.every(isPerson);
}

function isAttachment(value: unknown): value is ComposeWindowAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }
  let attachment = value as Record<string, unknown>;
  return isString(attachment.filename, 1_024) &&
    isNullableString(attachment.filepathLocal, kMaxAttachmentPathLength) &&
    isNullableString(attachment.mimeType, 256) &&
    (attachment.size === null || (typeof attachment.size === "number" && Number.isSafeInteger(attachment.size) && attachment.size >= 0)) &&
    ["unknown", "inline", "attachment"].includes(attachment.disposition as string) &&
    typeof attachment.related === "boolean" &&
    isNullableString(attachment.contentID, kMaxIDLength) &&
    (attachment.contentBase64 === null || isString(attachment.contentBase64, kMaxAttachmentContentLength));
}

function isSource(value: unknown): value is ComposeWindowSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  let source = value as Record<string, unknown>;
  return isNullableString(source.id, kMaxIDLength) &&
    isID(source.dbID) &&
    isString(source.subject, kMaxSubjectLength) &&
    isNullableString(source.html, kMaxBodyLength) &&
    isNullableString(source.text, kMaxBodyLength) &&
    typeof source.loadExternalImages === "boolean" &&
    isPerson(source.from) &&
    isDate(source.sent) &&
    isDate(source.received);
}

/** Проверяет данные из IPC до их сохранения в главном процессе. */
export function isComposeWindowPayload(value: unknown): value is ComposeWindowMail {
  if (!value || typeof value !== "object") {
    return false;
  }
  let mail = value as Record<string, unknown>;
  if (!isString(mail.windowID, 128) || !mail.windowID ||
      !isString(mail.accountID, kMaxIDLength) || !mail.accountID ||
      !isNullableString(mail.folderID, kMaxIDLength) ||
      !isNullableString(mail.identityID, kMaxIDLength) ||
      !isNullableString(mail.id, kMaxIDLength) || !isID(mail.pID) || !isID(mail.dbID) ||
      !isString(mail.subject, kMaxSubjectLength) ||
      !isNullableString(mail.html, kMaxBodyLength) ||
      !isNullableString(mail.text, kMaxBodyLength) ||
      !isPerson(mail.from) || !isNullablePerson(mail.replyTo) ||
      !isPersonArray(mail.to) || !isPersonArray(mail.cc) || !isPersonArray(mail.bcc) ||
      !isDate(mail.sent) || !isDate(mail.received) ||
      !isNullableString(mail.inReplyTo, kMaxIDLength) ||
      !isStringArray(mail.references, kMaxReferences, kMaxIDLength) ||
      !isNullableString(mail.threadID, kMaxIDLength) ||
      typeof mail.outgoing !== "boolean" || typeof mail.isRead !== "boolean" ||
      typeof mail.isStarred !== "boolean" || typeof mail.isImportant !== "boolean" ||
      !["high", "normal", "low"].includes(mail.importanceLevel as string) ||
      typeof mail.requestReadReceipt !== "boolean" || typeof mail.requestDeliveryReceipt !== "boolean" ||
      typeof mail.isDraft !== "boolean" || typeof mail.isDeleted !== "boolean" ||
      typeof mail.shouldEncrypt !== "boolean" || typeof mail.mustEncrypt !== "boolean" ||
      typeof mail.wasEncrypted !== "boolean" || !isNullableString(mail.signedByKeyID, kMaxIDLength) ||
      typeof mail.hasAttachmentsFlag !== "boolean" || !isHeaders(mail.headers) ||
      !Array.isArray(mail.attachments) || mail.attachments.length > kMaxAttachments || !mail.attachments.every(isAttachment) ||
      !isNullableSource(mail.composeSource) ||
      !isOptionalFollowUp(mail.followUpReminder) ||
      !(mail.scheduledSendAt === undefined || isDate(mail.scheduledSendAt))) {
    return false;
  }
  let bodyLength = (mail.html as string | null)?.length ?? 0;
  bodyLength += (mail.text as string | null)?.length ?? 0;
  if (bodyLength > kMaxBodyLength * 2) {
    return false;
  }
  let attachmentContentLength = (mail.attachments as ComposeWindowAttachment[])
    .reduce((total, attachment) => total + (attachment.contentBase64?.length ?? 0), 0);
  return attachmentContentLength <= kMaxAttachmentContentLength * 4;
}

function isOptionalFollowUp(value: unknown): value is ComposeWindowFollowUp | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  let followUp = value as Record<string, unknown>;
  if (followUp.mode === "date") {
    return isDate(followUp.dueAt) && followUp.dueAt !== null;
  }
  return (followUp.mode === "calendar" || followUp.mode === "working") &&
    typeof followUp.days === "number" && Number.isInteger(followUp.days) &&
    followUp.days >= 1 && followUp.days <= 365;
}

function isNullablePerson(value: unknown): value is ComposeWindowPerson | null {
  return value === null || isPerson(value);
}

function isNullableSource(value: unknown): value is ComposeWindowSource | null {
  return value === null || isSource(value);
}

function isStringArray(value: unknown, maxItems: number, maxItemLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => isString(item, maxItemLength));
}

function isHeaders(value: unknown): value is [string, string][] {
  return Array.isArray(value) && value.length <= kMaxHeaders && value.every(header =>
    Array.isArray(header) && header.length === 2 && isString(header[0], 512) && isString(header[1], kMaxBodyLength));
}
