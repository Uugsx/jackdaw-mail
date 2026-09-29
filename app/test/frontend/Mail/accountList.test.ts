// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { ArrayColl } from "svelte-collections";

let AccountList: any;
let MailAccount: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  await import("../../../logic/app");
  AccountList = (await import("../../../frontend/Mail/LeftPane/AccountList.svelte")).default;
  MailAccount = (await import("../../../logic/Mail/MailAccount")).MailAccount;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

describe("AccountList", () => {
  test("не показывает кнопку раскрытия папок в списке выбора ящика", async () => {
    let account = new MailAccount();
    account.name = "Test account";
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(AccountList, {
      target,
      props: {
        accounts: new ArrayColl([account]),
        selectedAccount: account,
      },
    }));
    await tick();

    expect(target.querySelector(".expand-btn")).toBeNull();
  });
});
