// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { tick, mount, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let QuickFilterBar: any;
let quickSearch: any;
let mounted: ReturnType<typeof mount>[] = [];
let localStorageValues = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
    removeItem: (key: string) => localStorageValues.delete(key),
  },
});

beforeAll(async () => {
  await import("../../../logic/app");
  QuickFilterBar = (
    await import("../../../frontend/Mail/LeftPane/QuickFilterBar.svelte")
  ).default;
  quickSearch = (await import("../../../frontend/Mail/Selected")).quickSearch;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  quickSearch.reset();
  quickSearch.folder = null;
  localStorageValues.clear();
  document.body.replaceChildren();
});

describe("QuickFilterBar", () => {
  test("keeps one sort menu and one filter menu on the toolbar", async () => {
    let folder = {
      id: "INBOX",
      messages: new ArrayColl(),
      countUnread: 0,
      countTotal: 0,
      countNewArrived: 0,
      subscribe(
        observer: (folder: any, property: string | null, oldValue: any) => void,
      ) {
        observer(this, null, null);
        return () => {};
      },
    } as any;
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(
      mount(QuickFilterBar, {
        target,
        props: { folder, searchMessages: null },
      }),
    );

    expect(target.querySelectorAll("button.sort-menu-trigger")).toHaveLength(1);
    expect(target.querySelectorAll("button.filter-menu-trigger")).toHaveLength(1);
    expect(target.querySelector("button.pill.add")).toBeNull();
    expect(target.querySelectorAll("button.pill-remove")).toHaveLength(0);
  });

  test("marks a filter as active inside the filter menu", async () => {
    let folder = {
      id: "INBOX",
      messages: new ArrayColl(),
      countUnread: 0,
      countTotal: 0,
      countNewArrived: 0,
      subscribe(
        observer: (folder: any, property: string | null, oldValue: any) => void,
      ) {
        observer(this, null, null);
        return () => {};
      },
    } as any;
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(
      mount(QuickFilterBar, {
        target,
        props: { folder, searchMessages: null },
      }),
    );

    let filterMenuButton = target.querySelector("button.filter-menu-trigger") as HTMLButtonElement;
    filterMenuButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();

    let unreadButton = [...document.querySelectorAll("button.menuitem")]
      .find(button => button.textContent?.trim() == "Unread") as HTMLButtonElement;
    expect(unreadButton).toBeTruthy();
    expect(unreadButton.classList.contains("selected")).toBe(false);

    unreadButton.click();
    await tick();

    expect(unreadButton.classList.contains("selected")).toBe(true);
    let filterButton = target.querySelector("button.filter-menu-trigger") as HTMLButtonElement;
    expect(filterButton.classList.contains("active")).toBe(true);
    expect(filterButton.textContent?.trim()).toBe("1");
  });

  test("keeps the sort menu anchored to its trigger", async () => {
    let folder = {
      id: "INBOX",
      messages: new ArrayColl(),
      countUnread: 0,
      countTotal: 0,
      countNewArrived: 0,
      subscribe(
        observer: (folder: any, property: string | null, oldValue: any) => void,
      ) {
        observer(this, null, null);
        return () => {};
      },
    } as any;
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(
      mount(QuickFilterBar, {
        target,
        props: { folder, searchMessages: null },
      }),
    );

    let sortButton = target.querySelector("button.sort-menu-trigger") as HTMLButtonElement;
    Object.defineProperty(sortButton, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 200,
        bottom: 234,
        left: 420,
        right: 454,
        width: 34,
        height: 34,
        x: 420,
        y: 200,
        toJSON: () => ({}),
      }),
    });

    sortButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
    await new Promise(resolve => setTimeout(resolve, 0));

    let popup = document.body.querySelector(".popup") as HTMLElement;
    expect(popup).toBeTruthy();
    expect(popup.style.transform).toContain("420px");
  });
});
