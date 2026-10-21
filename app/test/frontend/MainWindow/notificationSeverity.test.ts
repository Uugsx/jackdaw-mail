import { describe, expect, it } from "vitest";
import { NotificationSeverity, notificationSeverityRank } from "../../../frontend/MainWindow/Notification";

describe("порядок важности уведомлений", () => {
  it("сбой и ошибка важнее предупреждения, выхода из аккаунта и справки", () => {
    let sorted = [
      NotificationSeverity.Info,
      NotificationSeverity.Warning,
      NotificationSeverity.LoggedOut,
      NotificationSeverity.UnexpectedError,
      NotificationSeverity.Error,
    ].sort((a, b) => notificationSeverityRank(a) - notificationSeverityRank(b));
    expect(sorted).toEqual([
      NotificationSeverity.UnexpectedError,
      NotificationSeverity.Error,
      NotificationSeverity.Warning,
      NotificationSeverity.LoggedOut,
      NotificationSeverity.Info,
    ]);
  });

  it("по алфавиту «info» шло бы раньше «meltdown» — ранг это исправляет", () => {
    expect(notificationSeverityRank(NotificationSeverity.Info))
      .toBeGreaterThan(notificationSeverityRank(NotificationSeverity.UnexpectedError));
  });
});
