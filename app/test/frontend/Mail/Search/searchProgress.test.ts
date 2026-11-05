// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let SearchField: any;
let FolderHeader: any;
let mailSearchInProgress: typeof import("../../../../frontend/Mail/Search/searchProgress").mailSearchInProgress;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  let storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  SearchField = (await import("../../../../frontend/Shared/SearchField.svelte")).default;
  FolderHeader = (await import("../../../../frontend/Mail/LeftPane/FolderHeader.svelte")).default;
  mailSearchInProgress = (await import("../../../../frontend/Mail/Search/searchProgress")).mailSearchInProgress;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  mailSearchInProgress.set(false);
  document.body.replaceChildren();
});

function mountInto(component: any, props: Record<string, unknown>) {
  let target = document.createElement("div");
  document.body.append(target);
  let instance = mount(component, { target, props });
  mounted.push(instance);
  return { target, instance };
}

describe("Индикатор идущего поиска", () => {
  test("поле поиска показывает крутящийся значок вместо лупы", async () => {
    let { target } = mountInto(SearchField, { searchTerm: "inditex", variant: "toolbar", busy: true });
    await tick();
    expect(target.querySelector(".busy .loader")).not.toBeNull();
    expect(target.querySelector("input")?.getAttribute("aria-busy")).toBe("true");
  });

  test("без поиска — обычная лупа", async () => {
    let { target } = mountInto(SearchField, { searchTerm: "", variant: "toolbar" });
    await tick();
    expect(target.querySelector(".busy")).toBeNull();
    expect(target.querySelector("input")?.getAttribute("aria-busy")).toBe("false");
  });

  test("заголовок списка: «Идёт поиск…», затем «Результаты поиска»", async () => {
    mailSearchInProgress.set(true);
    let { target } = mountInto(FolderHeader, { folder: null, searchMessages: null });
    await tick();
    let status = target.querySelector(".folder-name.searching");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toMatch(/Searching|Идёт поиск/);

    mailSearchInProgress.set(false);
    await tick();
    expect(target.querySelector(".folder-name.searching")).toBeNull();
  });

  test("после поиска с результатом — «Результаты поиска»", async () => {
    let { target } = mountInto(FolderHeader, { folder: null, searchMessages: new ArrayColl() });
    await tick();
    expect(target.querySelector(".folder-name")?.textContent).toMatch(/Search results|Результаты поиска/);
  });
});
