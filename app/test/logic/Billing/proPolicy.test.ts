import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PRO_FEATURE_KEYS } from "../../../logic/Billing/Billing";
import { proEntitlement } from "../../../logic/Billing/ProEntitlement";
import { assertCanAddMailAccount, canAddMailAccount } from "../../../logic/Billing/ProPolicy";

describe("политика почтовых аккаунтов", () => {
  let previousEntitlement = proEntitlement.value;

  beforeEach(() => {
    previousEntitlement = proEntitlement.value;
    proEntitlement.setValue({
      status: "not-activated",
      plan: null,
      features: [],
      validUntil: null,
      keyLast4: null,
      message: null,
      lastValidatedAt: null,
    });
  });

  afterEach(() => {
    proEntitlement.setValue(previousEntitlement);
  });

  test("разрешает первый аккаунт и блокирует второй без Pro", () => {
    expect(canAddMailAccount(0)).toBe(true);
    expect(canAddMailAccount(1)).toBe(false);
    expect(() => assertCanAddMailAccount(1)).toThrow(/Jackdaw Pro/);
  });

  test("разрешает дополнительные аккаунты при активном Pro", () => {
    proEntitlement.setValue({
      status: "active",
      plan: "yearly",
      features: [...PRO_FEATURE_KEYS],
      validUntil: null,
      keyLast4: null,
      message: null,
      lastValidatedAt: new Date().toISOString(),
    });

    expect(canAddMailAccount(1)).toBe(true);
    expect(canAddMailAccount(10)).toBe(true);
  });
});
