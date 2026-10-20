import { beforeAll, describe, expect, test, vi } from "vitest";
import { chatConnectionProblem, JackdawChatConnectionError, type ChatConnectionState } from "../../../../logic/Chat/Jackdaw/chatConnectionProblem";
import { getDateTimeString } from "../../../../frontend/Util/date";

function state(changes: Partial<ChatConnectionState>): ChatConnectionState {
  return {
    status: "online",
    proChecking: false,
    lastError: null,
    offlineSince: null,
    hasVerifiedEmail: true,
    isRegistered: true,
    ...changes,
  };
}

describe("текст баннера чата по состоянию соединения", () => {
  beforeAll(() => {
    if (typeof localStorage == "undefined") {
      // Формат времени берёт язык из настроек интерфейса
      vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    }
  });

  test("на связи — баннера нет", () => {
    expect(chatConnectionProblem(state({}))).toBeNull();
  });

  test("нет Pro или учётных данных на устройстве", () => {
    for (let status of [null, "disabled"] as const) {
      let problem = chatConnectionProblem(state({ status }))!;
      expect(problem.kind).toBe("no-pro");
      expect(problem.message).toMatch(/Jackdaw Pro is not active on this device/);
      expect(problem.message).not.toMatch(/No connection/);
    }
    expect(chatConnectionProblem(state({ status: "disabled", proChecking: true }))!.kind).toBe("checking-pro");
    expect(chatConnectionProblem(state({ status: "disabled", proMessage: "The Pro license has expired." }))!.message)
      .toMatch(/Jackdaw Pro is not active on this device\. .+ The Pro license has expired\.$/);
  });

  test("идёт подключение", () => {
    let problem = chatConnectionProblem(state({ status: "connecting" }))!;
    expect(problem.kind).toBe("connecting");
    expect(problem.message).toMatch(/^Connecting to the Jackdaw server/);
  });

  test("нет связи — с какого времени и ответ сервера", () => {
    let since = new Date(Date.now() - 5 * 60_000);
    let plain = chatConnectionProblem(state({ status: "offline", offlineSince: since }))!;
    expect(plain.kind).toBe("offline");
    expect(plain.message).toContain(`No connection to the Jackdaw server since ${getDateTimeString(since)}.`);
    expect(plain.message).toMatch(/Unsent messages will be sent automatically/);
    let withReason = chatConnectionProblem(state({ status: "offline", offlineSince: since, lastError: "Too many requests. Try again later." }))!;
    expect(withReason.message).toContain("Server response: Too many requests. Try again later.");
    expect(chatConnectionProblem(state({ status: "offline" }))!.message)
      .toBe("No connection to the Jackdaw server. Unsent messages will be sent automatically when the connection is restored.");
  });

  test("сервер отказал — с причиной и без", () => {
    let problem = chatConnectionProblem(state({ status: "rejected", lastError: "Calls between Jackdaw Mail users need an active Jackdaw Pro license or trial." }))!;
    expect(problem.kind).toBe("rejected");
    expect(problem.message).toBe("The Jackdaw server refused the connection: Calls between Jackdaw Mail users need an active Jackdaw Pro license or trial.");
    expect(chatConnectionProblem(state({ status: "rejected" }))!.message).toBe("The Jackdaw server refused the connection.");
  });

  test("адрес не подтверждён и устройство ещё регистрируется", () => {
    expect(chatConnectionProblem(state({ hasVerifiedEmail: false }))!.kind).toBe("not-verified");
    expect(chatConnectionProblem(state({ hasVerifiedEmail: false }))!.message).toMatch(/Confirm your address/);
    expect(chatConnectionProblem(state({ isRegistered: false }))!.kind).toBe("registering");
  });

  test("«Переподключить» предлагается, только когда может помочь", () => {
    let account = {} as any;
    for (let status of ["disabled", "connecting", "offline", "rejected"] as const) {
      expect(new JackdawChatConnectionError(chatConnectionProblem(state({ status }))!, account).canReconnect, status).toBe(true);
    }
    expect(new JackdawChatConnectionError(chatConnectionProblem(state({ hasVerifiedEmail: false }))!, account).canReconnect).toBe(false);
    let error = new JackdawChatConnectionError(chatConnectionProblem(state({ status: "offline" }))!, account);
    expect(error.isUserError).toBe(true);
    expect(error.chatConnectionProblem).toBe(true);
  });
});
