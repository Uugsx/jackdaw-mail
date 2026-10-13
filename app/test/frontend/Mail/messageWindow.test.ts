import { afterEach, describe, expect, test, vi } from "vitest";
import type { ComposeWindowMail } from "../../../logic/Mail/Composer/ComposeWindowProtocol";

const mocks = vi.hoisted(() => ({
  serializeComposeMail: vi.fn(),
  deserializeComposeMail: vi.fn(),
}));

vi.mock("../../../frontend/Mail/Composer/composeWindow", () => ({
  serializeComposeMail: mocks.serializeComposeMail,
  deserializeComposeMail: mocks.deserializeComposeMail,
}));

import { serializeMessageWindowMail } from "../../../frontend/Mail/Message/messageWindow";

function createMail(windowID: string, html: string | null = null): ComposeWindowMail {
  return {
    windowID,
    accountID: "account-id",
    folderID: "folder-id",
    identityID: "identity-id",
    id: "message-id",
    pID: null,
    dbID: 42,
    subject: "Тестовое письмо",
    html,
    text: null,
    from: { emailAddress: "sender@example.test", name: "Отправитель" },
    replyTo: null,
    to: [{ emailAddress: "recipient@example.test", name: "Получатель" }],
    cc: [],
    bcc: [],
    sent: "2026-10-13T12:00:00.000Z",
    received: "2026-10-13T12:00:00.000Z",
    inReplyTo: null,
    references: [],
    threadID: "thread-id",
    outgoing: false,
    isRead: true,
    isStarred: false,
    isImportant: false,
    importanceLevel: "normal",
    requestReadReceipt: false,
    requestDeliveryReceipt: false,
    isDraft: false,
    isDeleted: false,
    shouldEncrypt: false,
    mustEncrypt: false,
    wasEncrypted: false,
    signedByKeyID: null,
    hasAttachmentsFlag: false,
    headers: [],
    attachments: [],
    composeSource: null,
  };
}

function createMessage(loadBody: () => Promise<void>) {
  return {
    loadBody,
    rawHTMLDangerous: null,
    rawText: null,
    sml: null,
    isSpam: false,
    isReplied: false,
    isForwarded: false,
  };
}

afterEach(() => {
  mocks.serializeComposeMail.mockReset();
  mocks.deserializeComposeMail.mockReset();
});

describe("payload окна просмотра письма", () => {
  test("откладывает загрузку тела, если snapshot превышает лимит IPC", async () => {
    let windowID = "message-window-id";
    let oversizedHTML = "x".repeat(8_000_001);
    mocks.serializeComposeMail.mockResolvedValue(createMail(windowID, oversizedHTML));

    let payload = await serializeMessageWindowMail(
      createMessage(async () => {}) as any,
      windowID,
    );

    expect(payload.bodyDeferred).toBe(true);
    expect(payload.mail.html).toBeNull();
    expect(payload.mail.windowID).toBe(windowID);
  });

  test("не меняет режим окна, если первичная загрузка тела временно упала", async () => {
    let windowID = "message-window-id";
    mocks.serializeComposeMail.mockResolvedValue(createMail(windowID));

    let payload = await serializeMessageWindowMail(
      createMessage(async () => {
        throw new Error("body unavailable");
      }) as any,
      windowID,
    );

    expect(payload.bodyDeferred).toBe(true);
    expect(payload.mail.html).toBeNull();
  });
});
