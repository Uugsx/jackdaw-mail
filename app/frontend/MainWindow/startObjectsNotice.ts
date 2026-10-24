import { ButtonData, Notification, NotificationSeverity, notifications } from "./Notification";
import { logError } from "../Util/error";
import { friendlyErrorMessage } from "../../logic/util/friendlyError";
import type { DatabaseBusyCallback } from "../../logic/util/retryWhileDatabaseBusy";
import { gt } from "../../l10n/l10n";

/** Через сколько показать баннер о загрузке: первая попытка сама
 * может ждать чужую блокировку базы до busy_timeout процесса базы. */
const kSlowStartMs = 2_000;

/**
 * Читает стартовые объекты (аккаунты из локальных баз), затем вызывает `onLoaded`.
 *
 * Пока чтение затянулось или база занята и идут повторы, показывает баннер
 * о загрузке: иначе пустой список писем выглядит так, будто аккаунты пропали.
 * Если прочитать не удалось, показывает понятную ошибку с кнопкой «Повторить»,
 * которая запускает загрузку заново.
 *
 * @returns true, если стартовые объекты прочитаны и `onLoaded` выполнен
 */
export async function loadStartObjects(
  getStartObjects: (onDatabaseBusy: DatabaseBusyCallback) => Promise<void>,
  onLoaded: () => Promise<void>,
): Promise<boolean> {
  let progress: Notification | null = null;
  function showProgress(message: string): void {
    if (progress) {
      progress.message = message;
      return;
    }
    progress = new Notification(message, NotificationSeverity.Info);
    notifications.add(progress);
  }
  let slowTimer = setTimeout(() => {
    if (!progress) {
      showProgress(gt`Loading your accounts…`);
    }
  }, kSlowStartMs);
  try {
    await getStartObjects(() => showProgress(gt`Loading your accounts. Local data is busy, waiting for it to be released…`));
  } catch (ex) {
    showStartObjectsError(ex, getStartObjects, onLoaded);
    return false;
  } finally {
    clearTimeout(slowTimer);
    if (progress) {
      notifications.remove(progress);
    }
  }
  await onLoaded();
  return true;
}

function showStartObjectsError(
  ex: Error,
  getStartObjects: (onDatabaseBusy: DatabaseBusyCallback) => Promise<void>,
  onLoaded: () => Promise<void>,
): void {
  logError(ex);
  let notification = new Notification(`${gt`Could not load your accounts.`} ${friendlyErrorMessage(ex)}`, NotificationSeverity.Error, ex);
  notification.buttons.add(new ButtonData(gt`Try again`, async () => {
    await loadStartObjects(getStartObjects, onLoaded);
  }));
  notifications.add(notification);
}
