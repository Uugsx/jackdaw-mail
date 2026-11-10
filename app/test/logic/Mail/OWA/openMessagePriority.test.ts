import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { sleep } from "../../../../logic/util/util";
import { expect, test } from "vitest";

/* 2026-11-10: письмо Exchange без сохранённого текста открывалось пустым,
 * текст появлялся через 3–5 минут — запрос GetItem стоял в общей очереди
 * за запросами синхронизации. */

function mimeBase64(text: string): string {
  return Buffer.from(`Message-ID: <open@example.com>\r\nSubject: s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`).toString("base64");
}

test("Текст открытого письма загружается раньше очереди синхронизации", async () => {
  let calls: string[] = [];
  appGlobal.remoteApp = {
    OWA: {
      fetchJSON: async (_partition: string, url: string) => {
        let action = new URL(url).searchParams.get("action") ?? "";
        calls.push(action);
        await sleep(0.02);
        let item = action == "GetItem"
          ? { ResponseClass: "Success", Items: [{ MimeContent: { Value: mimeBase64("Текст письма") } }] }
          : { ResponseClass: "Success" };
        return { ok: true, status: 200, json: { Body: { ResponseMessages: { Items: [item] } } } };
      },
    },
  } as any;
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.emailAddress = "user@example.com";
  account.url = "https://owa.example.test/owa/";
  (account as any).hasLoggedIn = true;
  let folder = account.newFolder();
  folder.id = "inbox";
  let email = folder.newEMail() as OWAEMail;
  email.pID = "AAMkItem";
  email.id = "open@example.com";

  // Синхронизация поставила в очередь много запросов
  let sync = Array.from({ length: 40 }, () => account.callOWA({ action: "FindItem" }));
  await Promise.resolve();
  let loaded = email.loadBody();
  await loaded;

  let position = calls.indexOf("GetItem");
  expect(position).toBeGreaterThanOrEqual(0);
  // Не больше занятых слотов семафора (8) впереди, а не 40
  expect(position).toBeLessThanOrEqual(9);
  expect(email.text).toContain("Текст письма");
  expect(email.loadedBody).toBe(true);
  await Promise.all(sync);
});
