import type { JackdawChatConnectionError } from "../../logic/Chat/Jackdaw/chatConnectionProblem";
import type { JackdawChatAccount } from "../../logic/Chat/Jackdaw/JackdawChatAccount";
import { refreshProEntitlement } from "../../logic/Billing/ProEntitlement";
import { ButtonData, Notification, NotificationSeverity, notifications } from "../MainWindow/Notification";
import { gt } from "../../l10n/l10n";

function isChatConnectionNotice(notification: Notification): boolean {
  return !!(notification.ex as any)?.chatConnectionProblem;
}

/** Наблюдение за аккаунтом ради текущего баннера */
let stopWatching: (() => void) | null = null;

/**
 * Чат не на связи: баннер с настоящей причиной и кнопкой «Переподключить».
 * Баннер один: новый заменяет прежний (причина могла смениться), и сам уходит, когда чат снова на связи.
 */
export function showChatConnectionProblem(ex: JackdawChatConnectionError): Notification {
  stopWatching?.();
  stopWatching = null;
  for (let old of notifications.contents.filter(isChatConnectionNotice)) {
    notifications.remove(old);
  }
  let notification = new Notification(ex.message, NotificationSeverity.Error, ex);
  if (ex.canReconnect) {
    notification.buttons.add(new ButtonData(gt`Reconnect`, () => reconnectChat(ex.account)));
  }
  notifications.add(notification);
  let stop = ex.account.subscribe(() => {
    if (ex.account.isOnline) {
      notifications.remove(notification);
    } else if (notifications.contains(notification)) {
      return;
    }
    // Не во время рассылки наблюдателям: отписка посреди неё пропустила бы следующего наблюдателя
    queueMicrotask(() => {
      stop();
      if (stopWatching == stop) {
        stopWatching = null;
      }
    });
  });
  stopWatching = stop;
  return notification;
}

/** Кнопка «Переподключить». Пока идёт вход — баннер «Подключение»; не удалось — снова баннер с причиной. */
export async function reconnectChat(account: JackdawChatAccount): Promise<void> {
  let progress = new Notification(gt`Connecting to the Jackdaw server…`, NotificationSeverity.Info);
  notifications.add(progress);
  try {
    let kind = account.connectionProblem()?.kind;
    if (kind == "no-pro" || kind == "checking-pro") {
      // Без действующей лицензии на устройстве соединению не с чем войти: сначала проверяем её заново.
      await refreshProEntitlement().catch(() => {});
    }
    await account.reconnect();
  } finally {
    notifications.remove(progress);
  }
}
