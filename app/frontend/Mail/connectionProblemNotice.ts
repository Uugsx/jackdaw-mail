import { setConnectionProblemListener, type ConnectionProblem, type ConnectionStatus } from "../../logic/Mail/connectionStatus";
import { SystemNotification, NotificationKinds } from "../Shared/SystemNotification";
import { getLocalStorage } from "../Util/LocalStorage";
import { getDateTimeString } from "../Util/date";
import { bringAppToFront } from "../AppsBar/selectedApp";
import { gt } from "../../l10n/l10n";

/** Короткая строка под названием аккаунта в списке слева. */
export function connectionProblemLine(lastSuccessAt: Date | null): string {
  return lastSuccessAt
    ? gt`No connection · synced ${getDateTimeString(lastSuccessAt)}`
    : gt`No connection to the server`;
}

/** Полный текст для подсказки: причина, с какого времени, последняя синхронизация. */
export function connectionProblemDetails(problem: ConnectionProblem, lastSuccessAt: Date | null): string {
  return [
    problem.hint ? `${problem.message} ${problem.hint}` : problem.message,
    gt`No connection since ${getDateTimeString(problem.since)}.`,
    lastSyncText(lastSuccessAt),
    gt`New mail will arrive as soon as the server responds again. Jackdaw keeps trying automatically.`,
  ].join("\n");
}

function lastSyncText(lastSuccessAt: Date | null): string {
  return lastSuccessAt
    ? gt`Last successful sync: ${getDateTimeString(lastSuccessAt)}.`
    : gt`Last successful sync: unknown.`;
}

/** Затянувшийся сбой связи — одно системное уведомление на эпизод.
 * Повторы, частоту и «не уведомлять без интернета» решает `ConnectionStatus`.
 * Уведомление показывается, только если пользователь не отключил всплывающие
 * уведомления о почте. */
export function startConnectionProblemNotifications(): void {
  setConnectionProblemListener(status => void showConnectionProblem(status));
}

async function showConnectionProblem(status: ConnectionStatus): Promise<void> {
  let problem = status.problem;
  if (!problem) {
    return;
  }
  let mailKinds = new NotificationKinds(getLocalStorage("notifications.mail", ["popup", "sound"]).value);
  if (!mailKinds.popup) {
    return;
  }
  let notification = new SystemNotification(
    new NotificationKinds(["popup"]),
    gt`${status.accountName()}: no connection to the server`,
    // Системное уведомление обрезает длинный текст, подсказка остаётся в списке аккаунтов
    `${problem.message} ${lastSyncText(status.lastSuccessAt)}`,
    "Mail connection problem",
  );
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => bringAppToFront();
  await notification.show();
}
