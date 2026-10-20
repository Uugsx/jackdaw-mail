// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { mailDatabaseMigrations } from "../../../../logic/Mail/SQL/SQLDatabase";
import {
  createFollowUpReminderTable,
  dedupeEMailsWithoutPID,
  rollbackFollowUpReminderTable,
} from "../../../../logic/Mail/SQL/SQLEMailMigrate";
import {
  cancelFollowUpReminder,
  checkFollowUpReminders,
  loadWaitingFollowUpReminders,
  markFollowUpNotified,
  saveFollowUpReminder,
  snoozeFollowUpReminder,
  type FollowUpReminderInput,
} from "../../../../logic/Mail/FollowUp/FollowUpReminderData";
import { InProcessSQLiteHost } from "../../util/hostedSQLite";
import type { Database } from "../../../../../lib/rs-sqlite";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir: string;
let sqlite: InProcessSQLiteHost;
let db: Database;

const own = ["me@example.com", "shared@example.com"];
const sentAt = new Date("2026-10-19T08:00:00.000Z");
const now = new Date("2026-10-20T09:00:00.000Z");

function seconds(date: Date | string): number {
  return Math.floor(new Date(date).getTime() / 1000);
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "follow-up-test-"));
  sqlite = new InProcessSQLiteHost();
  db = await sqlite.host.openDatabase(path.join(tempDir, "mail.db"), {});
  await db.migrate(...mailDatabaseMigrations);
  await db.execute(sql`
    INSERT INTO emailAccount (id, idStr, protocol) VALUES
      (1, 'personal', 'imap'), (2, 'shared', 'owa');
    INSERT INTO folder (id, accountID, name, path, specialUse) VALUES
      (11, 1, 'INBOX', 'INBOX', 'inbox'),
      (12, 1, 'Sent', 'Sent', 'sent'),
      (13, 1, 'Junk', 'Junk', 'junk'),
      (21, 2, 'Inbox', 'Inbox', 'inbox'),
      (22, 2, 'Sent', 'Sent', 'sent');
  `);
});

afterEach(async () => {
  await sqlite.host.shutdown();
  rmSync(tempDir, { recursive: true, force: true });
});

async function insertEmail(values: {
  id: number;
  folderID: number;
  messageID?: string | null;
  parentMsgID?: string | null;
  threadID?: string | null;
  date: Date | string;
  outgoing?: number;
  from: string;
  fromName?: string;
  subject: string;
}) {
  await db.run(sql`
    INSERT INTO email (
      id, folderID, messageID, parentMsgID, threadID, dateSent, dateReceived,
      outgoing, contactEmail, contactName, subject
    ) VALUES (
      ${values.id}, ${values.folderID}, ${values.messageID ?? null},
      ${values.parentMsgID ?? null}, ${values.threadID ?? null},
      ${seconds(values.date)}, ${seconds(values.date)},
      ${values.outgoing ?? 0}, ${values.from}, ${values.fromName ?? values.from},
      ${values.subject}
    )
  `);
  if (!values.outgoing) {
    await db.run(sql`INSERT OR IGNORE INTO emailPerson (emailAddress, name) VALUES (${values.from}, '')`);
    let person = await db.get<{ id: number }>(sql`
      SELECT id FROM emailPerson WHERE emailAddress = ${values.from} AND name = ''`);
    await db.run(sql`
      INSERT INTO emailPersonRel (emailID, emailPersonID, recipientType) VALUES (${values.id}, ${person!.id}, 1)`);
  }
}

function input(overrides: Partial<FollowUpReminderInput> = {}): FollowUpReminderInput {
  return {
    accountId: 1,
    messageID: "<sent-1@example.com>",
    subject: "Contract draft",
    recipients: ["Bob@Client.com", "carol@client.com"],
    sentAt,
    dueAt: new Date("2026-10-20T08:00:00.000Z"),
    scheduleMode: "calendar",
    durationDays: 1,
    ...overrides,
  };
}

async function sentCopy(messageID = "<sent-1@example.com>", folderID = 12, id = 100) {
  await insertEmail({
    id, folderID, messageID, threadID: "conversation-1", date: sentAt, outgoing: 1,
    from: "bob@client.com", subject: "Contract draft",
  });
}

describe("миграция", () => {
  test("десятая миграция — в конце списка, выпущенные не сдвинуты", () => {
    expect(mailDatabaseMigrations.indexOf(dedupeEMailsWithoutPID)).toBe(8);
    expect(mailDatabaseMigrations.indexOf(createFollowUpReminderTable)).toBe(9);
    expect(mailDatabaseMigrations.at(-1)).toBe(createFollowUpReminderTable);
  });

  test("база на user_version 9 получает таблицу, письма не трогаются; откат удаляет таблицу", async () => {
    let legacy = await sqlite.host.openDatabase(path.join(tempDir, "legacy.db"), {});
    await legacy.migrate(...mailDatabaseMigrations.slice(0, 9));
    await legacy.execute(sql`
      INSERT INTO emailAccount (id, idStr, protocol) VALUES (1, 'a', 'imap');
      INSERT INTO folder (id, accountID, name, path) VALUES (1, 1, 'INBOX', 'INBOX');
      INSERT INTO email (id, folderID, messageID, dateSent, dateReceived, subject) VALUES (1, 1, '<m>', 1, 1, 'Hi');
    `);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(9);
    await legacy.migrate(...mailDatabaseMigrations);
    expect(await legacy.pragma("user_version", { simple: true })).toBe(10);
    expect(await legacy.all(sql`SELECT id, subject FROM email`)).toEqual([{ id: 1, subject: "Hi" }]);
    expect(await legacy.get(sql`
      SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'index_followUpReminder_status_dueAt'`))
      .toEqual({ name: "index_followUpReminder_status_dueAt" });

    await legacy.execute(rollbackFollowUpReminderTable);
    expect(await legacy.get(sql`
      SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'followUpReminder'`)).toBeUndefined();
    // Повторный запуск миграции безопасен: IF NOT EXISTS
    await legacy.execute(createFollowUpReminderTable);
    await legacy.execute(createFollowUpReminderTable);
  });

  test("удаление ящика удаляет его напоминания", async () => {
    await db.pragma("foreign_keys = true");
    await saveFollowUpReminder(input(), now, db);
    await db.run(sql`DELETE FROM emailAccount WHERE id = 1`);
    expect(await loadWaitingFollowUpReminders(db)).toEqual([]);
  });
});

describe("хранение", () => {
  test("сохраняет, нормализует получателей и повторно включает то же письмо", async () => {
    let first = await saveFollowUpReminder(input(), now, db);
    expect(first.recipients).toEqual(["bob@client.com", "carol@client.com"]);
    expect(first.status).toBe("waiting");
    await cancelFollowUpReminder(first.id, db);
    expect(await loadWaitingFollowUpReminders(db)).toEqual([]);

    let again = await saveFollowUpReminder(input({ dueAt: new Date("2026-10-23T08:00:00.000Z"), durationDays: 3 }), now, db);
    expect(again.id).toBe(first.id);
    expect(again.dueAt).toEqual(new Date("2026-10-23T08:00:00.000Z"));
    expect((await loadWaitingFollowUpReminders(db)).map(item => item.id)).toEqual([first.id]);
  });

  test("отложить сбрасывает отметку об уведомлении", async () => {
    let item = await saveFollowUpReminder(input(), now, db);
    await markFollowUpNotified(item.id, now, db);
    expect((await loadWaitingFollowUpReminders(db))[0].notifiedAt).toEqual(now);
    await snoozeFollowUpReminder(item.id, new Date("2026-10-21T09:00:00.000Z"), db);
    let [snoozed] = await loadWaitingFollowUpReminders(db);
    expect(snoozed.notifiedAt).toBeNull();
    expect(snoozed.dueAt).toEqual(new Date("2026-10-21T09:00:00.000Z"));
  });
});

describe("проверка ответов", () => {
  test("ответ по In-Reply-To снимает ожидание", async () => {
    await sentCopy();
    await saveFollowUpReminder(input(), now, db);
    await insertEmail({
      id: 200, folderID: 11, messageID: "<r1>", parentMsgID: "<sent-1@example.com>",
      date: "2026-10-19T12:00:00.000Z", from: "bob@client.com", subject: "Re: Contract draft",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.waiting).toEqual([]);
    expect(result.replied.map(item => item.messageID)).toEqual(["<sent-1@example.com>"]);
    let row = await db.get(sql`SELECT status, replyEmailID FROM followUpReminder`);
    expect(row).toEqual({ status: "replied", replyEmailID: 200 });
  });

  test("автоответ, уведомление о доставке, свой ответ и спам не снимают ожидание", async () => {
    await sentCopy();
    await saveFollowUpReminder(input(), now, db);
    await insertEmail({
      id: 201, folderID: 11, parentMsgID: "<sent-1@example.com>", threadID: "conversation-1",
      date: "2026-10-19T08:01:00.000Z", from: "bob@client.com", subject: "Automatic reply: Contract draft",
    });
    await insertEmail({
      id: 202, folderID: 11, parentMsgID: "<sent-1@example.com>",
      date: "2026-10-19T08:02:00.000Z", from: "postmaster@client.com", fromName: "Microsoft Outlook",
      subject: "Delivered: Contract draft",
    });
    await insertEmail({
      id: 203, folderID: 12, parentMsgID: "<sent-1@example.com>", threadID: "conversation-1",
      date: "2026-10-19T09:00:00.000Z", outgoing: 1, from: "bob@client.com", subject: "Re: Contract draft",
    });
    // Своё письмо, пришедшее в общий ящик копией
    await insertEmail({
      id: 204, folderID: 21, parentMsgID: "<sent-1@example.com>", threadID: "conversation-1",
      date: "2026-10-19T09:30:00.000Z", from: "me@example.com", subject: "Re: Contract draft",
    });
    await insertEmail({
      id: 205, folderID: 13, parentMsgID: "<sent-1@example.com>",
      date: "2026-10-19T10:00:00.000Z", from: "bob@client.com", subject: "Re: Contract draft",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied).toEqual([]);
    expect(result.waiting.map(item => item.emailId)).toEqual([100]);
  });

  test("письмо получателя в той же цепочке без In-Reply-To — ответ", async () => {
    await sentCopy();
    await saveFollowUpReminder(input({ emailId: 100 }), now, db);
    await insertEmail({
      id: 210, folderID: 11, threadID: "conversation-1",
      date: "2026-10-19T15:00:00.000Z", from: "CAROL@client.com", subject: "Вопрос по договору",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied).toHaveLength(1);
  });

  test("письмо постороннего в цепочке и письмо получателя на другую тему — не ответ", async () => {
    await sentCopy();
    await saveFollowUpReminder(input({ emailId: 100 }), now, db);
    await insertEmail({
      id: 211, folderID: 11, threadID: "conversation-1",
      date: "2026-10-19T15:00:00.000Z", from: "eve@else.com", subject: "Re: Contract draft",
    });
    await insertEmail({
      id: 212, folderID: 11, threadID: "conversation-9",
      date: "2026-10-19T16:00:00.000Z", from: "bob@client.com", subject: "Lunch?",
    });
    // Ответ получателя на тему, но пришедший до отправки
    await insertEmail({
      id: 213, folderID: 11, date: "2026-10-18T16:00:00.000Z", from: "bob@client.com", subject: "Re: Contract draft",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied).toEqual([]);
  });

  test("Exchange заменил Message-ID: копия находится по теме и времени, ответ — по новой цепочке", async () => {
    await saveFollowUpReminder(input({ messageID: "<composer-id@example.com>" }), now, db);
    await insertEmail({
      id: 300, folderID: 22, messageID: "<exchange-id@example.com>", threadID: "AAQk-conv",
      date: new Date(sentAt.getTime() + 20_000), outgoing: 1, from: "bob@client.com", subject: "Contract draft",
    });
    // Ответ в общий ящик: In-Reply-To на настоящий Message-ID
    await insertEmail({
      id: 301, folderID: 21, parentMsgID: "<exchange-id@example.com>", threadID: "AAQk-conv",
      date: "2026-10-19T13:00:00.000Z", from: "dave@client.com", subject: "RE: Contract draft",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied.map(item => [item.messageID, item.emailId, item.folderAccountId]))
      .toEqual([["<exchange-id@example.com>", 300, 2]]);
  });

  test("без ответа — ждёт, отправленная копия найдена по Message-ID", async () => {
    await sentCopy();
    await saveFollowUpReminder(input(), now, db);
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied).toEqual([]);
    expect(result.waiting.map(item => [item.emailId, item.folderId, item.threadID]))
      .toEqual([[100, 12, "conversation-1"]]);
  });

  test("несколько ящиков: ответ снимает только своё напоминание", async () => {
    await sentCopy();
    await sentCopy("<sent-2@example.com>", 22, 101);
    await saveFollowUpReminder(input(), now, db);
    await saveFollowUpReminder(input({ accountId: 2, messageID: "<sent-2@example.com>", subject: "Invoice" }), now, db);
    await insertEmail({
      id: 400, folderID: 21, parentMsgID: "<sent-2@example.com>",
      date: "2026-10-19T13:00:00.000Z", from: "bob@client.com", subject: "Re: Invoice",
    });
    let result = await checkFollowUpReminders(own, now, db);
    expect(result.replied.map(item => item.accountId)).toEqual([2]);
    expect(result.waiting.map(item => item.accountId)).toEqual([1]);
  });
});
