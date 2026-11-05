// @vitest-environment happy-dom

import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test, vi } from "vitest";

/** Аккаунт, у которого вход и сам startup ничего не делают с сетью */
function newAccount() {
  appGlobal.remoteApp = { createIMAPFlowConnection: async () => ({}) };
  let account = new IMAPAccount();
  account.storage = new DummyMailStorage();
  account.log = () => {};
  let runs = 0;
  (account as any).startupOnce = vi.fn(async () => {
    runs++;
  });
  (account as any).connection = vi.fn(async () => ({}));
  (account.storage as any).readFolderHierarchy = vi.fn(async () => {});
  account.dbID = 1;
  return { account, runs: () => runs };
}

test("IMAP: startup() сразу после login() не выполняется второй раз", async () => {
  let { account, runs } = newAccount();
  await account.login(false);
  // Так делают запуск приложения и проверка после сна
  await account.startup();
  expect(runs()).toBe(1);
});

test("IMAP: новый вход снова выполняет startup", async () => {
  let { account, runs } = newAccount();
  await account.login(false);
  await account.login(false);
  expect(runs()).toBe(2);
});

test("IMAP: после ошибки startup его можно повторить", async () => {
  let { account } = newAccount();
  let attempts = 0;
  (account as any).startupOnce = vi.fn(async () => {
    attempts++;
    if (attempts == 1) {
      throw new Error("LIST failed");
    }
  });
  await expect(account.login(false)).rejects.toThrow("LIST failed");
  await account.startup();
  expect(attempts).toBe(2);
});

test("IMAP: основное соединение не вернулось быстро — повтор в фоне, пока не выйдем", async () => {
  vi.useFakeTimers();
  try {
    let { account } = newAccount();
    let reconnect = vi.fn(async () => {
      throw Object.assign(new Error("offline"), { code: "ENOTFOUND" });
    });
    (account as any).reconnect = reconnect;
    (account as any).reconnectMainInBackground({});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconnect).toHaveBeenCalledTimes(2);

    await account.logout(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reconnect).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("IMAP: при неверном пароле фоновый повтор останавливается", async () => {
  vi.useFakeTimers();
  try {
    let { account } = newAccount();
    let errors: Error[] = [];
    account.errorCallback = ex => errors.push(ex);
    let reconnect = vi.fn(async () => {
      throw Object.assign(new Error("auth"), { authFail: true });
    });
    (account as any).reconnect = reconnect;
    (account as any).reconnectMainInBackground({});
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
