// Регрессионные тесты к QA-аудиту почты (октябрь 2026).
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { IMAPAccount } from "../../../logic/Mail/IMAP/IMAPAccount";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import { getTagByName } from "../../../logic/Abstract/Tag";
import type { EMail } from "../../../logic/Mail/EMail";
import { beforeAll, describe, expect, test } from "vitest";

let account: IMAPAccount;

beforeAll(() => {
  let storage = new Map<string, string>();
  globalThis.localStorage ??= {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  } as any;
  appGlobal.remoteApp = {
    createIMAPFlowConnection: () => {
      throw new Error("The test should not talk to a server");
    },
  } as any;
  account = new IMAPAccount();
  account.emailAddress = "me@example.com";
  account.realname = "Me";
  account.contentStorage.clear();
  for (let address of ["me@example.com", "sales@example.com"]) {
    let identity = new MailIdentity(account);
    identity.emailAddress = address;
    identity.realname = "Me";
    account.identities.add(identity);
  }
  for (let special of [SpecialFolder.Inbox, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.name = special;
    folder.specialFolder = special;
    account.rootFolders.add(folder);
  }
  appGlobal.emailAccounts.add(account);
});

function incoming(): EMail {
  let mail = account.getSpecialFolder(SpecialFolder.Inbox).newEMail();
  mail.messageID = "original@example.com";
  mail.subject = "Вопрос";
  mail.sent = new Date("2026-10-01T10:00:00Z");
  mail.html = "<p>Текст</p>";
  mail.loadedBody = true;
  return mail;
}

const addresses = (persons: { contents: PersonUID[] }) =>
  persons.contents.map(person => person.emailAddress.toLowerCase());

describe("Ответить всем", () => {
  test("не дублирует адрес из Reply-To, To и Cc и не добавляет свой", () => {
    let mail = incoming();
    mail.from = new PersonUID("bob@example.com", "Bob");
    mail.replyTo = new PersonUID("list@example.com", "List");
    mail.to.add(new PersonUID("List@Example.com", "Рассылка"));
    mail.to.add(new PersonUID("me@example.com", "Me"));
    mail.cc.add(new PersonUID("carol@example.com", "Carol"));
    mail.cc.add(new PersonUID("CAROL@example.com", "Carol 2"));
    mail.cc.add(new PersonUID("list@example.com", "List"));

    let reply = mail.compose.replyAll();
    expect(addresses(reply.to)).toEqual(["list@example.com"]);
    expect(addresses(reply.cc)).toEqual(["carol@example.com"]);
  });
});

describe("Пересылка", () => {
  test("уходит с алиаса, на который пришло письмо, и сохраняется в «Отправленные»", async () => {
    let mail = incoming();
    mail.from = new PersonUID("bob@example.com", "Bob");
    mail.to.add(new PersonUID("sales@example.com", "Sales"));
    let forward = await mail.compose.forwardInline();
    expect(forward.from.emailAddress).toBe("sales@example.com");
    expect(forward.folder.specialFolder).toBe(SpecialFolder.Sent);
    expect(forward.subject).toBe("Fwd: Вопрос");
  });
});

describe("mailto:", () => {
  test("без адреса, с %40 и с параметрами to/cc/bcc", () => {
    let mail = account.newEMailFrom();
    mail.compose.populateFromMailtoURL("mailto:?subject=Hello&to=a@example.com,b@example.com&bcc=c@example.com");
    expect(addresses(mail.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(addresses(mail.bcc)).toEqual(["c@example.com"]);
    expect(mail.subject).toBe("Hello");

    let encoded = account.newEMailFrom();
    encoded.compose.populateFromMailtoURL("mailto:d%40example.com?cc=e%40example.com");
    expect(addresses(encoded.to)).toEqual(["d@example.com"]);
    expect(addresses(encoded.cc)).toEqual(["e@example.com"]);
  });
});

describe("Правила фильтрации", () => {
  test("теги правила переживают сохранение и перезапуск", () => {
    let action = new FilterRuleAction();
    action.addTags.add(getTagByName("Работа"));
    let json = action.toJSON();
    let restored = new FilterRuleAction();
    restored.fromJSON(JSON.parse(JSON.stringify(json)));
    expect(restored.addTags.contents.map(tag => tag.name)).toEqual(["Работа"]);
  });

  test("старый формат с ключом addTags тоже читается", () => {
    let restored = new FilterRuleAction();
    restored.fromJSON({ ...new FilterRuleAction().toJSON(), tags: undefined, addTags: ["Старое"] });
    expect(restored.addTags.contents.map(tag => tag.name)).toEqual(["Старое"]);
  });
});
