import { getLocalStorage } from "../Util/LocalStorage";
import {
  DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
  normalizeResponseReminderConfig,
  type ResponseReminderConfig,
} from "../../logic/Reports/ResponseReminder";

export const RESPONSE_REMINDER_CONFIG_STORAGE_KEY =
  "reports.response-reminders.v1";
/** Ящик, выбранный в живом контроле: только он входит в область напоминаний. */
export const LIVE_SLA_ACCOUNT_STORAGE_KEY = "reports.live-sla.account.v1";

const responseReminderSetting = getLocalStorage<unknown>(
  RESPONSE_REMINDER_CONFIG_STORAGE_KEY,
  {},
);

const defaultResponseReminderConfig: ResponseReminderConfig = {
  enabled: false,
  intervalsMinutes: [...DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES],
  excludedCategoryNames: [],
  includeUncategorized: false,
  notifyWhenOverdue: false,
  notifyWhenTakenInWork: false,
};

export function getResponseReminderConfig(
  accountId: number | null,
): ResponseReminderConfig {
  if (accountId == null) {
    return cloneConfig(defaultResponseReminderConfig);
  }
  const configs = readConfigMap();
  return normalizeResponseReminderConfig(
    configs[String(accountId)],
    defaultResponseReminderConfig,
  );
}

export function setResponseReminderConfig(
  accountId: number,
  config: ResponseReminderConfig,
): void {
  const configs = readConfigMap();
  const previous = normalizeResponseReminderConfig(
    configs[String(accountId)],
    defaultResponseReminderConfig,
  );
  const nextConfig = normalizeResponseReminderConfig(
    config,
    defaultResponseReminderConfig,
  );
  const enabledSince = nextConfig.enabled
    ? previous.enabled
      ? (previous.enabledSince ?? nextConfig.enabledSince ?? Date.now())
      : (nextConfig.enabledSince ?? Date.now())
    : undefined;
  const next = {
    ...configs,
    [String(accountId)]: {
      enabled: nextConfig.enabled,
      intervalsMinutes: nextConfig.intervalsMinutes,
      excludedCategoryNames: nextConfig.excludedCategoryNames,
      includeUncategorized: nextConfig.includeUncategorized,
      notifyWhenOverdue: nextConfig.notifyWhenOverdue,
      notifyWhenTakenInWork: nextConfig.notifyWhenTakenInWork,
      ...(enabledSince == null ? {} : { enabledSince }),
    },
  };
  responseReminderSetting.value = next;
}

function readConfigMap(): Record<string, unknown> {
  try {
    const value = responseReminderSetting.value;
    return value && typeof value == "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function cloneConfig(config: ResponseReminderConfig): ResponseReminderConfig {
  return {
    enabled: config.enabled,
    intervalsMinutes: [...config.intervalsMinutes],
    excludedCategoryNames: [...config.excludedCategoryNames],
    includeUncategorized: config.includeUncategorized,
    notifyWhenOverdue: config.notifyWhenOverdue,
    notifyWhenTakenInWork: config.notifyWhenTakenInWork,
    ...(config.enabledSince == null
      ? {}
      : { enabledSince: config.enabledSince }),
  };
}
