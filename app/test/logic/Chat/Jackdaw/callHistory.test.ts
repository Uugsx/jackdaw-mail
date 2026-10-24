// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { expect, test } from "vitest";
import { callSummary, formatCallDuration } from "../../../../logic/Chat/Jackdaw/callHistory";

const base = { outgoing: false, started: null as Date | null, ended: new Date(1_000_000), endReason: null as any, missed: false };

test("длительность звонка", () => {
  expect(formatCallDuration(5)).toBe("0:05");
  expect(formatCallDuration(192)).toBe("3:12");
  expect(formatCallDuration(3725)).toBe("1:02:05");
});

test("строка истории для разных исходов звонка", () => {
  expect(callSummary({ ...base, outgoing: true, started: new Date(1_000_000 - 192_000) })).toBe("Outgoing call · 3:12");
  expect(callSummary({ ...base, started: new Date(1_000_000 - 5_000) })).toBe("Incoming call · 0:05");
  expect(callSummary({ ...base, outgoing: true, endReason: "declined" })).toBe("Outgoing call · declined");
  expect(callSummary({ ...base, outgoing: true, endReason: "dnd" })).toBe("Outgoing call · not reached");
  expect(callSummary({ ...base, outgoing: true, endReason: "no-answer" })).toBe("Outgoing call · no answer");
  expect(callSummary({ ...base, outgoing: true })).toBe("Outgoing call · cancelled");
  expect(callSummary({ ...base, missed: true, endReason: "no-answer" })).toBe("Missed call");
  expect(callSummary({ ...base, endReason: "answered-elsewhere" })).toBe("Incoming call · answered on another device");
  expect(callSummary({ ...base })).toBe("Incoming call · declined");
});
