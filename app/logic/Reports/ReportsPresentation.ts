import type {
  MailCategoryRow,
  MailResponseRow,
  MailResponderRow,
} from "./ReportsData";
import {
  isWithinWorkingHours,
  normalizeWorkingHoursSchedule,
  type WorkingHoursSchedule,
} from "./WorkingHours";
import { gt } from "../../l10n/l10n";

export type ReportDashboardSectionId =
  | "timeline"
  | "heatmap"
  | "response-time"
  | "response-details"
  | "category-rhythm"
  | "responders"
  | "topics"
  | "categories"
  | "mail-breakdown"
  | "calendar"
  | "chat"
  | "files";

export type ReportDashboardWidth = "third" | "half" | "two-thirds" | "full";

export interface ReportDashboardPanelLayout {
  id: ReportDashboardSectionId;
  width: ReportDashboardWidth;
  tall: boolean;
}

export type ResponderAttributionMode = "profile" | "category";

export interface ResponderAttributionConfig {
  mode: ResponderAttributionMode;
  categoryNames: string[];
}

export const REPORT_DASHBOARD_DEFAULT_LAYOUT: ReportDashboardPanelLayout[] = [
  { id: "timeline", width: "full", tall: false },
  { id: "heatmap", width: "full", tall: false },
  { id: "response-time", width: "full", tall: false },
  { id: "response-details", width: "full", tall: true },
  { id: "category-rhythm", width: "full", tall: true },
  { id: "responders", width: "full", tall: false },
  { id: "topics", width: "half", tall: false },
  { id: "categories", width: "half", tall: false },
  { id: "mail-breakdown", width: "half", tall: false },
  { id: "calendar", width: "half", tall: false },
  { id: "chat", width: "half", tall: false },
  { id: "files", width: "half", tall: false },
];

const dashboardSectionIds = new Set<ReportDashboardSectionId>(
  REPORT_DASHBOARD_DEFAULT_LAYOUT.map((panel) => panel.id),
);

export function normalizeReportDashboardLayout(
  value: unknown,
): ReportDashboardPanelLayout[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<ReportDashboardSectionId>();
  const normalized: ReportDashboardPanelLayout[] = [];
  for (const item of input) {
    if (
      !isRecord(item) ||
      !dashboardSectionIds.has(item.id as ReportDashboardSectionId)
    ) {
      continue;
    }
    const id = item.id as ReportDashboardSectionId;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      width: isDashboardWidth(item.width) ? item.width : defaultPanel(id).width,
      tall: item.tall === true,
    });
  }
  for (const panel of REPORT_DASHBOARD_DEFAULT_LAYOUT) {
    if (!seen.has(panel.id)) {
      normalized.push({ ...panel });
    }
  }
  return normalized;
}

export function moveReportDashboardPanel(
  layout: ReportDashboardPanelLayout[],
  id: ReportDashboardSectionId,
  direction: "up" | "down",
): ReportDashboardPanelLayout[] {
  const next = layout.map((panel) => ({ ...panel }));
  const index = next.findIndex((panel) => panel.id === id);
  if (index < 0) {
    return next;
  }
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }
  const [panel] = next.splice(index, 1);
  next.splice(targetIndex, 0, panel);
  return next;
}

export function moveReportDashboardPanelBefore(
  layout: ReportDashboardPanelLayout[],
  sourceId: ReportDashboardSectionId,
  targetId: ReportDashboardSectionId,
): ReportDashboardPanelLayout[] {
  if (sourceId === targetId) {
    return layout.map((panel) => ({ ...panel }));
  }
  const next = layout.map((panel) => ({ ...panel }));
  const sourceIndex = next.findIndex((panel) => panel.id === sourceId);
  const targetIndex = next.findIndex((panel) => panel.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return next;
  }
  const [panel] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.findIndex((item) => item.id === targetId);
  next.splice(adjustedTargetIndex, 0, panel);
  return next;
}

export function cycleReportDashboardWidth(
  width: ReportDashboardWidth,
  direction: "wider" | "narrower" = "wider",
): ReportDashboardWidth {
  const widths: ReportDashboardWidth[] = [
    "third",
    "half",
    "two-thirds",
    "full",
  ];
  const currentIndex = widths.indexOf(width);
  const offset = direction === "wider" ? 1 : -1;
  return widths[
    Math.max(0, Math.min(widths.length - 1, currentIndex + offset))
  ];
}

export function reportDashboardWidthColumns(
  width: ReportDashboardWidth,
): number {
  switch (width) {
    case "third":
      return 2;
    case "half":
      return 3;
    case "two-thirds":
      return 4;
    case "full":
      return 6;
  }
}

/** Доля ответов сотрудника среди всех подтверждённых ответов выбранного представления. */
export function responderResponseShare(
  answered: number,
  totalAnswered: number,
): number {
  return totalAnswered > 0 ? answered / totalAnswered : 0;
}

export interface CategoryRhythmRow {
  name: string;
  requests: number;
  answered: number;
  unanswered: number;
  afterHours: number;
  afterHoursRate: number;
  activeDays: number;
  activeWeekdays: number;
  quietWeekdays: number;
  peakWeekday: number | null;
  peakHour: number | null;
  peakCount: number;
  quietWeekday: number | null;
  quietHour: number | null;
  quietWeekdayCount: number;
  quietHourCount: number;
  quietSlotWeekday: number | null;
  quietSlotHour: number | null;
  quietSlotCount: number;
  workingSlots: number;
  activeWorkingSlots: number;
  quietWorkingSlots: number;
  /** Количество первых ответов для каждой ячейки weekday * 24 + hour. */
  activity: number[];
}

const RHYTHM_WEEKDAYS = 7;
const RHYTHM_HOURS = 24;

/**
 * Строит ритм по ответам, связанным с категориями сотрудников.
 * Пустые слоты означают отсутствие зафиксированного ответа, а не доказанное
 * отсутствие сотрудника: категория может не получать запросы в этот момент.
 */
export function buildCategoryRhythmRows(
  responses: MailResponseRow[],
  categories: Pick<MailCategoryRow, "name" | "incoming">[],
  workingHours: WorkingHoursSchedule,
  categoryNames: string[] = categories.map((category) => category.name),
): CategoryRhythmRow[] {
  const schedule = normalizeWorkingHoursSchedule(workingHours);
  const requestsByName = new Map(
    categories.map((category) => [category.name.trim(), category.incoming]),
  );
  const selectedNames = [
    ...new Set(categoryNames.map((name) => name.trim()).filter(Boolean)),
  ];
  const accumulators = new Map(
    selectedNames.map((name) => [
      name,
      {
        requests: requestsByName.get(name) ?? 0,
        answered: 0,
        afterHours: 0,
        activeDates: new Set<string>(),
        weekdayCounts: Array.from({ length: RHYTHM_WEEKDAYS }, () => 0),
        hourCounts: Array.from({ length: RHYTHM_HOURS }, () => 0),
        activity: Array.from(
          { length: RHYTHM_WEEKDAYS * RHYTHM_HOURS },
          () => 0,
        ),
      },
    ]),
  );

  for (const response of responses) {
    const responseCategoryNames = new Set(
      response.categoryNames
        .map((name) => name.trim())
        .filter((name) => accumulators.has(name)),
    );
    if (!responseCategoryNames.size) {
      continue;
    }
    const weekday = localWeekday(response.responseAt);
    const hour = response.responseAt.getHours();
    if (
      weekday < 0 ||
      weekday >= RHYTHM_WEEKDAYS ||
      hour < 0 ||
      hour >= RHYTHM_HOURS
    ) {
      continue;
    }
    const activityIndex = weekday * RHYTHM_HOURS + hour;
    const outsideWorkingHours = !isWithinWorkingHours(
      response.responseAt,
      schedule,
    );
    for (const name of responseCategoryNames) {
      const accumulator = accumulators.get(name);
      if (!accumulator) {
        continue;
      }
      accumulator.answered++;
      accumulator.afterHours += outsideWorkingHours ? 1 : 0;
      accumulator.activeDates.add(localDateKey(response.responseAt));
      accumulator.weekdayCounts[weekday]++;
      accumulator.hourCounts[hour]++;
      accumulator.activity[activityIndex]++;
    }
  }

  const workingSlotIndexes = workingSlotIndexList(schedule);
  const enabledWeekdays = schedule.days
    .map((day, weekday) => (day.enabled ? weekday : null))
    .filter((weekday): weekday is number => weekday != null);
  const workingHoursSet = new Set(
    workingSlotIndexes.map((index) => index % RHYTHM_HOURS),
  );

  return selectedNames.map((name) => {
    const accumulator = accumulators.get(name);
    if (!accumulator) {
      throw new Error(gt`Could not build the rhythm for the category “${name}”.`);
    }
    const peak = selectPeakSlot(accumulator.activity);
    const quietWeekday = selectQuietValue(
      enabledWeekdays.map((weekday) => ({
        value: weekday,
        count: accumulator.weekdayCounts[weekday],
      })),
    );
    const quietHour = selectQuietValue(
      [...workingHoursSet].map((hour) => ({
        value: hour,
        count: accumulator.hourCounts[hour],
      })),
    );
    const activeWorkingSlots = workingSlotIndexes.filter(
      (index) => accumulator.activity[index] > 0,
    ).length;
    const quietSlot = selectQuietSlot(
      accumulator.activity,
      workingSlotIndexes,
    );
    const activeWeekdays = accumulator.weekdayCounts.filter(
      (count) => count > 0,
    ).length;
    const requests = Math.max(accumulator.requests, accumulator.answered);
    return {
      name,
      requests,
      answered: accumulator.answered,
      unanswered: Math.max(0, requests - accumulator.answered),
      afterHours: accumulator.afterHours,
      afterHoursRate:
        accumulator.answered > 0
          ? accumulator.afterHours / accumulator.answered
          : 0,
      activeDays: accumulator.activeDates.size,
      activeWeekdays,
      quietWeekdays: enabledWeekdays.filter(
        (weekday) => accumulator.weekdayCounts[weekday] == 0,
      ).length,
      peakWeekday: peak?.weekday ?? null,
      peakHour: peak?.hour ?? null,
      peakCount: peak?.count ?? 0,
      quietWeekday: quietWeekday?.value ?? null,
      quietHour: quietHour?.value ?? null,
      quietWeekdayCount: quietWeekday?.count ?? 0,
      quietHourCount: quietHour?.count ?? 0,
      quietSlotWeekday: quietSlot?.weekday ?? null,
      quietSlotHour: quietSlot?.hour ?? null,
      quietSlotCount: quietSlot?.count ?? 0,
      workingSlots: workingSlotIndexes.length,
      activeWorkingSlots,
      quietWorkingSlots: Math.max(
        0,
        workingSlotIndexes.length - activeWorkingSlots,
      ),
      activity: accumulator.activity,
    };
  });
}

/** Сортирует категории по количеству ответов вне графика, затем по объёму работы. */
export function sortCategoryRhythmRows(
  rows: CategoryRhythmRow[],
): CategoryRhythmRow[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        b.afterHours - a.afterHours ||
        b.answered - a.answered ||
        b.requests - a.requests ||
        a.name.localeCompare(b.name),
    );
}

export function toggleReportDashboardHeight(tall: boolean): boolean {
  return !tall;
}

export function isLikelyPersonCategory(value: string): boolean {
  const tokens = value.trim().split(/\s+/u);
  if (tokens.length < 2 || tokens.length > 4) {
    return false;
  }
  return tokens.every((token) => /^\p{Lu}[\p{L}'’\-]*$/u.test(token));
}

export function defaultResponderCategoryNames(
  categories: Pick<MailCategoryRow, "name">[],
): string[] {
  return categories
    .map((category) => category.name.trim())
    .filter((name) => isLikelyPersonCategory(name));
}

export function buildCategoryResponderRows(
  categories: MailCategoryRow[],
  accountId: number,
  categoryNames: string[],
): MailResponderRow[] {
  const selected = new Set(
    categoryNames.map((name) => name.trim()).filter(Boolean),
  );
  return categories
    .filter((category) => selected.has(category.name.trim()))
    .map((category) => ({
      accountId,
      accountName: category.name,
      email: "",
      requests: category.incoming,
      answered: category.answered,
      // В режиме меток это число подтверждённых первых ответов, а не весь исходящий поток ящика.
      sent: category.answered,
      lastActivity: category.lastActivity ?? null,
      peakWeekday: category.peakWeekday ?? null,
      peakHour: category.peakHour ?? null,
      responseTime: category.responseTime,
    }))
    .sort(
      (a, b) =>
        b.answered - a.answered ||
        b.requests - a.requests ||
        a.accountName.localeCompare(b.accountName),
    );
}

/** Ограничивает строки ответов выбранными метками входящего запроса. */
export function filterReportResponsesByCategories(
  responses: MailResponseRow[],
  categoryNames: string[] | null,
): MailResponseRow[] {
  if (categoryNames == null) {
    return responses;
  }
  const selected = new Set(
    categoryNames.map((name) => name.trim()).filter(Boolean),
  );
  return responses.filter((response) =>
    response.categoryNames.some((name) => selected.has(name.trim())),
  );
}

/** Оставляет в настройке отвечающих только категории, вошедшие в отчёт. */
export function intersectResponderCategories(
  responderCategories: string[],
  reportCategories: string[] | null,
): string[] {
  if (reportCategories == null) {
    return responderCategories.slice();
  }
  const allowed = new Set(
    reportCategories.map((name) => name.trim()).filter(Boolean),
  );
  return responderCategories.filter((name) => allowed.has(name.trim()));
}

export function normalizeResponderAttributionConfig(
  value: unknown,
  fallback: ResponderAttributionConfig,
): ResponderAttributionConfig {
  if (!isRecord(value)) {
    return { ...fallback, categoryNames: fallback.categoryNames.slice() };
  }
  const mode: ResponderAttributionMode =
    value.mode === "category" || value.mode === "profile"
      ? value.mode
      : fallback.mode;
  const categoryNames = Array.isArray(value.categoryNames)
    ? value.categoryNames
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean)
    : fallback.categoryNames.slice();
  return {
    mode,
    categoryNames: [...new Set(categoryNames)],
  };
}

function defaultPanel(
  id: ReportDashboardSectionId,
): ReportDashboardPanelLayout {
  return (
    REPORT_DASHBOARD_DEFAULT_LAYOUT.find((panel) => panel.id === id) ??
    REPORT_DASHBOARD_DEFAULT_LAYOUT[0]
  );
}

function selectPeakSlot(
  activity: number[],
): { weekday: number; hour: number; count: number } | null {
  let selected: { weekday: number; hour: number; count: number } | null = null;
  for (let weekday = 0; weekday < RHYTHM_WEEKDAYS; weekday++) {
    for (let hour = 0; hour < RHYTHM_HOURS; hour++) {
      const count = activity[weekday * RHYTHM_HOURS + hour] ?? 0;
      if (
        count > 0 &&
        (!selected ||
          count > selected.count ||
          (count == selected.count &&
            (weekday < selected.weekday ||
              (weekday == selected.weekday && hour < selected.hour))))
      ) {
        selected = { weekday, hour, count };
      }
    }
  }
  return selected;
}

function selectQuietValue(
  values: { value: number; count: number }[],
): { value: number; count: number } | null {
  return values.reduce<{ value: number; count: number } | null>(
    (selected, current) =>
      !selected ||
      current.count < selected.count ||
      (current.count == selected.count && current.value < selected.value)
        ? current
        : selected,
    null,
  );
}

function selectQuietSlot(
  activity: number[],
  indexes: number[],
): { weekday: number; hour: number; count: number } | null {
  let selected: { weekday: number; hour: number; count: number } | null = null;
  for (const index of indexes) {
    const weekday = Math.floor(index / RHYTHM_HOURS);
    const hour = index % RHYTHM_HOURS;
    const count = activity[index] ?? 0;
    if (
      !selected ||
      count < selected.count ||
      (count == selected.count &&
        (weekday < selected.weekday ||
          (weekday == selected.weekday && hour < selected.hour)))
    ) {
      selected = { weekday, hour, count };
    }
  }
  return selected;
}

function workingSlotIndexList(schedule: WorkingHoursSchedule): number[] {
  const indexes: number[] = [];
  for (let weekday = 0; weekday < RHYTHM_WEEKDAYS; weekday++) {
    const day = schedule.days[weekday];
    if (!day?.enabled || day.startMinutes >= day.endMinutes) {
      continue;
    }
    const startHour = Math.floor(day.startMinutes / 60);
    const endHour = Math.ceil(day.endMinutes / 60);
    for (let hour = startHour; hour < endHour; hour++) {
      indexes.push(weekday * RHYTHM_HOURS + hour);
    }
  }
  return indexes;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function localWeekday(date: Date): number {
  return (date.getDay() + 6) % RHYTHM_WEEKDAYS;
}

function isDashboardWidth(value: unknown): value is ReportDashboardWidth {
  return (
    value === "third" ||
    value === "half" ||
    value === "two-thirds" ||
    value === "full"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
