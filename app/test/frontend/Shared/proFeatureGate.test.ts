// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import "../../../logic/app";
import { PRO_FEATURE_KEYS } from "../../../logic/Billing/Billing";
import { proEntitlement, type ProEntitlementState } from "../../../logic/Billing/ProEntitlement";

// Проверка лицензии на сервере в тесте не нужна: состояние задаётся вручную.
vi.mock("../../../logic/Billing/ProEntitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../logic/Billing/ProEntitlement")>()),
  refreshProEntitlement: vi.fn(async () => proEntitlement.value),
}));

let ProFeatureGate: any;
let mounted: ReturnType<typeof mount>[] = [];

function state(overrides: Partial<ProEntitlementState>): ProEntitlementState {
  return {
    status: "active",
    plan: "yearly",
    features: [...PRO_FEATURE_KEYS],
    validUntil: null,
    keyLast4: null,
    message: null,
    lastValidatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  ProFeatureGate = (await import("../../../frontend/Shared/ProFeatureGate.svelte")).default;
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
});

describe("экран Pro-функции", () => {
  test("открывается сразу, когда лицензия подтвердилась уже после показа", async () => {
    let previous = proEntitlement.value;
    proEntitlement.setValue(state({ status: "error", features: [], message: "offline" }));
    let target = document.createElement("div");
    document.body.append(target);

    try {
      mounted.push(mount(ProFeatureGate, { target, props: { feature: "live-sla" } }));
      await tick();
      expect(target.querySelector(".pro-gate")).not.toBeNull();

      proEntitlement.setValue(state({ status: "active" }));
      await tick();
      await tick();

      expect(target.querySelector(".pro-gate")).toBeNull();
    } finally {
      proEntitlement.setValue(previous);
    }
  });

  test("закрывается, когда доступ пропал", async () => {
    let previous = proEntitlement.value;
    proEntitlement.setValue(state({ status: "active" }));
    let target = document.createElement("div");
    document.body.append(target);

    try {
      mounted.push(mount(ProFeatureGate, { target, props: { feature: "reports" } }));
      await tick();
      expect(target.querySelector(".pro-gate")).toBeNull();

      proEntitlement.setValue(state({ status: "expired", features: [] }));
      await tick();
      await tick();

      expect(target.querySelector(".pro-gate")).not.toBeNull();
    } finally {
      proEntitlement.setValue(previous);
    }
  });

  test("в узком виде не создаёт второй основной ориентир страницы", async () => {
    let previous = proEntitlement.value;
    proEntitlement.setValue(state({ status: "error", features: [], message: "offline" }));
    let target = document.createElement("div");
    document.body.append(target);

    try {
      mounted.push(mount(ProFeatureGate, { target, props: { feature: "live-sla", compact: true } }));
      await tick();

      expect(target.querySelector("main")).toBeNull();
      expect(target.querySelector("section.pro-gate.compact")).not.toBeNull();
    } finally {
      proEntitlement.setValue(previous);
    }
  });
});
