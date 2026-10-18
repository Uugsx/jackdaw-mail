import type { EMail } from "../../logic/Mail/EMail";
import type { MailListSort } from "./LeftPane/quickFilters";
import { normalizeRelatedSubject } from "../../logic/Mail/RelatedEMail";
import { getMailDayGroupLabel, getMailListGroupKey } from "../Util/date";
import { gt } from "../../l10n/l10n";
import { ArrayColl, CollectionObserver, type Collection } from "svelte-collections";
import { messagesRepresentSameMail } from "./mailReadActions";

export type MailListDayRow = {
  kind: "day";
  id: string;
  label: string;
  count: number;
  collapsed: boolean;
};

export type MailListTopicRow = {
  kind: "topic";
  id: string;
  label: string;
  count: number;
  collapsed: boolean;
};

export type MailListSenderRow = {
  kind: "sender";
  id: string;
  label: string;
  count: number;
  collapsed: boolean;
};

export type MailListMessageRow = {
  kind: "message";
  id: string;
  message: EMail;
};

export type MailListRow = MailListDayRow | MailListTopicRow | MailListSenderRow | MailListMessageRow;

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

function senderGroupKey(message: EMail): string {
  return senderName(message) || "no-sender";
}

function senderGroupLabel(message: EMail): string {
  return (message.contact?.name || message.from?.name || message.from?.emailAddress || "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function listDisplayTimestamp(message: EMail): number {
  let timestamp = listDisplayDate(message)?.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Тот же порядок, что у `localeCompare` без аргументов, но без поиска правил на каждое сравнение */
const textCollator = new Intl.Collator();

function compareText(a: string, b: string): number {
  return textCollator.compare(a, b);
}

type MailListGroupMode = "date" | "sender" | "subject";
type MailListGroupKind = "day" | "sender" | "topic";
type MailListGroupInfo = {
  kind: MailListGroupKind;
  key: string;
  id: string;
  label: string;
};

type MailListGroupKey = Omit<MailListGroupInfo, "label">;

/* Ключ группы дешёвый и нужен для каждого письма. Подпись (Intl, перевод)
 * считаем только для заголовка группы: раньше она строилась дважды на письмо,
 * и на 30 тыс. писем это занимало почти секунду. */
function groupKeyForMessage(message: EMail, mode: MailListGroupMode): MailListGroupKey | null {
  if (mode == "date") {
    let key = getMailListGroupKey(listDisplayDate(message));
    if (!key) {
      return null;
    }
    return { kind: "day", key, id: `day:${key}` };
  }
  if (mode == "sender") {
    let key = senderGroupKey(message);
    return { kind: "sender", key, id: `sender:${key}` };
  }
  let key = subjectGroupKey(message.subject) || "no-subject";
  return { kind: "topic", key, id: `topic:${key}` };
}

function groupLabelForMessage(message: EMail, kind: MailListGroupKind): string {
  if (kind == "day") {
    return getMailDayGroupLabel(listDisplayDate(message)) || gt`Today`;
  }
  if (kind == "sender") {
    return senderGroupLabel(message) || gt`Unknown sender`;
  }
  return subjectGroupLabel(message.subject);
}

/** Плоский список с заголовками группировки для FastList. */
export function buildMailListRows(
  messages: readonly EMail[],
  withDayHeaders = true,
  withTopicHeaders = false,
  collapsedGroupIds: ReadonlySet<string> = new Set(),
  withSenderHeaders = false,
): MailListRow[] {
  let rows: MailListRow[] = [];
  let lastGroup = "";
  let groupMode: MailListGroupMode | null = withTopicHeaders
    ? "subject"
    : withSenderHeaders
      ? "sender"
      : withDayHeaders
        ? "date"
        : null;
  let groupCounts = new Map<string, number>();
  let groups: (MailListGroupKey | null)[] = [];
  if (groupMode) {
    for (let message of messages) {
      let group = groupKeyForMessage(message, groupMode);
      groups.push(group);
      if (group) {
        groupCounts.set(group.id, (groupCounts.get(group.id) ?? 0) + 1);
      }
    }
  }
  for (let [index, message] of messages.entries()) {
    if (groupMode) {
      let group = groups[index];
      if (group && group.key != lastGroup) {
        let count = groupCounts.get(group.id) ?? 0;
        let label = groupLabelForMessage(message, group.kind);
        if (group.kind == "day") {
          rows.push({
            kind: "day",
            id: group.id,
            label,
            count,
            collapsed: collapsedGroupIds.has(group.id),
          });
        } else if (group.kind == "sender") {
          rows.push({
            kind: "sender",
            id: group.id,
            label,
            count,
            collapsed: collapsedGroupIds.has(group.id),
          });
        } else {
          rows.push({
            kind: "topic",
            id: group.id,
            label,
            count,
            collapsed: collapsedGroupIds.has(group.id),
          });
        }
        lastGroup = group.key;
      }
      if (group && collapsedGroupIds.has(group.id)) {
        continue;
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

/** Письмо с заранее посчитанными ключами сортировки */
type MailSortItem = {
  message: EMail;
  timestamp: number;
  subjectKey: string;
  senderKey: string;
};

function sortComparator(sort: MailListSort): (a: MailSortItem, b: MailSortItem) => number {
  switch (sort) {
  case "date-asc":
    return (a, b) => a.timestamp - b.timestamp ||
      compareText(a.subjectKey, b.subjectKey);
  case "sender":
    return (a, b) => compareText(a.senderKey, b.senderKey) ||
      b.timestamp - a.timestamp;
  case "subject":
    return (a, b) => compareText(a.subjectKey, b.subjectKey) ||
      b.timestamp - a.timestamp ||
      compareText(a.senderKey, b.senderKey);
  default:
    return (a, b) => b.timestamp - a.timestamp ||
      compareText(a.subjectKey, b.subjectKey);
  }
}

/* Нормализация темы и имени отправителя дорогая: раньше она выполнялась
 * в каждом сравнении, то есть O(n log n) раз вместо n. */
function sortMessages(messages: readonly EMail[], sort: MailListSort): EMail[] {
  let items = messages.map((message): MailSortItem => ({
    message,
    timestamp: listDisplayTimestamp(message),
    subjectKey: subjectGroupKey(message.subject),
    senderKey: senderName(message),
  }));
  items.sort(sortComparator(sort));
  return items.map(item => item.message);
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
  protected collapsedGroupIds = new Set<string>();
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
      this.collapsedGroupIds.clear();
    }
    this.sort = sort;
    this.rebuild();
  }

  dispose() {
    this.source?.unregisterObserver(this.observer);
    this.source = null;
  }

  toggleGroup(groupID: string): void {
    if (this.collapsedGroupIds.has(groupID)) {
      this.collapsedGroupIds.delete(groupID);
    } else {
      this.collapsedGroupIds.add(groupID);
    }
    this.rebuild();
  }

  toggleTopic(topicID: string): void {
    this.toggleGroup(topicID);
  }

  protected rebuild() {
    let messages = sortMessages(this.source ? this.source.contents : [], this.sort);
    let byDate = this.sort == "date-desc" || this.sort == "date-asc";
    let byTopic = this.sort == "subject";
    let bySender = this.sort == "sender";
    let nextRows = buildMailListRows(messages, byDate, byTopic, this.collapsedGroupIds, bySender);
    // При полной пересборке строки всегда создаются заново. `ArrayColl.replaceAll`
    // в таком случае сравнивает каждый новый объект со всеми старыми (O(n²)),
    // что заметно на папках с десятками тысяч писем. Сохраняем идентичность
    // коллекции и прежнюю последовательность уведомлений, но заменяем данные
    // линейно: сначала удаляем старый снимок, затем добавляем новый.
    this.rows.clear();
    this.rows.addAll(nextRows);
  }
}

export function mailListRowSelectable(row: MailListRow | null | undefined): boolean {
  return !!row && row.kind == "message";
}

/**
 * Стабильный ключ выбора строки письма. Объекты MailListRow создаются заново
 * при синхронизации папки, а объект EMail сохраняет идентичность.
 */
export function mailListRowSelectionKey(row: MailListRow | null | undefined): EMail | string | null {
  if (!row) {
    return null;
  }
  if (row.kind != "message") {
    return row.id;
  }
  let message = row.message;
  if (message.dbID != null) {
    return `db:${String(message.dbID)}`;
  }
  if (message.pID != null) {
    return `pid:${String(message.pID)}`;
  }
  if (message.id != null) {
    return `id:${String(message.id)}`;
  }
  return message;
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

export function findMailListRowsForMessages(
  messages: Collection<EMail>,
  rows: Collection<MailListRow>,
): MailListMessageRow[] {
  /* Раньше для каждого выбранного письма перебирались все строки: «Выделить всё»
   * на 30 тыс. писем — это 9·10⁸ сравнений и зависание интерфейса. Индекс даёт
   * тех же кандидатов, а сравнение и порядок «первая подходящая строка»
   * остаются как в `findMailListRowForMessage`. */
  let messageRows = rows.contents.filter((row): row is MailListMessageRow => row.kind == "message");
  let byObject = new Map<EMail, number>();
  let byField = new Map<unknown, number[]>();
  let indexField = (value: unknown, index: number) => {
    if (value == null) {
      return;
    }
    let list = byField.get(value);
    if (list) {
      list.push(index);
    } else {
      byField.set(value, [index]);
    }
  };
  messageRows.forEach((row, index) => {
    if (!byObject.has(row.message)) {
      byObject.set(row.message, index);
    }
    indexField(row.message.dbID, index);
    indexField(row.message.pID, index);
    indexField(row.message.id, index);
  });
  let findRow = (message: EMail): MailListMessageRow | null => {
    let best = byObject.get(message) ?? Infinity;
    for (let value of [message.dbID, message.pID, message.id]) {
      if (value == null) {
        continue;
      }
      for (let index of byField.get(value) ?? []) {
        if (index >= best) {
          break;
        }
        if (messagesRepresentSameMail(messageRows[index].message, message)) {
          best = index;
          break;
        }
      }
    }
    return Number.isFinite(best) ? messageRows[best] : null;
  };
  return messages.contents
    .map(message => message ? findRow(message) : null)
    .filter((row): row is MailListMessageRow => !!row);
}
