import { describe, expect, test, vi } from "vitest";
import { appGlobal } from "../../../logic/app";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { ComposeActions } from "../../../logic/Mail/ComposeActions";
import { EMail } from "../../../logic/Mail/EMail";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";

function createAccount(emailAddress: string): MailAccount {
  let account = new MailAccount();
  account.emailAddress = emailAddress;
  let identity = new MailIdentity(account);
  identity.emailAddress = emailAddress;
  identity.realname = emailAddress;
  account.identities.add(identity);
  return account;
}

function createReplyRecipient(original: EMail): string {
  let reply = new EMail(original.folder);
  (new ComposeActions(original) as any)._addFromAsRecipient(reply);
  return reply.to.first.emailAddress;
}

describe("адресат ответа", () => {
  test("не считает адрес из другого аккаунта своим отправителем", () => {
    let account = createAccount("team@smartds.test");
    let otherAccount = createAccount("galkynnikita@gmail.com");
    appGlobal.emailAccounts.add(otherAccount);

    let original = new EMail(new Folder(account));
    original.from = new PersonUID("galkynnikita@gmail.com", "G N");
    original.to.add(new PersonUID("team@smartds.test", "Team"));

    try {
      expect(createReplyRecipient(original)).toBe("galkynnikita@gmail.com");
    } finally {
      appGlobal.emailAccounts.remove(otherAccount);
    }
  });

  test("выбирает личность ответа только из аккаунта письма", () => {
    let account = createAccount("team@smartds.test");
    let otherAccount = createAccount("galkynnikita@gmail.com");
    appGlobal.emailAccounts.add(otherAccount);
    let sent = new Folder(account);
    sent.specialFolder = SpecialFolder.Sent;
    account.rootFolders.add(sent);

    let original = new EMail(new Folder(account));
    original.from = new PersonUID("galkynnikita@gmail.com", "G N");
    original.to.add(new PersonUID("team@smartds.test", "Team"));

    try {
      let reply = new ComposeActions(original).newMailFromSameIdentity();
      expect(reply.identity?.account).toBe(account);
      expect(reply.from.emailAddress).toBe("team@smartds.test");
    } finally {
      appGlobal.emailAccounts.remove(otherAccount);
    }
  });

  test("вставляет подпись выбранной личности после формирования цитаты", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
    });
    let account = createAccount("team@smartds.test");
    let sent = new Folder(account);
    sent.specialFolder = SpecialFolder.Sent;
    account.rootFolders.add(sent);
    let identity = account.identities.first!;
    identity.signatureHTML = `<p><span style="font-family: Arial; font-size: 10pt">Подпись</span></p>`;
    let original = new EMail(new Folder(account));
    original.from = new PersonUID("customer@example.test", "Customer");
    original.to.add(identity.asPersonUID());
    original.html = "<p>Original message</p>";

    try {
      let reply = new ComposeActions(original).replyToAuthor();

      expect(reply.rawHTMLDangerous).toContain(`<footer class="signature">`);
      expect(reply.rawHTMLDangerous).toMatch(/font-family:\s*Arial/i);
      expect(reply.rawHTMLDangerous).toMatch(/font-size:\s*10pt/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("для исходящего письма оставляет ответ текущему получателю", () => {
    let account = createAccount("team@smartds.test");
    let original = new EMail(new Folder(account));
    original.from = new PersonUID("team@smartds.test", "Team");
    original.to.add(new PersonUID("customer@example.test", "Customer"));

    expect(createReplyRecipient(original)).toBe("customer@example.test");
  });
});
