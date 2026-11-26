import { describe, expect, test } from "vitest";
import { decodeText } from "../../../../frontend/Mail/Attachments/attachmentPreview";

describe("decodeText", () => {
  test("UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("Москва <city>"))).toBe("Москва <city>");
  });

  test("Windows-1251", () => {
    // «Москва» в Windows-1251
    let bytes = new Uint8Array([0xCC, 0xEE, 0xF1, 0xEA, 0xE2, 0xE0]);
    expect(decodeText(bytes)).toBe("Москва");
  });

  test("UTF-16 LE с BOM", () => {
    let bytes = new Uint8Array([0xFF, 0xFE, 0x1C, 0x04, 0x30, 0x04]);
    expect(decodeText(bytes)).toBe("Ма");
  });
});
