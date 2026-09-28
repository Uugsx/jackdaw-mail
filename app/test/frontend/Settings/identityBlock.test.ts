// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { notifications } from "../../../frontend/MainWindow/Notification";
import "../../../logic/app";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";

let IdentityBlock: any;
let mounted: ReturnType<typeof mount>[] = [];

beforeAll(async () => {
  IdentityBlock = (await import("../../../frontend/Settings/Mail/Account/IdentityBlock.svelte")).default;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  notifications.clear();
  document.body.replaceChildren();
});

describe("настройки личности", () => {
  test("монтирует редактор подписи без ошибки dispatchTransaction", async () => {
    let account = { name: "Test account" } as any;
    let identity = new MailIdentity(account);
    identity.emailAddress = "user@example.test";
    identity.realname = "Test user";
    identity.signatureHTML = "<p>Test signature</p>";
    let target = document.createElement("div");
    document.body.append(target);

    mounted.push(mount(IdentityBlock, {
      target,
      props: { identity, canRemove: false },
    }));
    await tick();
    await tick();

    expect(target.querySelector(".html-editor")).not.toBeNull();
    expect(notifications.find(notification => notification.message.includes("dispatchTransaction"))).toBeUndefined();
  });
});
