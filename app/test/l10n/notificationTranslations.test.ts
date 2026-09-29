import { afterEach, expect, test } from "vitest";
import { gt, setUILocale } from "../../l10n/l10n";

const slaTakenInWorkBody =
  "The timer follows the selected mailbox schedule until a message is taken into work. If it is taken outside working hours, the timer continues without pausing from that moment.";

afterEach(() => {
  setUILocale("en");
});

test("translates the taken-in-work SLA notification body into Russian", () => {
  gt([slaTakenInWorkBody]);
  setUILocale("ru");

  expect(gt([slaTakenInWorkBody])).toBe(
    "Таймер следует расписанию выбранного почтового ящика, пока запрос не взят в работу. Если запрос взят вне рабочего времени, с этого момента таймер продолжает отсчёт без паузы.",
  );
});

test("keeps the taken-in-work SLA notification body in English", () => {
  setUILocale("en");

  expect(gt([slaTakenInWorkBody])).toBe(slaTakenInWorkBody);
});
