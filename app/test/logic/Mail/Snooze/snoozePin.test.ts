// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import {
  findSnooze, getSnoozes, kSnoozeMorningHour, snoozeMessage, snoozePresetTime, unsnoozeRecord, wakeDueSnoozes,
} from "../../../../logic/Mail/Snooze/Snooze";
import {
  isMessagePinned, pinnedMessagesChanged, resetPinnedCache, setMessagePinned, toggleMessagePinned,
} from "../../../../logic/Mail/Pin/PinnedMessages";
import { buildPinnedRows, kPinnedGroupID } from "../../../../frontend/Mail/mailListRows";
import { emlFilename } from "../../../../frontend/Mail/Message/drag";
import { get } from "svelte/store";
import { ArrayColl } from "svelte-collections";
import { beforeEach, describe, expect, test, vi } from "vitest";

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
  resetPinnedCache();
});

describe("Сроки «Отложить»", () => {
  test("Как в Outlook", () => {
    let wednesday = new Date(2026, 9, 21, 10, 15);
    expect(snoozePresetTime("later-today", wednesday)).toEqual(new Date(2026, 9, 21, 13, 0));
    expect(snoozePresetTime("tomorrow", wednesday)).toEqual(new Date(2026, 9, 22, kSnoozeMorningHour, 0));
    expect(snoozePresetTime("weekend", wednesday)).toEqual(new Date(2026, 9, 24, kSnoozeMorningHour, 0));
    expect(snoozePresetTime("next-week", wednesday)).toEqual(new Date(2026, 9, 26, kSnoozeMorningHour, 0));
    let saturday = new Date(2026, 9, 24, 9);
    expect(snoozePresetTime("weekend", saturday)).toEqual(new Date(2026, 9, 31, kSnoozeMorningHour, 0));
    let monday = new Date(2026, 9, 26, 9);
    expect(snoozePresetTime("next-week", monday)).toEqual(new Date(2026, 10, 2, kSnoozeMorningHour, 0));
  });
});

function fakeAccount() {
  let inbox: any = { messages: new ArrayColl<any>(), moveMessageHere: vi.fn(async (email: any) => { email.folder = inbox; inbox.messages.add(email); }) };
  let snoozed: any = { id: "f-snoozed", name: "Snoozed", messages: new ArrayColl<any>(), listMessages: vi.fn() };
  snoozed.moveMessageHere = vi.fn(async (email: any) => { email.folder = snoozed; snoozed.messages.add(email); });
  let account: any = {
    id: "acc1", isLoggedIn: true, inbox, rootFolders: new ArrayColl<any>(),
    findFolder: (test: (folder: any) => boolean) => [inbox, ...account.rootFolders.contents].find(test) ?? null,
    createToplevelFolder: vi.fn(async () => { account.rootFolders.add(snoozed); return snoozed; }),
  };
  inbox.account = account;
  snoozed.account = account;
  return { account, inbox, snoozed };
}

function fakeEmail(folder: any, messageID = "<m1@example.com>") {
  return { messageID, subject: "Отчёт", folder, isRead: true, markRead: vi.fn(async function (read = true) { this.isRead = read; }) };
}

describe("Отложить и вернуть", () => {
  test("Папка создаётся один раз, письмо возвращается непрочитанным", async () => {
    let { account, inbox, snoozed } = fakeAccount();
    let email = fakeEmail(inbox);
    await expect(snoozeMessage(email as any, new Date(Date.now() - 1000))).rejects.toThrow();
    await snoozeMessage(email as any, new Date(Date.now() + 60_000));
    expect(account.createToplevelFolder).toHaveBeenCalledTimes(1);
    expect(email.folder).toBe(snoozed);
    expect(findSnooze(email as any)).toMatchObject({ accountID: "acc1", messageID: "<m1@example.com>" });

    // Повторно — тот же срок заменяется, папка не создаётся заново
    let later = new Date(Date.now() + 120_000);
    await snoozeMessage(email as any, later);
    expect(account.createToplevelFolder).toHaveBeenCalledTimes(1);
    expect(getSnoozes()).toHaveLength(1);
    expect(getSnoozes()[0].until).toBe(later.toISOString());

    expect(await wakeDueSnoozes([account], new Date())).toBe(0);
    expect(await wakeDueSnoozes([account], new Date(Date.now() + 200_000))).toBe(1);
    expect(email.folder).toBe(inbox);
    expect(email.markRead).toHaveBeenCalledWith(false);
    expect(getSnoozes()).toHaveLength(0);
  });

  test("Письмо пропало — срок снимается; ящик удалён — тоже; без входа — ждём", async () => {
    let { account, snoozed } = fakeAccount();
    account.rootFolders.add(snoozed);
    let record = { accountID: "acc1", messageID: "<нет@x>", until: new Date(0).toISOString(), subject: "" };
    localStorage.setItem("mail.snooze.v1", JSON.stringify([record, { ...record, accountID: "gone" }]));
    account.isLoggedIn = false;
    expect(await unsnoozeRecord(record, [account])).toBe(false);
    expect(getSnoozes()).toHaveLength(2);
    account.isLoggedIn = true;
    expect(await wakeDueSnoozes([account])).toBe(0);
    expect(snoozed.listMessages).toHaveBeenCalled();
    expect(getSnoozes()).toHaveLength(0);
  });
});

describe("Закрепление", () => {
  test("Закрепить, открепить, ключ по ящику и Message-ID", () => {
    let email: any = { messageID: "<a@x>", folder: { account: { id: "acc1" } } };
    let other: any = { messageID: "<a@x>", folder: { account: { id: "acc2" } } };
    let changes = get(pinnedMessagesChanged);
    toggleMessagePinned(email);
    expect(isMessagePinned(email)).toBe(true);
    expect(isMessagePinned(other)).toBe(false);
    expect(get(pinnedMessagesChanged)).toBe(changes + 1);
    setMessagePinned(email, true);
    expect(get(pinnedMessagesChanged)).toBe(changes + 1);
    resetPinnedCache();
    expect(isMessagePinned(email)).toBe(true);
    toggleMessagePinned(email);
    expect(isMessagePinned(email)).toBe(false);
    let noID: any = { messageID: "", pID: null, folder: { account: { id: "acc1" } } };
    setMessagePinned(noID, true);
    expect(isMessagePinned(noID)).toBe(false);
  });

  test("Группа «Закреплённые» вверху, сворачивается", () => {
    let messages: any[] = [{ dbID: 1, subject: "А" }, { dbID: 2, subject: "Б" }];
    expect(buildPinnedRows([])).toEqual([]);
    let rows = buildPinnedRows(messages);
    expect(rows.map(row => row.kind)).toEqual(["day", "message", "message"]);
    expect(rows[0]).toMatchObject({ id: kPinnedGroupID, count: 2, collapsed: false });
    expect(buildPinnedRows(messages, new Set([kPinnedGroupID])).map(row => row.kind)).toEqual(["day"]);
  });
});

describe("Имя файла .eml", () => {
  test("Без двоеточий и запрещённых символов", () => {
    expect(emlFilename("Re: отчёт / Q3 <важно>")).toBe("Re отчёт Q3 важно .eml".replace(" .eml", ".eml"));
    expect(emlFilename("")).toBe("email.eml");
    expect(emlFilename(null)).toBe("email.eml");
    expect(emlFilename("a".repeat(300))).toHaveLength(124);
  });
});
