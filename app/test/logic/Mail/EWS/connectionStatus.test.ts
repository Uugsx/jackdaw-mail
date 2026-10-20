// @vitest-environment happy-dom
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { kIgnoreFailureAfterSuccessMs } from "../../../../logic/Mail/connectionStatus";
import { afterEach, expect, test, vi } from "vitest";

const kURL = "https://exchange.example.test/EWS/Exchange.asmx";
const kRequest = { m$GetFolder: { m$FolderIds: { t$DistinguishedFolderId: { Id: "inbox" } } } };
const kSOAPFault = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>
<faultcode>a:ErrorInternalServerError</faultcode><faultstring>Item not found</faultstring>
</s:Fault></s:Body></s:Envelope>`;

function newAccount(fetchImpl: (...args: any[]) => Promise<Response>): EWSAccount {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  let account = new EWSAccount();
  account.name = "Работа";
  account.url = kURL;
  account.username = "user@example.test";
  account.password = "secret";
  account.authMethod = AuthMethod.Password;
  return account;
}

async function call(account: EWSAccount): Promise<any> {
  try {
    return await account.callEWS(kRequest);
  } catch (ex) {
    return ex;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("недоступный сервер EWS виден у аккаунта, ответ сервера снимает состояние", async () => {
  let fail = true;
  let account = newAccount(async () => {
    if (fail) {
      throw Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" });
    }
    return new Response(kSOAPFault, { status: 500, headers: { "Content-Type": "text/xml" } });
  });
  let notified = vi.fn();
  account.subscribe(notified);
  notified.mockClear();

  let error = await call(account);

  expect(error?.message).toBe("fetch failed");
  expect(account.connectionStatus.problem?.kind).toBe("server-unreachable");
  expect(notified).toHaveBeenCalled();

  fail = false;
  vi.useFakeTimers({ now: Date.now() + kIgnoreFailureAfterSuccessMs });
  await call(account);

  expect(account.connectionStatus.problem).toBeNull();
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("HTTP 503 со страницей ошибки вместо SOAP — сбой связи", async () => {
  let account = newAccount(async () =>
    new Response("<html><body>Service Unavailable</body></html>", { status: 503, statusText: "Service Unavailable" }));

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("server");
});

test("HTTP 500 с SOAP-ответом — обычная ошибка, связь есть", async () => {
  let account = newAccount(async () =>
    new Response(kSOAPFault, { status: 500, headers: { "Content-Type": "text/xml" } }));

  let error = await call(account);

  expect(error).toBeInstanceOf(Error);
  expect(account.connectionStatus.isConnected).toBe(true);
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("неверный пароль EWS — не сбой связи", async () => {
  let account = newAccount(async () =>
    new Response("", { status: 401, headers: { "WWW-Authenticate": "Basic realm=\"x\"" } }));

  let error = await call(account);

  expect(error?.message).toMatch(/Password/);
  expect(account.connectionStatus.isConnected).toBe(true);
});

test("общий ящик EWS сообщает о сбое через основной аккаунт", async () => {
  let main = newAccount(async () => {
    throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
  });
  let shared = new EWSAccount();
  shared.mainAccount = main;

  await call(shared);

  expect(main.connectionStatus.problem?.kind).toBe("timeout");
  expect(shared.connectionStatusSource).toBe(main);
});
