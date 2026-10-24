import { readable } from "svelte/store";
import {
  calendarWorkingHoursSetting, loadCalendarWorkingHours, type CalendarWorkingHours,
} from "../../logic/Calendar/WorkingHours/CalendarWorkingHours";

/** Рабочие часы календаря; меняются из настроек без перезапуска */
export const calendarWorkingHours = readable<CalendarWorkingHours>(loadCalendarWorkingHours(), set =>
  calendarWorkingHoursSetting().subscribe(() => set(loadCalendarWorkingHours())));
