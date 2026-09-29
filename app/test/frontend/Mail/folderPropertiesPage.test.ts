// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let FolderPropertiesPage: any;
let MailAccount: any;
let SpecialFolder: any;
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
  FolderPropertiesPage = (
    await import("../../../frontend/Mail/FolderPropertiesPage.svelte")
  ).default;
  MailAccount = (await import("../../../logic/Mail/MailAccount")).MailAccount;
  SpecialFolder = (await import("../../../logic/Mail/Folder")).SpecialFolder;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  localStorageValues.clear();
});

function makeAccount(id: string, name: string): { account: any; inbox: any } {
  let account = new MailAccount();
  account.id = id;
  account.name = name;
  let inbox = account.newFolder();
  inbox.id = `${id}-inbox`;
  inbox.name = `Входящие ${name}`;
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  return { account, inbox };
}

test("переключает ящик и папку на странице настроек папки", async () => {
  let first = makeAccount("first", "Первый");
  let second = makeAccount("second", "Второй");
  let target = document.createElement("div");
  document.body.append(target);

  mounted.push(mount(FolderPropertiesPage, {
    target,
    props: {
      accounts: new ArrayColl([first.account, second.account]),
      folder: first.inbox,
      selectedAccount: first.account,
    },
  }));
  await tick();

  let accountRows = target.querySelectorAll(".account-list .row");
  expect(accountRows).toHaveLength(2);
  (accountRows[1] as HTMLElement).click();
  await tick();
  await tick();

  expect(target.querySelector("h2")?.textContent).toContain("Входящие Второй");
  expect(target.querySelector("h2")?.textContent).toContain("Второй");
});
