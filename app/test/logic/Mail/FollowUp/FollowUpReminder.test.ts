import { describe, expect, test } from "vitest";
import {
  computeFollowUpDueAt,
  findFollowUpReply,
  followUpState,
  isAutomatedFollowUpMessage,
  isFollowUpReply,
  normalizeFollowUpChoice,
  normalizeReplySubject,
  shouldNotifyFollowUp,
  snoozeFollowUpDueAt,
  type FollowUpReminder,
  type FollowUpReplyCandidate,
} from "../../../../logic/Mail/FollowUp/FollowUpReminder";
import {
  DEFAULT_WORKING_HOURS_SCHEDULE,
  type WorkingHoursSchedule,
} from "../../../../logic/Reports/WorkingHours";

/** Локальное время: расписание рабочих часов считает в местном часовом поясе. */
function local(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

const own = ["me@example.com", "team@example.com"];

function reminder(overrides: Partial<FollowUpReminder> = {}): FollowUpReminder {
  return {
    id: 1,
    accountId: 1,
    messageID: "<sent-1@example.com>",
    threadID: "conversation-1",
    emailId: 10,
    folderId: 2,
    folderAccountId: 1,
    subject: "Contract draft",
    recipients: ["bob@client.com", "carol@client.com"],
    sentAt: local(2026, 10, 19, 10),
    dueAt: local(2026, 10, 20, 10),
    scheduleMode: "calendar",
    durationDays: 1,
    status: "waiting",
    notifiedAt: null,
    repliedAt: null,
    createdAt: local(2026, 10, 19, 10),
    ...overrides,
  };
}

function candidate(overrides: Partial<FollowUpReplyCandidate> = {}): FollowUpReplyCandidate {
  return {
    emailId: 20,
    messageID: "<reply-1@client.com>",
    parentMsgID: null,
    threadID: null,
    fromAddress: "bob@client.com",
    fromName: "Bob",
    subject: "Re: Contract draft",
    receivedAt: local(2026, 10, 19, 15),
    outgoing: false,
    ...overrides,
  };
}

describe("срок напоминания", () => {
  test("календарные дни: то же локальное время через N суток", () => {
    let sentAt = local(2026, 10, 16, 15, 30); // пятница
    expect(computeFollowUpDueAt({ mode: "calendar", days: 1 }, sentAt)).toEqual(local(2026, 10, 17, 15, 30));
    expect(computeFollowUpDueAt({ mode: "calendar", days: 3 }, sentAt)).toEqual(local(2026, 10, 19, 15, 30));
    expect(computeFollowUpDueAt({ mode: "calendar", days: 7 }, sentAt)).toEqual(local(2026, 10, 23, 15, 30));
  });

  test("рабочее время: выходные пропускаются по расписанию ящика", () => {
    let friday = local(2026, 10, 16, 15);
    expect(computeFollowUpDueAt({ mode: "working", days: 1 }, friday, DEFAULT_WORKING_HOURS_SCHEDULE))
      .toEqual(local(2026, 10, 19, 15));
    expect(computeFollowUpDueAt({ mode: "working", days: 3 }, friday, DEFAULT_WORKING_HOURS_SCHEDULE))
      .toEqual(local(2026, 10, 21, 15));
  });

  test("рабочее время: письмо, отправленное в выходной, считается с начала рабочего дня", () => {
    let saturday = local(2026, 10, 17, 12);
    expect(computeFollowUpDueAt({ mode: "working", days: 1 }, saturday, DEFAULT_WORKING_HOURS_SCHEDULE))
      .toEqual(local(2026, 10, 19, 18));
  });

  test("рабочее время: своё расписание ящика", () => {
    let schedule: WorkingHoursSchedule = {
      days: DEFAULT_WORKING_HOURS_SCHEDULE.days.map((day, index) => ({
        ...day,
        enabled: index < 4, // пн–чт
        startMinutes: 10 * 60,
        endMinutes: 14 * 60,
      })),
    };
    let thursday = local(2026, 10, 15, 12);
    expect(computeFollowUpDueAt({ mode: "working", days: 1 }, thursday, schedule))
      .toEqual(local(2026, 10, 19, 12));
  });

  test("рабочее время без рабочих дней: срок не вычислить", () => {
    let schedule: WorkingHoursSchedule = {
      days: DEFAULT_WORKING_HOURS_SCHEDULE.days.map(day => ({ ...day, enabled: false })),
    };
    expect(computeFollowUpDueAt({ mode: "working", days: 1 }, local(2026, 10, 15, 12), schedule)).toBeNull();
  });

  test("к дате", () => {
    let dueAt = local(2026, 11, 1, 9);
    expect(computeFollowUpDueAt({ mode: "date", dueAt }, local(2026, 10, 15, 12))).toEqual(dueAt);
  });

  test("отложить: от текущего момента", () => {
    expect(snoozeFollowUpDueAt(local(2026, 10, 20, 11), 3)).toEqual(local(2026, 10, 23, 11));
  });

  test("нормализация выбора из IPC", () => {
    expect(normalizeFollowUpChoice({ mode: "working", days: 3 })).toEqual({ mode: "working", days: 3 });
    expect(normalizeFollowUpChoice({ mode: "date", dueAt: "2026-11-01T09:00:00.000Z" }))
      .toEqual({ mode: "date", dueAt: new Date("2026-11-01T09:00:00.000Z") });
    expect(normalizeFollowUpChoice({ mode: "calendar", days: 0 })).toBeNull();
    expect(normalizeFollowUpChoice({ mode: "calendar", days: 1.5 })).toBeNull();
    expect(normalizeFollowUpChoice({ mode: "date", dueAt: "nonsense" })).toBeNull();
    expect(normalizeFollowUpChoice({ mode: "hourly", days: 1 })).toBeNull();
    expect(normalizeFollowUpChoice(null)).toBeNull();
  });
});

describe("уведомление в срок", () => {
  test("до срока — ждёт, после — просрочено", () => {
    let item = reminder();
    expect(followUpState(item, local(2026, 10, 20, 9))).toBe("waiting");
    expect(followUpState(item, local(2026, 10, 20, 10))).toBe("overdue");
    expect(followUpState({ ...item, status: "replied" }, local(2026, 10, 21))).toBe("replied");
  });

  test("не чаще одного раза на срок", () => {
    let item = reminder();
    let now = local(2026, 10, 20, 11);
    expect(shouldNotifyFollowUp(item, local(2026, 10, 20, 9))).toBe(false);
    expect(shouldNotifyFollowUp(item, now)).toBe(true);
    expect(shouldNotifyFollowUp({ ...item, notifiedAt: now }, local(2026, 10, 20, 12))).toBe(false);
    // Отложили: по новому сроку уведомление снова один раз
    let snoozed = { ...item, notifiedAt: now, dueAt: local(2026, 10, 21, 11) };
    expect(shouldNotifyFollowUp(snoozed, local(2026, 10, 21, 12))).toBe(true);
  });

  test("после запуска ждёт синхронизацию, прежде чем сообщить о просрочке", () => {
    let item = reminder();
    let startedAt = local(2026, 10, 22, 9);
    let notBefore = new Date(startedAt.getTime() + 90_000);
    expect(shouldNotifyFollowUp(item, startedAt, notBefore)).toBe(false);
    expect(shouldNotifyFollowUp(item, new Date(notBefore.getTime() + 1), notBefore)).toBe(true);
  });

  test("отвеченное и снятое не уведомляют", () => {
    expect(shouldNotifyFollowUp(reminder({ status: "replied" }), local(2026, 10, 21))).toBe(false);
    expect(shouldNotifyFollowUp(reminder({ status: "cancelled" }), local(2026, 10, 21))).toBe(false);
  });
});

describe("автоответы и уведомления о доставке", () => {
  test.each([
    "Automatic reply: Contract draft",
    "Autoreply: Contract draft",
    "Out of Office: Contract draft",
    "Автоответ: Contract draft",
    "Автоматический ответ: Contract draft",
    "Réponse automatique : Contract draft",
    "Abwesenheitsnotiz: Contract draft",
    "Undeliverable: Contract draft",
    "Delivered: Contract draft",
    "Read: Contract draft",
    "Delivery Status Notification (Failure)",
    "Mail delivery failed: returning message to sender",
    "Не доставлено: Contract draft",
    "Доставлено: Contract draft",
    "Прочитано: Contract draft",
    "Lu : Contract draft",
    "Non remis : Contract draft",
  ])("тема «%s»", subject => {
    expect(isAutomatedFollowUpMessage({ subject, fromAddress: "bob@client.com", fromName: "Bob" })).toBe(true);
  });

  test.each([
    "mailer-daemon@client.com",
    "postmaster@client.com",
    "noreply@client.com",
    "no-reply@client.com",
    "do-not-reply@client.com",
  ])("служебный отправитель %s", fromAddress => {
    expect(isAutomatedFollowUpMessage({ subject: "Re: Contract draft", fromAddress, fromName: null })).toBe(true);
  });

  test("заголовки автоответа", () => {
    let base = { subject: "Re: Contract draft", fromAddress: "bob@client.com", fromName: "Bob" };
    expect(isAutomatedFollowUpMessage({ ...base, headers: { "Auto-Submitted": "auto-replied" } })).toBe(true);
    expect(isAutomatedFollowUpMessage({ ...base, headers: new Map([["x-autoreply", "yes"]]) })).toBe(true);
    expect(isAutomatedFollowUpMessage({ ...base, headers: { "X-Auto-Response-Suppress": "All" } })).toBe(true);
    expect(isAutomatedFollowUpMessage({ ...base, headers: { "Content-Type": "multipart/report; report-type=delivery-status" } })).toBe(true);
    expect(isAutomatedFollowUpMessage({ ...base, headers: { "Auto-Submitted": "no" } })).toBe(false);
  });

  test("обычные ответы не считаются автоматическими", () => {
    for (let subject of ["Re: Contract draft", "Ответ: Contract draft", "Re: Out of stock items", "Readiness review"]) {
      expect(isAutomatedFollowUpMessage({ subject, fromAddress: "bob@client.com", fromName: "Bob" })).toBe(false);
    }
  });
});

describe("тема без префиксов", () => {
  test("префиксы ответа на разных языках", () => {
    expect(normalizeReplySubject("Re: RE: Contract draft")).toBe("contract draft");
    expect(normalizeReplySubject("AW: Contract draft")).toBe("contract draft");
    expect(normalizeReplySubject("Ответ: Отв: Contract draft")).toBe("contract draft");
    expect(normalizeReplySubject("RE[2]: Contract  draft")).toBe("contract draft");
    expect(normalizeReplySubject("TR : Contract draft")).toBe("contract draft");
    expect(normalizeReplySubject("Fwd: Contract draft")).toBe("contract draft");
    expect(normalizeReplySubject("Readiness review")).toBe("readiness review");
  });
});

describe("определение ответа", () => {
  test("In-Reply-To на отслеживаемое письмо — ответ от любого отправителя", () => {
    let reply = candidate({ parentMsgID: "<sent-1@example.com>", fromAddress: "dave@client.com", subject: "Contract" });
    expect(isFollowUpReply(reminder(), reply, own)).toBe(true);
  });

  test("та же цепочка — ответ только от получателя", () => {
    let item = reminder();
    expect(isFollowUpReply(item, candidate({ threadID: "conversation-1", subject: "Другое" }), own)).toBe(true);
    expect(isFollowUpReply(item, candidate({ threadID: "conversation-1", fromAddress: "eve@else.com", subject: "Другое" }), own)).toBe(false);
  });

  test("цепочка по References: отслеживаемое письмо — начало цепочки", () => {
    let item = reminder({ threadID: null });
    expect(isFollowUpReply(item, candidate({ threadID: "<sent-1@example.com>", subject: "x" }), own)).toBe(true);
  });

  test("тема без «Re:» от получателя, если сервер не сохранил связи", () => {
    let item = reminder({ threadID: null, emailId: null });
    expect(isFollowUpReply(item, candidate({ subject: "RE: Contract draft" }), own)).toBe(true);
    expect(isFollowUpReply(item, candidate({ subject: "Lunch?" }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ fromAddress: "eve@else.com" }), own)).toBe(false);
  });

  test("свои ответы не считаются", () => {
    let item = reminder();
    expect(isFollowUpReply(item, candidate({ parentMsgID: "<sent-1@example.com>", fromAddress: "ME@example.com" }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ parentMsgID: "<sent-1@example.com>", outgoing: true }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ parentMsgID: "<sent-1@example.com>", isDraft: true }), own)).toBe(false);
    // Копия своего же письма (себе в копию) с тем же Message-ID
    expect(isFollowUpReply(item, candidate({ messageID: "<sent-1@example.com>", threadID: "conversation-1" }), own)).toBe(false);
  });

  test("свой адрес среди получателей не делает свои письма ответом", () => {
    let item = reminder({ recipients: ["bob@client.com", "team@example.com"] });
    expect(isFollowUpReply(item, candidate({ fromAddress: "team@example.com", threadID: "conversation-1" }), own)).toBe(false);
  });

  test("автоответ и уведомление о доставке не снимают ожидание", () => {
    let item = reminder();
    expect(isFollowUpReply(item, candidate({ parentMsgID: "<sent-1@example.com>", subject: "Automatic reply: Contract draft" }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ threadID: "conversation-1", subject: "Out of Office: Contract draft" }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ fromAddress: "postmaster@client.com", parentMsgID: "<sent-1@example.com>", subject: "Undeliverable: Contract draft" }), own)).toBe(false);
    expect(isFollowUpReply(item, candidate({ threadID: "conversation-1", subject: "Read: Contract draft" }), own)).toBe(false);
  });

  test("письмо до отправки — не ответ", () => {
    let item = reminder();
    expect(isFollowUpReply(item, candidate({ threadID: "conversation-1", receivedAt: local(2026, 10, 19, 9) }), own)).toBe(false);
  });

  test("первый настоящий ответ среди кандидатов", () => {
    let item = reminder();
    let reply = findFollowUpReply(item, [
      candidate({ emailId: 30, subject: "Automatic reply: Contract draft", parentMsgID: "<sent-1@example.com>", receivedAt: local(2026, 10, 19, 11) }),
      candidate({ emailId: 32, parentMsgID: "<sent-1@example.com>", receivedAt: local(2026, 10, 19, 16) }),
      candidate({ emailId: 31, threadID: "conversation-1", receivedAt: local(2026, 10, 19, 14) }),
    ], own);
    expect(reply?.emailId).toBe(31);
    expect(findFollowUpReply(item, [
      candidate({ subject: "Automatic reply: Contract draft", parentMsgID: "<sent-1@example.com>" }),
    ], own)).toBeNull();
  });
});
