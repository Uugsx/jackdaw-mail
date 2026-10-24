// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";

let MessageBody: any;
let mounted: ReturnType<typeof mount> | null = null;

beforeAll(async () => {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  MessageBody = (await import("../../../../frontend/Mail/Message/MessageBody.svelte")).default;
}, 120_000);

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

function interrupted(): Error {
  let ex = new Error("socket hang up");
  (ex as any).code = "ECONNRESET";
  return ex;
}

/** Письмо с минимальным контрактом store, как у Observable */
function fakeMessage(loadBody: () => Promise<void>) {
  let subscribers = new Set<(value: any) => void>();
  let message: any = {
    loadedBody: false,
    text: "Текст письма",
    html: "",
    folder: null,
    subscribe(callback: (value: any) => void) {
      subscribers.add(callback);
      callback(message);
      return () => subscribers.delete(callback);
    },
    loadBody: vi.fn(async () => {
      await loadBody();
      message.loadedBody = true;
      for (let callback of subscribers) {
        callback(message);
      }
    }),
  };
  return message;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
  }
}

describe("Тело письма при сбое связи", () => {
  test("показывает ошибку с кнопкой «Повторить», повтор загружает письмо", async () => {
    let fail = true;
    let message = fakeMessage(async () => {
      if (fail) {
        throw interrupted();
      }
    });
    let target = document.createElement("div");
    document.body.append(target);
    mounted = mount(MessageBody, { target, props: { message } });
    await settle();

    expect(target.querySelectorAll(".notice")).toHaveLength(1);
    let retry = [...target.querySelectorAll("button")].find(button => /Try again|Повтор/i.test(button.textContent ?? ""));
    expect(retry).toBeTruthy();

    fail = false;
    retry!.click();
    flushSync();
    await settle();

    expect(message.loadBody).toHaveBeenCalledTimes(2);
    expect(target.querySelector(".notice")).toBeNull();
  });
});
