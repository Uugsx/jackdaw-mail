import { beforeAll, afterEach, expect, test } from "vitest";
import { gt, setUILocale } from "../../l10n/l10n";
import { loadLanguageMessages } from "../../l10n/messagesLoader";

// Переводы грузятся по требованию: русский нужен до синхронного setUILocale("ru").
beforeAll(() => loadLanguageMessages("ru"));

const criticalProMessages = [
  ["Interactive reports", "Интерактивные отчёты"],
  ["The license server is checking the entitlement for this device.", "Сервер лицензий проверяет право доступа для этого устройства."],
  ["This module is included in Jackdaw Pro. Buy a license key or enter one that was issued by your administrator.", "Этот модуль входит в Jackdaw Pro. Купите лицензионный ключ или введите ключ, выданный администратором."],
  ["Try Pro free for 7 days", "Попробовать Pro бесплатно 7 дней"],
  ["License key", "Лицензионный ключ"],
  ["A system clock change was detected. Connect to the license service to verify access again.", "Обнаружено изменение системных часов. Подключитесь к сервису лицензий, чтобы повторно проверить доступ."],
  ["The trial has ended. Activate a Pro license to continue.", "Пробный период закончился. Для продолжения активируйте Pro-лицензию."],
] as const;

gt([criticalProMessages[0][0]]);

afterEach(() => {
  setUILocale("en");
});

test("переводит критические строки Pro полностью на русский", () => {
  setUILocale("ru");

  for (let [source, translation] of criticalProMessages) {
    expect(gt([source])).toBe(translation);
  }
});

test("оставляет критические строки Pro полностью на английском", () => {
  setUILocale("en");

  for (let [source] of criticalProMessages) {
    expect(gt([source])).toBe(source);
  }
});
