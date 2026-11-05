import { Event } from "../Event";
import type { Participant } from "../Participant";

export class ExchangeEvent extends Event {
  /** The time zone in which the server sent the times of this all-day event.
   * `setAllDayTimeToLocalMidnight()` clears `timezone`, but occurrence dates
   * that the server sends still need the same conversion as the event times. */
  allDayTimezone: string | null = null;

  // Except for ActiveSync 16.x, whose all-day events are special-cased in
  // fromCompact(), Exchange provides a time zone and the time in UTC that
  // would be midnight in that time zone, but we need them to use local time.
  protected setAllDayTimeToLocalMidnight() {
    if (!this.allDay) {
      this.allDayTimezone = null;
      return;
    }
    if (this.timezone) {
      this.allDayTimezone = this.timezone;
      this.timezone = null;
    }
    this.startTime = this.toLocalMidnight(this.startTime);
    this.endTime = this.toLocalMidnight(this.endTime);
    // Must match the start time, otherwise it no longer matches the
    // recurrence that we generate from the start time.
    if (this.recurrenceStartTime) {
      this.recurrenceStartTime = this.toLocalMidnight(this.recurrenceStartTime);
    }
  }

  /** Converts a time that the server sent for an all-day event - the UTC time
   * that would be midnight in `allDayTimezone` - to local midnight.
   * Times of other events are already correct and stay unchanged.
   * Use this for all occurrence dates that the server sends, e.g. the
   * recurrence ID of a modified occurrence and deleted occurrences. */
  toLocalMidnight(date: Date): Date {
    if (!this.allDayTimezone) {
      return date;
    }
    return new Date(date.toLocaleDateString('lt', { timeZone: this.allDayTimezone }) + "T00:00:00");
  }

  /** Комнаты и другие ресурсы для поля Exchange `Resources`.
   * `null` — поле не трогать: ресурсов нет и до правки не было,
   * так обычные встречи сохраняются как раньше.
   * Пустой массив — ресурсы убрали, поле надо очистить. */
  protected resourcesForServer(withoutAttendees: boolean): Participant[] | null {
    let resources = withoutAttendees ? [] : this.participants.contents.filter(p => p.isResource);
    let hadResources = !!this.unedited?.participants.contents.some(p => p.isResource);
    return resources.length || hadResources ? resources : null;
  }

  /** ActiveSync sends the exceptions of an all-day event without the time zone
   * of the master, so pass it on to the instances. */
  protected copyFromRecurrenceMaster(original: ExchangeEvent) {
    super.copyFromRecurrenceMaster(original);
    this.allDayTimezone = original.allDayTimezone;
  }
}
