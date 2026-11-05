import { writable } from "svelte/store";
import { getLocalStorage } from "../../Util/LocalStorage";

export type SmartViewId = "unread" | "starred" | "attachments" | "awaiting-reply" | "tasks" | "notes" | "scheduled";

interface SmartViewPreferences {
  order: SmartViewId[];
  hidden: SmartViewId[];
}

const defaultPreferences: SmartViewPreferences = {
  order: ["unread", "starred", "attachments", "awaiting-reply", "tasks", "notes", "scheduled"],
  hidden: [],
};

const preferencesSetting = getLocalStorage<unknown>(
  "mail.smart-views.preferences.v1",
  defaultPreferences,
);

export const smartViewPreferencesEpoch = writable(0);

function isSmartViewId(value: unknown): value is SmartViewId {
  return value == "unread" || value == "starred" || value == "attachments" ||
    value == "awaiting-reply" || value == "tasks" || value == "notes" || value == "scheduled";
}

function readPreferences(): SmartViewPreferences {
  const value = preferencesSetting.value;
  const input = value && typeof value == "object"
    ? value as Partial<SmartViewPreferences>
    : {};
  const order = Array.isArray(input.order) ? input.order.filter(isSmartViewId) : [];
  const hidden = Array.isArray(input.hidden) ? input.hidden.filter(isSmartViewId) : [];
  return {
    order: [...new Set([...order, ...defaultPreferences.order])],
    hidden: [...new Set(hidden)],
  };
}

function writePreferences(preferences: SmartViewPreferences): void {
  preferencesSetting.value = preferences;
  smartViewPreferencesEpoch.update(value => value + 1);
}

export function getVisibleSmartViewIds(): SmartViewId[] {
  const preferences = readPreferences();
  return preferences.order.filter(id => !preferences.hidden.includes(id));
}

export function getHiddenSmartViewIds(): SmartViewId[] {
  return readPreferences().hidden;
}

export function moveSmartView(id: SmartViewId, direction: "up" | "down"): void {
  const preferences = readPreferences();
  const visible = preferences.order.filter(item => !preferences.hidden.includes(item));
  const index = visible.indexOf(id);
  const targetIndex = index + (direction == "up" ? -1 : 1);
  if (index < 0 || targetIndex < 0 || targetIndex >= visible.length) {
    return;
  }
  const nextVisible = visible.slice();
  const [moved] = nextVisible.splice(index, 1);
  nextVisible.splice(targetIndex, 0, moved);
  const nextOrder = [
    ...nextVisible,
    ...preferences.order.filter(item => preferences.hidden.includes(item)),
  ];
  writePreferences({ ...preferences, order: nextOrder });
}

export function setSmartViewHidden(id: SmartViewId, hidden: boolean): void {
  const preferences = readPreferences();
  const nextHidden = hidden
    ? [...new Set([...preferences.hidden, id])]
    : preferences.hidden.filter(item => item != id);
  writePreferences({ ...preferences, hidden: nextHidden });
}

export function resetSmartViewPreferences(): void {
  writePreferences({
    order: [...defaultPreferences.order],
    hidden: [],
  });
}
