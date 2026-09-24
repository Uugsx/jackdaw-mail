// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { applyColors } from "../../../frontend/Settings/Global/AppThemeColors";
import AppThemeColors from "../../../frontend/Settings/Global/AppThemeColors.svelte";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";

let mounted: ReturnType<typeof mount>[] = [];
let frameCallbacks: FrameRequestCallback[] = [];
let mediaChange: (() => void) | null = null;
let localStorageValues = new Map<string, string>();
let themeVariables: Record<string, string> = {};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  },
});

function setThemeVariables(dark: boolean): void {
  themeVariables = dark
    ? {
        "bg": "#111314",
        "main-bg": "#151718",
        "leftbar-bg": "#1a1c1e",
        "appbar-bg": "#1a1c1e",
        "windowheader-bg": "#151718",
        "selected-bg": "#4a351d",
      }
    : {
        "bg": "#f6f5f2",
        "main-bg": "#fcfbf9",
        "leftbar-bg": "#f1efea",
        "appbar-bg": "#f1efea",
        "windowheader-bg": "#f8f6f2",
        "selected-bg": "#f2e3c8",
      };
}

async function flushAnimationFrames(): Promise<void> {
  while (frameCallbacks.length) {
    let callback = frameCallbacks.shift();
    callback?.(0);
    await tick();
  }
}

describe("цвета темы приложения", () => {
  afterEach(() => {
    for (let instance of mounted) {
      unmount(instance);
    }
    mounted = [];
    frameCallbacks = [];
    mediaChange = null;
    themeVariables = {};
    document.body.replaceChildren();
    localStorageValues.clear();
    vi.unstubAllGlobals();
    applyColors({});
  });

  test("применяет пользовательские цвета и очищает их", () => {
    applyColors({
      "main-bg": "#123456",
      "main-fg": "#ffffff",
    });

    expect(document.documentElement.style.getPropertyValue("--main-bg")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("--main-fg")).toBe("#ffffff");

    applyColors({});

    expect(document.documentElement.style.getPropertyValue("--main-bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--main-fg")).toBe("");
  });

  test("переопределяет цвета desktop-оболочки окна", () => {
    let windowRoot = document.createElement("div");
    windowRoot.className = "main-window";
    document.body.append(windowRoot);

    applyColors({ "main-bg": "#28b464" });

    expect(windowRoot.style.getPropertyValue("--main-bg")).toBe("#28b464");

    applyColors({});
    expect(windowRoot.style.getPropertyValue("--main-bg")).toBe("");
    windowRoot.remove();
  });

  test("обновляет свотчи после переключения темы", async () => {
    localStorageValues.set("appearance.theme", JSON.stringify("dark"));
    localStorageValues.delete("appearance.colors");

    let windowRoot = document.createElement("div");
    windowRoot.className = "main-window";
    setThemeVariables(true);
    document.body.append(windowRoot);
    let readStyle = () => ({
      getPropertyValue: (name: string) => themeVariables[name.slice(2)] ?? "",
    });
    vi.stubGlobal("getComputedStyle", readStyle);
    window.getComputedStyle = readStyle as typeof window.getComputedStyle;

    let mediaQuery = {
      matches: true,
      addEventListener: (_type: string, listener: () => void) => {
        mediaChange = listener;
      },
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", () => mediaQuery);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    expect(document.querySelector(".main-window")).toBe(windowRoot);
    expect(window.getComputedStyle(windowRoot).getPropertyValue("--bg")).toBe("#111314");

    let target = document.createElement("div");
    windowRoot.append(target);
    mounted.push(mount(AppThemeColors, { target }));
    await tick();
    expect(frameCallbacks.length).toBeGreaterThan(0);
    await flushAnimationFrames();

    let swatches = target.querySelectorAll<HTMLElement>(".swatch-face");
    expect(swatches[0]?.style.background).toBe("#111314");
    expect(swatches[1]?.style.background).toBe("#151718");

    setThemeVariables(false);
    mediaQuery.matches = false;
    getLocalStorage("appearance.theme", "system").value = "light";
    mediaChange?.();
    await tick();
    await flushAnimationFrames();
    await tick();

    expect(swatches[0]?.style.background).toBe("#f6f5f2");
    expect(swatches[1]?.style.background).toBe("#fcfbf9");
  });
});
