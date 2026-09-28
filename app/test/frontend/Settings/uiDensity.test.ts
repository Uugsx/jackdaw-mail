import { describe, expect, it } from "vitest";
import { normalizeUIDensity } from "../../../frontend/Settings/Global/uiDensity";

describe("interface density", () => {
  it.each(["extra-compact", "compact", "normal", "large"])("keeps the %s option", (density) => {
    expect(normalizeUIDensity(density)).toBe(density);
  });

  it.each([undefined, null, "", "invalid", 1])("falls back for %s", (density) => {
    expect(normalizeUIDensity(density)).toBe("normal");
  });
});
