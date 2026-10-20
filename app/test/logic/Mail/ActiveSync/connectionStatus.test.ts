import "../../../../logic/app";
import { ActiveSyncAccount } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import { kIgnoreFailureAfterSuccessMs } from "../../../../logic/Mail/connectionStatus";
import { afterEach, expect, test, vi } from "vitest";

const kWBXML = "application/vnd.ms-sync.wbxml";

function newAccount(fetchImpl: (...args: any[]) => Promise<Response>): ActiveSyncAccount {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  let account = new ActiveSyncAccount();
  account.name = "Работа";
  account.url = "https://eas.example.test/Microsoft-Server-ActiveSync";
  account.username = "user@example.test";
  account.emailAddress = "user@example.test";
  account.password = "secret";
  return account;
}

async function call(account: ActiveSyncAccount): Promise<any> {
  try {
    return await account.callEAS("FolderSync", { SyncKey: "0" });
  } catch (ex) {
    return ex;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("недоступный сервер ActiveSync виден у аккаунта, ответ сервера снимает состояние", async () => {
  let fail = true;
  let account = newAccount(async () => {
    if (fail) {
      throw Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
    }
    // Пустой ответ — «изменений нет»
    return new Response(new Uint8Array(), { status: 200, headers: { "Content-Type": kWBXML } });
  });

  await call(account);
  expect(account.connectionStatus.problem?.kind).toBe("server-not-found");

  fail = false;
  vi.useFakeTimers({ now: Date.now() + kIgnoreFailureAfterSuccessMs });
  let result = await call(account);

  expect(result).toBeNull();
  expect(account.connectionStatus.problem).toBeNull();
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("таймаут ActiveSync — сбой связи", async () => {
  let account = newAccount(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("timeout");
});

test("HTTP 502 от прокси перед ActiveSync — сбой связи", async () => {
  let account = newAccount(async () => new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }));

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("server");
});

test("неверный пароль ActiveSync — не сбой связи", async () => {
  let account = newAccount(async () =>
    new Response(null, { status: 401, headers: { "WWW-Authenticate": "Basic realm=\"x\"" } }));

  let error = await call(account);

  expect(error?.message).toMatch(/Password/);
  expect(account.connectionStatus.isConnected).toBe(true);
});
