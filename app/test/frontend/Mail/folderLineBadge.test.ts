// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";

let FolderLine: any;
let OWAAccount: any;
let SpecialFolder: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  let appGlobal = (await import("../../../logic/app")).appGlobal;
  (appGlobal as any).remoteApp = { OWA: {} };
  FolderLine = (await import("../../../frontend/Mail/LeftPane/FolderLine.svelte")).default;
  OWAAccount = (await import("../../../logic/Mail/OWA/OWAAccount")).OWAAccount;
  SpecialFolder = (await import("../../../logic/Mail/Folder")).SpecialFolder;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

describe("FolderLine badge", () => {
  test("бейдж появляется при росте countUnread без пересоздания компонента", async () => {
    let account = new OWAAccount();
    let folder = account.newFolder();
    folder.id = "shared-inbox";
    folder.name = "Входящие";
    folder.specialFolder = SpecialFolder.Inbox;
    folder.countTotal = 3;
    folder.countUnread = 0;

    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(FolderLine, {
      target,
      props: { folder, selected: true },
      context: new Map(),
    }));
    await tick();
    expect(target.querySelector(".mail-folder-count")).toBeNull();

    // Новое письмо: счётчик обновлён нотификацией свойства (как из sync).
    folder.countUnread = 1;
    await tick();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("1");

    // Ещё письмо.
    folder.countUnread = 2;
    await tick();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("2");
  });
});
