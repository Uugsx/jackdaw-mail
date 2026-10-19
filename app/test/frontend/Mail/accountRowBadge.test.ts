// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";

let AccountListItem: any;
let OWAAccount: any;
let SpecialFolder: any;
let mailUnreadEpoch: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  let appGlobal = (await import("../../../logic/app")).appGlobal;
  (appGlobal as any).remoteApp = { OWA: {} };
  AccountListItem = (await import("../../../frontend/Mail/LeftPane/AccountListItem.svelte")).default;
  OWAAccount = (await import("../../../logic/Mail/OWA/OWAAccount")).OWAAccount;
  SpecialFolder = (await import("../../../logic/Mail/Folder")).SpecialFolder;
  mailUnreadEpoch = (await import("../../../frontend/Mail/mailUnreadCounts")).mailUnreadEpoch;
}, 120_000);

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

function accountWithInbox(unread: number) {
  let account = new OWAAccount();
  account.name = "integrators";
  let inbox = account.newFolder();
  inbox.id = "inbox";
  inbox.name = "Входящие";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.countUnread = unread;
  account.rootFolders.add(inbox);
  return { account, inbox };
}

async function bumpEpoch() {
  mailUnreadEpoch.update((n: number) => n + 1);
  await tick();
}

describe("Число на строке ящика", () => {
  test("исчезает, когда во «Входящих» больше нет непрочитанных, без переключения папки", async () => {
    let { account, inbox } = accountWithInbox(1);
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(AccountListItem, { target, props: { account }, context: new Map() }));
    await tick();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("1");

    // Письмо прочитали на другом устройстве: счётчик обновился, выбор папки тот же
    inbox.countUnread = 0;
    await bumpEpoch();
    expect(target.querySelector(".mail-folder-count")).toBeNull();
  });

  test("появляется при новом письме", async () => {
    let { account, inbox } = accountWithInbox(0);
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(AccountListItem, { target, props: { account }, context: new Map() }));
    await tick();
    expect(target.querySelector(".mail-folder-count")).toBeNull();

    inbox.countUnread = 2;
    await bumpEpoch();
    expect(target.querySelector(".mail-folder-count")?.textContent?.trim()).toBe("2");
  });
});
