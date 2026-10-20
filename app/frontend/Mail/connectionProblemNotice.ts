import { setConnectionProblemListener, type ConnectionProblem, type ConnectionStatus } from "../../logic/Mail/connectionStatus";
import type { FriendlyErrorKind } from "../../logic/util/friendlyError";
import type { Folder } from "../../logic/Mail/Folder";
import { SystemNotification, NotificationKinds } from "../Shared/SystemNotification";
import { getLocalStorage } from "../Util/LocalStorage";
import { getDateTimeString } from "../Util/date";
import { bringAppToFront } from "../AppsBar/selectedApp";
import { gt } from "../../l10n/l10n";

/** Сбои, у которых подсказка говорит, что проверить самому.
 * У остальных она сводится к «попробуйте ещё раз», а Jackdaw и так повторяет сам. */
const kConnectionKindsWithHint: ReadonlySet<FriendlyErrorKind> = new Set<FriendlyErrorKind>([
  "server-not-found",
  "certificate",
]);

/** Короткая строка под названием аккаунта в списке слева. */
export function connectionProblemLine(lastSuccessAt: Date | null): string {
  return lastSuccessAt
    ? gt`No connection · synced ${getDateTimeString(lastSuccessAt)}`
    : gt`No connection to the server`;
}

/**
 * Полный текст для подсказки: причина, с какого времени, последняя синхронизация.
 * @param newestMailAt Время самого нового письма во «Входящих» — показывается,
 *   если время синхронизации ещё не сохранено (например, сбой начался до первого запуска с этой функцией).
 */
export function connectionProblemDetails(problem: ConnectionProblem, lastSuccessAt: Date | null, newestMailAt: Date | null = null): string {
  let showHint = problem.hint && kConnectionKindsWithHint.has(problem.kind);
  return [
    showHint ? `${problem.message} ${problem.hint}` : problem.message,
    gt`No connection since ${getDateTimeString(problem.since)}.`,
    lastSyncText(lastSuccessAt, newestMailAt),
    gt`New mail will arrive as soon as the server responds again. Jackdaw keeps trying automatically.`,
  ].filter(Boolean).join("\n");
}

/** Время получения самого нового письма в папке, или `null`, если писем нет. */
export function newestMessageTime(folder: Folder | null | undefined): Date | null {
  let newest: Date | null = null;
  for (let message of folder?.messages.contents ?? []) {
    let received = message.received;
    if (received && (!newest || received > newest)) {
      newest = received;
    }
  }
  return newest;
}

/** @returns строку о последней синхронизации, или "", если время неизвестно */
function lastSyncText(lastSuccessAt: Date | null, newestMailAt: Date | null = null): string {
  if (lastSuccessAt) {
    return gt`Last successful sync: ${getDateTimeString(lastSuccessAt)}.`;
  }
  if (newestMailAt) {
    return gt`Newest message in Inbox: ${getDateTimeString(newestMailAt)}.`;
  }
  return "";
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
    [problem.message, lastSyncText(status.lastSuccessAt)].filter(Boolean).join(" "),
    "Mail connection problem",
  );
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => bringAppToFront();
  await notification.show();
}
