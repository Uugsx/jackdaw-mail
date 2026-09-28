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
  function fakeFolder(id: string, accountID = "test-account") {
    return {
      id,
      account: { id: accountID },
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
  }

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

  test("keeps sort choices separate for each folder", async () => {
    let firstTarget = document.createElement("div");
    document.body.append(firstTarget);
    let firstFolder = fakeFolder("INBOX");
    let first = mount(QuickFilterBar, {
      target: firstTarget,
      props: { folder: firstFolder, searchMessages: null },
    });
    mounted.push(first);

    let firstSortButton = firstTarget.querySelector("button.sort-menu-trigger") as HTMLButtonElement;
    firstSortButton.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await tick();
    let bySubject = [...document.querySelectorAll("button.menuitem")]
      .find(button => button.textContent?.trim() == "By subject") as HTMLButtonElement;
    bySubject.click();
    await tick();
    expect(firstSortButton.getAttribute("aria-label")).toContain("By subject");

    unmount(mounted.pop()!);
    firstTarget.remove();

    let secondTarget = document.createElement("div");
    document.body.append(secondTarget);
    let second = mount(QuickFilterBar, {
      target: secondTarget,
      props: { folder: fakeFolder("Archive"), searchMessages: null },
    });
    mounted.push(second);
    await tick();
    expect((secondTarget.querySelector("button.sort-menu-trigger") as HTMLButtonElement)
      .getAttribute("aria-label")).toContain("Newest");

    unmount(mounted.pop()!);
    secondTarget.remove();

    let restoredTarget = document.createElement("div");
    document.body.append(restoredTarget);
    let restored = mount(QuickFilterBar, {
      target: restoredTarget,
      props: { folder: firstFolder, searchMessages: null },
    });
    mounted.push(restored);
    await tick();
    expect((restoredTarget.querySelector("button.sort-menu-trigger") as HTMLButtonElement)
      .getAttribute("aria-label")).toContain("By subject");
  });
});
