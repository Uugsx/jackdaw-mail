// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import "../../../logic/app";
import { proEntitlement } from "../../../logic/Billing/ProEntitlement";

let resolveCheckout: (value: { monthly: boolean; yearly: boolean }) => void = () => {};

// Сеть в тесте не нужна: ответ сервиса лицензий отдаётся вручную, когда это нужно тесту.
vi.mock("../../../logic/Billing/Billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../logic/Billing/Billing")>()),
  fetchBillingCheckoutAvailability: vi.fn(() => new Promise((resolve) => { resolveCheckout = resolve; })),
  fetchBillingTrialAvailability: vi.fn(async () => false),
}));
vi.mock("../../../logic/Billing/ProEntitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../logic/Billing/ProEntitlement")>()),
  refreshProEntitlement: vi.fn(async () => proEntitlement.value),
}));

let Billing: any;
let mounted: ReturnType<typeof mount>[] = [];

function planButtonLabels(target: HTMLElement): string[] {
  return [...target.querySelectorAll(".plan-card button")].map(button => button.textContent?.trim() ?? "");
}

beforeAll(async () => {
  Billing = (await import("../../../frontend/Settings/Billing/Billing.svelte")).default;
});

beforeEach(() => {
  let values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  for (let instance of mounted) {
    unmount(instance);
  }
  mounted = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("кнопки покупки Pro", () => {
  test("после проверки магазина метка «Проверяем…» сменяется на покупку", async () => {
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(Billing, { target }));
    await tick();

    expect(planButtonLabels(target)).toEqual(["Checking…", "Checking…"]);

    resolveCheckout({ monthly: true, yearly: true });
    await tick();
    await tick();

    expect(planButtonLabels(target)).toEqual(["Buy monthly", "Buy yearly"]);
  });

  test("без магазина метка сообщает, что покупка недоступна", async () => {
    let target = document.createElement("div");
    document.body.append(target);
    mounted.push(mount(Billing, { target }));
    await tick();

    resolveCheckout({ monthly: false, yearly: false });
    await tick();
    await tick();

    expect(planButtonLabels(target)).toEqual(["Store unavailable", "Store unavailable"]);
  });
});
