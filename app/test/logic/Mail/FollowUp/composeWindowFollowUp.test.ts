import { describe, expect, test } from "vitest";
import {
  isComposeWindowPayload,
  type ComposeWindowMail,
} from "../../../../logic/Mail/Composer/ComposeWindowProtocol";

function payload(overrides: Partial<ComposeWindowMail> = {}): ComposeWindowMail {
  return {
    windowID: "w1",
    accountID: "account-1",
    folderID: null,
    identityID: null,
    id: "<m@example.com>",
    pID: null,
    dbID: null,
    subject: "Hi",
    html: "<p>Hi</p>",
    text: null,
    from: { emailAddress: "me@example.com", name: "Me" },
    replyTo: null,
    to: [{ emailAddress: "bob@client.com", name: null }],
    cc: [],
    bcc: [],
    sent: null,
    received: null,
    inReplyTo: null,
    references: [],
    threadID: null,
    outgoing: true,
    isRead: true,
    isStarred: false,
    isImportant: false,
    importanceLevel: "normal",
    requestReadReceipt: false,
    requestDeliveryReceipt: false,
    isDraft: true,
    isDeleted: false,
    shouldEncrypt: false,
    mustEncrypt: false,
    wasEncrypted: false,
    signedByKeyID: null,
    hasAttachmentsFlag: false,
    headers: [],
    attachments: [],
    composeSource: null,
    ...overrides,
  };
}

describe("«Напомнить, если не ответят» в IPC отдельного окна редактора", () => {
  test("старое окно без поля и пустой выбор принимаются", () => {
    expect(isComposeWindowPayload(payload())).toBe(true);
    expect(isComposeWindowPayload(payload({ followUpReminder: null }))).toBe(true);
  });

  test("корректный выбор принимается", () => {
    expect(isComposeWindowPayload(payload({ followUpReminder: { mode: "working", days: 3 } }))).toBe(true);
    expect(isComposeWindowPayload(payload({ followUpReminder: { mode: "date", dueAt: "2026-11-01T09:00:00.000Z" } }))).toBe(true);
  });

  test("некорректный выбор отклоняется", () => {
    for (let followUpReminder of [
      { mode: "calendar", days: 0 },
      { mode: "calendar", days: 2.5 },
      { mode: "calendar", days: 1000 },
      { mode: "date", dueAt: "not a date" },
      { mode: "date", dueAt: null },
      { mode: "hourly", days: 1 },
      "tomorrow",
    ]) {
      expect(isComposeWindowPayload(payload({ followUpReminder: followUpReminder as any }))).toBe(false);
    }
  });
});
