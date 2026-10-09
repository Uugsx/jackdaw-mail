// @vitest-environment happy-dom

import "../../../logic/app";
import { expect, test } from "vitest";
import { OAuth2 } from "../../../logic/Auth/OAuth2";
import { OAuth2URLs, Provider } from "../../../logic/Auth/OAuth2URLs";
import { getOAuth2BuiltIn } from "../../../logic/Auth/OAuth2Util";
import { OAuth2SystemBrowser } from "../../../logic/Auth/UI/OAuth2SystemBrowser";
import {
  OAuth2UIMethod,
  newOAuth2UI,
} from "../../../logic/Auth/UI/OAuth2UIMethod";
import { OAuth2Window } from "../../../logic/Auth/UI/OAuth2Window";

const mailRu = OAuth2URLs.find((entry) => entry.provider == Provider.MailRu);

function createAuth() {
  if (!mailRu) {
    throw new Error("Mail.ru OAuth configuration is missing");
  }
  return new OAuth2(
    { username: "galyn07@mail.ru" } as any,
    mailRu.tokenURL,
    mailRu.authURL,
    mailRu.authDoneURL,
    mailRu.scope,
    mailRu.clientID,
    mailRu.clientSecret,
    mailRu.doPKCE,
  );
}

test("содержит совместимые с Mail.ru OAuth-параметры", async () => {
  const auth = createAuth();
  const loginURL = await auth.getAuthURL();
  const params = new URL(loginURL).searchParams;

  expect(params.get("client_id")).toBe("thunderbird");
  expect(params.get("redirect_uri")).toBe("http://localhost");
  expect(params.get("scope")).toBe("mail.imap");
  expect(auth.supportsSystemBrowser).toBe(false);
  expect(mailRu?.clientSecret).toEqual(expect.any(String));
});

test("направляет Mail.ru callback во внутреннее окно вместо нерабочего loopback-порта", () => {
  const auth = createAuth();

  expect(newOAuth2UI(OAuth2UIMethod.SystemBrowser, auth)).toBeInstanceOf(
    OAuth2Window,
  );
  expect(newOAuth2UI(OAuth2UIMethod.Localhost, auth)).toBeInstanceOf(
    OAuth2Window,
  );
});

test("подбирает Mail.ru OAuth-конфигурацию по IMAP-хосту автоконфигурации", () => {
  const auth = getOAuth2BuiltIn({
    protocol: "imap",
    hostname: "imap.mail.ru",
  } as any);

  expect(auth).toBeInstanceOf(OAuth2);
  expect((auth as OAuth2).clientID).toBe("thunderbird");
  expect((auth as OAuth2).authDoneURL).toBe("http://localhost");
});

test("сохраняет внешний браузер для провайдеров с доступным loopback-callback", () => {
  const auth = new OAuth2(
    { username: "user@example.test" } as any,
    "https://example.test/token",
    "https://example.test/login",
    "http://127.0.0.1:5460/login-success",
    "mail",
    "test-client",
  );

  expect(auth.supportsSystemBrowser).toBe(true);
  expect(newOAuth2UI(OAuth2UIMethod.SystemBrowser, auth)).toBeInstanceOf(
    OAuth2SystemBrowser,
  );
});
