import { getLocalStorage } from "../Util/LocalStorage";
import {
  MAX_RESPONSE_TARGET_MINUTES,
  MIN_RESPONSE_TARGET_MINUTES,
} from "../../logic/Reports/ReportsData";

/** Норматив ответа по почтовым ящикам. Тот же ключ использует «Живой контроль»
 * (LiveSlaApp), поэтому отчёт и живой контроль видят одно значение. */
export const RESPONSE_TARGET_STORAGE_KEY = "reports.live-sla.target.v1";

const responseTargetSetting = getLocalStorage<unknown>(
  RESPONSE_TARGET_STORAGE_KEY,
  {},
);

/** @returns сохранённый норматив ящика в минутах или null, если его нет. */
export function getStoredResponseTargetMinutes(
  accountId: number | null,
): number | null {
  if (accountId == null) {
    return null;
  }
  const stored = Number(readTargetMap()[String(accountId)]);
  return Number.isInteger(stored) &&
    stored >= MIN_RESPONSE_TARGET_MINUTES &&
    stored <= MAX_RESPONSE_TARGET_MINUTES
    ? stored
    : null;
}

export function setStoredResponseTargetMinutes(
  accountId: number,
  targetMinutes: number,
): void {
  responseTargetSetting.value = {
    ...readTargetMap(),
    [String(accountId)]: targetMinutes,
  };
}

function readTargetMap(): Record<string, unknown> {
  try {
    const value = responseTargetSetting.value;
    return value && typeof value == "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}
