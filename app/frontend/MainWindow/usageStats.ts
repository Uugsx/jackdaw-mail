import { appGlobal } from "../../logic/app";
import { appVersion, isMobile, webMail } from "../../logic/build";
import { getLocalStorage } from "../Util/LocalStorage";

/** Анонимная статистика использования: раз в сутки отправляется
 * случайный идентификатор установки, версия, ОС и архитектура.
 * Ни почты, ни имён, ни адресов, ни IP-привязок к аккаунтам. */
const kPingURL = "https://license.jackdaw-mail.pro/v1/telemetry/ping";
const kStartDelayMs = 30_000;
const kCheckIntervalMs = 60 * 60 * 1000;
const kTimeoutMs = 10_000;

/** Выключатель в настройках. По умолчанию включено. */
export const usageStatsSetting = getLocalStorage<boolean>("usageStats.enabled", true);
const installIdSetting = getLocalStorage<string>("usageStats.installId", "");
const lastPingSetting = getLocalStorage<string>("usageStats.lastPingDay", "");

let started = false;

export function isUsageStatsEnabled(): boolean {
  return usageStatsSetting.value !== false;
}

/** Текущий день по UTC, как считает сервер. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function mapOS(platform: string | undefined): string | null {
  switch (platform) {
    case "darwin": return "mac";
    case "win32": return "win";
    case "linux": return "linux";
    default: return null;
  }
}

export function sanitizeArch(arch: string | undefined): string {
  let value = String(arch ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return /^[a-z0-9_]{2,10}$/.test(value) ? value : "unknown";
}

/** Отдельный случайный UUID, не связанный ни с лицензией, ни с устройством. */
function getInstallId(): string {
  let id = installIdSetting.value;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    id = crypto.randomUUID();
    installIdSetting.value = id;
  }
  return id;
}

/** Нужен ли пинг сегодня: включено и ещё не отправляли в этот день. */
export function shouldPing(now = new Date()): boolean {
  return isUsageStatsEnabled() && lastPingSetting.value != utcDay(now);
}

/** Отправляет пинг, если пора. Любые ошибки молча игнорируются. */
export async function sendUsageStatsPing(): Promise<boolean> {
  try {
    if (!shouldPing()) {
      return false;
    }
    let os = mapOS(await appGlobal.remoteApp?.platform?.());
    if (!os) {
      return false;
    }
    let arch = sanitizeArch(await appGlobal.remoteApp?.arch?.());
    let day = utcDay();
    let response = await fetch(kPingURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: getInstallId(), version: appVersion, os, arch }),
      signal: AbortSignal.timeout(kTimeoutMs),
    });
    if (response.ok) {
      lastPingSetting.value = day;
      return true;
    }
  } catch (ex) {
    // Нет сети или сервер недоступен: попробуем при следующей проверке
  }
  return false;
}

/** Запускает ежедневную отправку; запуск приложения не задерживает. */
export function startUsageStatsPing(): void {
  if (started || webMail || isMobile) {
    return;
  }
  started = true;
  setTimeout(() => {
    void sendUsageStatsPing();
    setInterval(() => void sendUsageStatsPing(), kCheckIntervalMs);
  }, kStartDelayMs);
}
