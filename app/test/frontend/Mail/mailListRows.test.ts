import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ArrayColl } from "svelte-collections";
import type { EMail } from "../../../logic/Mail/EMail";
import {
  findMailListRowForMessage,
  MailListRows,
  mailListSectionLabels,
  mailListTopicLabels,
  type MailListMessageRow,
} from "../../../frontend/Mail/mailListRows";

// The day-header labels go through the l10n date formatter, which reads the
// user's locale from localStorage.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
});

function fakeMail(subject: string, sent: Date, from = "zoe@example.com"): EMail {
  return {
    dbID: subject,
    subject,
    sent,
    from: { emailAddress: from, name: from },
    contact: null,
  } as unknown as EMail;
}

function subjects(rows: ArrayColl<any>): string[] {
  return rows.contents
    .filter((row): row is MailListMessageRow => row.kind == "message")
    .map(row => row.message.subject);
}

function sectionLabels(rows: ArrayColl<any>): string[] {
  return mailListSectionLabels(rows.contents);
}

function topicLabels(rows: ArrayColl<any>): string[] {
  return mailListTopicLabels(rows.contents);
}

const jan1 = new Date(2026, 0, 1, 9, 0);
const jan1Later = new Date(2026, 0, 1, 17, 0);
const jan2 = new Date(2026, 0, 2, 9, 0);
const jan3 = new Date(2026, 0, 3, 9, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(jan3);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MailListRows", () => {
  test("picks up mail that arrives in the folder after the list was built", () => {
    let messages = new ArrayColl<EMail>([fakeMail("first", jan2)]);
    let model = new MailListRows();
    model.setSource(messages, "date-desc");
    expect(subjects(model.rows)).toEqual(["first"]);

    // The folder collection is mutated in place by the sync, and its object
    // identity never changes. This is the case that used to leave the list
    // frozen on whatever it was showing at mount time.
    messages.add(fakeMail("just arrived", new Date(2026, 0, 3, 9, 0)));

    expect(subjects(model.rows)).toEqual(["just arrived", "first"]);
    model.dispose();
  });

  test("drops mail that was deleted on the server", () => {
    let doomed = fakeMail("deleted elsewhere", jan2);
    let messages = new ArrayColl<EMail>([doomed, fakeMail("kept", jan1)]);
    let model = new MailListRows();
    model.setSource(messages, "date-desc");

    messages.remove(doomed);

    expect(subjects(model.rows)).toEqual(["kept"]);
    model.dispose();
  });

  test("stops following the previous folder after switching", () => {
    let inbox = new ArrayColl<EMail>([fakeMail("inbox mail", jan1)]);
    let archive = new ArrayColl<EMail>([fakeMail("archived mail", jan2)]);
    let model = new MailListRows();
    model.setSource(inbox, "date-desc");
    model.setSource(archive, "date-desc");

    inbox.add(fakeMail("should not show up here", jan2));

    expect(subjects(model.rows)).toEqual(["archived mail"]);
    model.dispose();
  });

  test("groups by period under date sorts, one header per section", () => {
    let messages = new ArrayColl<EMail>([
      fakeMail("morning", jan1),
      fakeMail("evening", jan1Later),
      fakeMail("next day", jan2),
    ]);
    let model = new MailListRows();
    model.setSource(messages, "date-asc");

    expect(subjects(model.rows)).toEqual(["morning", "evening", "next day"]);
    // Jan 1 (Thu) and Jan 2 (Fri) are separate weekday sections; today is Jan 3.
    expect(sectionLabels(model.rows)).toHaveLength(2);
    model.dispose();
  });

  test("omits header for today's mail", () => {
    let messages = new ArrayColl<EMail>([
      fakeMail("today early", jan3),
      fakeMail("today later", new Date(2026, 0, 3, 18, 0)),
      fakeMail("yesterday", jan2),
    ]);
    let model = new MailListRows();
    model.setSource(messages, "date-desc");

    expect(sectionLabels(model.rows)).toEqual(["Yesterday"]);
    model.dispose();
  });

  test("groups normalized subjects while sorting by subject", () => {
    let messages = new ArrayColl<EMail>([
      fakeMail("Re: Project update", jan1, "anna@example.com"),
      fakeMail("Other topic", jan2, "zoe@example.com"),
      fakeMail("FW: Project update", jan1Later, "zoe@example.com"),
      fakeMail("Project update", jan1, "mike@example.com"),
    ]);
    let model = new MailListRows();
    model.setSource(messages, "subject");

    expect(topicLabels(model.rows)).toEqual(["Other topic", "Project update"]);
    expect(subjects(model.rows)).toEqual([
      "Other topic",
      "FW: Project update",
      "Re: Project update",
      "Project update",
    ]);
    model.dispose();
  });

  test("shows a topic header for messages without a subject", () => {
    let messages = new ArrayColl<EMail>([
      fakeMail("", jan2),
      fakeMail("Re: Project update", jan1),
    ]);
    let model = new MailListRows();
    model.setSource(messages, "subject");

    expect(topicLabels(model.rows)).toEqual(["", "Project update"]);
    model.dispose();
  });

  test("omits day headers when sorting by sender", () => {
    let messages = new ArrayColl<EMail>([
      fakeMail("b", jan1, "anna@example.com"),
      fakeMail("a", jan2, "zoe@example.com"),
    ]);
    let model = new MailListRows();

    // Consecutive rows have unrelated dates under these sorts, so a day header
    // would appear above nearly every message.
    model.setSource(messages, "sender");
    expect(subjects(model.rows)).toEqual(["b", "a"]);
    expect(sectionLabels(model.rows)).toEqual([]);
    model.dispose();
  });

  test("keeps its rows collection identity across sort and folder changes", () => {
    let model = new MailListRows();
    let rows = model.rows;
    model.setSource(new ArrayColl<EMail>([fakeMail("a", jan1)]), "date-desc");
    model.setSource(new ArrayColl<EMail>([fakeMail("b", jan2)]), "subject");

    // FastList subscribes to this collection once, so replacing it would
    // silently detach the list from its data.
    expect(model.rows).toBe(rows);
    model.dispose();
  });

  test("finds a row when the same message was rehydrated as another object", () => {
    let loaded = fakeMail("loaded", jan2);
    let row = {
      kind: "message",
      id: "msg:loaded",
      message: loaded,
    } as MailListMessageRow;
    let rows = new ArrayColl([row]);

    let rehydrated = fakeMail("loaded", jan2);
    rehydrated.dbID = loaded.dbID;

    expect(findMailListRowForMessage(rows, rehydrated)).toBe(row);
  });

  test("stops updating after dispose", () => {
    let messages = new ArrayColl<EMail>([fakeMail("only", jan1)]);
    let model = new MailListRows();
    model.setSource(messages, "date-desc");
    model.dispose();

    messages.add(fakeMail("after dispose", jan2));

    expect(subjects(model.rows)).toEqual(["only"]);
  });
});
