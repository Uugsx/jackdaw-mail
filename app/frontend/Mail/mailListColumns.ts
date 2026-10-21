import { getLocalStorage } from "../Util/LocalStorage";
import { getUILocale, gt } from "../../l10n/l10n";
import type { MailListSort } from "./LeftPane/quickFilters";

/** Столбцы табличного списка писем, как в Outlook */
export type MailListColumnId =
  | "importance"
  | "status"
  | "attachment"
  | "from"
  | "subject"
  | "received"
  | "size"
  | "categories"
  | "flag";

export type MailListSortColumn = Exclude<MailListColumnId, "status">;
export type MailListSortDirection = "asc" | "desc";
/** auto — таблица, когда список достаточно широкий, иначе карточки */
export type MailListLayout = "auto" | "table" | "cards";

export interface MailListColumnDef {
  id: MailListColumnId;
  /** Полное название: меню, подсказка, заголовок текстового столбца */
  label: () => string;
  /** Узкий столбец-значок: ширина постоянная */
  icon: boolean;
  defaultWidth: number;
  minWidth: number;
  /** Занимает оставшееся место (тема) */
  flexible: boolean;
  /** Нельзя скрыть: иначе строке нечего показать */
  required: boolean;
  sortable: boolean;
}

export interface MailListColumnPrefs {
  order: MailListColumnId[];
  hidden: MailListColumnId[];
  /** Ширина в px; нет значения — ширина по умолчанию */
  widths: Partial<Record<MailListColumnId, number>>;
}

const kIconColumnWidth = 24;
const kMaxColumnWidth = 800;
/** Уже этого список показывается карточками в режиме «Авто» */
export const kMailListTableMinWidth = 640;
/** Доля ширины списка, которую тема получает раньше остальных столбцов */
const kSubjectMinShare = 0.3;
/** Должно совпадать с --mail-list-column-gap и отступами строки в VerticalMessageList */
const kColumnGap = 8;
const kRowPaddingInline = 16;
/** Полоса прокрутки списка (::-webkit-scrollbar в app.css) */
const kScrollbarWidth = 8;

function textColumn(id: MailListColumnId, label: () => string, defaultWidth: number,
  minWidth: number, sortable = true): MailListColumnDef {
  return { id, label, icon: false, defaultWidth, minWidth, flexible: false, required: false, sortable };
}

function iconColumn(id: MailListColumnId, label: () => string, sortable = true): MailListColumnDef {
  return {
    id, label, icon: true, defaultWidth: kIconColumnWidth, minWidth: kIconColumnWidth,
    flexible: false, required: false, sortable,
  };
}

export const mailListColumnDefs: Readonly<Record<MailListColumnId, MailListColumnDef>> = {
  importance: iconColumn("importance", () => gt`Importance`),
  status: iconColumn("status", () => gt`Reply status`, false),
  attachment: iconColumn("attachment", () => gt`Attachment`),
  from: textColumn("from", () => gt`From`, 200, 60),
  subject: {
    ...textColumn("subject", () => gt`Subject`, 320, 120),
    flexible: true,
    required: true,
  },
  received: textColumn("received", () => gt`Received`, 140, 70),
  size: textColumn("size", () => gt`Size`, 84, 50),
  categories: textColumn("categories", () => gt`Categories`, 180, 60),
  flag: iconColumn("flag", () => gt`Flag *=> Message list column: follow-up flag`),
};

export const defaultMailListColumnOrder: readonly MailListColumnId[] = [
  "importance", "status", "attachment", "from", "subject", "received", "size", "categories", "flag",
];

const allColumnIds = new Set<MailListColumnId>(defaultMailListColumnOrder);

export function defaultMailListColumnPrefs(): MailListColumnPrefs {
  return { order: [...defaultMailListColumnOrder], hidden: [], widths: {} };
}

export const mailListColumnsSetting = getLocalStorage<MailListColumnPrefs>(
  "mail.list.columns", defaultMailListColumnPrefs());
export const mailListDividersSetting = getLocalStorage<boolean>("mail.list.dividers", true);
export const mailListLayoutSetting = getLocalStorage<MailListLayout>("mail.list.layout", "auto");

const validLayouts = new Set<MailListLayout>(["auto", "table", "cards"]);

export function normalizeMailListLayout(value: unknown): MailListLayout {
  return validLayouts.has(value as MailListLayout) ? value as MailListLayout : "auto";
}

export function normalizeMailListDividers(value: unknown): boolean {
  return typeof value == "boolean" ? value : true;
}

function isColumnId(value: unknown): value is MailListColumnId {
  return allColumnIds.has(value as MailListColumnId);
}

function clampWidth(id: MailListColumnId, width: number): number {
  let def = mailListColumnDefs[id];
  return Math.round(Math.min(Math.max(width, def.minWidth), kMaxColumnWidth));
}

/** Сохранённое значение может быть старым или испорченным: приводим к полному набору столбцов. */
export function normalizeMailListColumnPrefs(value: unknown): MailListColumnPrefs {
  let raw = value && typeof value == "object" && !Array.isArray(value)
    ? value as Partial<Record<keyof MailListColumnPrefs, unknown>>
    : {};
  let order: MailListColumnId[] = [];
  for (let id of Array.isArray(raw.order) ? raw.order : []) {
    if (isColumnId(id) && !order.includes(id)) {
      order.push(id);
    }
  }
  // Новые столбцы из будущих версий встают на своё место по умолчанию
  for (let [index, id] of defaultMailListColumnOrder.entries()) {
    if (!order.includes(id)) {
      let before = defaultMailListColumnOrder.slice(index + 1).find(next => order.includes(next));
      order.splice(before ? order.indexOf(before) : order.length, 0, id);
    }
  }
  let hidden = (Array.isArray(raw.hidden) ? raw.hidden : [])
    .filter((id, index, list): id is MailListColumnId =>
      isColumnId(id) && !mailListColumnDefs[id].required && list.indexOf(id) == index);
  let widths: Partial<Record<MailListColumnId, number>> = {};
  if (raw.widths && typeof raw.widths == "object" && !Array.isArray(raw.widths)) {
    for (let [id, width] of Object.entries(raw.widths)) {
      if (isColumnId(id) && !mailListColumnDefs[id].icon &&
          typeof width == "number" && Number.isFinite(width)) {
        widths[id] = clampWidth(id, width);
      }
    }
  }
  return { order, hidden, widths };
}

export function visibleMailListColumns(prefs: MailListColumnPrefs): MailListColumnId[] {
  return prefs.order.filter(id => !prefs.hidden.includes(id));
}

export function mailListColumnWidth(prefs: MailListColumnPrefs, id: MailListColumnId): number {
  return prefs.widths[id] ?? mailListColumnDefs[id].defaultWidth;
}

/** Место строки, которое не делится между столбцами: отступы, промежутки, полоса прокрутки */
function reservedRowWidth(columnCount: number): number {
  return kRowPaddingInline + kScrollbarWidth + kColumnGap * Math.max(columnCount - 1, 0);
}

/**
 * `grid-template-columns` для заголовка и строк.
 *
 * Если ширина списка известна, заданные ширины столбцов соблюдаются, а тема
 * забирает остаток. Когда места не хватает, тема сохраняет не меньше 30 %,
 * а остальные текстовые столбцы сжимаются пропорционально до своего минимума;
 * текст в ячейке обрезается многоточием и виден целиком в подсказке.
 */
export function mailListGridTemplate(prefs: MailListColumnPrefs, listWidth = 0): string {
  let columns = visibleMailListColumns(prefs);
  if (!(listWidth > 0)) {
    return columns.map(id => {
      let def = mailListColumnDefs[id];
      if (def.icon) {
        return `${def.defaultWidth}px`;
      }
      if (def.flexible) {
        return `minmax(max(${def.minWidth}px, ${kSubjectMinShare * 100}%), 1fr)`;
      }
      return `minmax(${def.minWidth}px, ${mailListColumnWidth(prefs, id)}px)`;
    }).join(" ");
  }
  let reserved = reservedRowWidth(columns.length);
  let subjectFloor = 0;
  let textColumns: MailListColumnId[] = [];
  for (let id of columns) {
    let def = mailListColumnDefs[id];
    if (def.icon) {
      reserved += def.defaultWidth;
    } else if (def.flexible) {
      subjectFloor = Math.max(def.minWidth, kSubjectMinShare * listWidth);
    } else {
      textColumns.push(id);
    }
  }
  let room = listWidth - reserved - subjectFloor;
  let desired = textColumns.map(id => mailListColumnWidth(prefs, id));
  let minimum = textColumns.map(id => mailListColumnDefs[id].minWidth);
  let sumDesired = desired.reduce((sum, width) => sum + width, 0);
  let sumMinimum = minimum.reduce((sum, width) => sum + width, 0);
  let widths = new Map<MailListColumnId, number>();
  textColumns.forEach((id, index) => {
    let width = desired[index];
    if (room < sumDesired) {
      let ratio = sumDesired > sumMinimum ? Math.max(room - sumMinimum, 0) / (sumDesired - sumMinimum) : 0;
      width = minimum[index] + (desired[index] - minimum[index]) * ratio;
    }
    widths.set(id, Math.floor(width));
  });
  return columns.map(id => {
    let def = mailListColumnDefs[id];
    if (def.icon) {
      return `${def.defaultWidth}px`;
    }
    if (def.flexible) {
      return "minmax(0, 1fr)";
    }
    return `${widths.get(id)}px`;
  }).join(" ");
}

export function setMailListColumnVisible(prefs: MailListColumnPrefs, id: MailListColumnId,
  visible: boolean): MailListColumnPrefs {
  if (mailListColumnDefs[id].required) {
    return prefs;
  }
  let hidden = prefs.hidden.filter(hiddenID => hiddenID != id);
  if (!visible) {
    hidden.push(id);
  }
  return { ...prefs, hidden };
}

/** Переносит столбец перед `beforeID`; без `beforeID` — в конец. */
export function moveMailListColumnBefore(prefs: MailListColumnPrefs, id: MailListColumnId,
  beforeID: MailListColumnId | null): MailListColumnPrefs {
  if (id == beforeID) {
    return prefs;
  }
  let order = prefs.order.filter(other => other != id);
  let index = beforeID ? order.indexOf(beforeID) : -1;
  order.splice(index < 0 ? order.length : index, 0, id);
  return { ...prefs, order };
}

/** Сдвигает столбец на одну позицию среди видимых: «левее» (-1) или «правее» (+1). */
export function moveMailListColumn(prefs: MailListColumnPrefs, id: MailListColumnId,
  delta: -1 | 1): MailListColumnPrefs {
  let visible = visibleMailListColumns(prefs);
  let index = visible.indexOf(id);
  let target = index + delta;
  if (index < 0 || target < 0 || target >= visible.length) {
    return prefs;
  }
  let before = delta < 0 ? visible[target] : visible[target + 1] ?? null;
  return moveMailListColumnBefore(prefs, id, before);
}

export function setMailListColumnWidth(prefs: MailListColumnPrefs, id: MailListColumnId,
  width: number | null): MailListColumnPrefs {
  let def = mailListColumnDefs[id];
  if (def.icon || def.flexible) {
    return prefs;
  }
  let widths = { ...prefs.widths };
  if (width == null || !Number.isFinite(width)) {
    delete widths[id];
  } else {
    widths[id] = clampWidth(id, width);
  }
  return { ...prefs, widths };
}

export function updateMailListColumns(change: (prefs: MailListColumnPrefs) => MailListColumnPrefs): void {
  mailListColumnsSetting.value = change(normalizeMailListColumnPrefs(mailListColumnsSetting.value));
}

export function resetMailListColumns(): void {
  mailListColumnsSetting.value = defaultMailListColumnPrefs();
}

/** Помещаются ли все видимые столбцы в минимальную ширину */
export function mailListTableFits(prefs: MailListColumnPrefs, listWidth: number): boolean {
  let columns = visibleMailListColumns(prefs);
  let fixed = reservedRowWidth(columns.length);
  let subjectMin = 0;
  for (let id of columns) {
    let def = mailListColumnDefs[id];
    if (def.flexible) {
      subjectMin = def.minWidth;
    } else {
      fixed += def.minWidth;
    }
  }
  let available = listWidth - fixed;
  return available >= Math.max(subjectMin, kSubjectMinShare * listWidth);
}

/**
 * Таблица или карточки для текущей ширины списка. Если столбцы не помещаются
 * даже сжатыми, показываем карточки: обрезанный край таблицы скрыл бы столбцы.
 */
export function resolveMailListLayout(layout: MailListLayout, listWidth: number,
  options: { mobile?: boolean, incidents?: boolean, prefs?: MailListColumnPrefs } = {}): "table" | "cards" {
  // Карточки инцидентов и мобильный вид рассчитаны на двухстрочные строки
  if (options.mobile || options.incidents || layout == "cards") {
    return "cards";
  }
  if (!mailListTableFits(options.prefs ?? defaultMailListColumnPrefs(), listWidth)) {
    return "cards";
  }
  if (layout == "table") {
    return "table";
  }
  return listWidth >= kMailListTableMinWidth ? "table" : "cards";
}

type ColumnSorts = { asc: MailListSort, desc: MailListSort, first: MailListSortDirection };

const columnSorts: Record<MailListSortColumn, ColumnSorts> = {
  received: { asc: "date-asc", desc: "date-desc", first: "desc" },
  from: { asc: "sender", desc: "sender-desc", first: "asc" },
  subject: { asc: "subject", desc: "subject-desc", first: "asc" },
  size: { asc: "size-asc", desc: "size-desc", first: "desc" },
  categories: { asc: "categories", desc: "categories-desc", first: "asc" },
  flag: { asc: "flag-asc", desc: "flag-desc", first: "desc" },
  importance: { asc: "importance-asc", desc: "importance-desc", first: "desc" },
  attachment: { asc: "attachment-asc", desc: "attachment-desc", first: "desc" },
};

/** Столбец и направление текущей сортировки */
export function mailListSortColumn(sort: MailListSort): { column: MailListSortColumn, direction: MailListSortDirection } {
  for (let [column, sorts] of Object.entries(columnSorts) as [MailListSortColumn, ColumnSorts][]) {
    if (sorts.asc == sort) {
      return { column, direction: "asc" };
    }
    if (sorts.desc == sort) {
      return { column, direction: "desc" };
    }
  }
  return { column: "received", direction: "desc" };
}

export function mailListSortFor(column: MailListSortColumn, direction: MailListSortDirection): MailListSort {
  return columnSorts[column][direction];
}

/** Щелчок по заголовку: тот же столбец — обратное направление, другой — его направление по умолчанию. */
export function nextMailListSort(current: MailListSort, column: MailListSortColumn): MailListSort {
  let active = mailListSortColumn(current);
  if (active.column == column) {
    return mailListSortFor(column, active.direction == "asc" ? "desc" : "asc");
  }
  return mailListSortFor(column, columnSorts[column].first);
}

export function isMailListSortColumn(id: MailListColumnId): id is MailListSortColumn {
  return mailListColumnDefs[id].sortable;
}

/** Подпись сортировки для подсказки и меню */
export function mailListSortLabel(sort: MailListSort): string {
  switch (sort) {
    case "date-asc": return gt`Oldest`;
    case "sender": return gt`By sender`;
    case "sender-desc": return gt`By sender, Z to A`;
    case "subject": return gt`By subject`;
    case "subject-desc": return gt`By subject, Z to A`;
    case "size-desc": return gt`Largest first`;
    case "size-asc": return gt`Smallest first`;
    case "categories": return gt`By category`;
    case "categories-desc": return gt`By category, Z to A`;
    case "flag-desc": return gt`Flagged first`;
    case "flag-asc": return gt`Unflagged first`;
    case "importance-desc": return gt`Important first`;
    case "importance-asc": return gt`Important last`;
    case "attachment-desc": return gt`With attachments first`;
    case "attachment-asc": return gt`Without attachments first`;
    default: return gt`Newest`;
  }
}

/** Размер письма для столбца «Размер», как в Outlook: «182 КБ», «1 МБ» */
export function mailSizeLabel(size: number | null | undefined): string {
  let bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  const units = [
    gt`B *=> bytes, short unit`,
    gt`KB *=> kilobytes, short unit`,
    gt`MB *=> megabytes, short unit`,
    gt`GB *=> gigabytes, short unit`,
  ];
  let index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  let value = bytes / Math.pow(1024, index);
  let number = new Intl.NumberFormat(getUILocale(), {
    maximumFractionDigits: index >= 2 && value < 10 ? 1 : 0,
  }).format(value);
  return `${number} ${units[index]}`;
}
