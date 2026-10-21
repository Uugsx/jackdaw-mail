import { describe, expect, it } from "vitest";
import { CreateMIME } from "../../../../logic/Mail/SMTP/CreateMIME";

describe("Message-ID исходящего письма", () => {
  it("берёт локальный ID письма и оборачивает в угловые скобки", () => {
    expect(CreateMIME.getMessageIDHeader("0f1e-2d3c@example.com")).toBe("<0f1e-2d3c@example.com>");
  });

  it("не удваивает скобки у ID, прочитанного с сервера", () => {
    expect(CreateMIME.getMessageIDHeader("<abc@example.com>")).toBe("<abc@example.com>");
  });

  it("без ID или с непохожим на Message-ID значением отдаёт выбор nodemailer", () => {
    expect(CreateMIME.getMessageIDHeader(null)).toBeUndefined();
    expect(CreateMIME.getMessageIDHeader("")).toBeUndefined();
    expect(CreateMIME.getMessageIDHeader("AAMkAGI2THVSAAA=")).toBeUndefined();
    expect(CreateMIME.getMessageIDHeader("a b@example.com")).toBeUndefined();
  });
});
