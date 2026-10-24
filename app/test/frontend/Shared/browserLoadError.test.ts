// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";

let Browser: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  Browser = (await import("../../../frontend/Shared/Browser.svelte")).default;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

async function mountBrowser(): Promise<{ target: HTMLElement; page: HTMLElement }> {
  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(Browser, { target, props: { url: "https://mail.example.com/owa/", title: "Вход", sessionID: "s" } }));
  await tick();
  let page = target.querySelector("webview, iframe") as HTMLElement;
  return { target, page };
}

function failLoad(page: HTMLElement, detail: Record<string, unknown>) {
  page.dispatchEvent(Object.assign(new Event("did-fail-load"), detail));
}

describe("Встроенный браузер при недоступном сервере", () => {
  test("вместо пустой страницы показывает причину и кнопку повтора", async () => {
    let { target, page } = await mountBrowser();
    let reload = vi.fn();
    (page as any).reload = reload;
    expect(target.querySelector(".load-error")).toBeNull();

    failLoad(page, { errorCode: -118, errorDescription: "ERR_CONNECTION_TIMED_OUT", isMainFrame: true, validatedURL: "https://mail.example.com/owa/" });
    await tick();

    let error = target.querySelector(".load-error");
    expect(error).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent?.trim().length).toBeGreaterThan(0);

    (error?.querySelector("button") as HTMLButtonElement).click();
    await tick();
    expect(reload).toHaveBeenCalledOnce();
    expect(target.querySelector(".load-error")).toBeNull();
  });

  test("прерванная загрузка и сбой во фрейме ошибкой не считаются", async () => {
    let { target, page } = await mountBrowser();
    failLoad(page, { errorCode: -3, errorDescription: "ERR_ABORTED", isMainFrame: true });
    failLoad(page, { errorCode: -105, errorDescription: "ERR_NAME_NOT_RESOLVED", isMainFrame: false });
    await tick();
    expect(target.querySelector(".load-error")).toBeNull();
  });

  test("новая загрузка убирает прошлую ошибку", async () => {
    let { target, page } = await mountBrowser();
    failLoad(page, { errorCode: -102, errorDescription: "ERR_CONNECTION_REFUSED", isMainFrame: true });
    await tick();
    expect(target.querySelector(".load-error")).not.toBeNull();

    page.dispatchEvent(new Event("did-start-loading"));
    await tick();
    expect(target.querySelector(".load-error")).toBeNull();
  });
});
