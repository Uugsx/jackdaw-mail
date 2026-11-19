import { readable } from "svelte/store";
import { appGlobal } from "../../logic/app";
import type { Event } from "../../logic/Calendar/Event";

const kRefreshMS = 60 * 1000;

/** Событие ещё предстоит или идёт сегодня: не отменено, не закончилось, начинается до конца дня. */
export function isEventLeftToday(event: Pick<Event, "startTime" | "endTime" | "allDay" | "isCancelled">, now = new Date()): boolean {
  if (event.isCancelled || !event.startTime) {
    return false;
  }
  let dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  let start = event.startTime.getTime();
  let end = event.endTime?.getTime() ?? start;
  if (event.allDay) {
    // Событие на весь день: конец исключающий (полночь следующего дня)
    return start < dayEnd.getTime() && end > dayStart.getTime();
  }
  return start < dayEnd.getTime() && end > now.getTime() && end > dayStart.getTime();
}

/** Сколько событий сегодня ещё впереди или идут сейчас: счётчик на значке «Календарь» в панели приложений.
 * Пересчитывается при изменении событий и раз в минуту (событие кончилось, наступила полночь). */
export const calendarTodayCount = readable(0, set => {
  function count(): number {
    let now = new Date();
    let n = 0;
    for (let event of appGlobal.calendarEvents.contents) {
      if (isEventLeftToday(event, now)) {
        n++;
      }
    }
    return n;
  }
  let update = () => set(count());
  let stop = appGlobal.calendarEvents.subscribe(update);
  let timer = setInterval(update, kRefreshMS);
  update();
  return () => {
    stop();
    clearInterval(timer);
  };
});
