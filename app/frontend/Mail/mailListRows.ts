import type { EMail } from "../../logic/Mail/EMail";
import type { MailListSort } from "./LeftPane/quickFilters";
import { normalizeRelatedSubject } from "../../logic/Mail/RelatedEMail";
import { getMailDayGroupLabel, getMailListGroupKey } from "../Util/date";
import { gt } from "../../l10n/l10n";
import { ArrayColl, CollectionObserver, type Collection } from "svelte-collections";
import { writable } from "svelte/store";
import { messagesRepresentSameMail } from "./mailReadActions";
import {
  buildAlertIncidents,
  isAlertIncidentActive,
  type AlertIncident,
} from "../../logic/Mail/AlertIncident";

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
  /** Письмо раскрытой карточки инцидента */
  incidentID?: string;
};

/** Карточка инцидента: однотипные письма-алерты папки алертов */
export type MailListIncidentRow = {
  kind: "incident";
  id: string;
  incident: AlertIncident;
  expanded: boolean;
};

export type MailListRow = MailListDayRow | MailListTopicRow | MailListSenderRow | MailListMessageRow | MailListIncidentRow;

/** Режим «папка алертов» для списка писем */
export interface MailListIncidentMode {
  quietMs: number;
  activeOnly: boolean;
  patterns?: readonly RegExp[];
  closedAt?: (key: string) => number | null | undefined;
  now?: () => number;
}

export interface MailListIncidentSummary {
  total: number;
  active: number;
}

/** Таймер не дольше суток: статус «затихло» пересчитываем к нужному моменту */
const kMaxIncidentTimerMs = 24 * 60 * 60 * 1000;
const kMinIncidentTimerMs = 1000;

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

function incidentRowID(incident: AlertIncident): string {
  return `incident:${incident.key}`;
}

function sortIncidents(incidents: AlertIncident[], sort: MailListSort): AlertIncident[] {
  switch (sort) {
  case "date-asc":
    return incidents.sort((a, b) => a.lastEventAt - b.lastEventAt || compareText(a.label, b.label));
  case "sender":
    return incidents.sort((a, b) => compareText(a.senderLabel.toLowerCase(), b.senderLabel.toLowerCase()) ||
      b.lastEventAt - a.lastEventAt);
  case "sender-desc":
    return incidents.sort((a, b) => compareText(b.senderLabel.toLowerCase(), a.senderLabel.toLowerCase()) ||
      b.lastEventAt - a.lastEventAt);
  case "subject":
    return incidents.sort((a, b) => compareText(a.label.toLowerCase(), b.label.toLowerCase()) ||
      b.lastEventAt - a.lastEventAt);
  case "subject-desc":
    return incidents.sort((a, b) => compareText(b.label.toLowerCase(), a.label.toLowerCase()) ||
      b.lastEventAt - a.lastEventAt);
  default:
    // buildAlertIncidents уже вернул новые первыми
    return incidents;
  }
}

/**
 * Строки папки алертов: карточка на инцидент, под раскрытой карточкой — её
 * письма. Без заголовков дней: карточка сама показывает первое и последнее
 * срабатывание.
 */
export function buildAlertIncidentRows(
  messages: readonly EMail[],
  mode: MailListIncidentMode,
  expandedIncidentIds: ReadonlySet<string> = new Set(),
  sort: MailListSort = "date-desc",
): { rows: MailListRow[]; nextTransitionAt: number | null; summary: MailListIncidentSummary } {
  let incidents = buildAlertIncidents(messages, {
    now: mode.now?.() ?? Date.now(),
    quietMs: mode.quietMs,
    patterns: mode.patterns,
    closedAt: mode.closedAt,
  });
  let rows: MailListRow[] = [];
  let nextTransitionAt: number | null = null;
  let summary: MailListIncidentSummary = { total: incidents.length, active: 0 };
  for (let incident of sortIncidents(incidents, sort)) {
    if (incident.nextTransitionAt != null) {
      nextTransitionAt = Math.min(nextTransitionAt ?? Infinity, incident.nextTransitionAt);
    }
    if (isAlertIncidentActive(incident)) {
      summary.active++;
    }
    if (mode.activeOnly && !isAlertIncidentActive(incident)) {
      continue;
    }
    let id = incidentRowID(incident);
    let expanded = expandedIncidentIds.has(id);
    rows.push({ kind: "incident", id, incident, expanded });
    if (expanded) {
      for (let message of incident.messages) {
        rows.push({ kind: "message", id: `msg:${messageRowID(message)}`, message, incidentID: id });
      }
    }
  }
  return { rows, nextTransitionAt, summary };
}

/** Письма строки: у карточки инцидента — все письма группы. */
export function mailListRowMessages(row: MailListRow | null | undefined): EMail[] {
  if (!row) {
    return [];
  }
  if (row.kind == "message") {
    return [row.message];
  }
  if (row.kind == "incident") {
    return row.incident.messages;
  }
  return [];
}

/** Письмо с заранее посчитанными ключами сортировки */
type MailSortItem = {
  message: EMail;
  timestamp: number;
  subjectKey: string;
  senderKey: string;
  /** Значение столбца для сортировки по размеру, категориям или признаку (1/0) */
  columnKey: number | string;
};

/** Сортировки по признаку письма: сначала письма с признаком (desc) или без него (asc) */
const flagSortKeys: Partial<Record<MailListSort, (message: EMail) => boolean>> = {
  "flag-desc": message => !!message.isStarred,
  "flag-asc": message => !!message.isStarred,
  "importance-desc": message => !!message.isImportant,
  "importance-asc": message => !!message.isImportant,
  "attachment-desc": message => !!message.hasVisibleAttachments,
  "attachment-asc": message => !!message.hasVisibleAttachments,
};

function messageSize(message: EMail): number {
  let size = Number(message.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Категории письма одной строкой, как в столбце «Категории» */
export function mailCategoriesKey(message: EMail): string {
  let tags = message.tags?.contents ?? [];
  return tags.map(tag => tag?.name ?? "").filter(Boolean).join("; ").toLowerCase();
}

function columnKeyFor(message: EMail, sort: MailListSort): number | string {
  if (sort == "size-desc" || sort == "size-asc") {
    return messageSize(message);
  }
  if (sort == "categories" || sort == "categories-desc") {
    return mailCategoriesKey(message);
  }
  let flag = flagSortKeys[sort];
  return flag ? (flag(message) ? 1 : 0) : 0;
}

/** Письма без категорий — в конце при любом направлении, как пустые значения в Outlook */
function compareCategories(a: MailSortItem, b: MailSortItem, direction: 1 | -1): number {
  let aKey = a.columnKey as string;
  let bKey = b.columnKey as string;
  if (!aKey != !bKey) {
    return aKey ? -1 : 1;
  }
  return direction * compareText(aKey, bKey);
}

function sortComparator(sort: MailListSort): (a: MailSortItem, b: MailSortItem) => number {
  switch (sort) {
  case "date-asc":
    return (a, b) => a.timestamp - b.timestamp ||
      compareText(a.subjectKey, b.subjectKey);
  case "sender":
    return (a, b) => compareText(a.senderKey, b.senderKey) ||
      b.timestamp - a.timestamp;
  case "sender-desc":
    return (a, b) => compareText(b.senderKey, a.senderKey) ||
      b.timestamp - a.timestamp;
  case "subject":
    return (a, b) => compareText(a.subjectKey, b.subjectKey) ||
      b.timestamp - a.timestamp ||
      compareText(a.senderKey, b.senderKey);
  case "subject-desc":
    return (a, b) => compareText(b.subjectKey, a.subjectKey) ||
      b.timestamp - a.timestamp ||
      compareText(a.senderKey, b.senderKey);
  case "categories":
    return (a, b) => compareCategories(a, b, 1) || b.timestamp - a.timestamp;
  case "categories-desc":
    return (a, b) => compareCategories(a, b, -1) || b.timestamp - a.timestamp;
  case "size-asc":
  case "flag-asc":
  case "importance-asc":
  case "attachment-asc":
    return (a, b) => (a.columnKey as number) - (b.columnKey as number) ||
      b.timestamp - a.timestamp;
  case "size-desc":
  case "flag-desc":
  case "importance-desc":
  case "attachment-desc":
    return (a, b) => (b.columnKey as number) - (a.columnKey as number) ||
      b.timestamp - a.timestamp;
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
    columnKey: columnKeyFor(message, sort),
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
  /** Число инцидентов и активных из них; null — обычный список */
  readonly incidentSummary = writable<MailListIncidentSummary | null>(null);
  protected source: Collection<EMail> | null = null;
  protected sort: MailListSort = "date-desc";
  protected collapsedGroupIds = new Set<string>();
  protected expandedIncidentIds = new Set<string>();
  protected incidentMode: MailListIncidentMode | null = null;
  protected incidentTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.expandedIncidentIds.clear();
    }
    this.sort = sort;
    this.rebuild();
  }

  /** Включает карточки инцидентов (папка алертов) или возвращает обычный список. */
  setIncidentMode(mode: MailListIncidentMode | null): void {
    if (!mode && !this.incidentMode) {
      return;
    }
    if (!mode) {
      this.expandedIncidentIds.clear();
    }
    this.incidentMode = mode;
    this.rebuild();
  }

  get isIncidentMode(): boolean {
    return !!this.incidentMode;
  }

  /** Пересчитать карточки: изменилась прочитанность писем, а не состав папки. */
  refreshIncidents(): void {
    if (this.incidentMode) {
      this.rebuild();
    }
  }

  dispose() {
    this.source?.unregisterObserver(this.observer);
    this.source = null;
    this.clearIncidentTimer();
  }

  toggleGroup(groupID: string): void {
    if (groupID.startsWith("incident:")) {
      if (!this.expandedIncidentIds.delete(groupID)) {
        this.expandedIncidentIds.add(groupID);
      }
      this.rebuild();
      return;
    }
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

  protected clearIncidentTimer() {
    if (this.incidentTimer) {
      clearTimeout(this.incidentTimer);
      this.incidentTimer = null;
    }
  }

  protected rebuild() {
    this.clearIncidentTimer();
    if (this.incidentMode) {
      let mode = this.incidentMode;
      let { rows, nextTransitionAt, summary } = buildAlertIncidentRows(this.source ? this.source.contents : [],
        mode, this.expandedIncidentIds, this.sort);
      if (nextTransitionAt != null) {
        // «Идёт» сам по себе становится «затихло»: пересобираем к этому моменту
        let now = mode.now?.() ?? Date.now();
        let delay = Math.min(Math.max(nextTransitionAt - now, kMinIncidentTimerMs), kMaxIncidentTimerMs);
        this.incidentTimer = setTimeout(() => {
          this.incidentTimer = null;
          this.rebuild();
        }, delay);
      }
      this.incidentSummary.set(summary);
      this.rows.clear();
      this.rows.addAll(rows);
      return;
    }
    this.incidentSummary.set(null);
    let messages = sortMessages(this.source ? this.source.contents : [], this.sort);
    let byDate = this.sort == "date-desc" || this.sort == "date-asc";
    let byTopic = this.sort == "subject" || this.sort == "subject-desc";
    let bySender = this.sort == "sender" || this.sort == "sender-desc";
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
  return !!row && (row.kind == "message" || row.kind == "incident");
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

/**
 * Строка, на которой видно письмо: его собственная или свёрнутая карточка
 * инцидента, в которую оно входит.
 */
export function findMailListRowShowingMessage(
  rows: Collection<MailListRow>,
  message: EMail | null | undefined,
): MailListMessageRow | MailListIncidentRow | null {
  let row = findMailListRowForMessage(rows, message);
  if (row || !message) {
    return row;
  }
  return rows.contents.find((candidate): candidate is MailListIncidentRow =>
    candidate.kind == "incident" && !candidate.expanded &&
    candidate.incident.messages.some(member => messagesRepresentSameMail(member, message))) ?? null;
}

/**
 * Как `findMailListRowsForMessages`, но письма свёрнутых карточек инцидентов
 * дают карточку (одну на инцидент).
 */
export function findMailListRowsShowingMessages(
  messages: Collection<EMail>,
  rows: Collection<MailListRow>,
): (MailListMessageRow | MailListIncidentRow)[] {
  let messageRows = findMailListRowsForMessages(messages, rows);
  let collapsed = rows.contents.filter((row): row is MailListIncidentRow =>
    row.kind == "incident" && !row.expanded);
  if (!collapsed.length) {
    return messageRows;
  }
  // Письмо входит ровно в один инцидент, а у свёрнутой карточки нет строк писем
  let byObject = new Map<EMail, MailListIncidentRow>();
  let byDBID = new Map<unknown, MailListIncidentRow>();
  for (let row of collapsed) {
    for (let member of row.incident.messages) {
      byObject.set(member, row);
      if (member.dbID != null) {
        byDBID.set(member.dbID, row);
      }
    }
  }
  let result: (MailListMessageRow | MailListIncidentRow)[] = [...messageRows];
  let added = new Set<MailListIncidentRow>();
  for (let message of messages.contents) {
    if (!message) {
      continue;
    }
    let row = byObject.get(message) ?? (message.dbID != null ? byDBID.get(message.dbID) : undefined);
    if (row && !added.has(row)) {
      added.add(row);
      result.push(row);
    }
  }
  return result;
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
