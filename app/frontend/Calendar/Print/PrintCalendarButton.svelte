<!-- Печать календаря: день, неделя или месяц вокруг показанной даты -->
<hbox bind:this={anchor}>
  <RoundButton
    classes="print-calendar"
    label={$t`Print`}
    icon={PrintIcon}
    onClick={() => isMenuOpen = !isMenuOpen}
    iconSize="14px"
    padding="6px"
    border={false}
    />
</hbox>
<Menu bind:isMenuOpen {anchor} placement="bottom-end">
  <MenuItem label={$t`Print day`} icon={DayIcon} onClick={() => print("day")} />
  <MenuItem label={$t`Print week`} icon={WeekIcon} onClick={() => print("week")} />
  <MenuItem label={$t`Print month`} icon={MonthIcon} onClick={() => print("month")} />
</Menu>

<script lang="ts">
  import type { CalendarPrintRange } from "../../../logic/Calendar/Print/CalendarPrint";
  import { printCalendar } from "./printCalendar";
  import { shownCalendarEvents, startDate, selectedDate, type DateInterval } from "../selected";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import PrintIcon from "lucide-svelte/icons/printer";
  import DayIcon from "lucide-svelte/icons/calendar-1";
  import WeekIcon from "lucide-svelte/icons/calendar-range";
  import MonthIcon from "lucide-svelte/icons/calendar-days";
  import { t } from "../../../l10n/l10n";

  export let dateInterval: DateInterval;

  let anchor: HTMLElement;
  let isMenuOpen = false;

  /** Дата, вокруг которой печатаем. В месяце начало вида — понедельник
   * перед первым числом, поэтому месяц берём по середине вида. */
  function printDate(range: CalendarPrintRange): Date {
    let start = new Date($startDate);
    if (dateInterval == 28 || dateInterval == 31) {
      start.setDate(start.getDate() + 14);
      return start;
    }
    let selected = $selectedDate;
    let viewEnd = new Date(start);
    viewEnd.setDate(viewEnd.getDate() + Math.max(dateInterval, 1));
    // Выбранный день внутри показанного — печатаем его день или неделю
    if (range != "month" && selected && selected >= start && selected < viewEnd) {
      return new Date(selected);
    }
    return start;
  }

  async function print(range: CalendarPrintRange) {
    isMenuOpen = false;
    await printCalendar(shownCalendarEvents.contents, range, printDate(range));
  }
</script>
