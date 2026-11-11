// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  clearReplyReminder, findReplyReminder, getReplyReminders, isReplyReminderDue, markReplyReminderNotified,
  replyRemindersChanged, setReplyReminder,
} from "../../../../logic/Mail/ReplyReminder/ReplyReminder";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

const shown = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../../../../frontend/Shared/SystemNotification", () => ({
  NotificationKinds: class { constructor(public kinds: string[]) { } },
  SystemNotification: class {
    onClick: any; icon: any; updatesTaskbarBadge = true;
    constructor(public kinds: any, public title: string, public body: string, public id: string) { }
    async show() { shown.calls.push(this); }
  },
}));
vi.mock("../../../../frontend/Mail/open", () => ({ openEMailMessage: vi.fn(async () => { }) }));

import { appGlobal } from "../../../../logic/app";
import { checkReplyReminders } from "../../../../frontend/Mail/ReplyReminder/replyReminderWatcher";

beforeEach(() => {
  let store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as Storage;
  shown.calls.length = 0;
});

function fakeEmail(extra: any = {}) {
  let inbox: any = { messages: [] as any[], account: { id: "acc1" } };
  let email: any = { messageID: "<m1@example.com>", subject: "Отчёт", folder: inbox, isReplied: false, ...extra };
  inbox.messages.push(email);
  let account: any = { id: "acc1", findFolder: (test: (folder: any) => boolean) => test(inbox) ? inbox : null };
  inbox.account = account;
  return { email, account };
}

const future = (ms = 60_000) => new Date(Date.now() + ms);

describe("Напоминание «ответить»", () => {
  test("ставится, находится, заменяется и снимается", () => {
    let { email } = fakeEmail();
    expect(findReplyReminder(email)).toBeNull();
    let changes = get(replyRemindersChanged);
    setReplyReminder(email, future());
    expect(findReplyReminder(email)?.subject).toBe("Отчёт");
    expect(get(replyRemindersChanged)).toBeGreaterThan(changes);
    let later = future(3_600_000);
    setReplyReminder(email, later);
    expect(getReplyReminders()).toHaveLength(1);
    expect(findReplyReminder(email)?.at).toBe(later.toISOString());
    clearReplyReminder(email);
    expect(findReplyReminder(email)).toBeNull();
  });

  test("прошлое время и письмо без Message-ID — ошибка", () => {
    let { email } = fakeEmail();
    expect(() => setReplyReminder(email, new Date(Date.now() - 1000))).toThrow();
    let noID = { ...email, messageID: "" };
    expect(() => setReplyReminder(noID, future())).toThrow();
    expect(getReplyReminders()).toHaveLength(0);
  });

  test("другой ящик с тем же Message-ID не затрагивается", () => {
    let { email } = fakeEmail();
    let other: any = { messageID: email.messageID, subject: "x", folder: { account: { id: "acc2" } } };
    setReplyReminder(email, future());
    expect(findReplyReminder(other)).toBeNull();
    clearReplyReminder(other);
    expect(findReplyReminder(email)).not.toBeNull();
  });

  test("срок наступил — due, после отметки — нет", () => {
    let { email } = fakeEmail();
    setReplyReminder(email, future());
    let record = findReplyReminder(email)!;
    expect(isReplyReminderDue(record)).toBe(false);
    let after = new Date(Date.now() + 120_000);
    expect(isReplyReminderDue(record, after)).toBe(true);
    markReplyReminderNotified(record, after);
    expect(isReplyReminderDue(findReplyReminder(email)!, after)).toBe(false);
  });

  test("уведомление показывается один раз, письмо остаётся на месте", async () => {
    let { email, account } = fakeEmail();
    (appGlobal as any).emailAccounts = [account];
    setReplyReminder(email, future());
    expect(await checkReplyReminders(new Date())).toBe(0);
    let after = new Date(Date.now() + 120_000);
    expect(await checkReplyReminders(after)).toBe(1);
    expect(shown.calls).toHaveLength(1);
    expect(shown.calls[0].body).toContain("Отчёт");
    expect(await checkReplyReminders(after)).toBe(0);
    expect(shown.calls).toHaveLength(1);
    expect(email.folder.messages).toContain(email);
  });

  test("на письмо уже ответили — напоминание снимается молча", async () => {
    let { email, account } = fakeEmail();
    (appGlobal as any).emailAccounts = [account];
    setReplyReminder(email, future());
    email.isReplied = true;
    expect(await checkReplyReminders(new Date(Date.now() + 120_000))).toBe(0);
    expect(shown.calls).toHaveLength(0);
    expect(findReplyReminder(email)).toBeNull();
  });
});
