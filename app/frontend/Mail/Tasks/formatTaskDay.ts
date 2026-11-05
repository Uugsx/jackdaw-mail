import { dayToLocalDate, type DayString } from "../../../logic/Mail/Tasks/ExchangeTask";
import { getDateTimeLocale } from "../../../l10n/l10n";

/** «пт, 30 окт.»; год — только если не текущий. Принимает день или момент времени. */
export function formatTaskDay(value: DayString | Date, now = new Date()): string {
  let date = typeof value == "string" ? dayToLocalDate(value) : value;
  if (!date) {
    return "";
  }
  let sameYear = date.getFullYear() == now.getFullYear();
  return new Intl.DateTimeFormat(getDateTimeLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

