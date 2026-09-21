import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAuth } from "../../../../logic/Auth/OWAAuth";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWALoginBackground } from "../../../../logic/Mail/OWA/Login/OWALoginBackground";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { ArrayColl } from "svelte-collections";
import { expect, test, vi } from "vitest";

test("тихое восстановление OWA сохраняет cookies сессии", async () => {
  let clearStorageData = vi.fn();
  appGlobal.remoteApp = { OWA: { clearStorageData } };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let auth = new OWAAuth(account);
  auth.isLoggedIn = true;
  (account as any).oAuth2 = auth;

  await account.logout(true);

  expect(auth.isLoggedIn).toBe(false);
  expect(clearStorageData).not.toHaveBeenCalled();
});

test("считает вход успешным, если OWA выставил cookies перед ошибкой errorfe.aspx", async () => {
  vi.useFakeTimers();
  appGlobal.remoteApp = { OWA: {} };
  let findLoginElements = vi.spyOn(OWALoginBackground, "findLoginElements")
    .mockResolvedValue({
      url: "https://cas.smartds.ru/owa/auth/logon.aspx",
      form: null,
      username: null,
      password: null,
    } as any);
  let submitLoginForm = vi.spyOn(OWALoginBackground, "submitLoginForm")
    .mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      url: "https://cas.smartds.ru/owa/auth/errorfe.aspx",
    } as any);
  let account = new OWAAccount();
  let testLoggedIn = vi.spyOn(account, "testLoggedIn")
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);

  try {
    let loginPromise = (account as any).loginWithPasswordForm();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await loginPromise;
    expect(submitLoginForm).toHaveBeenCalledOnce();
    expect(testLoggedIn).toHaveBeenCalledTimes(2);
  } finally {
    findLoginElements.mockRestore();
    submitLoginForm.mockRestore();
    testLoggedIn.mockRestore();
    vi.useRealTimers();
  }
});

test("помечает потерю сети временной и запускает восстановление OWA", async () => {
  appGlobal.remoteApp = {
    OWA: {
      fetchJSON: async () => {
        throw new Error("net::ERR_INTERNET_DISCONNECTED");
      },
    },
  };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).hasLoggedIn = true;
  let recoveryCount = 0;
  account.recoverAfterNetworkRestored = async () => {
    recoveryCount++;
  };

  let error: any;
  try {
    await account.callOWAShared("https://owa.example.test/service.svc", {
      method: "POST",
    });
  } catch (ex) {
    error = ex;
  }
  await Promise.resolve();

  expect(error?.message).toBe("net::ERR_INTERNET_DISCONNECTED");
  expect(error?.doNotShow).toBe(true);
  expect(recoveryCount).toBe(1);
});

test("помечает timeout сети временной ошибкой", async () => {
  appGlobal.remoteApp = {
    OWA: {
      fetchJSON: async () => {
        throw new Error("net::ERR_TIMED_OUT");
      },
    },
  };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).hasLoggedIn = true;
  let recoveryCount = 0;
  account.recoverAfterNetworkRestored = async () => {
    recoveryCount++;
  };

  let error: any;
  try {
    await account.callOWAShared("https://owa.example.test/service.svc", {
      method: "POST",
    });
  } catch (ex) {
    error = ex;
  }
  await Promise.resolve();

  expect(error?.message).toBe("net::ERR_TIMED_OUT");
  expect(error?.doNotShow).toBe(true);
  expect(recoveryCount).toBe(1);
});

test("refreshMessages не показывает ошибку при timeout GetItem", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  let folder = account.newFolder();
  let message = folder.newEMail();
  message.itemID = "message-1";
  folder.messages.add(message);

  let shownErrors: unknown[] = [];
  account.errorCallback = ex => shownErrors.push(ex);
  account.recoverAfterNetworkRestored = async () => {};
  (account as any).hasLoggedIn = true;
  (account as any).callOWA = async () => {
    throw new Error("net::ERR_TIMED_OUT");
  };

  await expect(folder.refreshMessages([message.itemID!])).resolves.toBeUndefined();
  expect(shownErrors).toEqual([]);
});

test("после восстановления сети синхронизирует Inbox и запускает уведомления", async () => {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  (account as any).hasLoggedIn = true;
  let originalOnline = navigator.onLine;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });

  let folder = account.newFolder();
  folder.id = "inbox";
  folder.name = "Входящие";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  account.folderMap.set(folder.id, folder);
  let syncCount = 0;
  folder.syncRecentArrivals = async () => {
    syncCount++;
    return new ArrayColl();
  };
  let pollingCount = 0;
  let notificationCount = 0;
  let sharedPollingCount = 0;
  (account as any).startPolling = () => pollingCount++;
  (account as any).startNotifications = () => notificationCount++;
  (account as any).pollDependentSharedFolders = async () =>
    sharedPollingCount++;

  try {
    await account.recoverAfterNetworkRestored();
  } finally {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalOnline,
    });
  }

  expect(syncCount).toBe(1);
  expect(pollingCount).toBe(1);
  expect(notificationCount).toBe(1);
  expect(sharedPollingCount).toBe(1);
});
