import type { Account } from "../../logic/Abstract/Account";
import { ButtonData, Notification, NotificationSeverity, notifications } from "../MainWindow/Notification";
import { getSettingsCategoryForAccount, openSettingsCategoryForAccount } from "../Settings/Window/CategoriesUtils";
import { requestPasswordFocus } from "../Settings/Shared/passwordFocus";
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
    openPasswordField(passwordAccount);
  }));
  notifications.add(notification);
}

/** Открывает страницу «Сервер» ящика (для отдельных ящиков — основного
 * аккаунта, где хранится пароль) и ставит фокус в поле пароля. */
export function openPasswordField(account: Account): void {
  let passwordAccount = account.mainAccount ?? account;
  requestPasswordFocus();
  openSettingsCategoryForAccount(passwordAccount, "mail-server");
}

/** Обычная плашка «Сервер не принял логин или пароль»: добавляем кнопку,
 * которая ведёт к полю нового пароля. */
export function addEnterPasswordButton(notification: Notification, account: Account): void {
  if (!getSettingsCategoryForAccount(account.mainAccount ?? account, "mail-server")) {
    return;
  }
  notification.buttons.add(new ButtonData(gt`Enter new password`, async () => {
    openPasswordField(account);
  }));
}
