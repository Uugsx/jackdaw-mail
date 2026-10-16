import { describe, expect, test } from "vitest";
import { isTrialCredential } from "../../../logic/Billing/ProEntitlement";

function stored(credentialType: "license" | "trial" | undefined, plan: string) {
  return { credentialType, payload: { plan } } as any;
}

describe("определение пробного периода", () => {
  test("ключ с планом trial остаётся лицензией, если сохранён как лицензия", () => {
    expect(isTrialCredential(stored("license", "trial"))).toBe(false);
  });

  test("пробный период устройства определяется по типу учётных данных", () => {
    expect(isTrialCredential(stored("trial", "trial"))).toBe(true);
    expect(isTrialCredential(stored("trial", "yearly"))).toBe(true);
  });

  test("для старых записей без типа решает план", () => {
    expect(isTrialCredential(stored(undefined, "trial"))).toBe(true);
    expect(isTrialCredential(stored(undefined, "monthly"))).toBe(false);
  });

  test("без сохранённой лицензии это не пробный период", () => {
    expect(isTrialCredential(null)).toBe(false);
    expect(isTrialCredential(undefined)).toBe(false);
  });
});
