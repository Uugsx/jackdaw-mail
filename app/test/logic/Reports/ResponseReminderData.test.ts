import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../lib/rs-sqlite";
import { createReportReplyIndexes } from "../../../logic/Mail/SQL/SQLEMailMigrate";
import { mailDatabaseSchema } from "../../../logic/Mail/SQL/createDatabase";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import {
  loadPendingResponseRequests,
  loadResponseTrackingCategoryNames,
} from "../../../logic/Reports/ResponseReminderData";

function seconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function insertEmail(
  database: InProcessSQLiteDatabase,
  values: {
    id: number;
    folderID: number;
    messageID: string | null;
    parentMsgID: string | null;
    threadID: string | null;
    date: number;
    outgoing: number;
    isReplied: number;
    isRead?: number;
    subject: string;
    contactEmail?: string;
    contactName?: string;
  },
): void {
  database.run(sql`
    INSERT INTO email (
      id, folderID, messageID, parentMsgID, threadID,
      dateSent, dateReceived, isRead, outgoing, contactEmail, contactName,
      subject, isReplied
    ) VALUES (
      ${values.id}, ${values.folderID}, ${values.messageID},
      ${values.parentMsgID}, ${values.threadID}, ${values.date}, ${values.date},
      ${values.isRead ?? 0}, ${values.outgoing},
      ${values.contactEmail ?? "requester@example.com"},
      ${values.contactName ?? "Requester"},
      ${values.subject}, ${values.isReplied}
    )
  `);
}

function insertRecipient(
  database: InProcessSQLiteDatabase,
  emailID: number,
  recipientType: number,
  emailAddress: string,
  name = emailAddress,
): void {
  database.run(sql`
    INSERT OR IGNORE INTO emailPerson (emailAddress, name)
    VALUES (${emailAddress}, ${name})
  `);
  const person = database.get(sql`
    SELECT id
    FROM emailPerson
    WHERE emailAddress = ${emailAddress}
      AND name = ${name}
  `) as { id?: number } | undefined;
  if (!person?.id) {
    throw new Error(`Could not create email person for ${emailAddress}`);
  }
  database.run(sql`
    INSERT INTO emailPersonRel (emailID, emailPersonID, recipientType)
    VALUES (${emailID}, ${person.id}, ${recipientType})
  `);
}

describe("ResponseReminderData", () => {
  test("uses the same verified-reply rules as reports and scopes categories", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "response-reminder-"));
    const database = new InProcessSQLiteDatabase(path.join(tempDir, "mail.db"));
    const now = new Date("2026-09-09T10:00:00.000Z");
    try {
      await database.migrate(mailDatabaseSchema, createReportReplyIndexes);
      database.run(sql`
        INSERT INTO emailAccount (id, idStr, protocol)
        VALUES (1, ${"account-1"}, ${"imap"}), (2, ${"account-2"}, ${"imap"})
      `);
      database.run(sql`
        INSERT INTO folder (id, accountID, name, path, specialUse)
        VALUES
          (101, 1, ${"Inbox"}, ${"INBOX"}, ${"inbox"}),
          (102, 1, ${"Sent"}, ${"Sent"}, ${"sent"}),
          (201, 2, ${"Inbox"}, ${"INBOX"}, ${"inbox"}),
          (202, 2, ${"Sent"}, ${"Sent"}, ${"sent"})
      `);

      insertEmail(database, {
        id: 1,
        folderID: 101,
        messageID: "<request-1>",
        parentMsgID: null,
        threadID: "<thread-1>",
        date: seconds("2026-09-09T09:30:00.000Z"),
        outgoing: 0,
        // The provider's reply flag is enough to remove a request from the
        // live queue when the local sent copy is unavailable.
        isReplied: 1,
        subject: "Unanswered employee request",
      });
      insertEmail(database, {
        id: 2,
        folderID: 101,
        messageID: "<request-2>",
        parentMsgID: null,
        threadID: "<thread-2>",
        date: seconds("2026-09-09T09:20:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Unanswered other category",
      });
      insertEmail(database, {
        id: 3,
        folderID: 101,
        messageID: "<request-3>",
        parentMsgID: null,
        threadID: "<thread-3>",
        date: seconds("2026-09-09T09:10:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Answered by parent header",
      });
      insertEmail(database, {
        id: 4,
        folderID: 101,
        messageID: null,
        parentMsgID: null,
        threadID: "<thread-4>",
        date: seconds("2026-09-09T09:00:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Answered by thread",
      });
      insertEmail(database, {
        id: 30,
        folderID: 102,
        messageID: "<reply-3>",
        parentMsgID: "<request-3>",
        threadID: "<thread-3>",
        date: seconds("2026-09-09T09:40:00.000Z"),
        outgoing: 1,
        isReplied: 0,
        subject: "Re: Answered by parent header",
      });
      insertEmail(database, {
        id: 40,
        folderID: 102,
        messageID: "<reply-4>",
        parentMsgID: null,
        threadID: "<thread-4>",
        date: seconds("2026-09-09T09:45:00.000Z"),
        outgoing: 1,
        isReplied: 0,
        subject: "Re: Answered by thread",
      });
      insertEmail(database, {
        id: 50,
        folderID: 101,
        messageID: "<future>",
        parentMsgID: null,
        threadID: "<future-thread>",
        date: seconds("2026-09-09T10:05:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Future request",
      });
      insertEmail(database, {
        id: 60,
        folderID: 201,
        messageID: "<other-account>",
        parentMsgID: null,
        threadID: "<other-account-thread>",
        date: seconds("2026-09-09T09:30:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Other account",
      });
      insertEmail(database, {
        id: 70,
        folderID: 102,
        messageID: "<in-sent>",
        parentMsgID: null,
        threadID: "<in-sent-thread>",
        date: seconds("2026-09-09T09:30:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Incoming in sent folder",
      });
      insertEmail(database, {
        id: 80,
        folderID: 101,
        messageID: "<uncategorized>",
        parentMsgID: null,
        threadID: "<uncategorized-thread>",
        date: seconds("2026-09-09T09:05:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        isRead: 1,
        subject: "Uncategorized request",
      });
      insertEmail(database, {
        id: 81,
        folderID: 101,
        messageID: "<copy-request>",
        parentMsgID: null,
        threadID: "<copy-thread>",
        date: seconds("2026-09-09T09:06:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Already handled in copy",
      });
      insertEmail(database, {
        id: 90,
        folderID: 101,
        messageID: "<personal-reply-request>",
        parentMsgID: null,
        threadID: "<personal-reply-thread>",
        date: seconds("2026-09-09T09:15:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Answered from a personal mailbox",
      });
      insertEmail(database, {
        id: 91,
        folderID: 202,
        messageID: "<personal-reply>",
        parentMsgID: "<personal-reply-request>",
        threadID: "<personal-reply-thread>",
        date: seconds("2026-09-09T09:45:00.000Z"),
        // Some providers save a sent copy with outgoing=0. The sent folder
        // must still make it an outbound reply.
        outgoing: 0,
        isReplied: 0,
        subject: "Re: Answered from a personal mailbox",
      });

      database.run(sql`
        INSERT INTO emailTag (emailID, tagName)
        VALUES
          (1, ${"Никита Левченко"}),
          (1, ${"Никита Левченко"}),
          (2, ${"Никита Левченко"}),
          (2, ${"Елена Силантьева"}),
          (3, ${"Никита Левченко"}),
          (4, ${"Никита Левченко"}),
          (50, ${"Никита Левченко"}),
          (60, ${"Никита Левченко"}),
          (70, ${"Никита Левченко"}),
          (81, ${"Переписка (мы в копии)"}),
          (90, ${"Никита Левченко"})
      `);

      const employeeRequests = await loadPendingResponseRequests(
        1,
        ["Никита Левченко"],
        now,
        database,
      );
      expect(employeeRequests.map(request => request.emailId)).toEqual([2]);
      expect(employeeRequests[0].categoryNames).toEqual([
        "Никита Левченко",
        "Елена Силантьева",
      ]);

      const allRequests = await loadPendingResponseRequests(1, null, now, database);
      expect(allRequests.map(request => request.emailId)).toEqual([80, 81, 2]);

      const trackedRequests = await loadPendingResponseRequests(
        1,
        null,
        now,
        database,
        101,
        {
          excludedCategoryNames: ["Переписка (мы в копии)"],
          includeUncategorized: false,
        },
      );
      // В режиме профиля категория не является условием постановки в SLA:
      // новое письмо должно начать отсчёт сразу после получения.
      expect(trackedRequests.map(request => request.emailId)).toEqual([80, 2]);
      expect(trackedRequests.find((request) => request.emailId == 80)?.isRead).toBe(
        true,
      );

      const categoryNames = await loadResponseTrackingCategoryNames(
        1,
        database,
      );
      expect(categoryNames).toContain("Переписка (мы в копии)");

      const inboxRequests = await loadPendingResponseRequests(
        1,
        null,
        now,
        database,
        101,
      );
      expect(inboxRequests.map(request => request.emailId)).toEqual([80, 81, 2]);

      const sentRequests = await loadPendingResponseRequests(
        1,
        null,
        now,
        database,
        102,
      );
      expect(sentRequests).toEqual([]);
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("includes uncategorized requests in category mode only when enabled", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "response-reminder-category-filter-"));
    const database = new InProcessSQLiteDatabase(path.join(tempDir, "mail.db"));
    const now = new Date("2026-09-09T10:00:00.000Z");
    try {
      await database.migrate(mailDatabaseSchema, createReportReplyIndexes);
      database.run(sql`
        INSERT INTO emailAccount (id, idStr, protocol)
        VALUES (1, ${"account-1"}, ${"imap"})
      `);
      database.run(sql`
        INSERT INTO folder (id, accountID, name, path, specialUse)
        VALUES (101, 1, ${"Inbox"}, ${"INBOX"}, ${"inbox"})
      `);

      insertEmail(database, {
        id: 1,
        folderID: 101,
        messageID: "<selected-category>",
        parentMsgID: null,
        threadID: "<selected-category-thread>",
        date: seconds("2026-09-09T09:00:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Selected employee request",
      });
      insertEmail(database, {
        id: 2,
        folderID: 101,
        messageID: "<uncategorized>",
        parentMsgID: null,
        threadID: "<uncategorized-thread>",
        date: seconds("2026-09-09T09:01:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Request after category removal",
      });
      insertEmail(database, {
        id: 3,
        folderID: 101,
        messageID: "<other-category>",
        parentMsgID: null,
        threadID: "<other-category-thread>",
        date: seconds("2026-09-09T09:02:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Other employee request",
      });
      database.run(sql`
        INSERT INTO emailTag (emailID, tagName)
        VALUES
          (1, ${"Никита Галкин"}),
          (3, ${"Никита Левченко"})
      `);

      const withUncategorized = await loadPendingResponseRequests(
        1,
        ["Никита Галкин"],
        now,
        database,
        101,
        { includeUncategorized: true },
      );
      expect(withUncategorized.map((request) => request.emailId)).toEqual([1, 2]);

      const withoutUncategorized = await loadPendingResponseRequests(
        1,
        ["Никита Галкин"],
        now,
        database,
        101,
        { includeUncategorized: false },
      );
      expect(withoutUncategorized.map((request) => request.emailId)).toEqual([1]);
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("tracks every incoming follow-up, including an employee reply copy", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "response-reminder-copy-"));
    const database = new InProcessSQLiteDatabase(path.join(tempDir, "mail.db"));
    const now = new Date("2026-09-09T10:00:00.000Z");
    try {
      await database.migrate(mailDatabaseSchema, createReportReplyIndexes);
      database.run(sql`
        INSERT INTO emailAccount (id, idStr, protocol)
        VALUES (1, ${"account-1"}, ${"imap"})
      `);
      database.run(sql`
        INSERT INTO folder (id, accountID, name, path, specialUse)
        VALUES (101, 1, ${"Inbox"}, ${"INBOX"}, ${"inbox"})
      `);

      insertEmail(database, {
        id: 100,
        folderID: 101,
        messageID: "<request-copy>",
        parentMsgID: null,
        threadID: "<request-thread>",
        date: seconds("2026-09-09T09:00:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Request",
        contactEmail: "customer@external.test",
        contactName: "Customer",
      });
      insertEmail(database, {
        id: 101,
        folderID: 101,
        messageID: "<employee-reply>",
        parentMsgID: "<request-copy>",
        threadID: "<request-thread>",
        date: seconds("2026-09-09T09:05:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Re: Request",
        contactEmail: "employee@company.test",
        contactName: "Employee",
      });
      insertEmail(database, {
        id: 102,
        folderID: 101,
        messageID: "<external-follow-up>",
        parentMsgID: "<employee-reply>",
        threadID: null,
        date: seconds("2026-09-09T09:20:00.000Z"),
        outgoing: 0,
        isReplied: 0,
        subject: "Re: Request",
        contactEmail: "customer@external.test",
        contactName: "Customer",
      });
      database.run(sql`
        INSERT INTO emailTag (emailID, tagName)
        VALUES
          (100, ${"Никита Левченко"}),
          (101, ${"Никита Левченко"}),
          (102, ${"Никита Левченко"})
      `);

      insertRecipient(database, 100, 1, "customer@external.test", "Customer");
      insertRecipient(database, 100, 2, "shared@company.test", "Shared");
      insertRecipient(database, 101, 1, "employee@company.test", "Employee");
      insertRecipient(database, 101, 2, "customer@external.test", "Customer");
      insertRecipient(database, 101, 3, "shared@company.test", "Shared");
      insertRecipient(database, 102, 1, "customer@external.test", "Customer");
      insertRecipient(database, 102, 2, "shared@company.test", "Shared");

      const requests = await loadPendingResponseRequests(
        1,
        ["Никита Левченко"],
        now,
        database,
        101,
        {
          mailboxAddress: "shared@company.test",
          knownSenderAddresses: ["employee@company.test"],
        },
      );

      // Первый запрос закрыт копией ответа сотрудника. Сама копия и
      // последующее письмо клиента — отдельные неотвеченные запросы.
      expect(requests.map((request) => request.emailId)).toEqual([101, 102]);
    } finally {
      database.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
