/**
 * Публичная конфигурация биллинга.
 *
 * Платёжные реквизиты и ключи подписи лицензий должны храниться на сервере
 * биллинга. Десктопный клиент получает от него только подписанное право доступа.
 */
export const BILLING_PROVIDER = "Lemon Squeezy";
export const BILLING_SITE_URL = "https://jackdaw-mail.app";
export const BILLING_PLANS_URL = `${BILLING_SITE_URL}#plans`;

export type BillingPlan = "monthly" | "yearly";

const LEMON_SQUEEZY_HOST_SUFFIX = ".lemonsqueezy.com";
const LEMON_SQUEEZY_CHECKOUT_PATH = /^\/checkout\/buy\/[^/]+\/?$/;

function readPublicHTTPSURL(
  variableName: string,
  hostnameSuffix: string | null = null,
): string | null {
  let value = import.meta.env[variableName]?.trim();
  if (!value) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol != "https:") {
    return null;
  }
  if (hostnameSuffix && !url.hostname.endsWith(hostnameSuffix)) {
    return null;
  }
  return url.toString();
}

function readCheckoutURL(variableName: string): string | null {
  let value = readPublicHTTPSURL(variableName, LEMON_SQUEEZY_HOST_SUFFIX);
  if (!value) {
    return null;
  }

  let url = new URL(value);
  return LEMON_SQUEEZY_CHECKOUT_PATH.test(url.pathname) ? value : null;
}

/**
 * Публичные ссылки checkout не являются секретами, но обязаны вести на
 * реальный URL Lemon Squeezy `checkout/buy/{variant}`. Пустые значения
 * оставляют сборку в безопасном режиме до активации вариантов магазина.
 */
export const BILLING_CHECKOUT_URLS: Readonly<Record<BillingPlan, string | null>> = Object.freeze({
  monthly: readCheckoutURL("VITE_LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL"),
  yearly: readCheckoutURL("VITE_LEMON_SQUEEZY_YEARLY_CHECKOUT_URL"),
});

/**
 * Намеренно не задано до развёртывания сервиса лицензий в продакшене.
 * Явное значение не позволяет интерфейсу считать сбой запроса биллинга
 * действующей подпиской Pro.
 */
export const BILLING_LICENSE_API_URL = readPublicHTTPSURL("VITE_BILLING_LICENSE_API_URL");

export const BILLING_SERVER_CONFIGURED = BILLING_LICENSE_API_URL != null;

export const PRO_FEATURE_KEYS = [
  "reports",
  "live-sla",
  "working-hours",
  "reminders",
  "html-export",
] as const;

export type ProFeatureKey = (typeof PRO_FEATURE_KEYS)[number];
