import { MailIdentity } from "../MailIdentity";
import type { MailAccount } from "../MailAccount";
import { findOrCreatePersonUID } from "../../Abstract/PersonUID";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** Exchange сам решает «как» или «от имени» по правам на ящик (EWS `From`, сервер ставит `Sender`) */
export function canSendFromOtherAddress(account: MailAccount | null | undefined): boolean {
  let protocol = (account?.mainAccount ?? account)?.protocol;
  return protocol == "ews" || protocol == "owa";
}

/** Нормализованный адрес, `"invalid"` или `"own"` — свой адрес, его выбирают из списка */
export function checkOtherFromAddress(input: string, account: MailAccount): string | "invalid" | "own" {
  let address = sanitize.emailAddress(input?.trim().replace(/^mailto:/i, ""), null);
  if (!address || address.includes("*")) {
    return "invalid";
  }
  if (account.isMyEMailAddress(address)) {
    return "own";
  }
  return address;
}

/** Чужой ящик как отправитель этого аккаунта; уже добавленный — возвращается как есть */
export async function addDelegateIdentity(account: MailAccount, address: string): Promise<MailIdentity> {
  let existing = account.identities.find(identity => identity.isDelegate && identity.isEMailAddress(address));
  if (existing) {
    return existing;
  }
  let identity = new MailIdentity(account);
  identity.emailAddress = address;
  let person = findOrCreatePersonUID(address, null).findPerson();
  identity.realname = person?.name && person.name != address ? person.name : "";
  identity.isDelegate = true;
  account.identities.add(identity);
  await account.save();
  return identity;
}
