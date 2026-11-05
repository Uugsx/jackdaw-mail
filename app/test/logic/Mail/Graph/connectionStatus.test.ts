import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { kIgnoreFailureAfterSuccessMs } from "../../../../logic/Mail/connectionStatus";
import { afterEach, expect, test, vi } from "vitest";

const kURL = "https://graph.microsoft.com/v1.0/me/mailFolders";

function httpError(status: number, statusText: string, body?: any): Error {
  let ex = new Error(`HTTP GET <${kURL}> failed with ${status} ${statusText}`);
  ex.name = "HTTPError";
  Object.assign(ex, {
    httpCode: status,
    httpStatusText: statusText,
    response: body ? { json: async () => body } : undefined,
  });
  return ex;
}

function newAccount(get: (url: string) => Promise<any>): GraphAccount {
  appGlobal.remoteApp = { kyCreate: () => ({ get }) };
  let account = new GraphAccount();
  account.name = "Outlook";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer test" } as any;
  return account;
}

async function call(account: GraphAccount): Promise<any> {
  try {
    return await account.httpCall(kURL);
  } catch (ex) {
    return ex;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

test("недоступный Microsoft Graph виден у аккаунта, ответ сервера снимает состояние", async () => {
  let fail = true;
  let account = newAccount(async () => {
    if (fail) {
      throw Object.assign(new Error("HTTP host graph.microsoft.com not found"), { code: "ENOTFOUND" });
    }
    return { value: [] };
  });

  await call(account);
  expect(account.connectionStatus.problem?.kind).toBe("server-not-found");

  fail = false;
  vi.useFakeTimers({ now: Date.now() + kIgnoreFailureAfterSuccessMs });
  expect(await call(account)).toEqual({ value: [] });

  expect(account.connectionStatus.problem).toBeNull();
});

test("HTTP 504 от Microsoft Graph — сбой связи", async () => {
  let account = newAccount(async () => {
    throw httpError(504, "Gateway Timeout");
  });

  await call(account);

  expect(account.connectionStatus.problem?.kind).toBe("timeout");
});

test("HTTP 500 с ответом Graph — ошибка запроса, связь есть", async () => {
  let account = newAccount(async () => {
    throw httpError(500, "Internal Server Error", { code: "generalException", message: "General exception" });
  });

  await call(account);

  expect(account.connectionStatus.isConnected).toBe(true);
});

test("HTTP 401 от Microsoft Graph — не сбой связи", async () => {
  let account = newAccount(async () => {
    throw httpError(401, "Unauthorized");
  });

  await call(account);

  expect(account.connectionStatus.isConnected).toBe(true);
});
