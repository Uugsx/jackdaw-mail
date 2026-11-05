import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { kIgnoreFailureAfterSuccessMs } from "../../../../logic/Mail/connectionStatus";
import { afterEach, expect, test, vi } from "vitest";

const kURL = "https://owa.example.test/owa/service.svc";

function newAccount(fetchJSON: (...args: any[]) => Promise<any>): OWAAccount {
  appGlobal.remoteApp = { OWA: { fetchJSON } };
  let account = new OWAAccount();
  account.storage = new DummyMailStorage();
  account.name = "Работа";
  (account as any).hasLoggedIn = true;
  // Восстановление сети проверяется отдельно в networkRecovery.test.ts
  account.recoverAfterNetworkRestored = async () => {};
  return account;
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: kURL,
    contentType: "application/json",
    json: { Body: { ResponseClass: "Success", ResponseCode: "NoError" } },
  };
}

async function call(account: OWAAccount): Promise<any> {
  try {
    return await account.callOWAShared(kURL, { method: "POST" });
  } catch (ex) {
    return ex;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

test("недоступный сервер OWA сразу виден у аккаунта, ответ сервера снимает состояние", async () => {
  let fail = true;
  let account = newAccount(async () => {
    if (fail) {
      throw new Error("net::ERR_CONNECTION_REFUSED");
    }
    return okResponse();
  });
  let notified = vi.fn();
  account.subscribe(notified);
  notified.mockClear();

  let error = await call(account);

  expect(error?.message).toBe("net::ERR_CONNECTION_REFUSED");
  expect(account.connectionStatus.problem?.kind).toBe("server-unreachable");
  expect(notified).toHaveBeenCalled();

  fail = false;
  vi.useFakeTimers({ now: Date.now() + kIgnoreFailureAfterSuccessMs });
  await call(account);

  expect(account.connectionStatus.problem).toBeNull();
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("таймаут и DNS OWA классифицируются как сбой связи", async () => {
  let errors = [new Error("This operation was aborted"), new Error("net::ERR_NAME_NOT_RESOLVED")];
  let account = newAccount(async () => {
    throw errors.shift();
  });

  await call(account);
  expect(account.connectionStatus.isConnected).toBe(false);
  let since = account.connectionStatus.problem?.since;

  await call(account);
  expect(account.connectionStatus.problem?.kind).toBe("server-not-found");
  expect(account.connectionStatus.problem?.since).toBe(since);
});

test("HTTP 503 от сервера Exchange — сбой связи", async () => {
  let account = newAccount(async () => ({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    url: kURL,
    contentType: "text/html",
    json: null,
  }));

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("server");
});

test("HTTP 500 с ответом OWA — обычная ошибка, связь есть", async () => {
  let account = newAccount(async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    url: kURL,
    contentType: "application/json",
    json: { ResponseClass: "Error", ResponseCode: "ErrorItemNotFound", MessageText: "Not found" },
  }));

  let error = await call(account);

  expect(error).toBeInstanceOf(Error);
  expect(account.connectionStatus.isConnected).toBe(true);
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("общий ящик показывает состояние связи основного аккаунта", () => {
  appGlobal.remoteApp = { OWA: {} };
  let main = new OWAAccount();
  let shared = new OWAAccount();
  shared.mainAccount = main;

  expect(shared.connectionStatusSource).toBe(main);
  expect(main.connectionStatusSource).toBe(main);
});
