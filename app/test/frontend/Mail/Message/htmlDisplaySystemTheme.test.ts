// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";

vi.mock("../../../../frontend/Shared/WebView.svelte", async () => ({
  default: (await import("./StubWebView.svelte")).default,
}));

let HTMLDisplay: any;
let mounted: ReturnType<typeof mount> | null = null;
let systemDark = false;
const listeners = new Set<(event: { matches: boolean }) => void>();

beforeAll(async () => {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  // Как nativeTheme в Electron: схема меняется, настройка темы остаётся «system»
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return systemDark;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  })) as any;
  HTMLDisplay = (await import("../../../../frontend/Mail/Message/HTMLDisplay.svelte")).default;
}, 120_000);

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

function bodyClass(target: HTMLElement): string {
  return target.querySelector(".stub-webview")?.getAttribute("data-body-class") ?? "";
}

describe("Письмо при автоматической смене темы", () => {
  test("становится тёмным, когда система вечером переходит в тёмный режим", async () => {
    systemDark = false;
    let target = document.createElement("div");
    document.body.append(target);
    mounted = mount(HTMLDisplay, { target, props: { html: "<p style=\"color:#1f3864\">Подпись</p>" } });
    await tick();
    expect(bodyClass(target)).toContain("jackdaw-email-light");

    systemDark = true;
    for (let listener of listeners) {
      listener({ matches: true });
    }
    await tick();
    expect(bodyClass(target)).toContain("jackdaw-email-dark");

    systemDark = false;
    for (let listener of listeners) {
      listener({ matches: false });
    }
    await tick();
    expect(bodyClass(target)).toContain("jackdaw-email-light");
  });
});
