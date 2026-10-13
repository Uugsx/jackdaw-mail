// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MessageWindowPayload } from "../../../logic/Mail/MessageWindowProtocol";

const serializeMessageWindowMailMock = vi.hoisted(() =>
  vi.fn(
    async (_message: unknown, windowID: string) =>
      ({
        windowID,
      }) as unknown as MessageWindowPayload,
  ),
);
vi.mock("../../../frontend/Mail/Message/messageWindow", () => ({
  serializeMessageWindowMail: serializeMessageWindowMailMock,
}));

import {
  openNativeMessageWindow,
  requestNativeMessageReply,
} from "../../../frontend/Mail/Message/messageNative";

describe("отдельное окно просмотра письма", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "api");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    serializeMessageWindowMailMock.mockClear();
  });

  test("открывает письмо один раз и повторный двойной клик только фокусирует окно", async () => {
    let closedCallback: ((windowID: string) => void) | null = null;
    let api = {
      openMessageWindow: vi.fn(),
      focusMessageWindow: vi.fn(),
      onMessageWindowClosed: vi.fn((callback: (windowID: string) => void) => {
        closedCallback = callback;
        return () => {};
      }),
    };
    Object.defineProperty(window, "api", { configurable: true, value: api });
    vi.stubGlobal("crypto", { randomUUID: () => "message-window-id" });

    let message = {} as EMail;
    await openNativeMessageWindow(message);
    await openNativeMessageWindow(message);

    expect(serializeMessageWindowMailMock).toHaveBeenCalledTimes(1);
    expect(api.openMessageWindow).toHaveBeenCalledTimes(1);
    expect(api.openMessageWindow).toHaveBeenCalledWith("message-window-id", {
      windowID: "message-window-id",
    });
    expect(api.focusMessageWindow).toHaveBeenCalledWith("message-window-id");
    expect(api.onMessageWindowClosed).toHaveBeenCalledTimes(1);

    closedCallback?.("message-window-id");
    await openNativeMessageWindow(message);
    expect(api.openMessageWindow).toHaveBeenCalledTimes(2);
  });

  test("передаёт запрос ответа владельцу отдельного окна", () => {
    let api = {
      requestMessageWindowReply: vi.fn(),
    };
    Object.defineProperty(window, "api", { configurable: true, value: api });

    requestNativeMessageReply("message-window-id");
    requestNativeMessageReply("message-window-id", true);

    expect(api.requestMessageWindowReply).toHaveBeenNthCalledWith(
      1,
      "message-window-id",
      false,
    );
    expect(api.requestMessageWindowReply).toHaveBeenNthCalledWith(
      2,
      "message-window-id",
      true,
    );
  });
});
