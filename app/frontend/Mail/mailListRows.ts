import type { EMail } from "../../logic/Mail/EMail";
import type { MailListSort } from "./LeftPane/quickFilters";
import { normalizeRelatedSubject } from "../../logic/Mail/RelatedEMail";
import { getMailDayGroupLabel, getMailListGroupKey } from "../Util/date";
import { ArrayColl, CollectionObserver, type Collection } from "svelte-collections";
import { messagesRepresentSameMail } from "./mailReadActions";

export type MailListDayRow = {
  kind: "day";
  id: string;
  label: string;
};

export type MailListTopicRow = {
  kind: "topic";
  id: string;
  label: string;
};

export type MailListMessageRow = {
  kind: "message";
  id: string;
  message: EMail;
};

export type MailListRow = MailListDayRow | MailListTopicRow | MailListMessageRow;

const subjectPrefixPattern = /^(?:(?:re|fw|fwd|aw|ответ|пересылка)\s*:\s*)+/iu;

function messageRowID(message: EMail): string {
  return String(message.dbID ?? message.pID ?? message.id ?? message.subject);
}

function listDisplayDate(message: EMail): Date {
  if (typeof message.listDisplayDate === "function") {
    return message.listDisplayDate();
  }
  return message.received ?? message.sent;
}

function subjectGroupKey(subject: string | null | undefined): string {
  return normalizeRelatedSubject(subject);
}

function subjectGroupLabel(subject: string | null | undefined): string {
  return (subject ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(subjectPrefixPattern, "")
    .trim();
}

function listDisplayTimestamp(message: EMail): number {
  let timestamp = listDisplayDate(message)?.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Плоский список с заголовками периода или темы для FastList. */
export function buildMailListRows(
  messages: readonly EMail[],
  withDayHeaders = true,
  withTopicHeaders = false,
): MailListRow[] {
  let rows: MailListRow[] = [];
  let lastGroup = "";
  let lastTopic = "";
  let hasTopic = false;
  for (let message of messages) {
    if (withTopicHeaders) {
      let topic = subjectGroupKey(message.subject);
      if (!hasTopic || topic != lastTopic) {
        rows.push({
          kind: "topic",
          id: `topic:${topic || "no-subject"}`,
          label: subjectGroupLabel(message.subject),
        });
        lastTopic = topic;
        hasTopic = true;
      }
    } else if (withDayHeaders) {
      let displayDate = listDisplayDate(message);
      let groupKey = getMailListGroupKey(displayDate);
      if (groupKey && groupKey != lastGroup) {
        if (groupKey != "today") {
          let label = getMailDayGroupLabel(displayDate);
          if (label) {
            rows.push({
              kind: "day",
              id: `day:${groupKey}`,
              label,
            });
          }
        }
        lastGroup = groupKey;
      }
    }
    rows.push({
      kind: "message",
      id: `msg:${messageRowID(message)}`,
      message,
    });
  }
  return rows;
}

function sortComparator(sort: MailListSort): ((a: EMail, b: EMail) => number) | null {
  switch (sort) {
  case "date-asc":
    return (a, b) => listDisplayTimestamp(a) - listDisplayTimestamp(b) ||
      compareText(subjectGroupKey(a.subject), subjectGroupKey(b.subject));
  case "sender":
    return (a, b) => compareText(senderName(a), senderName(b)) ||
      listDisplayTimestamp(b) - listDisplayTimestamp(a);
  case "subject":
    return (a, b) => compareText(subjectGroupKey(a.subject), subjectGroupKey(b.subject)) ||
      listDisplayTimestamp(b) - listDisplayTimestamp(a) ||
      compareText(senderName(a), senderName(b));
  default:
    return (a, b) => listDisplayTimestamp(b) - listDisplayTimestamp(a) ||
      compareText(subjectGroupKey(a.subject), subjectGroupKey(b.subject));
  }
}

function senderName(email: EMail): string {
  return (email.contact?.name || email.from?.name || email.from?.emailAddress || "").toLowerCase();
}

/**
 * Keeps a `MailListRow` list in sync with a folder's messages.
 *
 * `rows` keeps its object identity for the lifetime of the list component, so
 * `FastList` stays subscribed to it across sort and folder changes. The
 * messages of a folder are mutated in place when mail arrives or is deleted,
 * so we have to observe the collection: deriving the rows in a `$:` statement
 * would only rebuild them when the collection object itself is replaced.
 */
export class MailListRows {
  readonly rows = new ArrayColl<MailListRow>();
  protected source: Collection<EMail> | null = null;
  protected sort: MailListSort = "date-desc";
  protected readonly observer: CollectionObserver<EMail>;

  constructor() {
    let rebuild = () => this.rebuild();
    this.observer = new class extends CollectionObserver<EMail> {
      added() {
        rebuild();
      }
      removed() {
        rebuild();
      }
    };
  }

  setSource(messages: Collection<EMail> | null | undefined, sort: MailListSort) {
    let source = messages ?? null;
    if (source === this.source && sort == this.sort) {
      return;
    }
    if (source !== this.source) {
      this.source?.unregisterObserver(this.observer);
      source?.registerObserver(this.observer);
      this.source = source;
    }
    this.sort = sort;
    this.rebuild();
  }

  dispose() {
    this.source?.unregisterObserver(this.observer);
    this.source = null;
  }

  protected rebuild() {
    let messages = this.source ? this.source.contents.slice() : [];
    messages.sort(sortComparator(this.sort));
    let byDate = this.sort == "date-desc" || this.sort == "date-asc";
    let byTopic = this.sort == "subject";
    this.rows.replaceAll(buildMailListRows(messages, byDate, byTopic));
  }
}

export function mailListRowSelectable(row: MailListRow | null | undefined): boolean {
  return !!row && row.kind == "message";
}

export function mailListSectionLabels(rows: readonly MailListRow[]): string[] {
  return rows
    .filter((row): row is MailListDayRow => row.kind == "day")
    .map(row => row.label);
}

export function mailListTopicLabels(rows: readonly MailListRow[]): string[] {
  return rows
    .filter((row): row is MailListTopicRow => row.kind == "topic")
    .map(row => row.label);
}

export function findMailListRowForMessage(rows: Collection<MailListRow>, message: EMail | null | undefined): MailListMessageRow | null {
  if (!message) {
    return null;
  }
  return rows.contents.find((row): row is MailListMessageRow =>
    row.kind == "message" && messagesRepresentSameMail(row.message, message)) ?? null;
}
