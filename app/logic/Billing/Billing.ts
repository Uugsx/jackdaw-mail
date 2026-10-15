/**
 * Публичная конфигурация биллинга.
 *
 * Платёжные реквизиты и ключи подписи лицензий должны храниться на сервере
 * биллинга. Десктопный клиент получает от него только подписанное право доступа.
 */
export const BILLING_PROVIDER = "Lemon Squeezy";
export const BILLING_SITE_URL = "https://jackdaw-mail.pro";
export const BILLING_PLANS_URL = `${BILLING_SITE_URL}#plans`;
export const BILLING_LICENSE_API_DEFAULT_URL = "https://license.jackdaw-mail.pro";
export const BILLING_CHECKOUT_DEFAULT_URLS: Readonly<Record<BillingPlan, string>> = Object.freeze({
  monthly: `${BILLING_LICENSE_API_DEFAULT_URL}/buy/monthly`,
  yearly: `${BILLING_LICENSE_API_DEFAULT_URL}/buy/yearly`,
});

/** Публичные цены Pro в валюте магазина Lemon Squeezy. */
export const BILLING_PRICES: Readonly<Record<BillingPlan, string>> = Object.freeze({
  monthly: "$9.99 / month",
  yearly: "$79.99 / year",
});

/** Публичный ключ Ed25519. Приватная пара находится только на сервере лицензий. */
const configuredEntitlementPublicKey = import.meta.env.VITE_BILLING_ENTITLEMENT_PUBLIC_KEY?.trim();
export const BILLING_ENTITLEMENT_PUBLIC_KEY = configuredEntitlementPublicKey ||
  "GG1VDmhY_Iew3dDfD9SG2WB8SAoyDMkCKx4QsOuBkPc";

export type BillingPlan = "monthly" | "yearly";

const LEMON_SQUEEZY_HOST_SUFFIX = ".lemonsqueezy.com";
const LEMON_SQUEEZY_CHECKOUT_PATH = /^\/checkout\/buy\/[^/]+\/?$/;
const JACKDAW_CHECKOUT_HOSTS = new Set([
  "jackdaw-mail.pro",
  "www.jackdaw-mail.pro",
  "license.jackdaw-mail.pro",
]);
const JACKDAW_CHECKOUT_PATH = /^\/buy\/(monthly|yearly)\/?$/;

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
  return url.toString().replace(/\/$/, "");
}

function readCheckoutURL(variableName: string): string | null {
  let value = readPublicHTTPSURL(variableName);
  if (!value) {
    value = BILLING_CHECKOUT_DEFAULT_URLS[variableName.includes("YEARLY") ? "yearly" : "monthly"];
  }
  if (!value) {
    return null;
  }

  let url = new URL(value);
  let isLemonSqueezyURL = url.hostname.endsWith(LEMON_SQUEEZY_HOST_SUFFIX) &&
    LEMON_SQUEEZY_CHECKOUT_PATH.test(url.pathname);
  let isJackdawLicenseURL = JACKDAW_CHECKOUT_HOSTS.has(url.hostname) &&
    JACKDAW_CHECKOUT_PATH.test(url.pathname);
  return isLemonSqueezyURL || isJackdawLicenseURL ? value : null;
}

function readLicenseAPIURL(): string | null {
  let value = readPublicHTTPSURL("VITE_BILLING_LICENSE_API_URL");
  if (!value) return null;
  try {
    return JACKDAW_CHECKOUT_HOSTS.has(new URL(value).hostname) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Публичные ссылки checkout не являются секретами. По умолчанию они ведут на
 * наш allowlist-сервис лицензий, который перенаправляет в Lemon Squeezy только
 * после настройки реальных вариантов магазина.
 */
export const BILLING_CHECKOUT_URLS: Readonly<Record<BillingPlan, string | null>> = Object.freeze({
  monthly: readCheckoutURL("VITE_LEMON_SQUEEZY_MONTHLY_CHECKOUT_URL"),
  yearly: readCheckoutURL("VITE_LEMON_SQUEEZY_YEARLY_CHECKOUT_URL"),
});

/**
 * Endpoint сервиса лицензий. Явный HTTPS allowlist не позволяет сборке
 * отправить лицензионные данные на произвольный адрес.
 */
export const BILLING_LICENSE_API_URL =
  readLicenseAPIURL() ?? BILLING_LICENSE_API_DEFAULT_URL;

export const BILLING_SERVER_CONFIGURED = BILLING_LICENSE_API_URL != null;

function hasDirectLemonCheckout(plan: BillingPlan): boolean {
  let checkoutURL = BILLING_CHECKOUT_URLS[plan];
  if (!checkoutURL) return false;
  try {
    return new URL(checkoutURL).hostname.endsWith(LEMON_SQUEEZY_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export async function fetchBillingCheckoutAvailability(): Promise<Readonly<Record<BillingPlan, boolean>>> {
  let availability: Record<BillingPlan, boolean> = {
    monthly: hasDirectLemonCheckout("monthly"),
    yearly: hasDirectLemonCheckout("yearly"),
  };
  if (!BILLING_LICENSE_API_URL || availability.monthly && availability.yearly) {
    return availability;
  }

  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let response = await fetch(`${BILLING_LICENSE_API_URL}/v1/public-config`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let body = await response.json().catch(() => null) as {
      checkout?: Partial<Record<BillingPlan, { configured?: boolean }>>;
    } | null;
    if (response.ok && body?.checkout) {
      availability = {
        monthly: availability.monthly || body.checkout.monthly?.configured === true,
        yearly: availability.yearly || body.checkout.yearly?.configured === true,
      };
    }
  } catch {
    // Недоступность публичной конфигурации не должна блокировать почту.
  } finally {
    clearTimeout(timeout);
  }
  return availability;
}

export async function fetchBillingTrialAvailability(): Promise<boolean> {
  if (!BILLING_LICENSE_API_URL) return false;
  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let response = await fetch(`${BILLING_LICENSE_API_URL}/v1/public-config`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let body = await response.json().catch(() => null) as {
      trial?: { configured?: boolean; durationDays?: number; onlineRequired?: boolean };
    } | null;
    return response.ok && body?.trial?.configured === true && body.trial.onlineRequired === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const PRO_FEATURE_KEYS = [
  "reports",
  "live-sla",
  "working-hours",
  "reminders",
  "html-export",
  "signatures",
  "multiple-accounts",
] as const;

export type ProFeatureKey = (typeof PRO_FEATURE_KEYS)[number];
