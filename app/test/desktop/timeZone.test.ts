import { describe, expect, test } from "vitest";
import { parseTimeZone, serializeTimeZone, validTimeZone } from "../../../desktop/backend/timeZone";

describe("часовой пояс программы", () => {
  test("сохранённое значение читается обратно", () => {
    expect(parseTimeZone(serializeTimeZone("Europe/Moscow"))).toBe("Europe/Moscow");
    expect(parseTimeZone(serializeTimeZone("Asia/Tashkent"))).toBe("Asia/Tashkent");
  });
  test("«как на компьютере» — null", () => {
    expect(parseTimeZone(serializeTimeZone(null))).toBeNull();
    expect(parseTimeZone("")).toBeNull();
    expect(parseTimeZone(null)).toBeNull();
  });
  test("неизвестное имя отбрасывается", () => {
    expect(validTimeZone("Mars/Olympus")).toBeNull();
    expect(validTimeZone(42)).toBeNull();
    expect(parseTimeZone("{broken")).toBeNull();
  });
});
