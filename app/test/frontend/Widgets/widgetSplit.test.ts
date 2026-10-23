import { expect, test } from "vitest";
import {
  clampWidgetSplitRatio,
  fitWidgetSplitRatio,
  splittableWidgets,
  WIDGET_SPLIT_DEFAULT_RATIO,
  WIDGET_SPLIT_MAX_RATIO,
  WIDGET_SPLIT_MIN_PART_PX,
  WIDGET_SPLIT_MIN_RATIO,
  type WidgetEntry,
} from "../../../frontend/Widgets/widgetState";

const widgets: WidgetEntry[] = [
  { id: "calendar", name: "Calendar", kind: "calendar" },
  { id: "chat", name: "Chat", kind: "chat" },
  { id: "live-sla", name: "SLA", kind: "live-sla" },
  { id: "site", name: "Site", kind: "web", url: "https://example.com" },
];

test("внизу — только встроенные панели, кроме той, что сверху", () => {
  expect(splittableWidgets(widgets, "chat").map(w => w.id)).toEqual(["calendar", "live-sla"]);
  expect(splittableWidgets(widgets, "site").map(w => w.id)).toEqual(["calendar", "chat", "live-sla"]);
});

test("доля верхней части в допустимых пределах", () => {
  expect(clampWidgetSplitRatio(0)).toBe(WIDGET_SPLIT_MIN_RATIO);
  expect(clampWidgetSplitRatio(1)).toBe(WIDGET_SPLIT_MAX_RATIO);
  expect(clampWidgetSplitRatio(NaN)).toBe(WIDGET_SPLIT_DEFAULT_RATIO);
  expect(clampWidgetSplitRatio(0.6500000000000001)).toBe(0.65);
});

test("в низкой панели ни одна часть не меньше минимума", () => {
  let height = 2 * WIDGET_SPLIT_MIN_PART_PX + 100;
  let top = fitWidgetSplitRatio(0.2, height) * height;
  expect(top).toBeGreaterThanOrEqual(WIDGET_SPLIT_MIN_PART_PX - 0.001);
  let bottom = (1 - fitWidgetSplitRatio(0.8, height)) * height;
  expect(bottom).toBeGreaterThanOrEqual(WIDGET_SPLIT_MIN_PART_PX - 0.001);
  expect(fitWidgetSplitRatio(0.3, WIDGET_SPLIT_MIN_PART_PX)).toBe(0.5);
  expect(fitWidgetSplitRatio(0.4, 2000)).toBe(0.4);
});
