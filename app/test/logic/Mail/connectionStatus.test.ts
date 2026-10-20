import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ConnectionStatus,
  connectionProblemKind,
  kConnectionProblemNotifyAfterMs,
  kIgnoreFailureAfterSuccessMs,
  setConnectionProblemListener,
} from "../../../logic/Mail/connectionStatus";

function codeError(code: string, message = code): Error {
  let ex = new Error(message);
  (ex as any).code = code;
  return ex;
}

function httpError(status: number): Error {
  let ex = new Error(`HTTP ${status}`);
  (ex as any).httpCode = status;
  return ex;
}

function at(ms: number): Date {
  return new Date(Date.UTC(2026, 9, 20, 9, 0, 0) + ms);
}

function newStatus(storageID: string | null = null) {
  let onChange = vi.fn();
  let status = new ConnectionStatus(onChange, () => "Работа", () => storageID);
  return { status, onChange };
}

afterEach(() => {
  setConnectionProblemListener(null);
  vi.unstubAllGlobals();
});

describe("классификация сбоев связи", () => {
  test.each([
    ["таймаут Node", codeError("ETIMEDOUT"), "timeout"],
    ["таймаут ImapFlow", codeError("CONNECT_TIMEOUT"), "timeout"],
    ["таймаут Chromium", new Error("net::ERR_TIMED_OUT"), "timeout"],
    ["DNS Node", codeError("ENOTFOUND", "getaddrinfo ENOTFOUND mail.example.test"), "server-not-found"],
    ["DNS Chromium", new Error("net::ERR_NAME_NOT_RESOLVED"), "server-not-found"],
    ["отказ соединения", codeError("ECONNREFUSED"), "server-unreachable"],
    ["отказ соединения Chromium", new Error("net::ERR_CONNECTION_REFUSED"), "server-unreachable"],
    ["обрыв соединения", codeError("ECONNRESET"), "connection-lost"],
    ["fetch без ответа", Object.assign(new TypeError("Failed to fetch")), "network"],
    ["прерванный запрос", new Error("This operation was aborted"), "network"],
    ["TLS Node", codeError("CERT_HAS_EXPIRED", "certificate has expired"), "certificate"],
    ["TLS Chromium", new Error("net::ERR_CERT_AUTHORITY_INVALID"), "certificate"],
    ["HTTP 502", httpError(502), "server"],
    ["HTTP 503", httpError(503), "server"],
    ["HTTP 504", httpError(504), "timeout"],
  ])("%s — сбой связи", (_name, ex, kind) => {
    expect(connectionProblemKind(ex)).toBe(kind);
  });

  test.each([
    ["нет ошибки", null],
    ["неверный пароль", Object.assign(new Error("Login failed"), { authFail: true })],
    ["пароль отклонён", Object.assign(new Error("Password rejected"), { passwordRejected: true })],
    ["IMAP AUTHENTICATIONFAILED", Object.assign(new Error("Invalid credentials"), { authenticationFailed: true })],
    ["HTTP 401", httpError(401)],
    ["HTTP 403", httpError(403)],
    ["HTTP 404", httpError(404)],
    ["ограничение частоты", httpError(429)],
    ["понятная ошибка приложения", Object.assign(new Error("Папка не найдена"), { isUserError: true })],
  ])("%s — не сбой связи", (_name, ex) => {
    expect(connectionProblemKind(ex)).toBeNull();
  });
});

describe("состояние связи", () => {
  test("сбой ставит состояние с причиной и временем начала", () => {
    let { status, onChange } = newStatus();

    expect(status.reportFailure(codeError("ETIMEDOUT"), at(0))).toBe(true);

    expect(status.isConnected).toBe(false);
    expect(status.problem?.kind).toBe("timeout");
    expect(status.problem?.message).toBeTruthy();
    expect(status.problem?.since).toEqual(at(0));
    expect(onChange).toHaveBeenCalledOnce();
  });

  test("повторные одинаковые сбои не перерисовывают интерфейс и не сдвигают начало", () => {
    let { status, onChange } = newStatus();
    status.reportFailure(codeError("ETIMEDOUT"), at(0));
    status.reportFailure(codeError("ETIMEDOUT"), at(3_000));
    status.reportFailure(codeError("ETIMEDOUT"), at(6_000));

    expect(onChange).toHaveBeenCalledOnce();
    expect(status.problem?.since).toEqual(at(0));
  });

  test("смена причины обновляет текст, но не начало сбоя", () => {
    let { status, onChange } = newStatus();
    status.reportFailure(codeError("ETIMEDOUT"), at(0));
    status.reportFailure(codeError("ECONNREFUSED"), at(5_000));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(status.problem?.kind).toBe("server-unreachable");
    expect(status.problem?.since).toEqual(at(0));
  });

  test("ответ сервера снимает состояние и запоминает время синхронизации", () => {
    let { status, onChange } = newStatus();
    status.reportFailure(codeError("ECONNREFUSED"), at(0));
    status.reportSuccess(at(30_000));

    expect(status.isConnected).toBe(true);
    expect(status.problem).toBeNull();
    expect(status.lastSuccessAt).toEqual(at(30_000));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("удачные запросы без сбоя не вызывают перерисовку", () => {
    let { status, onChange } = newStatus();
    status.reportSuccess(at(0));
    status.reportSuccess(at(3_000));

    expect(onChange).not.toHaveBeenCalled();
    expect(status.lastSuccessAt).toEqual(at(3_000));
  });

  test("ошибки входа и прочие ошибки состояние не меняют", () => {
    let { status, onChange } = newStatus();

    expect(status.reportFailure(Object.assign(new Error("Login failed"), { authFail: true }), at(0))).toBe(false);
    expect(status.reportFailure(httpError(404), at(0))).toBe(false);

    expect(status.isConnected).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("единичный сбой сразу после удачного ответа не показывается", () => {
    let { status } = newStatus();
    status.reportSuccess(at(0));

    status.reportFailure(codeError("ECONNRESET"), at(kIgnoreFailureAfterSuccessMs - 1));
    expect(status.isConnected).toBe(true);

    status.reportFailure(codeError("ECONNRESET"), at(kIgnoreFailureAfterSuccessMs));
    expect(status.isConnected).toBe(false);
  });

  test("время последней синхронизации переживает перезапуск", () => {
    let store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    newStatus("acc-1").status.reportSuccess(at(0));

    expect(newStatus("acc-1").status.lastSuccessAt).toEqual(at(0));
    expect(newStatus("acc-2").status.lastSuccessAt).toBeNull();
  });

  test("недоступное хранилище не ломает учёт", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    });
    let { status } = newStatus("acc-1");

    expect(status.lastSuccessAt).toBeNull();
    expect(() => status.reportSuccess(at(0))).not.toThrow();
    expect(status.lastSuccessAt).toEqual(at(0));
  });
});

describe("уведомление о сбое", () => {
  test("не больше одного уведомления на эпизод сбоя", () => {
    let listener = vi.fn();
    setConnectionProblemListener(listener);
    let { status } = newStatus();

    for (let ms = 0; ms <= 10 * 60_000; ms += 3_000) {
      status.reportFailure(codeError("ETIMEDOUT"), at(ms));
    }

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(status);
  });

  test("короткий сбой уведомления не даёт", () => {
    let listener = vi.fn();
    setConnectionProblemListener(listener);
    let { status } = newStatus();

    status.reportFailure(codeError("ETIMEDOUT"), at(0));
    status.reportFailure(codeError("ETIMEDOUT"), at(kConnectionProblemNotifyAfterMs - 1));
    status.reportSuccess(at(kConnectionProblemNotifyAfterMs));

    expect(listener).not.toHaveBeenCalled();
  });

  test("новый эпизод после восстановления уведомляет снова, но тоже один раз", () => {
    let listener = vi.fn();
    setConnectionProblemListener(listener);
    let { status } = newStatus();

    status.reportFailure(codeError("ETIMEDOUT"), at(0));
    status.reportFailure(codeError("ETIMEDOUT"), at(kConnectionProblemNotifyAfterMs));
    status.reportSuccess(at(kConnectionProblemNotifyAfterMs + 1_000));

    let start = kConnectionProblemNotifyAfterMs + 1_000 + kIgnoreFailureAfterSuccessMs;
    status.reportFailure(codeError("ECONNREFUSED"), at(start));
    status.reportFailure(codeError("ECONNREFUSED"), at(start + kConnectionProblemNotifyAfterMs));
    status.reportFailure(codeError("ECONNREFUSED"), at(start + 2 * kConnectionProblemNotifyAfterMs));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("без интернета не уведомляет: это видно и так", () => {
    let listener = vi.fn();
    setConnectionProblemListener(listener);
    let { status } = newStatus();

    status.reportFailure(new Error("net::ERR_INTERNET_DISCONNECTED"), at(0));
    status.reportFailure(new Error("net::ERR_INTERNET_DISCONNECTED"), at(kConnectionProblemNotifyAfterMs));

    expect(status.problem?.kind).toBe("offline");
    expect(listener).not.toHaveBeenCalled();
  });

  test("ошибка получателя уведомления не ломает учёт сбоя", () => {
    setConnectionProblemListener(() => { throw new Error("notification failed"); });
    let { status } = newStatus();
    let consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      status.reportFailure(codeError("ETIMEDOUT"), at(0));
      expect(() => status.reportFailure(codeError("ETIMEDOUT"), at(kConnectionProblemNotifyAfterMs))).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }
    expect(status.isConnected).toBe(false);
  });
});
