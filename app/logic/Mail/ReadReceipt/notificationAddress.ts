import { PersonUID, findOrCreatePersonUID } from "../../Abstract/PersonUID";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** Разбирает `Disposition-Notification-To`: `Имя <a@b>`, `<a@b>` или `a@b`, возможно несколько через запятую */
export function parseNotificationAddresses(header: string | null | undefined): PersonUID[] {
  if (!header) {
    return [];
  }
  let result: PersonUID[] = [];
  // Запятые внутри кавычек имени не делят адреса
  let parts = header.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (let part of parts) {
    let angle = part.match(/<([^<>\s]+)>/);
    let address = sanitize.emailAddress((angle?.[1] ?? part).trim(), null);
    if (!address) {
      continue;
    }
    let name = angle
      ? part.slice(0, angle.index).trim().replace(/^"|"$/g, "").trim()
      : "";
    result.push(findOrCreatePersonUID(address, name || null));
  }
  return result;
}
