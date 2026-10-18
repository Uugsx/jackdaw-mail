import { ed25519 } from "@noble/curves/ed25519.js";
import { Observable } from "../util/Observable";
import { gt } from "../../l10n/l10n";
import {
  BILLING_ENTITLEMENT_PUBLIC_KEY,
  BILLING_LICENSE_API_DEFAULT_URL,
  BILLING_LICENSE_API_URL,
  PRO_FEATURE_KEYS,
  type ProFeatureKey,
} from "./Billing";

export type ProEntitlementStatus =
  | "checking"
  | "not-configured"
  | "not-activated"
  | "active"
  | "trial"
  | "past_due"
  | "offline"
  | "trial-offline"
  | "expired"
  | "revoked"
  | "error";

export interface ProEntitlementPayload {
  product: string;
  plan: string;
  features: string[];
  status: "active" | "trial" | "past_due";
  validUntil: string | null;
  issuedAt: string;
  serverNow?: string;
  trialStartedAt?: string;
}

export interface ProEntitlementState {
  status: ProEntitlementStatus;
  plan: string | null;
  features: ProFeatureKey[];
  validUntil: string | null;
  keyLast4: string | null;
  message: string | null;
  lastValidatedAt: string | null;
}

interface StoredEntitlement {
  licenseKey: string;
  credentialType?: "license" | "trial";
  payload: ProEntitlementPayload;
  signature: string;
  keyLast4?: string;
  validatedAt: string;
}

const STORAGE_KEY = "jackdaw.billing.pro.v1";
const DEVICE_ID_STORAGE_KEY = "jackdaw.billing.device-id.v1";
const CLOCK_STATE_STORAGE_KEY = "jackdaw.billing.clock-state.v1";
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const TRIAL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const TRIAL_CLOCK_CHECK_INTERVAL_MS = 60 * 1000;
/** Платный ключ тоже перепроверяется в фоне, иначе отзыв ключа или отключение
 * устройства в админке доходят до работающего приложения только после перезапуска. */
const LICENSE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LICENSE_REFRESH_STATUSES = new Set<ProEntitlementStatus>(["active", "past_due", "offline"]);
const JACKDAW_LICENSE_KEY_PATTERN = /^JACKDAW-PRO-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$/;
const PROVIDER_LICENSE_KEY_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ENTITLEMENT_STATUSES = new Set(["active", "trial", "past_due"]);
const ACCESS_STATUSES = new Set(["active", "trial", "past_due", "offline"]);

const defaultState: ProEntitlementState = {
  status: BILLING_LICENSE_API_URL ? "checking" : "not-configured",
  plan: null,
  features: [],
  validUntil: null,
  keyLast4: null,
  message: null,
  lastValidatedAt: null,
};

class ProEntitlementObservable extends Observable {
  value: ProEntitlementState = defaultState;

  setValue(value: ProEntitlementState): void {
    this.value = value;
    scheduleTrialRefresh(value);
    this.notifyObservers();
  }
}

export const proEntitlement = new ProEntitlementObservable();

let refreshPromise: Promise<ProEntitlementState> | null = null;
let inMemoryDeviceID: string | null = null;
let trialRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let trialClockGuardTimer: ReturnType<typeof setTimeout> | null = null;

interface ClockState {
  lastServerNow: string | null;
  lastLocalNowMs: number | null;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage == "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readClockState(): ClockState {
  let fallback: ClockState = { lastServerNow: null, lastLocalNowMs: null };
  let storage = getStorage();
  if (!storage) return fallback;
  try {
    let raw = storage.getItem(CLOCK_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    let value = JSON.parse(raw) as Partial<ClockState>;
    let lastLocalNowMs = typeof value.lastLocalNowMs == "number" && Number.isFinite(value.lastLocalNowMs)
      ? value.lastLocalNowMs
      : null;
    let lastServerNow = typeof value.lastServerNow == "string" && Number.isFinite(Date.parse(value.lastServerNow))
      ? value.lastServerNow
      : null;
    return { lastServerNow, lastLocalNowMs };
  } catch {
    return fallback;
  }
}

function writeClockState(value: ClockState): void {
  try {
    getStorage()?.setItem(CLOCK_STATE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Невозможность сохранить якорь времени не должна ломать базовую почту.
  }
}

function recordServerTime(serverNow: string | undefined): void {
  if (!serverNow || !Number.isFinite(Date.parse(serverNow))) return;
  writeClockState({
    lastServerNow: serverNow,
    lastLocalNowMs: Date.now(),
  });
}

function localClockWasRolledBack(): boolean {
  let clock = readClockState();
  return clock.lastLocalNowMs != null && Date.now() + CLOCK_SKEW_TOLERANCE_MS < clock.lastLocalNowMs;
}

function trustedServerNowMs(): number | null {
  let clock = readClockState();
  if (!clock.lastServerNow || clock.lastLocalNowMs == null) return null;
  let serverNowMs = Date.parse(clock.lastServerNow);
  if (!Number.isFinite(serverNowMs)) return null;
  let localNowMs = Date.now();
  if (localNowMs + CLOCK_SKEW_TOLERANCE_MS < clock.lastLocalNowMs) return null;
  // Для trial отсчитываем срок от серверного якоря, а не от часов клиента.
  return serverNowMs + Math.max(0, localNowMs - clock.lastLocalNowMs);
}

function cachedEntitlementMayBeUsed(payload: ProEntitlementPayload): boolean {
  if (localClockWasRolledBack()) return false;
  if (payload.serverNow && Date.parse(payload.serverNow) > Date.now() + CLOCK_SKEW_TOLERANCE_MS) return false;
  return true;
}

function scheduleTrialRefresh(state: ProEntitlementState): void {
  if (trialRefreshTimer != null) {
    clearTimeout(trialRefreshTimer);
    trialRefreshTimer = null;
  }
  if (trialClockGuardTimer != null) {
    clearTimeout(trialClockGuardTimer);
    trialClockGuardTimer = null;
  }
  if (state.status == "trial") {
    let checkTrialClock = (): void => {
      let trustedNow = trustedServerNowMs();
      if (trustedNow != null && state.validUntil != null && Date.parse(state.validUntil) <= trustedNow) {
        // Срок вышел обычным образом, а не из-за смены часов.
        proEntitlement.setValue({
          ...defaultState,
          status: "expired",
          plan: state.plan,
          validUntil: state.validUntil,
          message: gt`The trial has ended. Activate a Pro license to continue.`,
          lastValidatedAt: state.lastValidatedAt,
        });
        return;
      }
      let expired = trustedNow == null;
      if (expired) {
        proEntitlement.setValue({
          ...defaultState,
          status: "error",
          plan: state.plan,
          validUntil: state.validUntil,
          message: gt`A system clock change was detected. Connect to the license service to verify access again.`,
          lastValidatedAt: state.lastValidatedAt,
        });
        return;
      }
      trialClockGuardTimer = setTimeout(checkTrialClock, TRIAL_CLOCK_CHECK_INTERVAL_MS);
    };
    trialClockGuardTimer = setTimeout(checkTrialClock, TRIAL_CLOCK_CHECK_INTERVAL_MS);
    trialRefreshTimer = setTimeout(() => {
      void refreshProEntitlement();
    }, TRIAL_REFRESH_INTERVAL_MS);
  } else if (LICENSE_REFRESH_STATUSES.has(state.status)) {
    trialRefreshTimer = setTimeout(() => {
      void refreshProEntitlement();
    }, LICENSE_REFRESH_INTERVAL_MS);
  }
}

/**
 * Пробный период определяется по типу учётных данных. План «trial» у ключа
 * лицензии (выдан администратором) не делает его пробным периодом устройства.
 * По плану судим только для старых записей, где тип ещё не сохранялся.
 */
export function isTrialCredential(stored: Pick<StoredEntitlement, "credentialType" | "payload"> | null | undefined): boolean {
  if (!stored) return false;
  return stored.credentialType != null ? stored.credentialType == "trial" : stored.payload.plan == "trial";
}

/** Растёт при активации, смене или удалении лицензии: запоздавший ответ проверки не должен их отменить. */
let entitlementGeneration = 0;

function readStoredEntitlement(): StoredEntitlement | null {
  let storage = getStorage();
  if (!storage) return null;
  try {
    let raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    let value = JSON.parse(raw) as StoredEntitlement;
    if (
      !value ||
      typeof value.licenseKey != "string" ||
      value.credentialType != null && value.credentialType != "license" && value.credentialType != "trial" ||
      typeof value.signature != "string" ||
      !value.payload ||
      typeof value.validatedAt != "string"
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function saveStoredEntitlement(value: StoredEntitlement): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Хранилище может быть недоступно в ограниченном профиле. Ответ сервера
    // всё равно работает в текущей сессии, даже если сохранить его нельзя.
  }
}

function removeStoredEntitlement(): void {
  try {
    getStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ошибки хранилища игнорируем, но право доступа в памяти всё равно очищаем.
  }
}

function normalizedLicenseKey(value: string): string {
  let providerKey = value.trim().toLowerCase();
  if (PROVIDER_LICENSE_KEY_PATTERN.test(providerKey)) {
    return providerKey;
  }
  let compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!compact.startsWith("JACKDAWPRO") || compact.length != 26) {
    throw new ProEntitlementError(gt`Enter a JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX key or the key from your purchase email.`);
  }
  let formatted = `JACKDAW-PRO-${compact.slice(10, 14)}-${compact.slice(14, 18)}-${compact.slice(18, 22)}-${compact.slice(22, 26)}`;
  if (!JACKDAW_LICENSE_KEY_PATTERN.test(formatted)) {
    throw new ProEntitlementError(gt`Enter a JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX key or the key from your purchase email.`);
  }
  return formatted;
}

export function getDeviceID(): string {
  if (inMemoryDeviceID) return inMemoryDeviceID;
  let storage = getStorage();
  let saved: string | null = null;
  try {
    saved = storage?.getItem(DEVICE_ID_STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  if (saved && /^[A-Za-z0-9._:-]{8,128}$/.test(saved)) {
    inMemoryDeviceID = saved;
    return saved;
  }
  let randomID: string | undefined = globalThis.crypto?.randomUUID?.();
  if (!randomID && globalThis.crypto?.getRandomValues) {
    let bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    randomID = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  let generated = `device-${randomID ?? `${Date.now()}-${typeof performance != "undefined" ? Math.round(performance.now()) : 0}`}`;
  inMemoryDeviceID = generated;
  try {
    storage?.setItem(DEVICE_ID_STORAGE_KEY, generated);
  } catch {
    // Непостоянный идентификатор устройства безопасен: при невозможности
    // сохранить его сервер запросит новую активацию.
  }
  return generated;
}

function getDeviceName(): string {
  if (typeof navigator != "undefined" && navigator.userAgent) {
    return navigator.userAgent.slice(0, 120);
  }
  return "Jackdaw Mail";
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value == "string" || typeof value == "number" || typeof value == "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalize(item)).join(",")}]`;
  }
  if (typeof value == "object") {
    let entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("Entitlement payload contains an unsupported value.");
}

function decodeBase64URL(value: string): Uint8Array {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  let binary = atob(normalized);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function assertValidEntitlement(payload: ProEntitlementPayload, signature: string): void {
  if (!BILLING_ENTITLEMENT_PUBLIC_KEY) {
    throw new ProEntitlementError(gt`This app build does not contain the public key for the license service.`);
  }
  if (
    payload.product != "jackdaw-mail" ||
    typeof payload.plan != "string" ||
    !Array.isArray(payload.features) ||
    typeof payload.issuedAt != "string" ||
    !Number.isFinite(Date.parse(payload.issuedAt)) ||
    (payload.validUntil !== null && (typeof payload.validUntil != "string" || !Number.isFinite(Date.parse(payload.validUntil)))) ||
    (payload.serverNow !== undefined && (typeof payload.serverNow != "string" || !Number.isFinite(Date.parse(payload.serverNow)))) ||
    (payload.trialStartedAt !== undefined && (typeof payload.trialStartedAt != "string" || !Number.isFinite(Date.parse(payload.trialStartedAt))))
  ) {
    throw new ProEntitlementError(gt`The license service returned an invalid entitlement.`);
  }
  let features = payload.features.filter((feature): feature is ProFeatureKey =>
    (PRO_FEATURE_KEYS as readonly string[]).includes(feature),
  );
  if (features.length != payload.features.length || !ENTITLEMENT_STATUSES.has(payload.status)) {
    throw new ProEntitlementError(gt`The entitlement does not comply with the Pro access policy.`);
  }
  let valid = ed25519.verify(
    decodeBase64URL(signature),
    new TextEncoder().encode(canonicalize(payload)),
    decodeBase64URL(BILLING_ENTITLEMENT_PUBLIC_KEY),
  );
  if (!valid) {
    throw new ProEntitlementError(gt`The entitlement signature could not be verified.`);
  }
}

function stateFromPayload(
  payload: ProEntitlementPayload,
  keyLast4: string | null,
  status: ProEntitlementStatus = payload.status,
  message: string | null = null,
  lastValidatedAt = new Date().toISOString(),
  comparisonTimeMs?: number,
): ProEntitlementState {
  let validUntil = payload.validUntil;
  let trustedNow = comparisonTimeMs ?? (payload.serverNow && Number.isFinite(Date.parse(payload.serverNow))
    ? Date.parse(payload.serverNow)
    : Date.now());
  if (validUntil && Date.parse(validUntil) <= trustedNow) {
    return {
      status: "expired",
      plan: payload.plan,
      features: [],
      validUntil,
      keyLast4,
      message: gt`The Pro license has expired.`,
      lastValidatedAt,
    };
  }
  return {
    status,
    plan: payload.plan,
    features: payload.features.filter((feature): feature is ProFeatureKey =>
      (PRO_FEATURE_KEYS as readonly string[]).includes(feature),
    ),
    validUntil,
    keyLast4,
    message,
    lastValidatedAt,
  };
}

class LicenseRequestError extends Error {
  constructor(
    message: string,
    readonly responseStatus: number,
    readonly responseCode: string | null,
  ) {
    super(message);
    this.name = "LicenseRequestError";
  }
}

/** Ответ сервера, означающий отказ в лицензии. 408 и 429 — таймаут и лимит запросов:
 * это временная ошибка, как сбой сети, и она не должна выключать Pro. */
function isLicenseRejection(error: unknown): error is LicenseRequestError {
  return error instanceof LicenseRequestError
    && error.responseStatus >= 400 && error.responseStatus < 500
    && error.responseStatus != 408 && error.responseStatus != 429;
}

class ProEntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProEntitlementError";
  }
}

export function getProEntitlementErrorMessage(error: unknown): string {
  if (error instanceof LicenseRequestError) {
    switch (error.responseCode) {
      case "invalid_license_key":
        return gt`The license key format is invalid. Use JACKDAW-PRO-XXXX-XXXX-XXXX-XXXX or the key from your purchase email.`;
      case "license_not_found":
        return gt`This license key was not found.`;
      case "license_inactive":
        return gt`This license is inactive or has expired.`;
      case "device_not_activated":
        return gt`This device is not activated for this license.`;
      case "activation_limit_reached":
        return gt`This license has reached its device activation limit.`;
      case "trial_not_started":
        return gt`The trial has not been started on this device.`;
      case "trial_expired":
        return gt`The trial has ended. Activate a Pro license to continue.`;
      case "trial_revoked":
        return gt`The trial was disabled by an administrator.`;
      case "rate_limited":
        return gt`Too many requests. Try again later.`;
      case "internal_error":
      case "license_read_failed":
        return gt`The license service is temporarily unavailable. Try again later.`;
      case "not_found":
        return gt`The requested license service resource was not found.`;
      default:
        return gt`The license service rejected the request.`;
    }
  }
  if (error instanceof ProEntitlementError && error.message) return error.message;
  return gt`Could not reach the license service. Check your internet connection and try again.`;
}

interface EntitlementResponse {
  payload: ProEntitlementPayload;
  signature: string;
  keyLast4?: string;
}

async function parseEntitlementResponse(response: Response): Promise<EntitlementResponse> {
  let body = await response.json().catch(() => null) as {
    entitlement?: { payload?: ProEntitlementPayload; signature?: string };
    license?: { keyLast4?: string };
    error?: string;
  } | null;
  if (!response.ok || !body?.entitlement?.payload || !body.entitlement.signature) {
    throw new LicenseRequestError(
      gt`The license service rejected the request.`,
      response.status,
      body?.error ?? null,
    );
  }
  assertValidEntitlement(body.entitlement.payload, body.entitlement.signature);
  recordServerTime(body.entitlement.payload.serverNow);
  return {
    payload: body.entitlement.payload,
    signature: body.entitlement.signature,
    keyLast4: body.license?.keyLast4,
  };
}

async function requestEntitlement(
  path: string,
  licenseKey: string,
  deviceName: string,
): Promise<EntitlementResponse> {
  if (!BILLING_LICENSE_API_URL || BILLING_LICENSE_API_URL == BILLING_LICENSE_API_DEFAULT_URL && !BILLING_ENTITLEMENT_PUBLIC_KEY) {
    throw new ProEntitlementError(gt`The license service is not configured in this app build.`);
  }
  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let response = await fetch(`${BILLING_LICENSE_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ licenseKey, deviceId: getDeviceID(), deviceName }),
      signal: controller.signal,
    });
    return await parseEntitlementResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestTrialEntitlement(path: string, deviceName: string): Promise<EntitlementResponse> {
  if (!BILLING_LICENSE_API_URL || !BILLING_ENTITLEMENT_PUBLIC_KEY) {
    throw new ProEntitlementError(gt`The license service is not configured in this app build.`);
  }
  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let response = await fetch(`${BILLING_LICENSE_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ deviceId: getDeviceID(), deviceName }),
      signal: controller.signal,
    });
    return await parseEntitlementResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function hasProFeature(feature: ProFeatureKey): boolean {
  let state = proEntitlement.value;
  if (state.status == "checking") {
    // Первые секунды после запуска и в отдельных окнах ответ сервера ещё не пришёл.
    // Пока идёт проверка, используем последнюю подписанную лицензию из кэша —
    // по тем же правилам, что и в офлайн-режиме. Иначе подпись вырезалась из писем.
    state = cachedStateWhileChecking() ?? state;
  }
  if (!ACCESS_STATUSES.has(state.status) || !state.features.includes(feature)) return false;
  if (state.status == "trial") {
    let trustedNow = trustedServerNowMs();
    if (trustedNow == null) return false;
    if (state.validUntil && Number.isFinite(Date.parse(state.validUntil)) && Date.parse(state.validUntil) <= trustedNow) return false;
  } else {
    if (localClockWasRolledBack()) return false;
    if (state.validUntil && Number.isFinite(Date.parse(state.validUntil)) && Date.parse(state.validUntil) <= Date.now()) return false;
  }
  return true;
}

let cachedCheckingState: { raw: string | null; state: ProEntitlementState | null } | null = null;

/** Подписанная лицензия из локального кэша, пока сервер ещё не ответил.
 * Подпись проверяется один раз на каждое значение в хранилище. */
function cachedStateWhileChecking(): ProEntitlementState | null {
  let raw: string | null = null;
  try {
    raw = getStorage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (cachedCheckingState && cachedCheckingState.raw === raw) {
    return cachedCheckingState.state;
  }
  let state: ProEntitlementState | null = null;
  try {
    let stored = readStoredEntitlement();
    if (stored && BILLING_LICENSE_API_URL && BILLING_ENTITLEMENT_PUBLIC_KEY) {
      assertValidEntitlement(stored.payload, stored.signature);
      let cachedDate = Date.parse(stored.validatedAt);
      if (cachedEntitlementMayBeUsed(stored.payload) &&
          Number.isFinite(cachedDate) && Date.now() - cachedDate <= OFFLINE_GRACE_MS) {
        state = stateFromPayload(
          stored.payload,
          null,
          isTrialCredential(stored) ? "trial" : "offline",
          null,
          stored.validatedAt,
          Date.now(),
        );
      }
    }
  } catch {
    state = null;
  }
  cachedCheckingState = { raw, state };
  return state;
}

/** Учётные данные устройства для сервиса звонков. Сервис сам проверяет их по базе лицензий,
 * поэтому подписанное entitlement ему не передаётся. null — Pro на устройстве не подключён. */
export type ProCallCredential =
  | { kind: "license"; licenseKey: string; deviceId: string }
  | { kind: "trial"; deviceId: string };

export function getProCallCredential(): ProCallCredential | null {
  let stored = readStoredEntitlement();
  if (!stored) return null;
  if (isTrialCredential(stored)) {
    return { kind: "trial", deviceId: getDeviceID() };
  }
  return stored.licenseKey ? { kind: "license", licenseKey: stored.licenseKey, deviceId: getDeviceID() } : null;
}

export function getSavedProLicenseKey(): string | null {
  let stored = readStoredEntitlement();
  return isTrialCredential(stored) ? null : stored?.licenseKey || null;
}

export async function activateProLicense(licenseKey: string, deviceName = getDeviceName()): Promise<ProEntitlementState> {
  let normalized = normalizedLicenseKey(licenseKey);
  let response = await requestEntitlement("/v1/license/activate", normalized, deviceName);
  entitlementGeneration++;
  let validatedAt = new Date().toISOString();
  saveStoredEntitlement({
    licenseKey: normalized,
    credentialType: "license",
    payload: response.payload,
    signature: response.signature,
    keyLast4: response.keyLast4 ?? normalized.slice(-4),
    validatedAt,
  });
  let state = stateFromPayload(response.payload, response.keyLast4 ?? normalized.slice(-4));
  proEntitlement.setValue(state);
  return state;
}

export async function startProTrial(deviceName = getDeviceName()): Promise<ProEntitlementState> {
  let stored = readStoredEntitlement();
  if (stored && stored.credentialType != "trial" && stored.payload.status == "active") {
    throw new ProEntitlementError(gt`A paid Pro license is already active on this device.`);
  }
  let response = await requestTrialEntitlement("/v1/trial/start", deviceName);
  entitlementGeneration++;
  let validatedAt = new Date().toISOString();
  saveStoredEntitlement({
    licenseKey: "",
    credentialType: "trial",
    payload: response.payload,
    signature: response.signature,
    validatedAt,
  });
  let state = stateFromPayload(response.payload, null);
  proEntitlement.setValue(state);
  return state;
}

export async function refreshProEntitlement(): Promise<ProEntitlementState> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let stored = readStoredEntitlement();
    if (!BILLING_LICENSE_API_URL || !BILLING_ENTITLEMENT_PUBLIC_KEY) {
      let state = { ...defaultState, status: "not-configured" as const, message: gt`The license service is not connected to this app build.` };
      proEntitlement.setValue(state);
      return state;
    }
    if (!stored) {
      let state = { ...defaultState, status: "not-activated" as const, message: gt`Enter a Pro license key.` };
      proEntitlement.setValue(state);
      return state;
    }
    try {
      assertValidEntitlement(stored.payload, stored.signature);
    } catch {
      removeStoredEntitlement();
      let state = { ...defaultState, status: "not-activated" as const, message: gt`The saved Pro license is damaged. Enter the key again.` };
      proEntitlement.setValue(state);
      return state;
    }
    let storedIsTrial = isTrialCredential(stored);
    let generation = entitlementGeneration;
    try {
      let response = storedIsTrial
        ? await requestTrialEntitlement("/v1/trial/refresh", getDeviceName())
        : await requestEntitlement("/v1/license/refresh", stored.licenseKey, getDeviceName());
      if (generation != entitlementGeneration) return proEntitlement.value;
      let validatedAt = new Date().toISOString();
      saveStoredEntitlement({
        ...stored,
        credentialType: storedIsTrial ? "trial" : "license",
        payload: response.payload,
        signature: response.signature,
        keyLast4: storedIsTrial ? undefined : response.keyLast4 ?? stored.keyLast4,
        validatedAt,
      });
      let state = stateFromPayload(response.payload, storedIsTrial ? null : response.keyLast4 ?? stored.keyLast4 ?? stored.licenseKey.slice(-4));
      proEntitlement.setValue(state);
      return state;
    } catch (error) {
      if (generation != entitlementGeneration) return proEntitlement.value;
      if (storedIsTrial) {
        if (isLicenseRejection(error)) {
          let status: ProEntitlementStatus = error.responseCode == "trial_expired" ? "expired" : "revoked";
          let state = {
            ...defaultState,
            status,
            plan: "trial",
            validUntil: stored.payload.validUntil,
            message: getProEntitlementErrorMessage(error),
            lastValidatedAt: stored.validatedAt,
          };
          proEntitlement.setValue(state);
          return state;
        }
        let state = {
          ...defaultState,
          status: "trial-offline" as const,
          plan: "trial",
          validUntil: stored.payload.validUntil,
          message: gt`The trial needs an internet connection for verification.`,
          lastValidatedAt: stored.validatedAt,
        };
        proEntitlement.setValue(state);
        return state;
      }
      let cachedDate = Date.parse(stored.validatedAt);
      if (isLicenseRejection(error)) {
        let status: ProEntitlementStatus = error.responseStatus == 404 ? "not-activated" : "revoked";
        let state = {
          ...defaultState,
          status,
          keyLast4: stored.keyLast4 ?? stored.licenseKey.slice(-4),
          message: getProEntitlementErrorMessage(error),
        };
        proEntitlement.setValue(state);
        return state;
      }
      if (!cachedEntitlementMayBeUsed(stored.payload)) {
        let state = {
          ...defaultState,
          status: "error" as const,
          keyLast4: stored.keyLast4 ?? stored.licenseKey.slice(-4),
          message: gt`A system clock change was detected. Connect to the license service to verify access again.`,
        };
        proEntitlement.setValue(state);
        return state;
      }
      let cachedState = stateFromPayload(
        stored.payload,
        stored.keyLast4 ?? stored.licenseKey.slice(-4),
        "offline",
        gt`The license service is temporarily unavailable. The last verified entitlement is being used.`,
        stored.validatedAt,
        Date.now(),
      );
      if (Number.isFinite(cachedDate) && Date.now() - cachedDate <= OFFLINE_GRACE_MS && cachedState.status != "expired") {
        proEntitlement.setValue(cachedState);
        return cachedState;
      }
      let state = { ...defaultState, status: "error" as const, keyLast4: stored.keyLast4 ?? stored.licenseKey.slice(-4), message: getProEntitlementErrorMessage(error) };
      proEntitlement.setValue(state);
      return state;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function deactivateProLicense(): Promise<void> {
  let stored = readStoredEntitlement();
  entitlementGeneration++;
  let isTrial = isTrialCredential(stored);
  if (stored && !isTrial && BILLING_LICENSE_API_URL) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      let controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      await fetch(`${BILLING_LICENSE_API_URL}/v1/license/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ licenseKey: stored.licenseKey, deviceId: getDeviceID() }),
        signal: controller.signal,
      });
    } catch {
      // Удаление локального ключа всё равно должно быть возможно без сети.
    } finally {
      // Таймер отмены не должен оставаться после неудачного сетевого запроса.
      if (timeout) clearTimeout(timeout);
    }
  }
  removeStoredEntitlement();
  proEntitlement.setValue({ ...defaultState, status: "not-activated", message: gt`Enter a Pro license key.` });
}
