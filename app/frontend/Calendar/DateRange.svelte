<hbox class="date-range-header">
  <hbox class="date-range" title={monthYear(middleOfRange(date))}>{@html htmlMonthYear(date, showDays)}</hbox>
  <Button classes="previous-button" label={$t`Previous ${dateInterval} days`} icon={ChevronLeftIcon} onClick={pagePrevious} iconSize="16px" plain iconOnly />
  <Button classes="next-button" label={$t`Next ${dateInterval} days`} icon={ChevronRightIcon} onClick={pageNext} iconSize="16px" plain iconOnly />
</hbox>

<script lang="ts">
  import Button from "../Shared/Button.svelte";
  import ChevronLeftIcon from "lucide-svelte/icons/chevron-left";
  import ChevronRightIcon from "lucide-svelte/icons/chevron-right";
  import { getWeekStart } from "../Util/date";
  import { getDateTimeLocale, t } from "../../l10n/l10n";

  export let date = new Date(); /* in/out */
  /** Days to page forward and back */
  export let dateInterval: number; /* in */
  /** Days visible in the view. Week views start on Monday, not on `date`. */
  export let showDays = dateInterval; /* in */

  // <copied to="MonthView.svelte">
  function pageNext() {
    // Advance months by 42 days just to be sure, e.g. for March 2025
    // MonthView.setDays will then rewind as necessary.
    date.setDate(date.getDate() + (dateInterval == 35 ? 42 : dateInterval));
    date = date;
  }
  function pagePrevious() {
    // Rewind by 28 days at most, e.g. for February 2025
    // MonthView.setDays will rewind further if necessary.
    date.setDate(date.getDate() - (dateInterval == 35 ? 28 : dateInterval));
    date = date;
  }
  // </copied>

  /** @returns The middle of the visible days, i.e. the month
   * that covers most of the current date range. */
  function middleOfRange(date: Date): Date {
    // Week views start on the Monday of the week, not on `date`
    let middle = showDays > 3 ? getWeekStart(date) : new Date(date);
    middle.setDate(middle.getDate() + (showDays >> 1));
    return middle;
  }

  function monthYear(date: Date): string {
    return date.toLocaleDateString(getDateTimeLocale(), {
      year: "numeric",
      month: "long",
      // day: dateInterval < 28 ? "numeric" : undefined,
    });
  }

  function htmlMonthYear(date: Date, _showDays: number): string {
    let middle = middleOfRange(date);
    let str = monthYear(middle);
    let year = middle.getFullYear();
    return str.replace(String(year), `&nbsp;<span class="year">${year}</span>&nbsp;`);
  }
</script>

<style>
  /* В узкой панели название месяца сжимается, а кнопки листания остаются
     видимыми (раньше заголовок выходил за край и кнопки обрезались). */
  .date-range-header {
    align-items: center;
    align-self: end;
    max-width: 100%;
    min-width: 0;
    margin-block-end: 4px;
  }
  .date-range-header > :global(button) {
    flex-shrink: 0;
  }
  .date-range {
    display: block;
    font-size: 18px;
    margin-inline-start: 8px;
    margin-inline-end: 8px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
