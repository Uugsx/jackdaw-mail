import { describe, expect, test, vi } from "vitest";
import type { EMail } from "../../../logic/Mail/EMail";
import { runMailActions } from "../../../frontend/Mail/mailBulkActions";

describe("массовые действия над письмами", () => {
  test("запускает все операции до ожидания ответов сервера", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let firstStartedPromise = new Promise<void>(resolve => firstStarted = resolve);
    let secondStartedPromise = new Promise<void>(resolve => secondStarted = resolve);
    let first = { pID: "first" } as EMail;
    let second = { pID: "second" } as EMail;
    let action = vi.fn(async (message: EMail) => {
      if (message == first) {
        firstStarted();
        await new Promise<void>(resolve => releaseFirst = resolve);
      } else {
        secondStarted();
        await new Promise<void>(resolve => releaseSecond = resolve);
      }
    });

    let run = runMailActions([first, second], action);
    await Promise.all([firstStartedPromise, secondStartedPromise]);

    expect(action).toHaveBeenCalledTimes(2);
    releaseFirst();
    releaseSecond();
    await run;
  });

  test("не отправляет второй запрос для дубликата того же письма", async () => {
    let message = { pID: "same-message" } as EMail;
    let action = vi.fn(async () => {});

    await runMailActions([message, { pID: "same-message" } as EMail], action);

    expect(action).toHaveBeenCalledTimes(1);
  });
});
