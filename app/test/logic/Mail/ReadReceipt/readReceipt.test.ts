// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { IMAPEMail } from "../../../../logic/Mail/IMAP/IMAPEMail";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { parseNotificationAddresses } from "../../../../logic/Mail/ReadReceipt/notificationAddress";
import {
  buildReadReceiptMIME, declineReadReceipt, getReadReceiptRequest, isReadReceiptHandledLocally,
  normalizeReadReceiptPolicy, readReceiptSender, sendReadReceipt,
} from "../../../../logic/Mail/ReadReceipt/ReadReceipt";
import { SendAsDeniedError, isSendAsDeniedError, rethrowSendAsDenied } from "../../../../logic/Mail/SendAs/SendAsError";
import { addDelegateIdentity, canSendFromOtherAddress, checkOtherFromAddress } from "../../../../logic/Mail/SendAs/SendAs";
import PostalMIME from "postal-mime";
import { ArrayColl } from "svelte-collections";
import { beforeEach, describe, expect, test, vi } from "vitest";

function memoryStorage(): Storage {
  let data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

function ewsAccount(): { account: EWSAccount, requests: any[] } {
  let account = new EWSAccount();
  account.id = "ews-1";
  account.emailAddress = "me@example.com";
  account.realname = "Я";
  let identity = new MailIdentity(account);
  identity.emailAddress = "me@example.com";
  identity.realname = "Я";
  account.identities.add(identity);
  let requests: any[] = [];
  account.callEWS = vi.fn(async (request: any) => {
    requests.push(request);
    return {};
  }) as any;
  return { account, requests };
}

function incoming(account: EWSAccount | OWAAccount, specialFolder = SpecialFolder.Inbox) {
  let folder = account.newFolder() as EWSFolder;
  folder.id = "inbox";
  folder.specialFolder = specialFolder;
  let mail = folder.newEMail() as EWSEMail;
  mail.itemID = "item-1";
  mail.id = "orig-1@example.org";
  mail.subject = "Отчёт за квартал";
  mail.sent = new Date("2026-10-20T08:00:00Z");
  mail.from = new PersonUID("anna@example.org", "Анна");
  mail.to.add(new PersonUID("me@example.com", "Я"));
  mail.readReceiptTo = new PersonUID("anna@example.org", "Анна");
  return mail;
}

function requestXML(request: any): Document {
  return new DOMParser().parseFromString(new EWSAccount().request2XML(request), "text/xml");
}

describe("Disposition-Notification-To", () => {
  test("имя в кавычках с запятой, угловые скобки и голый адрес", () => {
    let list = parseNotificationAddresses(`"Петрова, Анна" <anna@example.org>, bob@example.org`);
    expect(list.map(p => p.emailAddress)).toEqual(["anna@example.org", "bob@example.org"]);
    expect(list[0].name).toBe("Петрова, Анна");
    expect(parseNotificationAddresses("<x@example.org>")[0].emailAddress).toBe("x@example.org");
    expect(parseNotificationAddresses("не адрес")).toEqual([]);
    expect(parseNotificationAddresses(null)).toEqual([]);
  });

  test("разбор MIME сохраняет адрес запроса и Sender «от имени»", async () => {
    let { account } = ewsAccount();
    let mail = incoming(account);
    mail.readReceiptTo = null;
    mail.from = null;
    mail.mime = new TextEncoder().encode([
      "From: Boss <boss@example.org>",
      "Sender: Helper <helper@example.org>",
      "To: me@example.com",
      "Subject: hi",
      "Disposition-Notification-To: Boss <boss@example.org>",
      "Message-ID: <m1@example.org>",
      "",
      "text",
      "",
    ].join("\r\n"));
    await mail.parseMIME();
    expect(mail.readReceiptTo?.emailAddress).toBe("boss@example.org");
    expect(mail.sender?.emailAddress).toBe("helper@example.org");
  });

  test("Sender совпадает с From — не «от имени»", async () => {
    let { account } = ewsAccount();
    let mail = incoming(account);
    mail.from = null;
    mail.readReceiptTo = null;
    mail.mime = new TextEncoder().encode("From: a@example.org\r\nSender: A@example.org\r\nSubject: x\r\n\r\nt\r\n");
    await mail.parseMIME();
    expect(mail.sender).toBeNull();
    expect(mail.readReceiptTo).toBeNull();
  });
});

describe("когда спрашивать", () => {
  test("обычный запрос от отправителя", () => {
    let { account } = ewsAccount();
    let request = getReadReceiptRequest(incoming(account));
    expect(request?.to.emailAddress).toBe("anna@example.org");
    expect(request?.suspicious).toBe(false);
  });

  test("на чужой адрес — подозрительный", () => {
    let { account } = ewsAccount();
    let mail = incoming(account);
    mail.readReceiptTo = new PersonUID("tracker@spam.example", null);
    expect(getReadReceiptRequest(mail)?.suspicious).toBe(true);
  });

  test("не спрашиваем: своё, черновик, спам, отправленные, свой адрес, уже ответили", () => {
    let { account } = ewsAccount();
    let outgoing = incoming(account);
    outgoing.outgoing = true;
    expect(getReadReceiptRequest(outgoing)).toBeNull();
    let draft = incoming(account);
    draft.isDraft = true;
    expect(getReadReceiptRequest(draft)).toBeNull();
    expect(getReadReceiptRequest(incoming(account, SpecialFolder.Spam))).toBeNull();
    expect(getReadReceiptRequest(incoming(account, SpecialFolder.Sent))).toBeNull();
    let self = incoming(account);
    self.readReceiptTo = new PersonUID("ME@example.com", null);
    expect(getReadReceiptRequest(self)).toBeNull();
    let handled = incoming(account);
    handled.readReceiptHandled = true;
    expect(getReadReceiptRequest(handled)).toBeNull();
    let none = incoming(account);
    none.readReceiptTo = null;
    expect(getReadReceiptRequest(none)).toBeNull();
  });

  test("настройка: неизвестное значение — «спрашивать»", () => {
    expect(normalizeReadReceiptPolicy("always")).toBe("always");
    expect(normalizeReadReceiptPolicy("never")).toBe("never");
    expect(normalizeReadReceiptPolicy("yes")).toBe("ask");
    expect(normalizeReadReceiptPolicy(undefined)).toBe("ask");
  });
});

describe("MDN по RFC 8098", () => {
  const now = new Date("2026-10-24T10:00:00Z");

  test("только ASCII, разбирается как multipart/report", async () => {
    let { account } = ewsAccount();
    let original = incoming(account);
    let raw = buildReadReceiptMIME({
      original, from: new PersonUID("me@example.com", "Иван Петров"), to: original.readReceiptTo,
      mode: "manual", now, boundary: "b1", messageID: "<mdn-1@example.com>",
    });
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(raw)).toBe(true);
    expect(() => btoa(raw)).not.toThrow();
    expect(raw).toContain(`Content-Type: multipart/report; report-type=disposition-notification; boundary="b1"`);
    expect(raw).toContain("Original-Message-ID: <orig-1@example.org>");
    expect(raw).toContain("Final-Recipient: rfc822;me@example.com");
    expect(raw).toContain("Disposition: manual-action/MDN-sent-manually; displayed");
    expect(raw).toContain("Date: Sat, 24 Oct 2026 10:00:00 +0000");
    expect(raw).not.toContain("Auto-Submitted");
    let parsed = await new PostalMIME().parse(raw);
    expect(parsed.subject).toBe("Read: Отчёт за квартал");
    expect(parsed.from.name).toBe("Иван Петров");
    expect(parsed.to[0].address).toBe("anna@example.org");
    expect(parsed.text).toContain("Отчёт за квартал");
  });

  test("автоматическая отправка помечена как автоответ", () => {
    let { account } = ewsAccount();
    let original = incoming(account);
    let raw = buildReadReceiptMIME({ original, from: new PersonUID("me@example.com", null), to: original.readReceiptTo, mode: "automatic", now });
    expect(raw).toContain("Disposition: automatic-action/MDN-sent-automatically; displayed");
    expect(raw).toContain("Auto-Submitted: auto-replied");
  });

  test("отправитель — мой адрес, на который пришло письмо, но не чужой ящик", () => {
    let { account } = ewsAccount();
    let alias = new MailIdentity(account);
    alias.emailAddress = "sales@example.com";
    account.identities.add(alias);
    let delegate = new MailIdentity(account);
    delegate.emailAddress = "boss@example.com";
    delegate.isDelegate = true;
    account.identities.add(delegate);
    let mail = incoming(account);
    mail.to.replaceAll([new PersonUID("boss@example.com", null), new PersonUID("sales@example.com", null)]);
    expect(readReceiptSender(mail, account).emailAddress).toBe("sales@example.com");
    mail.to.replaceAll([new PersonUID("boss@example.com", null)]);
    expect(readReceiptSender(mail, account).emailAddress).toBe("me@example.com");
  });
});

describe("EWS", () => {
  test("«Отправить»: SendOnly с MimeContent, затем SuppressReadReceipt; второй раз не спрашиваем", async () => {
    let { account, requests } = ewsAccount();
    let mail = incoming(account);
    account.getSpecialFolder = () => mail.folder as any;
    await sendReadReceipt(mail, getReadReceiptRequest(mail), "manual");
    expect(requests).toHaveLength(2);
    let send = requestXML(requests[0]);
    expect(send.getElementsByTagName("m:CreateItem")[0].getAttribute("MessageDisposition")).toBe("SendOnly");
    expect(send.getElementsByTagName("m:SavedItemFolderId")).toHaveLength(0);
    let mime = atob(send.getElementsByTagName("t:MimeContent")[0].textContent);
    expect(mime).toContain("report-type=disposition-notification");
    let suppress = requestXML(requests[1]);
    let reference = suppress.getElementsByTagName("t:SuppressReadReceipt")[0].getElementsByTagName("t:ReferenceItemId")[0];
    expect(reference.getAttribute("Id")).toBe("item-1");
    expect(mail.readReceiptHandled).toBe(true);
    expect(isReadReceiptHandledLocally(mail)).toBe(true);
    let again = incoming(account);
    expect(getReadReceiptRequest(again)).toBeNull();
  });

  test("«Не отправлять»: только SuppressReadReceipt", async () => {
    let { account, requests } = ewsAccount();
    let mail = incoming(account);
    await declineReadReceipt(mail);
    expect(requests).toHaveLength(1);
    expect(requestXML(requests[0]).getElementsByTagName("t:SuppressReadReceipt")).toHaveLength(1);
    expect(getReadReceiptRequest(mail)).toBeNull();
  });

  test("нет прав «Отправить как» — понятная ошибка с адресом", async () => {
    let { account } = ewsAccount();
    account.callEWS = vi.fn(async () => {
      throw Object.assign(new Error("The user account which was used to submit this request does not have the right to send mail on behalf of the specified sending account."), { type: "ErrorSendAsDenied" });
    }) as any;
    let folder = account.newFolder() as EWSFolder;
    folder.id = "sent";
    let mail = folder.newEMail();
    mail.subject = "x";
    mail.text = "x";
    mail.from = new PersonUID("boss@example.com", "Босс");
    mail.to.add(new PersonUID("anna@example.org", null));
    let error = await account.send(mail).catch(ex => ex);
    expect(error).toBeInstanceOf(SendAsDeniedError);
    expect(error.message).toContain("boss@example.com");
    expect(isSendAsDeniedError(error)).toBe(true);
  });
});

describe("OWA", () => {
  test("отказ — SuppressReadReceipt с ItemId", async () => {
    (appGlobal as any).remoteApp ??= {};
    (appGlobal as any).remoteApp.OWA ??= {};
    let account = new OWAAccount();
    account.emailAddress = "me@example.com";
    let requests: any[] = [];
    account.callOWA = vi.fn(async (request: any) => {
      requests.push(request);
      return {};
    }) as any;
    let mail = incoming(account) as unknown as OWAEMail;
    await account.suppressReadReceipt(mail);
    expect(requests[0].Body.MessageDisposition).toBe("SendOnly");
    expect(requests[0].Body.Items[0]).toEqual({
      __type: "SuppressReadReceipt:#Exchange",
      ReferenceItemId: { __type: "ItemId:#Exchange", Id: "item-1" },
    });
  });
});

describe("IMAP $MDNSent", () => {
  test("флаг с сервера и обратно", () => {
    let mail = Object.create(IMAPEMail.prototype) as IMAPEMail;
    Object.assign(mail, { _observers: [], flagsChanging: false, tags: Object.assign([], { add() {} }), readReceiptHandled: false });
    mail.setFlagsLocal(new Set(["\\Seen", "$MDNSent"]));
    expect(mail.readReceiptHandled).toBe(true);
    expect(IMAPEMail.getIMAPFlags(mail)).toContain("$MDNSent");
  });
});

describe("Отправить как / от имени", () => {
  test("ошибки серверов распознаются", () => {
    expect(isSendAsDeniedError({ message: "554 5.2.0 STOREDRV.Submission.Exception:SendAsDeniedException.MapiExceptionSendAsDenied" })).toBe(true);
    expect(isSendAsDeniedError({ message: "550 5.7.60 SMTP; Client does not have permissions to send as this sender" })).toBe(true);
    expect(isSendAsDeniedError({ type: "ErrorSendAsDenied" })).toBe(true);
    expect(isSendAsDeniedError({ message: "Mailbox is full" })).toBe(false);
    expect(isSendAsDeniedError(null)).toBe(false);
    let other = new Error("quota");
    expect(() => rethrowSendAsDenied(other, "a@b.c")).toThrow(other);
  });

  test("чужой ящик — не мой адрес, но остаётся отправителем после перезапуска", async () => {
    let { account } = ewsAccount();
    account.save = vi.fn(async () => {}) as any;
    expect(canSendFromOtherAddress(account)).toBe(true);
    expect(checkOtherFromAddress(" mailto:Boss@Example.com ", account)).toBe("boss@example.com");
    expect(checkOtherFromAddress("me@example.com", account)).toBe("own");
    expect(checkOtherFromAddress("*@example.com", account)).toBe("invalid");
    expect(checkOtherFromAddress("boss", account)).toBe("invalid");
    let identity = await addDelegateIdentity(account, "boss@example.com");
    expect(identity.isDelegate).toBe(true);
    expect(account.save).toHaveBeenCalledTimes(1);
    expect(await addDelegateIdentity(account, "BOSS@example.com")).toBe(identity);
    expect(account.isMyEMailAddress("boss@example.com")).toBe(false);
    expect(account.findIdentityForEMailAddress("boss@example.com")).toBeNull();
    let restored = MailIdentity.fromConfigJSON(identity.toConfigJSON(), account);
    expect(restored.isDelegate).toBe(true);
    let own = MailIdentity.fromConfigJSON(account.identities.first.toConfigJSON(), account);
    expect(own.isDelegate).toBe(false);
    expect(account.identities.first.toConfigJSON()).not.toHaveProperty("isDelegate", false);
  });

  test("ответ на письмо, где чужой ящик в получателях, — от своего имени", () => {
    let { account } = ewsAccount();
    let delegate = new MailIdentity(account);
    delegate.emailAddress = "boss@example.com";
    delegate.isDelegate = true;
    account.identities.add(delegate);
    let found = MailIdentity.findIdentity(new ArrayColl([new PersonUID("boss@example.com", null)]), account);
    expect(found.identity.emailAddress).toBe("me@example.com");
  });
});
