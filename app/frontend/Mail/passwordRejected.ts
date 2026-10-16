import type { Account } from "../../logic/Abstract/Account";
import { ButtonData, Notification, NotificationSeverity, notifications } from "../MainWindow/Notification";
import { openSettingsCategoryForAccount } from "../Settings/Window/CategoriesUtils";
import { gt } from "../../l10n/l10n";

/**
 * Сервер отклонил сохранённый пароль: вместо веб-формы входа ведём
 * пользователя прямо к полю пароля в настройках сервера этого аккаунта.
 * После «Сохранить» там вход выполняется сразу, без перезапуска.
 */
export function showPasswordRejected(account: Account, ex: Error): void {
  let passwordAccount = account.mainAccount ?? account;
  let message = gt`${passwordAccount.name}: the server rejected the saved password. Enter the new password in the account's server settings.`;
  if (notifications.find(notification => notification.message == message)) {
    return;
  }
  let notification = new Notification(message, NotificationSeverity.LoggedOut, ex);
  notification.buttons.add(new ButtonData(gt`Enter password`, async () => {
    notifications.remove(notification);
    openSettingsCategoryForAccount(passwordAccount, "mail-server");
  }));
  notifications.add(notification);
}
