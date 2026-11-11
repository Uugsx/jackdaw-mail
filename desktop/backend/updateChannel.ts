/**
 * Канал обновлений: основной или пробный.
 *
 * Новый выпуск CI публикует на GitHub как prerelease — это пробный канал.
 * Основной канал смотрит только на выпуск, отмеченный GitHub как latest
 * (electron-updater с `allowPrerelease = false` запрашивает `/releases/latest`),
 * а latest меняется только при продвижении (workflow «Promote Desktop Update»).
 * Пробный клиент включает `allowPrerelease` и берёт самый новый опубликованный выпуск.
 *
 * Выбор хранится в файле в каталоге данных приложения, а не в настройках интерфейса:
 * проверка обновлений идёт из главного процесса сразу при запуске, до загрузки UI.
 */

export const kUpdateChannelFileName = "update-channel.json";

export type UpdateChannel = "stable" | "pilot";

/** Канал из содержимого файла; повреждённый или неизвестный файл — основной канал. */
export function parseUpdateChannel(raw: string | null | undefined): UpdateChannel {
  if (!raw) {
    return "stable";
  }
  try {
    let parsed = JSON.parse(raw);
    return parsed?.channel === "pilot" ? "pilot" : "stable";
  } catch {
    return "stable";
  }
}

export function serializeUpdateChannel(channel: UpdateChannel): string {
  return JSON.stringify({ channel }, null, 2) + "\n";
}

/**
 * Брать ли prerelease-выпуски GitHub.
 * Старые сборки `0.9.x-dev.*` выпускались как prerelease и без этого обновлений не видят.
 */
export function shouldAllowPrerelease(appVersion: string, channel: UpdateChannel): boolean {
  return channel === "pilot" || appVersion.includes("-dev");
}
