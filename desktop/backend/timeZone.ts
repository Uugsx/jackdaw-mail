/** Часовой пояс приложения, не зависящий от пояса компьютера (Настройки → Внешний вид). */

export const kTimeZoneFileName = "timezone.json";

/** Допустимое имя IANA-пояса, например `Europe/Moscow`; иначе null (= пояс системы). */
export function parseTimeZone(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  let name: unknown = text;
  try {
    let json = JSON.parse(text);
    name = json?.timeZone;
  } catch {
    // Простой текст с именем пояса
  }
  return validTimeZone(name);
}

export function validTimeZone(name: unknown): string | null {
  if (typeof name != "string" || !name.trim() || name.length > 64) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: name.trim() });
    return name.trim();
  } catch {
    return null;
  }
}

export function serializeTimeZone(timeZone: string | null): string {
  return JSON.stringify({ timeZone });
}
