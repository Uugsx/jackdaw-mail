import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

function newAccount(connect: () => Promise<void>): IMAPAccount {
  appGlobal.remoteApp = {
    createIMAPFlowConnection: async () => ({
      connect,
      on: () => {},
      close: () => {},
    }),
  };
  let account = new IMAPAccount();
  account.storage = new DummyMailStorage();
  account.name = "Почта";
  account.hostname = "imap.example.test";
  account.authMethod = AuthMethod.Password;
  account.log = () => {};
  return account;
}

function codeError(code: string): Error {
  let ex = new Error(code);
  (ex as any).code = code;
  return ex;
}

test("IMAP: сервер не принимает соединение — состояние у аккаунта, подключение снимает его", async () => {
  let reachable = false;
  let account = newAccount(async () => {
    if (!reachable) {
      throw codeError("ECONNREFUSED");
    }
  });

  await expect(account.connection()).rejects.toThrow();
  expect(account.connectionStatus.problem?.kind).toBe("server-unreachable");

  reachable = true;
  await account.connection();
  expect(account.connectionStatus.problem).toBeNull();
  expect(account.connectionStatus.lastSuccessAt).not.toBeNull();
});

test("IMAP: таймаут подключения — сбой связи", async () => {
  let account = newAccount(async () => {
    throw codeError("CONNECT_TIMEOUT");
  });

  await expect(account.connection()).rejects.toThrow();

  expect(account.connectionStatus.problem?.kind).toBe("timeout");
});

test("IMAP: неверный пароль не считается сбоем связи", async () => {
  let account = newAccount(async () => {
    let ex = new Error("Invalid credentials");
    (ex as any).authenticationFailed = true;
    throw ex;
  });

  await expect(account.connection()).rejects.toThrow();

  expect(account.connectionStatus.isConnected).toBe(true);
});
