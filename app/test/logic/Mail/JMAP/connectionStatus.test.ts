import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { AuthMethod, ConnectError } from "../../../../logic/Abstract/Account";
import { kIgnoreFailureAfterSuccessMs } from "../../../../logic/Mail/connectionStatus";
import { afterEach, expect, test, vi } from "vitest";

const kURL = "https://jmap.example.test/.well-known/jmap";

/** Ошибка `HTTPFetchError` из backend.ts, как она приходит через JPC */
function httpFetchError(status: number, statusText: string): Error {
  let ex = new Error(`HTTP GET <${kURL}> failed with ${status} ${statusText}`);
  ex.name = "HTTPError";
  Object.assign(ex, { httpCode: status, httpStatusText: statusText });
  return ex;
}

function newAccount(get: (url: string) => Promise<any>): JMAPAccount {
  appGlobal.remoteApp = { kyCreate: () => ({ get, post: get }) };
  let account = new JMAPAccount();
  account.name = "Почта";
  account.username = "user@example.test";
  account.password = "secret";
  account.authMethod = AuthMethod.Password;
  return account;
}

async function call(account: JMAPAccount): Promise<any> {
  try {
    return await account.httpGet(kURL);
  } catch (ex) {
    return ex;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

test("недоступный сервер JMAP виден у аккаунта, ответ сервера снимает состояние", async () => {
  let fail = true;
  let account = newAccount(async () => {
    if (fail) {
      throw Object.assign(new Error("HTTP host jmap.example.test connection refused"), { code: "ECONNREFUSED" });
    }
    return { ok: true };
  });

  await call(account);
  expect(account.connectionStatus.problem?.kind).toBe("server-unreachable");

  fail = false;
  vi.useFakeTimers({ now: Date.now() + kIgnoreFailureAfterSuccessMs });
  expect(await call(account)).toEqual({ ok: true });

  expect(account.connectionStatus.problem).toBeNull();
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("таймаут ky у JMAP — сбой связи", async () => {
  let account = newAccount(async () => {
    throw Object.assign(new Error("Request timed out"), { name: "TimeoutError" });
  });

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("timeout");
});

test("HTTP 503 от сервера JMAP — сбой связи", async () => {
  let account = newAccount(async () => {
    throw httpFetchError(503, "Service Unavailable");
  });

  let error = await call(account);

  expect(error).toBeInstanceOf(ConnectError);
  expect(account.connectionStatus.problem?.kind).toBe("server");
});

test("HTTP 401 и 404 от сервера JMAP — сервер отвечает, связь есть", async () => {
  for (let [status, text] of [[401, "Unauthorized"], [404, "Not Found"]] as const) {
    let account = newAccount(async () => {
      throw httpFetchError(status, text);
    });

    await call(account);

    expect(account.connectionStatus.isConnected).toBe(true);
    expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
  }
});
