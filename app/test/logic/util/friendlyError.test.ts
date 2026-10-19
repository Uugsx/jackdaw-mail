import { afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  describeError,
  friendlyErrorMessage,
  friendlyErrorText,
  httpStatus,
  looksTechnical,
  redactSecrets,
  technicalErrorDetails,
} from "../../../logic/util/friendlyError";
import { SpecificError, UserCancelled, UserError } from "../../../logic/util/util";
import { Cancelled } from "../../../logic/util/flow/Abortable";
import { setUILocale } from "../../../l10n/l10n";
import { loadLanguageMessages } from "../../../l10n/messagesLoader";

/* Account.ts при прямом импорте даёт циклическую зависимость модулей,
 * поэтому LoginError / PasswordRejectedError воспроизводим по их признакам. */
function loginError(ex: Error | null, message: string): Error {
  return Object.assign(new SpecificError(ex, message), { authFail: true, isUserError: true });
}
function passwordRejectedError(message: string): Error {
  return Object.assign(loginError(null, message), { passwordRejected: true });
}

function withCode(message: string, code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code }, extra);
}

beforeAll(async () => {
  await loadLanguageMessages("ru");
  await loadLanguageMessages("fr");
});

afterEach(() => {
  setUILocale("en");
});

describe("сетевые ошибки", () => {
  test("«read ETIMEDOUT» из проверки обновлений — понятный текст, а код в подробностях", () => {
    let described = describeError(new Error("read ETIMEDOUT"));
    expect(described.kind).toBe("timeout");
    expect(described.message).toBe("The server took too long to respond.");
    expect(described.hint).toMatch(/internet connection/);
    expect(described.action).toBe("retry");
    expect(described.technical).toBe("read ETIMEDOUT");
    expect(described.message).not.toMatch(/ETIMEDOUT/);
  });

  test.each([
    ["ETIMEDOUT", "timeout"],
    ["ESOCKETTIMEDOUT", "timeout"],
    ["GREETING_TIMEOUT", "timeout"],
    ["ENOTFOUND", "server-not-found"],
    ["EAI_AGAIN", "server-not-found"],
    ["ECONNREFUSED", "server-unreachable"],
    ["EHOSTUNREACH", "server-unreachable"],
    ["ECONNRESET", "connection-lost"],
    ["EPIPE", "connection-lost"],
    ["ENETUNREACH", "offline"],
    ["CERT_HAS_EXPIRED", "certificate"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "certificate"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificate"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "certificate"],
  ])("код %s → %s", (code, kind) => {
    expect(describeError(withCode(`something ${code}`, code)).kind).toBe(kind);
  });

  test("код только в тексте, без свойства code (JPC теряет свойства)", () => {
    expect(describeError(new Error("connect ECONNREFUSED 127.0.0.1:993")).kind).toBe("server-unreachable");
    expect(describeError(new Error("getaddrinfo ENOTFOUND imap.example.com")).kind).toBe("server-not-found");
    expect(describeError(new Error("net::ERR_CONNECTION_RESET")).kind).toBe("connection-lost");
    expect(describeError(new Error("net::ERR_INTERNET_DISCONNECTED")).kind).toBe("offline");
    expect(describeError(new Error("net::ERR_CERT_DATE_INVALID")).kind).toBe("certificate");
    expect(describeError(new Error("socket hang up")).kind).toBe("connection-lost");
  });

  test("код в причине (cause) и в AggregateError", () => {
    let wrapped = new Error("fetch failed", { cause: withCode("connect timeout", "UND_ERR_CONNECT_TIMEOUT") });
    expect(describeError(wrapped).kind).toBe("timeout");
    let aggregate = Object.assign(new Error(""), { errors: [withCode("x", "ECONNREFUSED"), withCode("y", "ECONNREFUSED")] });
    expect(describeError(aggregate).kind).toBe("server-unreachable");
  });

  test("браузерный fetch без кода — общая сетевая ошибка", () => {
    let ex = new TypeError("Failed to fetch");
    expect(describeError(ex).kind).toBe("network");
  });

  test("сертификат по тексту OpenSSL", () => {
    expect(describeError(new Error("self-signed certificate in certificate chain")).kind).toBe("certificate");
    expect(describeError(new Error("SSL routines:ssl3_get_record:wrong version number")).kind).toBe("certificate");
  });
});

describe("HTTP", () => {
  test.each([
    [401, "login"],
    [440, "login"],
    [403, "forbidden"],
    [404, "not-found"],
    [408, "timeout"],
    [413, "too-large"],
    [429, "rate-limit"],
    [500, "server"],
    [502, "server"],
    [503, "server"],
    [504, "timeout"],
  ])("статус %i → %s", (status, kind) => {
    let ex = Object.assign(new Error(`HTTP ${status}`), { httpCode: status });
    expect(describeError(ex).kind).toBe(kind);
  });

  test("статус из текста HTTPFetchError и из status у EWSError", () => {
    expect(httpStatus(new Error("HTTP GET <https://x/y> failed with 503 Service Unavailable"))).toBe(503);
    expect(httpStatus({ status: 429, message: "Too Many Requests" })).toBe(429);
    expect(httpStatus(new Error("all fine"))).toBe(0);
  });
});

describe("вход и почтовые серверы", () => {
  test("LoginError IMAP с английским текстом протокола → вход, подсказка про пароль приложения", () => {
    let ex = loginError(new Error("AUTHENTICATIONFAILED"), "Check your login, username, and password.\nCommand failed");
    let described = describeError(ex);
    expect(described.kind).toBe("login");
    expect(described.action).toBe("login");
    expect(described.hint).toMatch(/app password/);
    expect(described.technical).toMatch(/Command failed/);
  });

  test("отклонённый сохранённый пароль", () => {
    expect(describeError(passwordRejectedError("Password incorrect")).kind).toBe("password-rejected");
  });

  test.each([
    [{ code: "EAUTH", responseCode: 535, message: "Invalid login: 535 5.7.8 Username and Password not accepted" }, "login"],
    [{ responseCode: 421, message: "421 4.7.0 Too many login attempts" }, "rate-limit"],
    [{ responseCode: 552, message: "552 5.2.2 Mailbox full" }, "mailbox-full"],
    [{ responseCode: 552, message: "552 5.3.4 Message size exceeds fixed limit" }, "too-large"],
    [{ responseCode: 550, message: "550 5.1.1 Recipient address rejected: User unknown" }, "recipient-rejected"],
    [{ type: "ErrorServerBusy", message: "The server cannot service this request right now." }, "rate-limit"],
    [{ type: "ErrorQuotaExceeded", message: "The mailbox quota has been exceeded." }, "mailbox-full"],
    [{ type: "ErrorMailboxStoreUnavailable", message: "Mailbox store unavailable" }, "server"],
  ])("%o → %s", (props, kind) => {
    let ex = Object.assign(new Error(props.message), props);
    expect(describeError(ex).kind).toBe(kind);
  });
});

describe("локальные данные", () => {
  test.each([
    ["SQLITE_BUSY", "database-busy"],
    ["SQLITE_LOCKED", "database-busy"],
    ["SQLITE_FULL", "disk-full"],
    ["SQLITE_CORRUPT", "database-damaged"],
    ["SQLITE_NOTADB", "database-damaged"],
    ["SQLITE_READONLY", "no-permission"],
    ["SQLITE_ERROR", "database"],
    ["ENOSPC", "disk-full"],
    ["EACCES", "no-permission"],
  ])("код %s → %s", (code, kind) => {
    expect(describeError(withCode(`${code}: failed`, code)).kind).toBe(kind);
  });
});

describe("сообщения приложения и непонятные ошибки", () => {
  test("понятный текст приложения показывается как есть, без дубля в подробностях", () => {
    let described = describeError(new UserError("Choose a folder first."));
    expect(described.kind).toBe("app");
    expect(described.message).toBe("Choose a folder first.");
    expect(described.technical).toBe("");
  });

  test("обычная фраза без технических признаков тоже сохраняется", () => {
    expect(friendlyErrorMessage(new Error("The folder already exists."))).toBe("The folder already exists.");
  });

  test("технический текст без известного кода → общий текст, исходник в подробностях", () => {
    let described = describeError(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(described.kind).toBe("unknown");
    expect(described.message).toBe("Something went wrong.");
    expect(described.technical).toMatch(/Cannot read properties/);
    expect(described.technical).toMatch(/TypeError/);
  });

  test("пустая ошибка и строка", () => {
    expect(describeError(new Error("")).kind).toBe("unknown");
    expect(describeError(null).message).toBe("Something went wrong.");
    expect(describeError("read ETIMEDOUT").kind).toBe("timeout");
  });

  test("отмена пользователем", () => {
    expect(describeError(new UserCancelled()).kind).toBe("cancelled");
    expect(describeError(new Cancelled("Cancelled by user")).kind).toBe("cancelled");
  });

  test("friendlyErrorText — текст с подсказкой одной строкой", () => {
    expect(friendlyErrorText(new Error("read ETIMEDOUT")))
      .toBe("The server took too long to respond. Check your internet connection and try again. If you use a VPN or proxy, make sure it is working.");
  });

  test("looksTechnical", () => {
    expect(looksTechnical("read ETIMEDOUT")).toBe(true);
    expect(looksTechnical("HTTP 500 Internal Server Error")).toBe(true);
    expect(looksTechnical("Папка уже существует.")).toBe(false);
    expect(looksTechnical("")).toBe(true);
  });
});

describe("техническая деталь", () => {
  test("код, статус и причина", () => {
    let ex = Object.assign(new Error("request failed", { cause: withCode("read ETIMEDOUT", "ETIMEDOUT") }), { httpCode: 504 });
    let details = technicalErrorDetails(ex);
    expect(details).toContain("[HTTP 504] request failed");
    expect(details).toContain("[ETIMEDOUT] read ETIMEDOUT");
  });

  test("секреты из URL и заголовков не попадают в подробности", () => {
    let text = redactSecrets("GET https://user:hunter2@mail.example.com/owa?access_token=abc.def&x=1 Bearer eyJhbGciOiJIUzI1NiJ9.payload");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).toContain("x=1");
    expect(technicalErrorDetails(new Error("failed <https://x/?code=SECRET123>"))).not.toContain("SECRET123");
  });
});

describe("переводы", () => {
  test("русский текст для таймаута", () => {
    setUILocale("ru");
    let described = describeError(new Error("read ETIMEDOUT"));
    expect(described.message).toBe("Сервер слишком долго не отвечает.");
    expect(described.hint).toMatch(/интернет/);
  });

  test("все виды ошибок переведены на русский и французский", () => {
    let samples: unknown[] = [
      withCode("x", "ETIMEDOUT"), withCode("x", "ENETUNREACH"), withCode("x", "ENOTFOUND"),
      withCode("x", "ECONNREFUSED"), withCode("x", "ECONNRESET"), new TypeError("Failed to fetch"),
      withCode("x", "CERT_HAS_EXPIRED"), loginError(null, "Login failed"),
      passwordRejectedError("x"), { httpCode: 403, message: "x" }, { httpCode: 404, message: "x" },
      { httpCode: 429, message: "x" }, { httpCode: 500, message: "x" }, { httpCode: 413, message: "x" },
      { responseCode: 550, message: "x" }, { type: "ErrorQuotaExceeded", message: "x" },
      withCode("x", "ENOSPC"), withCode("x", "EACCES"), withCode("x", "SQLITE_BUSY"),
      withCode("x", "SQLITE_CORRUPT"), withCode("x", "SQLITE_ERROR"), new UserCancelled(),
      new TypeError("Cannot read properties of undefined"), new Error(""),
    ];
    setUILocale("en");
    let english = samples.map(ex => describeError(ex));
    for (let lang of ["ru", "fr"]) {
      setUILocale(lang);
      samples.forEach((ex, i) => {
        let translated = describeError(ex);
        expect(translated.message, `${lang}: ${english[i].message}`).not.toBe(english[i].message);
        if (english[i].hint) {
          expect(translated.hint, `${lang}: ${english[i].hint}`).not.toBe(english[i].hint);
        }
      });
    }
  });
});
