/**
 * Совместимый слой для старых проверок базового клиента.
 * Доступ к Pro-функциям проверяется отдельно через подписанное entitlement.
 * Почтовые и meeting-сценарии сохраняют прежний контракт этого модуля.
 */
import { gLicense } from "./License";
import type { URLString } from "../util/util";
import { BILLING_PLANS_URL } from "../Billing/Billing";
import {
  activateProLicense,
  deactivateProLicense,
  getSavedProLicenseKey,
  hasProFeature,
  proEntitlement,
  refreshProEntitlement,
  startProTrial,
  type ProEntitlementState,
} from "../Billing/ProEntitlement";

export class Ticket {
  get valid() { return true; }
  endDate = new Date(Date.now() + 3650 * 86400_000);
  get daysLeft() { return 3650; }
  name = "Jackdaw";
  emails: string[] = [];
  features = new Set(["mail", "chat", "meet", "calendar", "contacts"]);
}

export class BadTicket extends Ticket {
  override get valid() { return true; }
}

export class LicenseError extends Error {}
export class NoValidLicense extends LicenseError {
  message = "Базовая лицензия недоступна.";
}
export class AccountMissingError extends LicenseError {}

export async function ensureLicensed(): Promise<void> {
  gLicense.license = { valid: true };
}

export async function isLicensed(): Promise<boolean> {
  gLicense.license = { valid: true };
  return true;
}

export async function fetchLicenseFromServer(): Promise<Ticket> {
  return new Ticket();
}

export async function checkSavedLicense(): Promise<Ticket> {
  return new Ticket();
}

export function getSavedTicket(): { json: string; signature: string } | null {
  return { json: JSON.stringify({ valid: true }), signature: "" };
}

export async function addTicketFromString(_signedTicketStr: string) {
  gLicense.license = { valid: true };
}

export async function openPurchasePage(
  _paidCallback?: (license: Ticket) => void,
  _mode: "welcome" | "purchase" = "purchase",
) {
  if (typeof window != "undefined") {
    window.open(BILLING_PLANS_URL, "_blank", "noopener,noreferrer");
  }
}

export function purchagePageURL(_mode: "welcome" | "purchase" | "inline-payment" = "purchase"): URLString {
  return BILLING_PLANS_URL;
}

export function startFastPolling(_paidCallback?: (license: Ticket) => void) {}
export function stopFastPolling() {}

/** Текущее подписанное право доступа к Pro-возможностям. */
export { activateProLicense, deactivateProLicense, getSavedProLicenseKey, hasProFeature, proEntitlement, refreshProEntitlement, startProTrial };
export type { ProEntitlementState };
