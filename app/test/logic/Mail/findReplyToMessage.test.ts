import "../../../logic/app";
import { findReplyToMessage } from "../../../logic/Mail/findReplyToMessage";
import { SQLEMail } from "../../../logic/Mail/SQL/SQLEMail";
import type { Folder } from "../../../logic/Mail/Folder";
import { newTestEMail, setupTestFolder } from "./SQL/setup";
import { expect, test } from "vitest";

async function setupFolder(): Promise<Folder> {
  let { folder } = await setupTestFolder();
  folder.account.rootFolders.add(folder);
  return folder;
}

test("находит локальный ответ по In-Reply-To", async () => {
  let folder = await setupFolder();
  let original = newTestEMail(folder, "orig@example.com");
  original.isReplied = true;
  await SQLEMail.save(original);

  let reply = newTestEMail(folder, "reply@example.com");
  reply.inReplyTo = original.messageID;
  reply.outgoing = true;
  reply.sent = new Date("2026-07-14T11:00:00Z");
  await SQLEMail.save(reply);

  folder.messages.add(original);
  folder.messages.add(reply);

  expect(await findReplyToMessage(original)).toBe(reply);
});

test("не показывает ответ, если письмо не помечено как отвеченное", async () => {
  let folder = await setupFolder();
  let original = newTestEMail(folder, "orig2@example.com");
  await SQLEMail.save(original);

  let reply = newTestEMail(folder, "reply2@example.com");
  reply.inReplyTo = original.messageID;
  reply.outgoing = true;
  await SQLEMail.save(reply);
  folder.messages.add(original);
  folder.messages.add(reply);

  expect(await findReplyToMessage(original)).toBeUndefined();
});

test("не находит удалённый или несинхронизированный ответ", async () => {
  let folder = await setupFolder();
  let original = newTestEMail(folder, "orig3@example.com");
  original.isReplied = true;
  await SQLEMail.save(original);
  folder.messages.add(original);

  expect(await findReplyToMessage(original)).toBeUndefined();
});

test("выбирает самый поздний ответ", async () => {
  let folder = await setupFolder();
  let original = newTestEMail(folder, "orig4@example.com");
  original.isReplied = true;
  await SQLEMail.save(original);

  let older = newTestEMail(folder, "reply-old@example.com");
  older.inReplyTo = original.messageID;
  older.outgoing = true;
  older.sent = new Date("2026-07-14T11:00:00Z");
  await SQLEMail.save(older);

  let newer = newTestEMail(folder, "reply-new@example.com");
  newer.inReplyTo = original.messageID;
  newer.outgoing = true;
  newer.sent = new Date("2026-07-14T12:00:00Z");
  await SQLEMail.save(newer);

  folder.messages.add(original);
  folder.messages.add(older);
  folder.messages.add(newer);

  expect(await findReplyToMessage(original)).toBe(newer);
});

test("игнорирует более поздний чужой ответ в цепочке", async () => {
  let folder = await setupFolder();
  let original = newTestEMail(folder, "orig5@example.com");
  original.isReplied = true;
  await SQLEMail.save(original);

  let mine = newTestEMail(folder, "reply-mine@example.com");
  mine.inReplyTo = original.messageID;
  mine.outgoing = true;
  mine.sent = new Date("2026-07-14T09:48:00Z");
  await SQLEMail.save(mine);

  let foreign = newTestEMail(folder, "reply-foreign@example.com");
  foreign.inReplyTo = original.messageID;
  foreign.outgoing = false;
  foreign.sent = new Date("2026-07-14T10:03:00Z");
  await SQLEMail.save(foreign);

  folder.messages.add(original);
  folder.messages.add(mine);
  folder.messages.add(foreign);

  expect(await findReplyToMessage(original)).toBe(mine);
});
