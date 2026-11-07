<vbox flex class="calendar-app">
  <hbox flex>
    {#if $isCalendarListOpen}
      <CalendarList />
    {/if}
    <Splitter
      initialRightRatio={0.25}
      rightMinWidth={250}
      hasRight={!appGlobal.isMobile}
      >
      <vbox flex class="main" slot="left" class:mobile={$appGlobal.isMobile}>
        <MainView events={shownCalendarEvents} bind:start={$startDate} dateInterval={$dateIntervalSetting.value}>
          <hbox slot="top-left">
            {#if !$appGlobal.isMobile}
              <TitleBarLeft />
            {/if}
          </hbox>
          <TitleBarRight bind:dateInterval={dateIntervalSetting.value} slot="top-right" />
        </MainView>
      </vbox>
      <vbox flex class="sidebar" slot="right">
        {#if $selectedEvent && !appGlobal.isMobile}
          <ShowEvent event={$selectedEvent} />
        {:else if !appGlobal.isMobile}
          <EmptySelection
            title={$t`No event selected`}
            subtitle={$t`Select an event in the calendar, or create a new one.`}>
            <Button slot="actions"
              label={$t`New event`}
              icon={AddIcon}
              classes="primary"
              onClick={() => catchErrors(() => createNewEvent($selectedCalendar, $selectedDate ?? new Date(), false))} />
          </EmptySelection>
        {/if}
      </vbox>
    </Splitter>
  </hbox>
  {#if $appGlobal.isMobile}
    <CalendarViewBarM />
  {/if}
</vbox>

<script lang="ts">
  import { isCalendarListOpen, selectedCalendar, selectedDate, selectedEvent, shownCalendarEvents, startDate, type DateInterval } from "./selected";
  import { appGlobal } from "../../logic/app";
  import CalendarList from "./CalendarList.svelte";
  import MainView from "./MainView.svelte";
  import CalendarViewBarM from "./MonthView/CalenderViewBarM.svelte";
  import TitleBarLeft from "./TitleBarLeft.svelte";
  import TitleBarRight from "./TitleBarRight.svelte";
  import ShowEvent from "./DisplayEvent/ShowEvent.svelte";
  import EmptySelection from "../Shared/EmptySelection.svelte";
  import Button from "../Shared/Button.svelte";
  import AddIcon from "lucide-svelte/icons/calendar-plus";
  import { createNewEvent } from "./event";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";
  import Splitter from "../Shared/Splitter.svelte";
  import { getLocalStorage } from "../Util/LocalStorage";

  // Календари могут загрузиться позже открытия раздела — выбираем первый, когда появится
  const calendars = appGlobal.calendars;
  $: if (!$selectedCalendar) { $selectedCalendar = $calendars.first; }

  let dateIntervalSetting = getLocalStorage("calendar.view", 2 as DateInterval);
</script>

<style>
  .main {
    margin: 0px 16px 16px 16px;
  }
  /* В узкой панели заголовок переносится на вторую строку, поэтому высота
     минимальная, а не фиксированная. */
  .main :global(.range-header) {
    min-height: 58px;
    flex-wrap: wrap;
    align-items: center;
  }
  .main.mobile {
    margin-inline-end: 0px;
  }
  .main.mobile :global(.range-header) {
    min-height: 36px;
  }
</style>
