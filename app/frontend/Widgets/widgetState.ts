import { getLocalStorage } from "../Util/LocalStorage";
import { gt } from "../../l10n/l10n";
import { closeWidgetPopout } from "../../logic/util/widgetBrowser";
import { writable } from "svelte/store";

export type WidgetKind = "web" | "calendar" | "live-sla" | "chat";

export type WidgetRefreshMinutes = 0 | 1 | 2 | 5 | 10 | 30 | 60 | 90;

export interface WidgetWebSettings {
  refreshMinutes?: WidgetRefreshMinutes;
  mobileVersion?: boolean;
  /** null = use splitter width */
  customWidthPx?: number | null;
  /** Unmount webview while tab is hidden to save CPU/RAM (cookies stay). */
  freezeWhenHidden?: boolean;
}

export interface WidgetEntry {
  id: string;
  name: string;
  kind: WidgetKind;
  url?: string;
  settings?: WidgetWebSettings;
}

export const WIDGET_REFRESH_MINUTES: WidgetRefreshMinutes[] = [0, 1, 2, 5, 10, 30, 60, 90];

export const WIDGET_PANEL_WIDTHS: Array<number | null> = [null, 280, 320, 360, 420, 480, 560];

export const WIDGET_RAIL_WIDTH_PX = 44;
export const WIDGET_RAIL_TRAILING_INSET_PX = 4;
export const WIDGET_COLLAPSED_WIDTH_PX =
  WIDGET_RAIL_WIDTH_PX + WIDGET_RAIL_TRAILING_INSET_PX;
export const WIDGET_DEFAULT_PANEL_WIDTH_PX = 320;
export const LIVE_SLA_WIDGET_ID = "live-sla";

/** Bump to remount the widgets splitter after a preset width is applied. */
export const widgetSplitterResetKey = writable(0);

/** Apply a panel width preset by updating the saved widgets splitter ratio. */
export function applyWidgetPanelWidthPreset(panelWidthPx: number | null) {
  let storageKey = "ui.splitter.widgets";
  if (panelWidthPx == null) {
    localStorage.removeItem(storageKey);
  } else {
    let barWidth = 2;
    let chromeEstimate = 120;
    let available = Math.max(600, window.innerWidth - chromeEstimate) - barWidth;
    let rightWidth = WIDGET_RAIL_WIDTH_PX + panelWidthPx;
    let leftWidth = Math.max(300, available - rightWidth);
    localStorage.setItem(storageKey, JSON.stringify(rightWidth / leftWidth));
  }
  widgetSplitterResetKey.update(k => k + 1);
}

export const MOBILE_WEBVIEW_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const calendarWidget: WidgetEntry = {
  id: "calendar",
  name: gt`Calendar`,
  kind: "calendar",
};

export const CHAT_WIDGET_ID = "chat";

/** Чат Jackdaw рядом с почтой: переписка видна, пока пишешь письмо */
const chatWidget: WidgetEntry = {
  id: CHAT_WIDGET_ID,
  name: gt`Chat`,
  kind: "chat",
};

const liveSlaWidget: WidgetEntry = {
  id: LIVE_SLA_WIDGET_ID,
  name: gt`Live response control`,
  kind: "live-sla",
};

export const defaultWidgets: WidgetEntry[] = [
  calendarWidget,
  chatWidget,
  liveSlaWidget,
  {
    id: "chatgpt",
    name: "ChatGPT",
    kind: "web",
    url: "https://chatgpt.com",
  },
];

export const widgetsEnabled = getLocalStorage("widgets.enabled", true);
export const widgetsExpanded = getLocalStorage("widgets.expanded", false);
export const widgetsListSetting = getLocalStorage<WidgetEntry[]>("widgets.list", defaultWidgets);
export const activeWidgetIdSetting = getLocalStorage<string | null>("widgets.active", defaultWidgets[0]?.id ?? null);

/** Increment to ask an open web widget panel to reload after sign-in. */
export const widgetReloadNonce = writable<Record<string, number>>({});

export function reloadWebWidget(id: string) {
  widgetReloadNonce.update(map => ({ ...map, [id]: (map[id] ?? 0) + 1 }));
}

export function getWidgetWebSettings(entry: WidgetEntry): Required<WidgetWebSettings> {
  return {
    refreshMinutes: entry.settings?.refreshMinutes ?? 0,
    mobileVersion: entry.settings?.mobileVersion ?? false,
    customWidthPx: entry.settings?.customWidthPx ?? null,
    freezeWhenHidden: entry.settings?.freezeWhenHidden ?? false,
  };
}

export function updateWidgetSettings(id: string, patch: Partial<WidgetWebSettings>) {
  let list = normalizeWidgetList(widgetsListSetting.value);
  widgetsListSetting.value = list.map(entry => {
    if (entry.id !== id) {
      return entry;
    }
    let current = getWidgetWebSettings(entry);
    return {
      ...entry,
      settings: { ...current, ...entry.settings, ...patch },
    };
  });
}

export function resetWidgetSettings(id: string) {
  let list = normalizeWidgetList(widgetsListSetting.value);
  widgetsListSetting.value = list.map(entry => {
    if (entry.id !== id) {
      return entry;
    }
    let { settings: _removed, ...rest } = entry;
    return rest;
  });
  reloadWebWidget(id);
}

export function updateWebWidget(id: string, name: string, url: string) {
  let list = normalizeWidgetList(widgetsListSetting.value);
  widgetsListSetting.value = list.map(entry => {
    if (entry.id !== id) {
      return entry;
    }
    return { ...entry, name: name.trim(), url: url.trim() };
  });
  reloadWebWidget(id);
}

/** Название встроенной панели на текущем языке интерфейса.
 * В `widgets.list` хранится имя на языке, который был выбран при первом запуске,
 * поэтому для встроенных панелей его нельзя показывать как есть. */
function builtInWidgetName(kind: WidgetKind): string | null {
  if (kind === "calendar") {
    return gt`Calendar`;
  }
  if (kind === "live-sla") {
    return gt`Live response control`;
  }
  if (kind === "chat") {
    return gt`Chat`;
  }
  return null;
}

export function normalizeWidgetList(list: WidgetEntry[] | null | undefined): WidgetEntry[] {
  let items = (list ?? []).map(entry => {
    let kind = entry.kind ?? (entry.url ? "web" as const : "calendar" as const);
    return {
      ...entry,
      kind,
      name: builtInWidgetName(kind) ?? entry.name,
    };
  });
  if (!items.length) {
    // Имена встроенных панелей — на текущем языке: при загрузке модуля переводы могли быть ещё не готовы
    return defaultWidgets.map(entry => ({ ...entry, name: builtInWidgetName(entry.kind) ?? entry.name }));
  }
  if (!items.some(w => w.kind === "calendar")) {
    items = [calendarWidget, ...items];
  }
  if (!items.some(w => w.kind === "live-sla")) {
    let calendarIndex = items.findIndex(w => w.kind === "calendar");
    items.splice(calendarIndex + 1, 0, liveSlaWidget);
  }
  if (!items.some(w => w.kind === "chat")) {
    let calendarIndex = items.findIndex(w => w.kind === "calendar");
    items.splice(calendarIndex + 1, 0, chatWidget);
  }
  return items.length ? items : defaultWidgets;
}

export function selectWidget(id: string) {
  activeWidgetIdSetting.value = id;
  widgetsExpanded.value = true;
}

/** Открывает живой SLA-контроль в правой панели, даже если панель была скрыта. */
export function openLiveSlaWidget(): void {
  widgetsEnabled.value = true;
  selectWidget(LIVE_SLA_WIDGET_ID);
}

export function toggleWidgetPanel() {
  widgetsExpanded.value = !widgetsExpanded.value;
}

export function addWebWidget(name: string, url: string): WidgetEntry {
  let list = normalizeWidgetList(widgetsListSetting.value);
  let entry: WidgetEntry = {
    id: crypto.randomUUID(),
    name: name.trim(),
    kind: "web",
    url: url.trim(),
  };
  widgetsListSetting.value = [...list, entry];
  selectWidget(entry.id);
  return entry;
}

export function removeWidget(id: string) {
  if (id === calendarWidget.id) {
    return;
  }
  closeWidgetPopout("widget-" + id);
  let list = normalizeWidgetList(widgetsListSetting.value).filter(w => w.id !== id);
  widgetsListSetting.value = list.length ? list : defaultWidgets;
  if (activeWidgetIdSetting.value === id) {
    activeWidgetIdSetting.value = list[0]?.id ?? calendarWidget.id;
  }
}

export function isBuiltInWidget(entry: WidgetEntry): boolean {
  return entry.kind === "calendar" || entry.kind === "live-sla" || entry.kind === "chat";
}

export function migrateWidgetListIfNeeded(): void {
  let current = widgetsListSetting.value ?? [];
  let normalized = normalizeWidgetList(current);
  if (
    current.length !== normalized.length
    || normalized.some((entry, index) => entry.id !== current[index]?.id || entry.kind !== current[index]?.kind)
  ) {
    widgetsListSetting.value = normalized;
  }
}

/** Нижняя часть разделённой панели: вторая встроенная панель (например, чат сверху,
 * контроль ответа снизу). Больше двух частей не делаем: в низком окне они не помещаются. */
export interface WidgetSplitState {
  /** null — панель не разделена */
  bottomId: string | null;
  /** Доля высоты верхней части */
  ratio: number;
}

export const WIDGET_SPLIT_DEFAULT_RATIO = 0.55;
export const WIDGET_SPLIT_MIN_RATIO = 0.2;
export const WIDGET_SPLIT_MAX_RATIO = 0.8;
/** Меньше этой высоты части уже неудобны (в чате — заголовок, лента и поле ввода): такую панель не делим */
export const WIDGET_SPLIT_MIN_PART_PX = 240;

export const widgetSplitSetting = getLocalStorage<WidgetSplitState>("widgets.split",
  { bottomId: null, ratio: WIDGET_SPLIT_DEFAULT_RATIO });

export function clampWidgetSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return WIDGET_SPLIT_DEFAULT_RATIO;
  }
  let clamped = Math.min(WIDGET_SPLIT_MAX_RATIO, Math.max(WIDGET_SPLIT_MIN_RATIO, ratio));
  return Math.round(clamped * 1000) / 1000;
}

/** Доля верхней части для панели этой высоты: ни одна часть не меньше минимума */
export function fitWidgetSplitRatio(ratio: number, panelHeightPx: number): number {
  let clamped = clampWidgetSplitRatio(ratio);
  if (!(panelHeightPx > 0)) {
    return clamped;
  }
  let min = WIDGET_SPLIT_MIN_PART_PX / panelHeightPx;
  return min >= 0.5 ? 0.5 : Math.min(1 - min, Math.max(min, clamped));
}

/** Встроенные панели, которые можно открыть внизу. Сайты — только сверху: у каждого
 * один webview, и перенос вниз перезагружал бы страницу. */
export function splittableWidgets(list: WidgetEntry[], topId: string | null | undefined): WidgetEntry[] {
  return list.filter(entry => isBuiltInWidget(entry) && entry.id !== topId);
}

export function setWidgetSplitBottom(bottomId: string | null) {
  let current = widgetSplitSetting.value;
  widgetSplitSetting.value = { bottomId, ratio: clampWidgetSplitRatio(current?.ratio ?? WIDGET_SPLIT_DEFAULT_RATIO) };
}

export function setWidgetSplitRatio(ratio: number) {
  let current = widgetSplitSetting.value;
  widgetSplitSetting.value = { bottomId: current?.bottomId ?? null, ratio: clampWidgetSplitRatio(ratio) };
}
