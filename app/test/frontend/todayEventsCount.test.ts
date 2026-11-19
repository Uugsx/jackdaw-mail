import { describe, it, expect } from "vitest";
import { isEventLeftToday } from "../../frontend/Calendar/todayEventsCount";

const now = new Date(2026, 10, 19, 12, 0);
const at = (h: number, d = 19) => new Date(2026, 10, d, h, 0);
const ev = (o: any) => ({ allDay: false, isCancelled: false, ...o });

describe("isEventLeftToday", () => {
  it("будущее сегодня", () => expect(isEventLeftToday(ev({ startTime: at(15), endTime: at(16) }), now)).toBe(true));
  it("идёт сейчас", () => expect(isEventLeftToday(ev({ startTime: at(11), endTime: at(13) }), now)).toBe(true));
  it("уже закончилось", () => expect(isEventLeftToday(ev({ startTime: at(9), endTime: at(10) }), now)).toBe(false));
  it("завтра", () => expect(isEventLeftToday(ev({ startTime: at(10, 20), endTime: at(11, 20) }), now)).toBe(false));
  it("отменено", () => expect(isEventLeftToday(ev({ startTime: at(15), endTime: at(16), isCancelled: true }), now)).toBe(false));
  it("весь день сегодня", () => expect(isEventLeftToday(ev({ allDay: true, startTime: at(0), endTime: at(0, 20) }), now)).toBe(true));
  it("весь день вчера", () => expect(isEventLeftToday(ev({ allDay: true, startTime: at(0, 18), endTime: at(0, 19) }), now)).toBe(false));
});
