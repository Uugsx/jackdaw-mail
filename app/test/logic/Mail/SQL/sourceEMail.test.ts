import { beforeAll, expect, test } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { setupTestFolder, newTestEMail } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import { mimeBelongsToEMail, mimeMessageID, SQLSourceEMail } from "../../../../logic/Mail/SQL/Source/SQLSourceEMail";
import { getDatabase as getSourceDatabase } from "../../../../logic/Mail/SQL/Source/SQLSourceDatabase";
import sql from "../../../../../lib/rs-sqlite";

let folder: Folder;

beforeAll(async () => {
  let tempDir = "";
  ({ folder, tempDir } = await setupTestFolder({
    getConfigDir: async () => tempDir,
    path: { join: async (...parts: string[]) => path.join(...parts) },
    fs: { mkdir: async () => mkdirSync(path.join(tempDir, "backup"), { recursive: true }) },
  }));
});

function mime(messageID: string | null, text: string): Uint8Array {
  let header = messageID ? `Message-ID: ${messageID}\r\n` : "";
  return new TextEncoder().encode(`${header}Subject: test\r\n\r\n${text}\r\n`);
}

test("Message-ID из заголовков MIME, в том числе перенесённый на следующую строку", () => {
  expect(mimeMessageID(mime("<A@x>", "body"))).toBe("a@x");
  expect(mimeMessageID("Subject: s\r\nMessage-ID:\r\n <b@y>\r\n\r\nbody")).toBe("b@y");
  // Message-ID только в теле письма не считается
  expect(mimeMessageID("Subject: s\r\n\r\nMessage-ID: <c@z>")).toBeNull();
});

test("Исходник без Message-ID или письмо без него — сравнить нечем, исходник свой", () => {
  let email = newTestEMail(folder);
  email.id = "<own@x>";
  expect(mimeBelongsToEMail(mime(null, "body"), email)).toBe(true);
  email.id = "";
  expect(mimeBelongsToEMail(mime("<other@x>", "body"), email)).toBe(true);
});

test("Исходник удалённого письма под тем же номером строки не читается и удаляется", async () => {
  let db = await getSourceDatabase();
  let email = newTestEMail(folder);
  email.id = "<own@example.com>";
  email.dbID = 4242;
  await db.run(sql`
    INSERT INTO emailMIME (emailID, messageID, mime)
    VALUES (${4242}, ${"<own@example.com>"}, ${mime("<returns@example.com>", "Возвратные заказы во вложении")})`);
  let storage = new SQLSourceEMail();
  await storage.read(email);
  expect(email.mime ?? null).toBeNull();
  expect(await db.all(sql`SELECT * FROM emailMIME WHERE emailID = ${4242}`)).toEqual([]);

  // Свой исходник читается как раньше
  let own = mime("<own@example.com>", "Свой текст");
  await db.run(sql`INSERT INTO emailMIME (emailID, messageID, mime) VALUES (${4242}, ${"<own@example.com>"}, ${own})`);
  await storage.read(email);
  expect(new TextDecoder().decode(email.mime as Uint8Array)).toContain("Свой текст");
});
