import { describe, expect, test } from "vitest";
import {
  DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
  getDueResponseReminderIntervals,
  getNextResponseReminderAt,
  getResponseSlaStartAt,
  getResponseSlaProgress,
  isResponseReminderRequestAfterActivation,
  normalizeResponseReminderConfig,
  normalizeResponseReminderIntervals,
  responseReminderKey,
  isResponseRequestExcluded,
  shouldNotifyResponseReminderEvent,
  isResponseRequestTakenInWork,
  isResponseRequestSuppressedUntilTakenInWork,
  type PendingResponseRequest,
} from "../../../logic/Reports/ResponseReminder";
import type { WorkingHoursSchedule } from "../../../logic/Reports/WorkingHours";

const receivedAt = new Date("2026-09-09T09:00:00.000Z");
const request: PendingResponseRequest = {
  accountId: 7,
  folderId: 11,
  emailId: 42,
  messageID: "<request-42>",
  threadID: "<thread-42>",
  subject: "Access request",
  receivedAt,
  categoryNames: ["Никита Левченко"],
};

const weekdaySchedule: WorkingHoursSchedule = {
  days: [
    { enabled: true, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
    { enabled: true, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
    { enabled: true, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
    { enabled: true, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
    { enabled: true, startMinutes: 9 * 60 + 30, endMinutes: 16 * 60 },
    { enabled: false, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
    { enabled: false, startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 },
  ],
};

function reminderConfig(intervalsMinutes: number[]) {
  return {
    enabled: true,
    intervalsMinutes,
    excludedCategoryNames: [],
    includeUncategorized: false,
    notifyWhenOverdue: false,
    notifyWhenTakenInWork: false,
  };
}

describe("ResponseReminder", () => {
  test("normalizes intervals, removes duplicates, and applies safe defaults", () => {
    expect(
      normalizeResponseReminderIntervals([25, 10, 25, 0, 10.5, 20]),
    ).toEqual([10, 20, 25]);
    expect(normalizeResponseReminderIntervals([])).toEqual(
      DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
    );
    expect(
      normalizeResponseReminderConfig({
        enabled: true,
        intervalsMinutes: [15],
      }),
    ).toEqual({
      enabled: true,
      intervalsMinutes: [15],
      excludedCategoryNames: [],
      includeUncategorized: false,
      notifyWhenOverdue: false,
      notifyWhenTakenInWork: false,
    });
  });

  test("определяет принятие в работу по прочтению или категории", () => {
    expect(isResponseRequestTakenInWork({ ...request, isRead: true })).toBe(
      true,
    );
    expect(
      isResponseRequestTakenInWork({ ...request, categoryNames: [] }),
    ).toBe(false);
    expect(
      isResponseRequestTakenInWork({ ...request, categoryNames: ["  "] }),
    ).toBe(false);
  });

  test("не считает письмо взятым в работу, если его категория исключена из SLA", () => {
    const excludedRequest = {
      ...request,
      categoryNames: ["Переписка (мы в копии)"],
    };
    expect(
      isResponseRequestExcluded(excludedRequest, ["Переписка (мы в копии)"]),
    ).toBe(true);
    expect(
      isResponseRequestTakenInWork(
        { ...excludedRequest, isRead: true },
        ["Переписка (мы в копии)"],
      ),
    ).toBe(false);
  });

  test("снимает письмо с SLA после возврата в непрочитанное состояние", () => {
    const trackedRequest = {
      ...request,
      categoryNames: [],
      isRead: false,
    };
    const takenInWorkState = {
      receivedAt: request.receivedAt.getTime(),
      firedIntervalsMinutes: [10],
      startedAt: new Date("2026-09-09T08:55:00.000Z").getTime(),
      startedAtSource: "taken-in-work" as const,
      takenInWork: true,
      overdue: false,
    };

    expect(
      isResponseRequestSuppressedUntilTakenInWork(
        trackedRequest,
        takenInWorkState,
      ),
    ).toBe(true);
    expect(
      isResponseRequestSuppressedUntilTakenInWork(
        { ...trackedRequest, isRead: true },
        takenInWorkState,
      ),
    ).toBe(false);
    expect(
      isResponseRequestSuppressedUntilTakenInWork(
        {
          ...trackedRequest,
          categoryNames: ["Никита Галкин"],
        },
        takenInWorkState,
      ),
    ).toBe(false);
    expect(
      isResponseRequestSuppressedUntilTakenInWork(trackedRequest, {
        receivedAt: request.receivedAt.getTime(),
        firedIntervalsMinutes: [],
        takenInWork: false,
        suppressedUntilTakenInWork: true,
      }),
    ).toBe(true);
  });

  test("сигналит только при переходе состояния и не повторяет его", () => {
    const previous = {
      receivedAt: receivedAt.getTime(),
      firedIntervalsMinutes: [],
      takenInWork: false,
      overdue: false,
    };

    expect(
      shouldNotifyResponseReminderEvent(
        "taken-in-work",
        previous,
        receivedAt.getTime(),
        true,
      ),
    ).toBe(true);
    expect(
      shouldNotifyResponseReminderEvent(
        "taken-in-work",
        { ...previous, takenInWork: true },
        receivedAt.getTime(),
        true,
      ),
    ).toBe(false);
    expect(
      shouldNotifyResponseReminderEvent(
        "overdue",
        previous,
        receivedAt.getTime(),
        true,
      ),
    ).toBe(true);
    expect(
      shouldNotifyResponseReminderEvent(
        "overdue",
        previous,
        receivedAt.getTime() + 1,
        true,
      ),
    ).toBe(false);
  });

  test("returns only crossed points and keeps a fired point one-shot", () => {
    const now = new Date("2026-09-09T09:21:00.000Z");
    const config = reminderConfig([10, 20, 25]);
    expect(getDueResponseReminderIntervals(request, config, null, now)).toEqual(
      [10, 20],
    );
    expect(
      getDueResponseReminderIntervals(
        request,
        config,
        { receivedAt: receivedAt.getTime(), firedIntervalsMinutes: [10] },
        now,
      ),
    ).toEqual([20]);
  });

  test("catches up after sleep without inventing a second notification point", () => {
    const now = new Date("2026-09-09T09:31:00.000Z");
    const config = reminderConfig([10, 20, 25]);
    expect(getDueResponseReminderIntervals(request, config, null, now)).toEqual(
      [10, 20, 25],
    );
    expect(
      getNextResponseReminderAt(
        request,
        config,
        {
          receivedAt: receivedAt.getTime(),
          firedIntervalsMinutes: [10, 20, 25],
        },
        now,
      ),
    ).toBeNull();
  });

  test("does not reuse state from a different received timestamp", () => {
    const now = new Date("2026-09-09T09:21:00.000Z");
    expect(
      getDueResponseReminderIntervals(
        request,
        reminderConfig([10, 20]),
        { receivedAt: receivedAt.getTime() - 1, firedIntervalsMinutes: [10] },
        now,
      ),
    ).toEqual([10, 20]);
    expect(responseReminderKey(request)).toBe("7:11:42");
  });

  test("считает точки напоминаний в рабочих минутах и пропускает выходные", () => {
    const receivedAt = new Date(2026, 8, 4, 15, 50);
    const weekendRequest = { ...request, receivedAt };
    const mondayMorning = new Date(2026, 8, 7, 9, 40);
    const config = reminderConfig([10, 20]);

    expect(
      getDueResponseReminderIntervals(
        weekendRequest,
        config,
        null,
        mondayMorning,
        weekdaySchedule,
      ),
    ).toEqual([10, 20]);
    expect(
      getNextResponseReminderAt(
        weekendRequest,
        config,
        { receivedAt: receivedAt.getTime(), firedIntervalsMinutes: [10] },
        receivedAt,
        weekdaySchedule,
      ),
    ).toEqual(new Date(2026, 8, 7, 9, 40));
  });

  test("считает остаток SLA от получения письма, а не от назначения категории", () => {
    const receivedAt = new Date(2026, 8, 9, 11, 0);
    const assignedAt = new Date(2026, 8, 9, 11, 20);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: ["Никита Галкин"] },
      30,
      assignedAt,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(20 * 60);
    expect(progress.remainingSeconds).toBe(10 * 60);
    expect(progress.overdueSeconds).toBe(0);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 9, 11, 30));
    expect(progress.status).toBe("within-target");
  });

  test("не сдвигает SLA после прочтения письма в рабочее время", () => {
    const receivedAt = new Date(2026, 8, 9, 9, 40);
    const readAt = new Date(2026, 8, 9, 9, 47);
    const progress = getResponseSlaProgress(
      {
        ...request,
        receivedAt,
        categoryNames: ["Никита Галкин"],
        isRead: true,
      },
      30,
      readAt,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(7 * 60);
    expect(progress.remainingSeconds).toBe(23 * 60);
    expect(progress.overdueSeconds).toBe(0);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 9, 10, 10));
    expect(progress.status).toBe("within-target");
  });

  test("не сдвигает точку напоминания после прочтения письма", () => {
    const receivedAt = new Date(2026, 8, 9, 9, 40);
    const now = new Date(2026, 8, 9, 9, 47);
    const config = reminderConfig([10]);

    expect(
      getNextResponseReminderAt(
        {
          ...request,
          receivedAt,
          categoryNames: ["Никита Галкин"],
          isRead: true,
        },
        config,
        {
          receivedAt: receivedAt.getTime(),
          firedIntervalsMinutes: [],
        },
        now,
        weekdaySchedule,
      ),
    ).toEqual(new Date(2026, 8, 9, 9, 50));
  });

  test("не увеличивает SLA ночью и переносит дедлайн на следующий рабочий день", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 30);
    const now = new Date(2026, 8, 9, 19, 0);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: [], isRead: false },
      30,
      now,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(0);
    expect(progress.remainingSeconds).toBe(30 * 60);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 10, 10, 0));
    expect(progress.status).toBe("waiting-for-working-hours");
  });

  test("не запускает непрерывный режим без зафиксированного перехода в работу", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 12);
    const now = new Date(2026, 8, 9, 18, 25);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: [], isRead: true },
      30,
      now,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(0);
    expect(progress.remainingSeconds).toBe(30 * 60);
    expect(progress.overdueSeconds).toBe(0);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 10, 10, 0));
    expect(progress.status).toBe("waiting-for-working-hours");
  });

  test("использует сохраненный момент принятия в работу вне графика", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 12);
    const takenInWorkAt = new Date(2026, 8, 9, 18, 20);
    const now = new Date(2026, 8, 9, 18, 25);

    expect(
      getResponseSlaStartAt(
        { ...request, receivedAt, categoryNames: [], isRead: true },
        now,
        weekdaySchedule,
      ),
    ).toEqual(receivedAt);
    expect(
      getResponseSlaStartAt(
        { ...request, receivedAt, categoryNames: [], isRead: false },
        now,
        weekdaySchedule,
        takenInWorkAt.getTime(),
      ),
    ).toEqual(takenInWorkAt);
  });

  test("не запускает новый таймер для уже прочитанного письма при первом наблюдении", () => {
    const receivedAt = new Date(2026, 8, 9, 8, 56);
    const now = new Date(2026, 8, 9, 11, 35);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: [], isRead: true },
      30,
      now,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(2 * 60 * 60 + 5 * 60);
    expect(progress.remainingSeconds).toBe(0);
    expect(progress.overdueSeconds).toBe(1 * 60 * 60 + 35 * 60);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 9, 10, 0));
    expect(progress.status).toBe("over-target");
  });

  test("считает непрерывное время после принятия в работу вне графика", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 12);
    const slaStartedAt = new Date(2026, 8, 9, 18, 20);
    const now = new Date(2026, 8, 9, 18, 25);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: [], isRead: true },
      30,
      now,
      weekdaySchedule,
      slaStartedAt,
    );

    expect(progress.elapsedSeconds).toBe(5 * 60);
    expect(progress.remainingSeconds).toBe(25 * 60);
    expect(progress.overdueSeconds).toBe(0);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 9, 18, 50));
    expect(progress.status).toBe("within-target");
  });

  test("считает непрерывное время после назначения категории вне графика", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 12);
    const slaStartedAt = new Date(2026, 8, 9, 18, 20);
    const now = new Date(2026, 8, 9, 18, 25);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt, categoryNames: ["Никита Галкин"], isRead: false },
      30,
      now,
      weekdaySchedule,
      slaStartedAt,
    );

    expect(progress.elapsedSeconds).toBe(5 * 60);
    expect(progress.remainingSeconds).toBe(25 * 60);
    expect(progress.overdueSeconds).toBe(0);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 9, 18, 50));
    expect(progress.status).toBe("within-target");
  });

  test("напоминание для принятого вне графика письма считает от сохраненного старта", () => {
    const receivedAt = new Date(2026, 8, 9, 18, 12);
    const slaStartedAt = new Date(2026, 8, 9, 18, 20);
    const now = new Date(2026, 8, 9, 18, 25);
    const config = reminderConfig([10, 20]);

    expect(
      getNextResponseReminderAt(
        { ...request, receivedAt, categoryNames: [], isRead: true },
        config,
        {
          receivedAt: receivedAt.getTime(),
          firedIntervalsMinutes: [],
          startedAt: slaStartedAt.getTime(),
          startedAtSource: "taken-in-work",
        },
        now,
        weekdaySchedule,
      ),
    ).toEqual(new Date(2026, 8, 9, 18, 30));
  });

  test("переносит остаток пятничного SLA через выходные", () => {
    const receivedAt = new Date(2026, 8, 4, 15, 50);
    const mondayMorning = new Date(2026, 8, 7, 9, 40);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt },
      30,
      mondayMorning,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(20 * 60);
    expect(progress.remainingSeconds).toBe(10 * 60);
    expect(progress.deadlineAt).toEqual(new Date(2026, 8, 7, 9, 50));
    expect(progress.status).toBe("within-target");
  });

  test("помечает просрочку после прохождения рабочего норматива", () => {
    const receivedAt = new Date(2026, 8, 9, 11, 0);
    const now = new Date(2026, 8, 9, 11, 35);
    const progress = getResponseSlaProgress(
      { ...request, receivedAt },
      30,
      now,
      weekdaySchedule,
    );

    expect(progress.elapsedSeconds).toBe(35 * 60);
    expect(progress.remainingSeconds).toBe(0);
    expect(progress.overdueSeconds).toBe(5 * 60);
    expect(progress.status).toBe("over-target");
  });

  test("отсекает письма из архива, полученные до включения контроля", () => {
    expect(
      isResponseReminderRequestAfterActivation(
        request,
        new Date("2026-09-09T09:00:01.000Z").getTime(),
      ),
    ).toBe(false);
    expect(
      isResponseReminderRequestAfterActivation(request, receivedAt.getTime()),
    ).toBe(true);
  });
});
