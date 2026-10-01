// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let FolderList: any;
let OWAAccount: any;
let SpecialFolder: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  let appGlobal = (await import("../../../logic/app")).appGlobal;
  (appGlobal as any).remoteApp = { OWA: {} };
  FolderList = (await import("../../../frontend/Mail/LeftPane/FolderList.svelte")).default;
  OWAAccount = (await import("../../../logic/Mail/OWA/OWAAccount")).OWAAccount;
  SpecialFolder = (await import("../../../logic/Mail/Folder")).SpecialFolder;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

describe("FolderList (FastTree) badge", () => {
  test("бейдж папки обновляется внутри виртуализированного дерева", async () => {
    let account = new OWAAccount();
    let inbox = account.newFolder();
    inbox.id = "inbox";
    inbox.name = "Входящие";
    inbox.specialFolder = SpecialFolder.Inbox;
    inbox.countTotal = 3;
    inbox.countUnread = 0;
    account.rootFolders.add(inbox);

    let selectedFolders = new ArrayColl<any>();
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(FolderList, {
      target,
      props: {
        folders: account.rootFolders,
        selectedFolder: inbox,
        selectedFolders,
        embedded: true,
      },
    }));
    await tick();
    expect(target.querySelector(".mail-folder-count")).toBeNull();

    inbox.countUnread = 1;
    await tick();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("1");

    inbox.countUnread = 2;
    await tick();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("2");
  });
});
