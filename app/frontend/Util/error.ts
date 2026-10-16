import { notifications, Notification, NotificationSeverity } from "../MainWindow/Notification";
import { production } from "../../logic/build";
import { UserCancelled } from "../../logic/util/util";
import * as Sentry from "@sentry/svelte";

export function showError(ex: Error) {
  console.error(errorMessage(ex), ex);
  // Проверка по признаку, а не instanceof: импорт Account.ts отсюда создаёт
  // циклическую зависимость модулей (error.ts подключается почти везде).
  let rejectedAccount = (ex as any)?.passwordRejected ? (ex as any).account : null;
  if (rejectedAccount) {
    // Вместо «Неверный пароль» без действий — баннер с переходом к полю пароля.
    let account = rejectedAccount;
    void import("../Mail/passwordRejected").then(module => module.showPasswordRejected(account, ex));
    return;
  }
  if (shouldShow(ex)) {
    notifications.add(new Notification(errorMessage(ex), NotificationSeverity.Error, ex));
    logErrorToServer(ex);
  }
}

/** Убирает баннеры «войдите в систему» / «неверный пароль» после успешного
 * входа: сами они закрываются только вручную и вводили бы в заблуждение. */
export function clearLoginNotifications(accountNames: string[]) {
  for (let notification of notifications.contents) {
    let ex = notification.ex as any;
    let accountName = ex?.accountName;
    let isLoginProblem = !!ex?.authFail || ex instanceof UserCancelled;
    if (isLoginProblem && (!accountName || accountNames.includes(accountName))) {
      notifications.remove(notification);
    }
  }
}

export function backgroundError(ex: Error) {
  console.error(errorMessage(ex), ex);
  if (production) {
    return;
  }
  if (shouldShow(ex)) {
    notifications.add(new Notification(errorMessage(ex), NotificationSeverity.Warning, ex));
    logErrorToServer(ex);
  }
}

export function showUserError(ex: Error, autoDisappearAfterSeconds?: number): { remove(): void } {
  let notification = new Notification(errorMessage(ex), NotificationSeverity.Error, ex);
  notifications.add(notification);
  if (autoDisappearAfterSeconds) {
    setTimeout(() => {
      notifications.remove(notification);
    }, autoDisappearAfterSeconds * 1000);
  }
  return {
    remove() {
      notifications.remove(notification);
    }
  };
}

function shouldShow(ex: Error): boolean {
  // Local backend IPC drop after login/sleep/wake. Reconnect is already in
  // progress; a cryptic "JPC WebSocket error" banner is not actionable.
  if ((ex as any)?.code == "ConnectionClosed") {
    return false;
  }
  return ex?.message &&
    !(ex as any).doNotShow &&
    !notifications.find(noti => noti.message == errorMessage(ex)); // don't repeat
}

/** The account name, for errors of a specific account.
 * It's in a separate property and not in `ex.message`, because we must not
 * send it to the error log server. @see `addAccountName()` */
function errorMessage(ex: Error): string {
  let message = ex?.message ?? ex + "";
  let accountName = (ex as any)?.accountName;
  return accountName ? `${accountName}: ${message}` : message;
}

export function logError(ex: Error) {
  console.error(errorMessage(ex), ex);
  logErrorToServer(ex);
}

function logErrorToServer(ex: Error) {
  try {
    if ((ex as any)?.isUserError || (ex as any)?.doNotLog) {
      return;
    }
    if (production) {
      Sentry.captureException(ex);
    }
  } catch (ex) {
    console.error(ex);
  }
}

export async function catchErrors(func: Function, errorFunc = showError) {
  try {
    await func();
  } catch (ex) {
    errorFunc(ex);
  }
}

/** In case of errors/exceptions, return a fallback value */
export function catchFallback<T>(func: () => T, fallbackResult: T): T {
  try {
    return func();
  } catch (ex) {
    return fallbackResult;
  }
}
