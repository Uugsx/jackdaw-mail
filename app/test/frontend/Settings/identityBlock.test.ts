// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { mount, tick, unmount } from "svelte";
import { notifications } from "../../../frontend/MainWindow/Notification";
import "../../../logic/app";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { PRO_FEATURE_KEYS } from "../../../logic/Billing/Billing";
import { proEntitlement } from "../../../logic/Billing/ProEntitlement";

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
    let previousEntitlement = proEntitlement.value;
    proEntitlement.setValue({
      status: "active",
      plan: "yearly",
      features: [...PRO_FEATURE_KEYS],
      validUntil: null,
      keyLast4: null,
      message: null,
      lastValidatedAt: new Date().toISOString(),
    });
    let account = { name: "Test account" } as any;
    let identity = new MailIdentity(account);
    identity.emailAddress = "user@example.test";
    identity.realname = "Test user";
    identity.signatureHTML = "<p>Test signature</p>";
    let target = document.createElement("div");
    document.body.append(target);

    try {
      mounted.push(mount(IdentityBlock, {
        target,
        props: { identity, canRemove: false },
      }));
      await tick();
      await tick();

      expect(target.querySelector(".html-editor")).not.toBeNull();
      expect(notifications.find(notification => notification.message.includes("dispatchTransaction"))).toBeUndefined();
    } finally {
      proEntitlement.setValue(previousEntitlement);
    }
  });
});
