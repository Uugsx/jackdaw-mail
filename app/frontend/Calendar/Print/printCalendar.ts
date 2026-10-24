import type { Event } from "../../../logic/Calendar/Event";
import { buildCalendarPrintHTML, type CalendarPrintRange } from "../../../logic/Calendar/Print/CalendarPrint";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";

/** Страница печати календаря для дня, недели или месяца вокруг `date` */
export function calendarPrintHTML(events: readonly Event[], range: CalendarPrintRange, date: Date): string {
  return buildCalendarPrintHTML(events, range, date, {
    locale: getDateTimeLocale(),
    texts: {
      allDay: gt`All day`,
      noEvents: gt`No events`,
      more: gt`+ {0} more`,
    },
  });
}

/** Печатает страницу через скрытый iframe: системное окно печати, как у писем */
export async function printCalendar(events: readonly Event[], range: CalendarPrintRange, date: Date): Promise<void> {
  let frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position: fixed; width: 0; height: 0; border: 0; visibility: hidden;";
  frame.srcdoc = calendarPrintHTML(events, range, date);
  let loaded = new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  try {
    await loaded;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } finally {
    // Окно печати модальное: print() возвращается после него
    frame.remove();
  }
}
