// @vitest-environment happy-dom
// Регрессионные тесты к аудиту редактора писем (октябрь 2026).
import { describe, expect, test } from "vitest";
import "../../../logic/app"; // до ComposeActions, из-за циклических импортов
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { ComposeActions } from "../../../logic/Mail/ComposeActions";
import { EMail } from "../../../logic/Mail/EMail";
import { Folder } from "../../../logic/Mail/Folder";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { addIdentityDefaultRecipients, mentionsAttachment } from "../../../logic/Mail/composeRecipients";
import { resolveComposeRecipients } from "../../../logic/Mail/composeResolveRecipients";
import { splitComposeQuote } from "../../../frontend/Mail/Composer/composeQuote";
import { ArrayColl } from "svelte-collections";

if (typeof globalThis.localStorage?.getItem != "function") {
  let storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  };
}

function newMail(): EMail {
  return new EMail(new Folder(new MailAccount()));
}

describe("Автоматическая копия отправителя", () => {
  test("добавляет Cc и Bcc без повторов и без учёта регистра", () => {
    let mail = newMail();
    mail.to.add(new PersonUID("client@example.com", "Client"));
    mail.cc.add(new PersonUID("Team@Example.com", "Team"));
    addIdentityDefaultRecipients(mail, {
      sendCC: new ArrayColl(["team@example.com", "lead@example.com"]),
      sendBCC: new ArrayColl(["archive@example.com", "client@example.com", "not an address"]),
    });
    expect(mail.cc.contents.map(p => p.emailAddress.toLowerCase())).toEqual(["team@example.com", "lead@example.com"]);
    expect(mail.bcc.contents.map(p => p.emailAddress)).toEqual(["archive@example.com"]);
  });
});

describe("Напоминание о забытом вложении", () => {
  test("находит упоминания вложения", () => {
    expect(mentionsAttachment("Отчёт во вложении")).toBe(true);
    expect(mentionsAttachment("Прикрепляю файл")).toBe(true);
    expect(mentionsAttachment("Please see the attached file")).toBe(true);
    expect(mentionsAttachment("Обновите приложение до последней версии")).toBe(false);
    expect(mentionsAttachment("")).toBe(false);
  });
});

describe("Проверка имён", () => {
  test("не подменяет правильно набранный адрес похожим контактом", async () => {
    let mail = newMail();
    let person = new PersonUID("ivanov@example.com");
    person.nameIsUnknown = true;
    mail.to.add(person);
    await resolveComposeRecipients(mail, async () => [new PersonUID("a.ivanov@example.com", "A. Ivanov")]);
    expect(mail.to.first.emailAddress).toBe("ivanov@example.com");
  });

  test("подставляет имя для точно совпадающего адреса", async () => {
    let mail = newMail();
    let person = new PersonUID("ivanov@example.com");
    person.nameIsUnknown = true;
    mail.to.add(person);
    await resolveComposeRecipients(mail, async () => [new PersonUID("Ivanov@example.com", "Иван Иванов")]);
    expect(mail.to.first.name).toBe("Иван Иванов");
  });
});

describe("Место подписи", () => {
  test("цитата режется по самому раннему маркеру", () => {
    let html = `<p>Ответ</p><blockquote cite="mid:1"><p class="quote-header">X wrote:</p><p>old</p></blockquote>`;
    expect(splitComposeQuote(html).editable).toBe("<p>Ответ</p>");
  });

  test("пересылка письма с цитатой режется по заголовку пересылки", () => {
    let html = `<p></p><hr /><p class="forward-header">From: A</p><p>Text</p><blockquote>history</blockquote>`;
    expect(splitComposeQuote(html).editable).toBe("<p></p>");
  });

  test("в новом письме перед подписью есть пустой абзац", () => {
    let mail = newMail();
    let html = new ComposeActions(mail).applySignatureHTML("", "<p>С уважением</p>");
    expect(html.startsWith("<p></p><footer")).toBe(true);
  });

  test("при пересылке подпись встаёт перед пересылаемым письмом", () => {
    let mail = newMail();
    let body = `<p></p><hr /><p class="forward-header">From: A</p><p>Text</p><footer>их подпись</footer>`;
    let html = new ComposeActions(mail).applySignatureHTML(body, "<p>Моя подпись</p>");
    expect(html.indexOf("Моя подпись")).toBeLessThan(html.indexOf("forward-header"));
    expect(html).toContain("их подпись");
  });
});
