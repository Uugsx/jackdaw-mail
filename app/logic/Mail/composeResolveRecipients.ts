import { searchContacts } from "../Contacts/Search";
import { PersonUID } from "../Abstract/PersonUID";
import type { EMail } from "./EMail";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { UserError } from "../util/util";
import { gt } from "../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

type SearchContacts = (
  searchTerm: string,
  skip: (person: PersonUID) => boolean,
) => Promise<PersonUID[]>;

function isValidAddress(emailAddress: string): boolean {
  return !!sanitize.emailAddress(emailAddress, "");
}

function needsResolve(person: PersonUID): boolean {
  return person.nameIsUnknown || !isValidAddress(person.emailAddress);
}

async function resolvePerson(
  person: PersonUID,
  skip: (candidate: PersonUID) => boolean,
  search: SearchContacts,
): Promise<boolean> {
  if (!needsResolve(person)) {
    return true;
  }
  let searchTerm = isValidAddress(person.emailAddress)
    ? person.emailAddress
    : (person.name || person.emailAddress).trim();
  if (!searchTerm) {
    return false;
  }
  let matches = await search(searchTerm, candidate =>
    candidate.emailAddress !== person.emailAddress && skip(candidate));
  if (isValidAddress(person.emailAddress)) {
    // Правильно набранный адрес не подменяем: поиск идёт по подстроке, и для
    // `ivanov@x` единственным найденным мог оказаться `a.ivanov@x`. Из справочника
    // берём только имя для точно такого же адреса.
    let address = person.emailAddress.toLowerCase();
    matches = matches.filter(match => match.emailAddress?.toLowerCase() === address);
    if (matches.length === 0) {
      person.nameIsUnknown = false;
      return true;
    }
  }
  if (matches.length === 0) {
    return false;
  }
  let pick = pickBestMatch(matches, person, searchTerm);
  if (!pick) {
    return false;
  }
  person.emailAddress = pick.emailAddress;
  person.name = pick.name;
  person.nameIsUnknown = false;
  person.person = pick.person;
  return true;
}

function pickBestMatch(
  matches: PersonUID[],
  person: PersonUID,
  searchTerm: string,
): PersonUID | null {
  if (matches.length === 1) {
    return matches[0];
  }
  let term = searchTerm.toLowerCase();
  let byName = matches.filter(m => m.name?.toLowerCase() === term);
  if (byName.length === 1) {
    return byName[0];
  }
  let byEmail = matches.filter(m => m.emailAddress?.toLowerCase() === term);
  if (byEmail.length === 1) {
    return byEmail[0];
  }
  if (person.name) {
    let partial = matches.filter(m =>
      m.name?.toLowerCase().includes(person.name.toLowerCase()));
    if (partial.length === 1) {
      return partial[0];
    }
  }
  return null;
}

async function resolveList(
  persons: ArrayColl<PersonUID>,
  allRecipients: PersonUID[],
  search: SearchContacts,
): Promise<string[]> {
  let unresolved: string[] = [];
  let skip = (candidate: PersonUID) =>
    allRecipients.some(existing =>
      existing !== candidate && existing.emailAddress === candidate.emailAddress);
  for (let person of [...persons.contents]) {
    let ok = await resolvePerson(person, skip, search);
    if (!ok && needsResolve(person)) {
      unresolved.push(person.name || person.emailAddress);
    }
  }
  return unresolved;
}

/** Resolve ambiguous To/Cc/Bcc entries against the directory (Outlook Check Names). */
export async function resolveComposeRecipients(
  email: EMail,
  search: SearchContacts = searchContacts,
): Promise<void> {
  let allRecipients = [...email.to.contents, ...email.cc.contents, ...email.bcc.contents];
  let unresolved = [
    ...(await resolveList(email.to, allRecipients, search)),
    ...(await resolveList(email.cc, allRecipients, search)),
    ...(await resolveList(email.bcc, allRecipients, search)),
  ];
  if (unresolved.length) {
    throw new UserError(gt`Could not resolve: ${unresolved.join(", ")}`);
  }
}
