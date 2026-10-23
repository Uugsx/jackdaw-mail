import {
  checkSendLaterTime, isSafeToRetrySend, kDefaultUndoSendDelay, nextMondayMorning, normalizeUndoSendDelay,
  retryDelayMs, sendErrorText, sortScheduledSends, tomorrowMorning, type ScheduledSend,
} from "../../../../logic/Mail/SendLater/SendLater";
import { describe, expect, test } from "vitest";

/** Местное время: тесты не зависят от пояса машины */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("время «Отправить позже»", () => {
  test("завтра утром — 8:00 следующего дня по местному времени", () => {
    expect(tomorrowMorning(local(2026, 10, 23, 15, 30))).toEqual(local(2026, 10, 24, 8));
    // Ночью «завтра» — по календарю, не через 24 часа
    expect(tomorrowMorning(local(2026, 10, 23, 0, 5))).toEqual(local(2026, 10, 24, 8));
    // Конец месяца и года
    expect(tomorrowMorning(local(2026, 12, 31, 22))).toEqual(local(2027, 1, 1, 8));
  });

  test("понедельник утром — ближайший понедельник в 8:00", () => {
    // Пятница 23.10.2026
    expect(nextMondayMorning(local(2026, 10, 23, 18))).toEqual(local(2026, 10, 26, 8));
    // Воскресенье
    expect(nextMondayMorning(local(2026, 10, 25, 23))).toEqual(local(2026, 10, 26, 8));
    // Понедельник до 8:00 — сегодня, после — через неделю
    expect(nextMondayMorning(local(2026, 10, 26, 7, 30))).toEqual(local(2026, 10, 26, 8));
    expect(nextMondayMorning(local(2026, 10, 26, 8))).toEqual(local(2026, 11, 2, 8));
    expect(nextMondayMorning(local(2026, 10, 26, 12))).toEqual(local(2026, 11, 2, 8));
  });

  test("переход на зимнее время не сдвигает 8:00", () => {
    // В Европе часы переводят в ночь на 25.10.2026; в любом поясе час остаётся 8
    expect(nextMondayMorning(local(2026, 10, 24, 12)).getHours()).toBe(8);
    expect(tomorrowMorning(local(2026, 10, 24, 12)).getHours()).toBe(8);
  });

  test("проверка выбранного времени", () => {
    let now = local(2026, 10, 23, 12);
    expect(checkSendLaterTime(local(2026, 10, 23, 12, 1), now)).toBeNull();
    expect(checkSendLaterTime(local(2026, 10, 23, 12), now)).toBe("past");
    expect(checkSendLaterTime(local(2026, 10, 22, 12), now)).toBe("past");
    expect(checkSendLaterTime(local(2027, 12, 1), now)).toBe("too-far");
    expect(checkSendLaterTime(new Date(NaN), now)).toBe("invalid");
    expect(checkSendLaterTime(null, now)).toBe("invalid");
  });
});

describe("задержка отмены", () => {
  test("только варианты из настроек, иначе 5 секунд", () => {
    for (let value of [0, 5, 10, 20, 30]) {
      expect(normalizeUndoSendDelay(value)).toBe(value);
    }
    expect(normalizeUndoSendDelay("10")).toBe(10);
    expect(normalizeUndoSendDelay(7)).toBe(kDefaultUndoSendDelay);
    expect(normalizeUndoSendDelay(undefined)).toBe(5);
    expect(normalizeUndoSendDelay("abc")).toBe(5);
  });
});

describe("повтор отправки", () => {
  test("без сети и при неразрешённом сервере — можно повторить", () => {
    expect(isSafeToRetrySend(new Error("anything"), false)).toBe(true);
    expect(isSafeToRetrySend(Object.assign(new Error("getaddrinfo ENOTFOUND mail.example.com"), {}))).toBe(true);
    expect(isSafeToRetrySend({ message: "fetch failed", cause: { code: "ECONNREFUSED" } })).toBe(true);
    expect(isSafeToRetrySend(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
  });

  test("обрыв, таймаут и ошибка сервера — не повторяем сами: письмо могло уйти", () => {
    expect(isSafeToRetrySend(new Error("socket hang up ECONNRESET"))).toBe(false);
    expect(isSafeToRetrySend(new Error("ETIMEDOUT"))).toBe(false);
    expect(isSafeToRetrySend(new Error("The mailbox is full"))).toBe(false);
    expect(isSafeToRetrySend(null)).toBe(false);
  });

  test("паузы растут и упираются в 15 минут", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(5)).toBe(900_000);
    expect(retryDelayMs(50)).toBe(900_000);
    expect(retryDelayMs(0)).toBe(60_000);
  });

  test("текст ошибки — одна строка без лишнего", () => {
    expect(sendErrorText(new Error("  Сервер\n  отклонил   письмо "))).toBe("Сервер отклонил письмо");
    expect(sendErrorText("x".repeat(600)).length).toBe(500);
  });
});

describe("порядок списка", () => {
  function item(id: number, status: ScheduledSend["status"], sendAt: Date): ScheduledSend {
    return {
      id, queueID: `q${id}`, accountID: 1, kind: "later", mode: "local", status, sendAt,
      attempts: 0, lastError: null, subject: "", recipients: [], createdAt: sendAt,
    };
  }

  test("сначала неотправленные, затем по времени", () => {
    let sorted = sortScheduledSends([
      item(1, "pending", local(2026, 10, 25)),
      item(2, "server", local(2026, 10, 24)),
      item(3, "failed", local(2026, 10, 26)),
      item(4, "paused", local(2026, 10, 27)),
    ]);
    expect(sorted.map(entry => entry.id)).toEqual([3, 4, 2, 1]);
  });
});
