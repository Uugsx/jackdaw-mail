// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { afterEach, describe, expect, test, vi } from "vitest";
import { notifications, NotificationSeverity } from "../../../frontend/MainWindow/Notification";
import { reconnectChat, showChatConnectionProblem } from "../../../frontend/Chat/chatConnectionNotice";
import { showError } from "../../../frontend/Util/error";
import { chatConnectionProblem, JackdawChatConnectionError, type ChatConnectionState } from "../../../logic/Chat/Jackdaw/chatConnectionProblem";
import { Observable } from "../../../logic/util/Observable";

class FakeAccount extends Observable {
  isOnline = false;
  reconnect = vi.fn(async () => {});
  connectionProblem = vi.fn(() => ({ kind: "offline", message: "x" }));
  setOnline(online: boolean) {
    this.isOnline = online;
    this.notifyObservers("isOnline", !online);
  }
}

function problemError(account: FakeAccount, changes: Partial<ChatConnectionState>) {
  let problem = chatConnectionProblem({
    status: "offline", proChecking: false, lastError: null, offlineSince: null, hasVerifiedEmail: true, isRegistered: true, ...changes,
  })!;
  return new JackdawChatConnectionError(problem, account as any);
}

describe("баннер «чат не на связи»", () => {
  afterEach(() => {
    notifications.clear();
  });

  test("показывает причину и кнопку «Переподключить», кнопка входит заново", async () => {
    let account = new FakeAccount();
    let notification = showChatConnectionProblem(problemError(account, { status: "rejected", lastError: "License expired." }));
    expect(notifications.contents).toEqual([notification]);
    expect(notification.severity).toBe(NotificationSeverity.Error);
    expect(notification.message).toBe("The Jackdaw server refused the connection: License expired.");
    expect(notification.buttons.contents.map(b => b.label)).toEqual(["Reconnect"]);
    await notification.buttons.first.onClick();
    expect(account.reconnect).toHaveBeenCalledTimes(1);
    // Баннер «Подключение» убирается, когда вход закончился
    expect(notifications.contents.filter(n => n.severity == NotificationSeverity.Info)).toEqual([]);
  });

  test("пока идёт вход, виден баннер «Подключение»", async () => {
    let account = new FakeAccount();
    let finish!: () => void;
    account.reconnect.mockImplementation(() => new Promise<void>(resolve => finish = resolve));
    let running = reconnectChat(account as any);
    expect(notifications.contents.map(n => n.message)).toContain("Connecting to the Jackdaw server…");
    finish();
    await running;
    expect(notifications.contents).toEqual([]);
  });

  test("неудачный вход — ошибка с причиной уходит наверх, баннер «Подключение» убран", async () => {
    let account = new FakeAccount();
    let failure = problemError(account, { status: "offline" });
    account.reconnect.mockRejectedValue(failure);
    await expect(reconnectChat(account as any)).rejects.toBe(failure);
    expect(notifications.contents).toEqual([]);
  });

  test("новый баннер заменяет прежний, а когда чат снова на связи — исчезает", () => {
    let account = new FakeAccount();
    showChatConnectionProblem(problemError(account, { status: "connecting" }));
    let latest = showChatConnectionProblem(problemError(account, { status: "offline" }));
    expect(notifications.contents).toEqual([latest]);
    account.setOnline(true);
    expect(notifications.contents).toEqual([]);
  });

  test("неподтверждённый адрес — без кнопки: переподключение не поможет", () => {
    let account = new FakeAccount();
    let notification = showChatConnectionProblem(problemError(account, { status: "online", hasVerifiedEmail: false }));
    expect(notification.buttons.contents).toEqual([]);
  });

  test("showError показывает ошибку чата этим баннером", async () => {
    let account = new FakeAccount();
    vi.spyOn(console, "error").mockImplementation(() => {});
    showError(problemError(account, { status: "offline" }));
    await vi.waitFor(() => expect(notifications.first?.buttons.contents.map(b => b.label)).toEqual(["Reconnect"]));
    vi.restoreAllMocks();
  });
});
