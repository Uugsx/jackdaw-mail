import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { expect, test } from "vitest";

/** Вход по логину `ngalkin0179@`, а основной адрес ящика — `nikita.galkin@` */
function fakeAccount(callOWA: (request: any) => Promise<any>): OWAAccount {
  appGlobal.remoteApp = { OWA: {} };
  let account = new OWAAccount();
  account.emailAddress = "ngalkin0179@example.com";
  (account as any).callOWA = callOWA;
  account.save = async () => void 0;
  return account;
}

test("основной адрес ящика берётся из настроек сеанса OWA", async () => {
  let requests: string[] = [];
  let account = fakeAccount(async request => {
    requests.push(request.action);
    return {};
  });
  await (account as any).loadServerEmailAddresses({
    SessionSettings: { UserEmailAddress: "Nikita.Galkin@example.com", LogonEmailAddress: "ngalkin0179@example.com" },
  });
  expect(account.serverEmailAddresses).toEqual(["nikita.galkin@example.com"]);
  expect(requests).toEqual([]);
  // Сохраняется и восстанавливается вместе с аккаунтом
  let restored = new OWAAccount();
  restored.fromConfigJSON(account.toConfigJSON());
  expect(restored.serverEmailAddresses).toEqual(["nikita.galkin@example.com"]);
});

test("без настроек сеанса — адрес из каталога по логину; неоднозначный ответ не берётся", async () => {
  let account = fakeAccount(async request => {
    expect(request.action).toBe("ResolveNames");
    return { ResolutionSet: { Resolution: [{ Mailbox: { EmailAddress: "nikita.galkin@example.com", RoutingType: "SMTP" } }] } };
  });
  await (account as any).loadServerEmailAddresses({});
  expect(account.serverEmailAddresses).toEqual(["nikita.galkin@example.com"]);

  let ambiguous = fakeAccount(async () => ({
    ResolutionSet: { Resolution: [
      { Mailbox: { EmailAddress: "a@example.com", RoutingType: "SMTP" } },
      { Mailbox: { EmailAddress: "b@example.com", RoutingType: "SMTP" } },
    ] },
  }));
  await (ambiguous as any).loadServerEmailAddresses({});
  expect(ambiguous.serverEmailAddresses).toEqual([]);
});

test("каталог недоступен — аккаунт работает по адресу входа", async () => {
  let account = fakeAccount(async () => {
    throw new Error("offline");
  });
  await (account as any).loadServerEmailAddresses(null);
  expect(account.serverEmailAddresses).toEqual([]);
});
