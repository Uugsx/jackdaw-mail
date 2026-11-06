import { getLocalStorage } from "../Util/LocalStorage";

/** Политика обработки персональных данных на сайте */
export const kPrivacyPolicyURL = "https://jackdaw-mail.pro/legal/privacy.html";

/** Редакция политики, на которую дано согласие.
 * При существенных изменениях политики повысить — согласие спросим заново. */
export const kPrivacyConsentVersion = "2026-11-06";

/** Согласие на обработку персональных данных перед отправкой
 * данных на серверы Jackdaw: пробный период, лицензия, звонки и чат, отзыв.
 * Хранит редакцию политики, пустая строка — согласия нет или оно отозвано. */
export function getPrivacyConsentSetting() {
  return getLocalStorage<string>("privacy.consent.version", "");
}

export function hasPrivacyConsent(value = getPrivacyConsentSetting().value): boolean {
  return value == kPrivacyConsentVersion;
}

export function setPrivacyConsent(accepted: boolean) {
  getPrivacyConsentSetting().value = accepted ? kPrivacyConsentVersion : "";
}
