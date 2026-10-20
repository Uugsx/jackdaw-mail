import { describe, expect, test } from "vitest";
import { collisionTag, normalizeMessageID } from "../../../../logic/Mail/Collision/collisionTag";

describe("метка письма общего ящика", () => {
  test("одинакова у всех членов ящика и не зависит от записи Message-ID", () => {
    let tag = collisionTag("team@example.com", "<abc.123@mail.example.com>");
    expect(tag).toMatch(/^[0-9a-f]{64}$/);
    expect(collisionTag("Team@Example.com ", " abc.123@mail.example.com")).toBe(tag);
  });

  test("разная для разных ящиков и писем", () => {
    let tag = collisionTag("team@example.com", "<abc@x>");
    expect(collisionTag("sales@example.com", "<abc@x>")).not.toBe(tag);
    expect(collisionTag("team@example.com", "<abd@x>")).not.toBe(tag);
  });

  test("не содержит Message-ID", () => {
    let tag = collisionTag("team@example.com", "<deadbeef@x>");
    expect(tag).not.toContain("deadbeef");
  });

  test("без пригодного Message-ID метки нет", () => {
    for (let value of [null, undefined, "", "   ", "<>", "a b@c", "x".repeat(999)]) {
      expect(collisionTag("team@example.com", value)).toBeNull();
    }
    expect(normalizeMessageID("<<a@b>>")).toBe("a@b");
  });
});
