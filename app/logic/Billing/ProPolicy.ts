import { gt } from "../../l10n/l10n";
import { UserError } from "../util/util";
import { hasProFeature } from "./ProEntitlement";

/** В бесплатном плане первый почтовый аккаунт доступен для знакомства с клиентом. */
export const FREE_MAIL_ACCOUNT_LIMIT = 1;

export function canAddMailAccount(accountCount: number): boolean {
  if (!Number.isFinite(accountCount) || accountCount < 0) {
    return false;
  }
  return accountCount < FREE_MAIL_ACCOUNT_LIMIT || hasProFeature("multiple-accounts");
}

export function assertCanAddMailAccount(accountCount: number): void {
  if (canAddMailAccount(accountCount)) {
    return;
  }
  throw new UserError(gt`Adding a second email account is a Jackdaw Pro feature. Start the 7-day trial in Settings → Jackdaw Pro or activate a license.`);
}
