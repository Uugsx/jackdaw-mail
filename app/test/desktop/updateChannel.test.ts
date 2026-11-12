import { describe, expect, test } from "vitest";
import { parseUpdateChannel, serializeUpdateChannel, shouldAllowPrerelease } from "../../../desktop/backend/updateChannel";

describe("канал обновлений", () => {
  test("по умолчанию — основной канал", () => {
    expect(parseUpdateChannel(null)).toBe("stable");
    expect(parseUpdateChannel("")).toBe("stable");
    expect(parseUpdateChannel("{битый")).toBe("stable");
    expect(parseUpdateChannel(JSON.stringify({ channel: "beta" }))).toBe("stable");
  });

  test("пробный канал сохраняется и читается", () => {
    expect(parseUpdateChannel(serializeUpdateChannel("pilot"))).toBe("pilot");
    expect(parseUpdateChannel(serializeUpdateChannel("stable"))).toBe("stable");
  });

  test("основной канал не видит prerelease, пробный видит", () => {
    expect(shouldAllowPrerelease("0.10.321", "stable")).toBe(false);
    expect(shouldAllowPrerelease("0.10.321", "pilot")).toBe(true);
  });

  test("старые -dev сборки по-прежнему видят выпуски", () => {
    expect(shouldAllowPrerelease("0.9.4-dev.20260101120000", "stable")).toBe(true);
  });
});
