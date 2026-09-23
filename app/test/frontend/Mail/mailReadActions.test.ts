import { describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../../logic/Mail/EMail";
import { markMessagesRead } from "../../../frontend/Mail/mailReadActions";

describe("массовая отметка писем прочитанными", () => {
  test("запускает все изменения до ожидания ответов сервера", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let firstStartedPromise = new Promise<void>(resolve => firstStarted = resolve);
    let secondStartedPromise = new Promise<void>(resolve => secondStarted = resolve);
    let first = {
      markRead: vi.fn(async () => {
        firstStarted();
        await new Promise<void>(resolve => releaseFirst = resolve);
      }),
    } as unknown as EMail;
    let second = {
      markRead: vi.fn(async () => {
        secondStarted();
        await new Promise<void>(resolve => releaseSecond = resolve);
      }),
    } as unknown as EMail;

    let mark = markMessagesRead([first, second], true);
    await Promise.all([firstStartedPromise, secondStartedPromise]);

    expect(first.markRead).toHaveBeenCalledWith(true);
    expect(second.markRead).toHaveBeenCalledWith(true);
    releaseFirst();
    releaseSecond();
    await mark;
  });

  test("синхронизирует дубликат открытого письма без второго запроса", async () => {
    let listMessage = {
      pID: "message-1",
      isRead: false,
      markRead: vi.fn(async () => {
        listMessage.isRead = true;
      }),
    } as unknown as EMail;
    let openMessage = {
      pID: "message-1",
      isRead: false,
      markRead: vi.fn(),
    } as unknown as EMail;

    await markMessagesRead([listMessage, openMessage], true);

    expect(listMessage.markRead).toHaveBeenCalledTimes(1);
    expect(openMessage.markRead).not.toHaveBeenCalled();
    expect(openMessage.isRead).toBe(true);
  });
});
