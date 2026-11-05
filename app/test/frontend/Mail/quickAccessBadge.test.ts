// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";

let QuickAccessFolder: any;
let OWAAccount: any;
let SpecialFolder: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  let appGlobal = (await import("../../../logic/app")).appGlobal;
  (appGlobal as any).remoteApp = { OWA: {} };
  QuickAccessFolder = (await import("../../../frontend/Mail/LeftPane/QuickAccessFolder.svelte")).default;
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

test("бейдж Корзины в быстром доступе меняется сразу, без перехода в другую папку", async () => {
  let account = new OWAAccount();
  let trash = account.newFolder();
  trash.id = "trash";
  trash.name = "Deleted Items";
  trash.specialFolder = SpecialFolder.Trash;
  trash.countUnread = 0;

  let target = document.createElement("div");
  document.body.append(target);
  mounted.push(mount(QuickAccessFolder, {
    target,
    props: { folder: trash, selected: false },
    context: new Map(),
  }));
  await tick();
  expect(target.querySelector(".mail-folder-count")).toBeNull();

  // «Очистить папку» перенесла в Корзину 5 непрочитанных
  trash.countUnread = 5;
  await tick();
  expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("5");

  trash.countUnread = 0;
  await tick();
  expect(target.querySelector(".mail-folder-count")).toBeNull();
});
