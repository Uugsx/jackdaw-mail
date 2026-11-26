// @vitest-environment happy-dom

import { beforeEach, describe, expect, test, vi } from "vitest";
// app первым: иначе циклический импорт моделей ломает загрузку ComposeActions
import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { LoginError } from "../../../../logic/Abstract/Account";
import { ComposeActions, isMailboxWriteDenied } from "../../../../logic/Mail/ComposeActions";
import { EMail } from "../../../../logic/Mail/EMail";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { notifications } from "../../../../frontend/MainWindow/Notification";

const kURL = "https://cas.example.test/owa/service.svc?action=CreateItem&EP=1";

function owaWith401(): { account: OWAAccount, logout: ReturnType<typeof vi.fn> } {
  appGlobal.remoteApp = {
    OWA: {
      fetchJSON: vi.fn().mockResolvedValue({
        ok: false, status: 401, statusText: "Unauthorized", url: kURL, contentType: "text/html", json: null, text: "",
      }),
    },
  };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).hasLoggedIn = true;
  // Сессия основного ящика жива: тихое восстановление «удаётся»
  (account as any).refreshSessionSilently = vi.fn().mockResolvedValue(true);
  let logout = vi.fn().mockResolvedValue(undefined);
  account.logout = logout as any;
  return { account, logout };
}

describe("OWA: 401 на Explicit Logon общего ящика", () => {
  test("не выходит из основного ящика и сообщает об отказе в доступе к ящику", async () => {
    let { account, logout } = owaWith401();
    let error: any;
    try {
      await account.callOWAShared(kURL, {
        method: "POST",
        headers: {
          "x-owa-explicitlogonuser": "integrators@example.test",
          "x-customowascenariodata": "MailboxAccess:SharedMailbox,ExplicitLogon",
        },
      });
    } catch (ex) {
      error = ex;
    }
    expect(error).toBeInstanceOf(OWAError);
    expect(error.mailboxAccessDenied).toBe(true);
    expect(error.message).toContain("integrators@example.test");
    expect(logout).not.toHaveBeenCalled();
  });

  test("401 своего ящика по-прежнему выходит из сессии и просит войти", async () => {
    let { account, logout } = owaWith401();
    let error: any;
    try {
      await account.callOWAShared(kURL, { method: "POST", headers: {} });
    } catch (ex) {
      error = ex;
    }
    expect(error).toBeInstanceOf(LoginError);
    expect(logout).toHaveBeenCalledOnce();
  });
});

describe("черновик общего ящика", () => {
  beforeEach(() => {
    let store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    notifications.clear();
  });

  function setup(sharedError: Error) {
    let main = new MailAccount();
    main.name = "nikita.galkin@example.test";
    let shared = new MailAccount();
    shared.name = "integrators";
    shared.mainAccount = main;
    let mainDrafts = new Folder(main);
    mainDrafts.specialFolder = SpecialFolder.Drafts;
    let sharedDrafts = new Folder(shared);
    sharedDrafts.specialFolder = SpecialFolder.Drafts;
    vi.spyOn(main, "getSpecialFolder").mockImplementation(type => type == SpecialFolder.Drafts ? mainDrafts : null);
    vi.spyOn(shared, "getSpecialFolder").mockImplementation(type => type == SpecialFolder.Drafts ? sharedDrafts : null);
    sharedDrafts.addMessage = vi.fn().mockRejectedValue(sharedError);
    mainDrafts.addMessage = vi.fn(async (message: EMail) => {
      message.folder = mainDrafts;
    });
    let email = new EMail(new Folder(shared));
    email.html = "<p>ответ</p>";
    // Текст из HTML здесь не проверяем: DOMPurify в happy-dom не работает
    email.regenerateTextFromHTML = () => {};
    return { email, sharedDrafts, mainDrafts };
  }

  test("отказ сервера в записи — черновик в основном ящике и понятное сообщение", async () => {
    let denied = new OWAError({ message: "denied" });
    denied.mailboxAccessDenied = true;
    let { email, sharedDrafts, mainDrafts } = setup(denied);
    await new ComposeActions(email).saveAsDraft();
    expect(sharedDrafts.addMessage).toHaveBeenCalledOnce();
    expect(mainDrafts.addMessage).toHaveBeenCalledOnce();
    expect(email.folder).toBe(mainDrafts);
    expect(notifications.first?.message).toContain("integrators");
  });

  test("сетевая ошибка не уводит черновик в чужой ящик", async () => {
    let { email, mainDrafts } = setup(new Error("net::ERR_INTERNET_DISCONNECTED"));
    await expect(new ComposeActions(email).saveAsDraft()).rejects.toThrow("ERR_INTERNET_DISCONNECTED");
    expect(mainDrafts.addMessage).not.toHaveBeenCalled();
  });

  test("распознаёт отказы в записи", () => {
    expect(isMailboxWriteDenied(new LoginError(null, "Please login"))).toBe(true);
    expect(isMailboxWriteDenied({ type: "ErrorAccessDenied", message: "Access denied" })).toBe(true);
    expect(isMailboxWriteDenied(new Error("HTTP 403 Forbidden"))).toBe(true);
    expect(isMailboxWriteDenied(new Error("Mailbox is full"))).toBe(false);
  });
});
