<hbox class="top">
  <hbox class="buttons">
    {#if canMeet}
      <RoundButton
        label={$t`Start a new meeting`}
        onClick={startAdHocMeeting}
        errorCallback={showError}
        icon={PlusIcon}
        iconSize="24px"
        border={false}
        classes="plain primary create" />
    {/if}
    <RoundButton
      label={$t`Plan a meeting`}
      onClick={addToCalendar}
      errorCallback={showError}
      icon={AddToCalendarIcon}
      iconSize="24px"
      border={false}
      classes="plain primary" />
    {#if havePhoneAccount}
      <RoundButton
        label={isPhoneDial ? $t`Video conference` : $t`Make a phone call`}
        onClick={() => isPhoneDial = !isPhoneDial}
        errorCallback={showError}
        icon={isPhoneDial ? VideoConfIcon : PhoneCallIcon}
        iconSize="24px"
        border={false}
        classes="plain primary" />
    {/if}
  </hbox>
  <hbox flex />
  <AccountDropDown
    accounts={appGlobal.meetAccounts.filterObservable(acc => !(acc instanceof PhoneAccount))}
    bind:selectedAccount
    filterByWorkspace={true} />
</hbox>
<div class="main">
  <section class="start background-pattern" aria-labelledby="meet-start-title">
    <div class="panel">
      <h2 id="meet-start-title" class="heading">{$t`Meetings and calls`}</h2>
      {#if callPerson}
        <Button label={$t`Call ${callPerson.name}`} onClick={() => callPersonNow(callPerson)} errorCallback={showError} classes="call-person secondary">
          <PersonPicture slot="icon" person={callPerson} size={24} />
        </Button>
      {/if}
      {#if canMeet}
        <Button
          label={$t`Start a new meeting`}
          icon={PlusIcon}
          onClick={startAdHocMeeting}
          errorCallback={showError}
          classes="primary filled" />
      {:else}
        <div class="no-account">
          <p>{$t`Group video meetings need a meeting account. Calls to colleagues work without it: open a chat or a contact and press the call button.`}</p>
          <Button label={$t`Connect a meeting account`} classes="secondary" onClick={() => openSettingsCategoryByID("meet")} />
        </div>
      {/if}
      <div class="join">
        <input class="meeting-link" type="url" bind:value={conferenceURL}
          aria-label={$t`Enter meeting link to join`}
          placeholder={$t`Enter meeting link to join`}
          on:input={() => errorMsg = null}
          on:paste={() => catchErrors(joinURLPasted, showError)}
          on:keydown={event => onKeyEnter(event, () => catchErrors(() => joinByURL(conferenceURL), showError))} />
        <Button label={$t`Join`} classes="secondary"
          disabled={!conferenceURL}
          onClick={() => joinByURL(conferenceURL)}
          errorCallback={showError} />
      </div>
      {#if errorMsg}
        <div class="error" role="alert">
          <ErrorMessage bind:errorMessage={errorMsg} errorGravity={ErrorGravity.Error} ex={errorEx} />
        </div>
      {/if}
    </div>
  </section>
  <aside class="meetings">
    {#if $callLog.hasItems}
      <section class="list">
        <hbox class="list-header">
          <h3 class="title font-small">{$t`Recent calls`}</h3>
          <hbox flex />
          <Button label={$t`All calls`} plain classes="all-calls font-small" onClick={() => goTo("/meet/history", {})} />
        </hbox>
        <CallLogList limit={RECENT_CALLS} errorCallback={showError} />
      </section>
    {/if}
    <section class="list">
      <h3 class="title font-small">{$t`Today's next meetings`}</h3>
      <MeetingList meetings={upcomingMeetings}
        onClick={joinMeetingEvent}>
        <div slot="emptyMsg" class="emptyMsg font-small">{$t`No meetings`}</div>
      </MeetingList>
    </section>
    {#if !appGlobal.isMobile}
      <section class="list">
        <h3 class="title font-small">{$t`Previous meetings`}</h3>
        <MeetingList meetings={previousMeetings}
          onClick={openEvent}>
          <div slot="emptyMsg" class="emptyMsg font-small">{$t`No meetings`}</div>
        </MeetingList>
      </section>
    {/if}
  </aside>
</div>
{#if $appGlobal.isMobile}
  <StartBarM {selectedAccount} />
{/if}

<script lang="ts">
  import { startAdHocMeeting, callSelected, joinByURL } from "./start";
  import { callTargetEmails, myMailboxEmails, startJackdawCall } from "../../../logic/Meet/Jackdaw/JackdawCalls";
  import type { Person } from "../../../logic/Abstract/Person";
  import { openSettingsCategoryByID } from "../../Settings/Window/CategoriesUtils";
  import { PhoneAccount } from "../../../logic/Meet/PhoneAccount";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import { meetApp } from "../MeetJackdawApp";
  import { Event } from "../../../logic/Calendar/Event";
  import { Calendar } from "../../../logic/Calendar/Calendar";
  import { openEvent } from "../../Calendar/open";
  import { setNewEventTime } from "../../Calendar/event";
  import { appGlobal } from "../../../logic/app";
  import MeetingList from "./MeetingList.svelte";
  import CallLogList from "./CallLogList.svelte";
  import { loadCallLog } from "../../../logic/Meet/Jackdaw/callLog";
  import { goTo, selectedApp } from "../../AppsBar/selectedApp";
  import StartBarM from "./StartBarM.svelte";
  import PersonPicture from "../../Contacts/Person/PersonPicture.svelte";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import { friendlyErrorMessage } from "../../../logic/util/friendlyError";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import VideoIcon from 'lucide-svelte/icons/video';
  import PlusIcon from 'lucide-svelte/icons/plus';
  import AddToCalendarIcon from "lucide-svelte/icons/calendar-plus";
  import PhoneCallIcon from "lucide-svelte/icons/phone";
  import VideoConfIcon from "lucide-svelte/icons/video";
  import { catchErrors, logError } from "../../Util/error";
  import { onKeyEnter } from "../../Util/util";
  import { assert, sleep, UserError } from "../../../logic/util/util";
  import { gt, t } from "../../../l10n/l10n";

  export let isPhoneDial = false;

  const now = new Date();
  const maxUpcoming = new Date();
  maxUpcoming.setHours(23); // today
  maxUpcoming.setMinutes(59);
  const maxPrevious = new Date();
  maxPrevious.setDate(maxPrevious.getDate() - 14); // last 14 days
  const upcomingMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime > now && event.startTime < maxUpcoming);
  const previousMeetings = appGlobal.calendarEvents.filterObservable(event => event.startTime < now && event.startTime > maxPrevious).reverse();

  /** Сколько последних звонков показать рядом со встречами; остальные — на странице журнала */
  const RECENT_CALLS = 5;
  const callLog = loadCallLog();

  let selectedAccount = appGlobal.meetAccounts.first;
  let conferenceURL: string;

  async function joinURLPasted() {
    await sleep(0.1); // paste event fires before the input event, which clears the error
    await joinByURL(conferenceURL);
  }

  async function joinMeetingEvent(meeting: Event) {
    assert(meeting?.onlineMeetingURL, $t`Not an online meeting, or no join URL known`);
    await joinByURL(meeting.onlineMeetingURL);
  }

  function addToCalendar() {
    let calendar = selectedAccount?.mainAccount?.dependentAccounts().find(acc => acc instanceof Calendar) as Calendar
      ?? appGlobal.calendars.first;
    assert(calendar, $t`Please set up a calendar first`);
    let event = calendar.newEvent();
    setNewEventTime(event, false, new Date());
    openEvent(event);
  }

  let errorMsg: string | null = null;
  let errorEx: Error | null = null;

  function showError(ex: Error) {
    errorMsg = friendlyErrorMessage(ex);
    errorEx = ex;
    logError(ex);
  }

  $selectedApp = meetApp;
  let meetAccounts = appGlobal.meetAccounts;
  $: havePhoneAccount = $meetAccounts.some(acc => acc instanceof PhoneAccount);
  /** Групповую встречу можно начать только с учётной записью совещаний */
  $: canMeet = $meetAccounts.some(acc => acc.canVideo && acc.canMultipleParticipants);
  /** Выбранный в контактах человек; себе не звоним */
  $: callPerson = $selectedPerson && !isMyself($selectedPerson) ? $selectedPerson : null;

  function isMyself(person: Person): boolean {
    let mine = new Set(myMailboxEmails().map(email => email.trim().toLowerCase()));
    let emails = callTargetEmails(person);
    return emails.length > 0 && emails.every(email => mine.has(email));
  }

  /** Звонок коллеге идёт через Jackdaw, как из чата; иначе — через учётную запись совещаний */
  async function callPersonNow(person: Person) {
    if (await startJackdawCall(person)) {
      return;
    }
    if (!canMeet) {
      throw new UserError(gt`${person.name} cannot be called in Jackdaw right now. Try again when they are online.`);
    }
    await callSelected(person);
  }
</script>

<style>
  .top {
    margin: 12px;
  }
  .buttons {
    column-gap: 12px;
    margin-inline-start: 8px;
    margin-block-start: 4px;
  }
  .main {
    flex: 1 1 0;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 400px);
  }
  .start {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    overflow-y: auto;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 400px;
  }
  .heading {
    margin: 0 0 4px;
    font-size: 1.375rem;
    line-height: 1.3;
    font-weight: 600;
    color: var(--main-fg);
  }
  .panel :global(.call-person .avatar) {
    margin: -4px 0px;
  }
  .no-account {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background-color: var(--main-bg);
  }
  .no-account p {
    margin: 0;
    line-height: 1.45;
  }
  .join {
    display: flex;
    gap: 8px;
  }
  .meeting-link {
    flex: 1 1 auto;
    min-width: 0;
  }
  .meetings {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
    border-inline-start: 1px solid var(--border);
    overflow-y: auto;
  }
  .title {
    margin: 0 0 8px;
    font-weight: 600;
  }
  .list-header {
    align-items: baseline;
  }
  .list-header :global(.all-calls) {
    padding: 0 4px;
  }
  .emptyMsg {
    color: var(--main-fg);
    opacity: 0.7;
  }
  @media (max-width: 800px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
      grid-auto-rows: min-content;
      overflow-y: auto;
    }
    .meetings {
      order: 1;
      border-inline-start: none;
      border-block-end: 1px solid var(--border);
      padding: 16px;
    }
    .start {
      order: 2;
    }
  }
</style>
