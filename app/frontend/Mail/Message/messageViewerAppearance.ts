import { getLocalStorage } from "../../Util/LocalStorage";
import type { MailAccount } from "../../../logic/Mail/MailAccount";

export type MessageViewerBackground = "white" | "theme" | "dark";
export type MessageContentRendering = "html" | "with-external" | "plaintext" | "source";

const kMessageViewerBackgroundSetting = "mail.read.background";
const kMessageContentRenderingSetting = "mail.contentRendering";
const accountDefaultSubscriptions = new Map<string, () => void>();

/** Общая настройка фона панели чтения и содержимого письма. */
export function getMessageViewerBackgroundSetting() {
  return getLocalStorage<MessageViewerBackground>(kMessageViewerBackgroundSetting, "theme");
}

/** Безопасное значение для старых или вручную изменённых настроек. */
export function normalizeMessageViewerBackground(value: unknown): MessageViewerBackground {
  if (value === "white" || value === "dark") {
    return value;
  }
  return "theme";
}

/**
 * Переключает фон сообщения.
 *
 * В светлой теме сохраняется трёхпозиционный цикл: белый → тема → тёмный.
 * Для тёмной темы вызывающая сторона может отключить промежуточный фон темы,
 * оставив только белый и тёмный варианты.
 */
export function cycleMessageViewerBackground(
  value: unknown,
  includeThemeBackground = true,
): MessageViewerBackground {
  let current = normalizeMessageViewerBackground(value);
  if (!includeThemeBackground) {
    if (current == "theme") {
      current = "dark";
    }
    return current == "dark" ? "white" : "dark";
  }
  if (current == "white") {
    return "theme";
  }
  if (current == "theme") {
    return "dark";
  }
  return "white";
}

/**
 * Возвращает режим отображения для конкретного почтового ящика.
 * Старую общую настройку используем как начальное значение для совместимости.
 */
export function getMessageContentRenderingSetting(account?: MailAccount | null) {
  if (!account?.id) {
    return getLocalStorage<MessageContentRendering>(kMessageContentRenderingSetting, "html");
  }
  let globalSetting = getLocalStorage<MessageContentRendering>(kMessageContentRenderingSetting, "html");
  let legacyValue = globalSetting.value;
  let defaultValue = normalizeMessageContentRendering(legacyValue);
  let accountSettingKey = `${kMessageContentRenderingSetting}.account.${account.id}`;
  let setting = getLocalStorage<MessageContentRendering>(
    accountSettingKey,
    defaultValue,
  );

  // Если для ящика нет своего значения, изменение общей настройки должно
  // сразу дойти до уже открытого просмотрщика письма.
  setting.withDefault(defaultValue);

  if (!accountDefaultSubscriptions.has(accountSettingKey)) {
    let unsubscribe = globalSetting.subscribe(() => {
      if (localStorage.getItem(accountSettingKey) !== null) {
        return;
      }

      let previousValue = setting.value;
      setting.withDefault(normalizeMessageContentRendering(globalSetting.value));
      if (setting.value !== previousValue) {
        setting.notifyObservers();
      }
    });
    accountDefaultSubscriptions.set(accountSettingKey, unsubscribe);
  }

  return setting;
}

/** Безопасное значение для старых или вручную изменённых настроек. */
export function normalizeMessageContentRendering(value: unknown): MessageContentRendering {
  if (value === "with-external" || value === "plaintext" || value === "source") {
    return value;
  }
  return "html";
}
