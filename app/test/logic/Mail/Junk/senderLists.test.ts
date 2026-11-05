// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  OWAGetJunkEmailRequest, OWASetJunkEmailRequest, addSenderEntry, applySenderLists, blockSender,
  getLocalSenderLists, getPhishingReportAddress, kPhishingAddressKey, kSenderListsKey, normalizeSenderEntry,
  parseOWAJunkEmailResponse, removeSenderEntry, reportPhishing, sanitizeSenderLists, saveSenderLists,
  senderVerdict, setLocalSenderLists, trustSender,
} from "../../../../logic/Mail/Junk/SenderLists";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { getLocalStorage } from "../../../../frontend/Util/LocalStorage";
import { beforeEach, describe, expect, test, vi } from "vitest";

beforeEach(() => {
  let store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
  getLocalStorage(kSenderListsKey, {}).value = {};
  getLocalStorage(kPhishingAddressKey, "").value = "";
});

describe("Записи списков", () => {
  test("Адреса и домены приводятся к виду Exchange", () => {
    expect(normalizeSenderEntry(" Anna@Example.com ")).toBe("anna@example.com");
    expect(normalizeSenderEntry("@Example.com")).toBe("example.com");
    expect(normalizeSenderEntry("mailto:a@b.ru")).toBe("a@b.ru");
    expect(normalizeSenderEntry("mail.example.co.uk")).toBe("mail.example.co.uk");
    expect(normalizeSenderEntry("не адрес")).toBeNull();
    expect(normalizeSenderEntry("localhost")).toBeNull();
    expect(normalizeSenderEntry("")).toBeNull();
    expect(normalizeSenderEntry(null)).toBeNull();
  });

  test("Очистка: дубли, мусор, сортировка", () => {
    expect(sanitizeSenderLists({ trusted: ["b@x.com", "A@x.com", "a@x.com", 5, "мусор"], blocked: "нет" }))
      .toEqual({ trusted: ["a@x.com", "b@x.com"], blocked: [] });
    expect(sanitizeSenderLists(null)).toEqual({ trusted: [], blocked: [] });
  });

  test("Добавление переносит запись из другого списка, удаление", () => {
    let lists = addSenderEntry({ trusted: [], blocked: ["spam.com"] }, "trusted", "@Spam.com");
    expect(lists).toEqual({ trusted: ["spam.com"], blocked: [] });
    expect(removeSenderEntry(lists, "trusted", "spam.com")).toEqual({ trusted: [], blocked: [] });
    expect(() => addSenderEntry(lists, "blocked", "что-то")).toThrow();
  });

  test("Проверка отправителя: надёжный важнее, домен с поддоменами", () => {
    let lists = { trusted: ["boss@spam.com"], blocked: ["spam.com", "bad@good.com"] };
    expect(senderVerdict(lists, "Boss@Spam.com")).toBe("trusted");
    expect(senderVerdict(lists, "x@spam.com")).toBe("blocked");
    expect(senderVerdict(lists, "x@mail.spam.com")).toBe("blocked");
    expect(senderVerdict(lists, "x@notspam.com")).toBeNull();
    expect(senderVerdict(lists, "bad@good.com")).toBe("blocked");
    expect(senderVerdict(lists, "ok@good.com")).toBeNull();
    expect(senderVerdict(lists, null)).toBeNull();
  });
});

describe("OWA", () => {
  test("Запросы", () => {
    expect(new OWAGetJunkEmailRequest().action).toBe("GetMailboxJunkEmailConfiguration");
    let set = new OWASetJunkEmailRequest({ trusted: ["a@x.com"], blocked: ["spam.com"] });
    expect(set.action).toBe("SetMailboxJunkEmailConfiguration");
    expect(set.Options.TrustedSendersAndDomains).toEqual(["a@x.com"]);
    expect(set.Options.BlockedSendersAndDomains).toEqual(["spam.com"]);
  });

  test("Разбор ответа и ошибки", () => {
    expect(parseOWAJunkEmailResponse({ Options: { TrustedSendersAndDomains: ["A@x.com"], BlockedSendersAndDomains: { String: ["spam.com"] } } }))
      .toEqual({ trusted: ["a@x.com"], blocked: ["spam.com"] });
    expect(parseOWAJunkEmailResponse({ Body: { Options: {} } })).toEqual({ trusted: [], blocked: [] });
    expect(() => parseOWAJunkEmailResponse({ WasSuccessful: false, ErrorMessage: "нет прав" })).toThrow("нет прав");
    expect(() => parseOWAJunkEmailResponse({})).toThrow();
  });

  test("Сохранение уходит на сервер и в локальную копию", async () => {
    let account: any = { id: "owa1", protocol: "owa", callOWA: vi.fn().mockResolvedValue({ WasSuccessful: true }) };
    await saveSenderLists(account, { trusted: [], blocked: ["spam.com"] });
    expect(account.callOWA).toHaveBeenCalledWith(expect.any(OWASetJunkEmailRequest));
    expect(getLocalSenderLists(account)).toEqual({ trusted: [], blocked: ["spam.com"] });
  });
});

function fakeEmail(protocol: string, special: SpecialFolder, from: string, isSpam = false): any {
  let account = { id: protocol + "1", protocol };
  return {
    from: { emailAddress: from },
    isSpam,
    outgoing: false,
    folder: { account, specialFolder: special },
    treatSpam: vi.fn(async function (spam = true) { this.isSpam = spam; }),
  };
}

describe("Локальные списки для входящих", () => {
  test("IMAP: заблокированный — в «Спам», надёжный — из «Спама»", async () => {
    let blocked = fakeEmail("imap", SpecialFolder.Inbox, "x@spam.com");
    setLocalSenderLists(blocked.folder.account, { trusted: ["friend@x.com"], blocked: ["spam.com"] });
    expect(await applySenderLists(blocked)).toBe("blocked");
    expect(blocked.treatSpam).toHaveBeenCalledWith(true);

    let trusted = fakeEmail("imap", SpecialFolder.Spam, "friend@x.com", true);
    expect(await applySenderLists(trusted)).toBe("trusted");
    expect(trusted.treatSpam).toHaveBeenCalledWith(false);

    let other = fakeEmail("imap", SpecialFolder.Inbox, "a@b.com");
    expect(await applySenderLists(other)).toBeNull();
    expect(other.treatSpam).not.toHaveBeenCalled();

    let sentFolder = fakeEmail("imap", SpecialFolder.Sent, "x@spam.com");
    expect(await applySenderLists(sentFolder)).toBeNull();
  });

  test("Exchange сортирует сам", async () => {
    for (let protocol of ["ews", "owa"]) {
      let email = fakeEmail(protocol, SpecialFolder.Inbox, "x@spam.com");
      setLocalSenderLists(email.folder.account, { trusted: [], blocked: ["spam.com"] });
      expect(await applySenderLists(email)).toBeNull();
    }
  });
});

describe("Действия с письмом", () => {
  test("Заблокировать и доверять", async () => {
    let email = fakeEmail("imap", SpecialFolder.Inbox, "Bad@Spam.com");
    await blockSender(email);
    expect(getLocalSenderLists(email.folder.account).blocked).toEqual(["bad@spam.com"]);
    expect(email.treatSpam).toHaveBeenCalledWith(true);

    email.folder.specialFolder = SpecialFolder.Spam;
    await trustSender(email, true);
    expect(getLocalSenderLists(email.folder.account)).toEqual({ trusted: ["spam.com"], blocked: ["bad@spam.com"] });
    expect(email.treatSpam).toHaveBeenLastCalledWith(false);
  });

  test("Фишинг без адреса — понятная ошибка, письмо не трогаем", async () => {
    let email = fakeEmail("imap", SpecialFolder.Inbox, "x@spam.com");
    expect(getPhishingReportAddress()).toBeNull();
    await expect(reportPhishing(email)).rejects.toThrow();
    expect(email.treatSpam).not.toHaveBeenCalled();
    getLocalStorage(kPhishingAddressKey, "").value = "не адрес";
    expect(getPhishingReportAddress()).toBeNull();
    getLocalStorage(kPhishingAddressKey, "").value = " security@example.com ";
    expect(getPhishingReportAddress()).toBe("security@example.com");
  });

  test("Фишинг: пересылка вложением на адрес и перенос в «Спам»", async () => {
    getLocalStorage(kPhishingAddressKey, "").value = "security@example.com";
    let email = fakeEmail("imap", SpecialFolder.Inbox, "x@spam.com");
    email.subject = "Ваш пароль истекает";
    let send = vi.fn();
    let report: any = { to: { add: vi.fn() }, compose: { send }, composeSource: email };
    email.compose = { forwardAsAttachment: vi.fn().mockResolvedValue(report) };
    await reportPhishing(email);
    expect(report.composeSource).toBeNull();
    expect(report.subject).toBe("Phishing: Ваш пароль истекает");
    expect(report.to.add.mock.calls[0][0].emailAddress).toBe("security@example.com");
    expect(send).toHaveBeenCalled();
    expect(email.treatSpam).toHaveBeenCalledWith(true);
  });
});
