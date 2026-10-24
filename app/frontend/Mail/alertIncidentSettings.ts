import type { Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import {
  alertIncidentKey,
  alertMessageOpensIncident,
  compileAlertPatterns,
  indexAlertIncidentHistory,
  kDefaultAlertQuietMs,
} from "../../logic/Mail/AlertIncident";
import { getLocalStorage } from "../Util/LocalStorage";

/**
 * Настройки «папки алертов». Хранятся локально, как звук и сортировка папки:
 * группировка считается в памяти, база данных не меняется.
 */
export interface AlertIncidentFolderSettings {
  /** true/false — явный выбор пользователя; нет значения — по правилу имени папки */
  enabled?: boolean;
  activeOnly?: boolean;
  suggestionDismissed?: boolean;
  /** Ключ инцидента → время закрытия, мс */
  closed?: Record<string, number>;
}

export type AlertIncidentCloseAction = "read" | "archive";

const kFolderPrefix = "mail.alertIncidents.folder.";
const kMaxClosedEntries = 500;
const kClosedRetentionMs = 90 * 24 * 60 * 60 * 1000;
const kQuietMinutesChoices = [15, 30, 60, 180, 720] as const;
/* Папки, где группировка алертов не имеет смысла */
const kExcludedSpecialFolders = new Set(["sent", "drafts", "trash", "spam", "outbox", "all", "search"]);

/** Общий выключатель: выключен — ни карточек, ни предложений, уведомления как обычно */
export const alertIncidentsEnabledSetting = getLocalStorage<boolean>("mail.alertIncidents.enabled", true);
export const alertQuietMinutesSetting = getLocalStorage<number>("mail.alertIncidents.quietMinutes", 60);
export const alertCloseActionSetting = getLocalStorage<AlertIncidentCloseAction>("mail.alertIncidents.closeAction", "read");
/** Шаблоны изменчивых частей темы, по одному регулярному выражению на строку */
export const alertPatternsSetting = getLocalStorage<string[]>("mail.alertIncidents.patterns", []);
/** Правило «это папка алертов»: подстроки имени папки, без учёта регистра */
export const alertFolderNameRulesSetting = getLocalStorage<string[]>("mail.alertIncidents.folderNameRules", []);

export const alertQuietMinutesOptions: readonly number[] = kQuietMinutesChoices;

export function alertIncidentFolderSetting(folder: Folder | null | undefined) {
  return getLocalStorage<AlertIncidentFolderSettings>(folderKey(folder), {});
}

export function readAlertIncidentFolderSettings(value: unknown): AlertIncidentFolderSettings {
  if (!value || typeof value != "object" || Array.isArray(value)) {
    return {};
  }
  let stored = value as AlertIncidentFolderSettings;
  let closed: Record<string, number> = {};
  if (stored.closed && typeof stored.closed == "object" && !Array.isArray(stored.closed)) {
    for (let [key, time] of Object.entries(stored.closed)) {
      if (typeof time == "number" && Number.isFinite(time)) {
        closed[key] = time;
      }
    }
  }
  return {
    enabled: typeof stored.enabled == "boolean" ? stored.enabled : undefined,
    activeOnly: stored.activeOnly === true,
    suggestionDismissed: stored.suggestionDismissed === true,
    closed,
  };
}

export function updateAlertIncidentFolderSettings(
  folder: Folder | null | undefined,
  patch: Partial<AlertIncidentFolderSettings>,
): void {
  if (!hasFolderKey(folder)) {
    return;
  }
  let setting = alertIncidentFolderSetting(folder);
  setting.value = {
    ...readAlertIncidentFolderSettings(setting.value),
    ...patch,
  };
}

export function canGroupAlertFolder(
  folder: Folder | null | undefined,
  globalEnabled: unknown = alertIncidentsEnabledSetting.value,
): boolean {
  return globalEnabled !== false && hasFolderKey(folder) && !kExcludedSpecialFolders.has(folder.specialFolder);
}

/** Группировать ли письма папки в инциденты. */
export function isAlertIncidentFolder(
  folder: Folder | null | undefined,
  settingsValue: unknown = alertIncidentFolderSetting(folder).value,
  nameRules: unknown = alertFolderNameRulesSetting.value,
  globalEnabled: unknown = alertIncidentsEnabledSetting.value,
): boolean {
  if (!canGroupAlertFolder(folder, globalEnabled)) {
    return false;
  }
  let settings = readAlertIncidentFolderSettings(settingsValue);
  if (typeof settings.enabled == "boolean") {
    return settings.enabled;
  }
  return matchesFolderNameRule(folder.name, nameRules);
}

export function matchesFolderNameRule(name: string | null | undefined, rules: unknown): boolean {
  let folderName = (name ?? "").toLocaleLowerCase();
  if (!folderName || !Array.isArray(rules)) {
    return false;
  }
  return rules.some(rule => typeof rule == "string" &&
    !!rule.trim() &&
    folderName.includes(rule.trim().toLocaleLowerCase()));
}

export function alertQuietMs(value: unknown = alertQuietMinutesSetting.value): number {
  let minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return kDefaultAlertQuietMs;
  }
  return Math.min(minutes, 7 * 24 * 60) * 60 * 1000;
}

export function alertPatterns(value: unknown = alertPatternsSetting.value): readonly RegExp[] {
  return compileAlertPatterns(Array.isArray(value) ? value : []);
}

/** Запоминает закрытие инцидента; старые записи удаляются, чтобы настройка не росла. */
export function markAlertIncidentClosed(folder: Folder | null | undefined, key: string, now = Date.now()): void {
  if (!hasFolderKey(folder)) {
    return;
  }
  let settings = readAlertIncidentFolderSettings(alertIncidentFolderSetting(folder).value);
  let entries = Object.entries(settings.closed ?? {})
    .filter(([entryKey, time]) => entryKey != key && now - time < kClosedRetentionMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, kMaxClosedEntries - 1);
  entries.unshift([key, now]);
  updateAlertIncidentFolderSettings(folder, { closed: Object.fromEntries(entries) });
}

/**
 * Оставляет из новых писем те, о которых стоит уведомить. В папке алертов —
 * только новый инцидент или возобновление после затишья, «решено» или
 * закрытия; не больше одного уведомления на инцидент в пачке.
 * Письма других папок проходят без изменений.
 */
export function filterAlertIncidentNotifications(messages: EMail[]): EMail[] {
  if (alertIncidentsEnabledSetting.value === false) {
    return messages;
  }
  let byFolder = new Map<Folder, EMail[]>();
  let checkedFolders = new Map<Folder, boolean>();
  for (let message of messages) {
    let folder = message.folder;
    if (!folder) {
      continue;
    }
    let isAlertFolder = checkedFolders.get(folder);
    if (isAlertFolder === undefined) {
      isAlertFolder = isAlertIncidentFolder(folder);
      checkedFolders.set(folder, isAlertFolder);
    }
    if (isAlertFolder) {
      let list = byFolder.get(folder);
      if (list) {
        list.push(message);
      } else {
        byFolder.set(folder, [message]);
      }
    }
  }
  if (!byFolder.size) {
    return messages;
  }
  let allowed = new Set<EMail>();
  let quietMs = alertQuietMs();
  let patterns = alertPatterns();
  for (let [folder, newMessages] of byFolder) {
    let batch = new Set(newMessages);
    let history = indexAlertIncidentHistory(folder.messages?.contents ?? [], batch, patterns);
    let closed = readAlertIncidentFolderSettings(alertIncidentFolderSetting(folder).value).closed ?? {};
    let notifiedKeys = new Set<string>();
    for (let message of newMessages) {
      let key = alertIncidentKey(message, patterns);
      if (notifiedKeys.has(key)) {
        continue;
      }
      let previous = history.get(key) ?? { lastFiring: null, lastResolved: null };
      if (alertMessageOpensIncident(message, previous, { quietMs, closedAt: closed[key] ?? null, patterns })) {
        allowed.add(message);
        notifiedKeys.add(key);
      }
    }
  }
  return messages.filter(message => !byFolder.has(message.folder) || allowed.has(message));
}

function hasFolderKey(folder: Folder | null | undefined): folder is Folder {
  return !!folder?.account?.id && (!!folder.id || folder.dbID != null);
}

function folderKey(folder: Folder | null | undefined): string {
  if (!hasFolderKey(folder)) {
    return `${kFolderPrefix}default`;
  }
  let reference = folder.id ? `id:${folder.id}` : `db:${folder.dbID}`;
  return `${kFolderPrefix}${folder.account.id}.${encodeURIComponent(reference)}`;
}
