/**
 * Другие адреса того же человека из каталога организации (Exchange GAL).
 *
 * В компании у ящика обычно несколько адресов: основной (`nlevchenko0181@…`) и псевдонимы
 * (`nikita.levchenko@…`). Письма приходят с псевдонима, и чат с человеком заводится на него,
 * а устройство собеседника подключает чат на адрес своего ящика. Каталог связывает эти адреса.
 */
import { ArrayColl } from "svelte-collections";
import type { Person } from "../../Abstract/Person";
import type { SearchOnlyAddressbook } from "../../Contacts/Addressbook";
import { normalizeCallEmail } from "../../Meet/Jackdaw/JackdawCallProtocol";

/**
 * @returns остальные адреса человека, у которого в каталоге есть `email`. Пусто, если такого
 *   человека нет или найдено несколько: выбирать наугад нельзя, сообщение ушло бы не тому.
 */
export async function findDirectoryAddresses(email: string, directories: SearchOnlyAddressbook[]): Promise<string[]> {
  let wanted = normalizeCallEmail(email);
  if (!wanted || !directories.length) {
    return [];
  }
  let found = new ArrayColl<Person>();
  for (let directory of directories) {
    try {
      await directory.quickSearchAsync(wanted, found);
    } catch {
      // Каталог недоступен (нет сети, нет прав): остальные каталоги ещё могут ответить
    }
  }
  let people = new Map<string, string[]>();
  for (let person of found.contents) {
    let emails = [...new Set(person.emailAddresses.contents
      .map(entry => normalizeCallEmail(entry.value))
      .filter((address): address is string => !!address))];
    if (emails.length) {
      people.set(emails.slice().sort().join(" "), emails);
    }
  }
  // Поиск по каталогу идёт по началу адреса и имени: того же человека определяем
  // по совпадению адреса, если оно есть, иначе — только при единственном результате
  let matching = [...people.values()].filter(emails => emails.includes(wanted));
  let candidates = matching.length ? matching : [...people.values()];
  if (candidates.length != 1) {
    return [];
  }
  return candidates[0].filter(address => address != wanted);
}

/** Имя человека с адресом `email` из каталога. null — не найден или найдено несколько разных людей. */
export async function findDirectoryName(email: string, directories: SearchOnlyAddressbook[]): Promise<string | null> {
  let wanted = normalizeCallEmail(email);
  if (!wanted || !directories.length) {
    return null;
  }
  let found = new ArrayColl<Person>();
  for (let directory of directories) {
    try {
      await directory.quickSearchAsync(wanted, found);
    } catch {
      // Каталог недоступен: остальные ещё могут ответить
    }
  }
  let names = new Set(found.contents
    .filter(person => person.emailAddresses.contents.some(entry => normalizeCallEmail(entry.value) == wanted))
    .map(person => person.name?.trim())
    .filter((name): name is string => !!name && normalizeCallEmail(name) != wanted));
  return names.size == 1 ? [...names][0] : null;
}
