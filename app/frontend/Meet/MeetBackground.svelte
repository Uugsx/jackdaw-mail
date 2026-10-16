<svelte:window
  on:url-tel|capture={event => catchErrors(() => onMeetingURL(event, event.url))}
  on:url-https|capture={event => catchErrors(() => onMeetingURL(event, event.url))} />

<script lang="ts">
  import { MeetingState } from "../../logic/Meet/VideoConfMeeting";
  import { openApp, selectedApp, apps, bringAppToFront } from "../AppsBar/selectedApp";
  import { meetApp } from "./MeetJackdawApp";
  import { PhoneAccount } from "../../logic/Meet/PhoneAccount";
  import { appGlobal } from "../../logic/app";
  import { catchErrors, showUserError, backgroundError } from "../Util/error";
  import { startJackdawCalls } from "../../logic/Meet/Jackdaw/JackdawCalls";
  import { JackdawCall, setJackdawCallEndedHandler } from "../../logic/Meet/Jackdaw/JackdawCall";
  import { NotificationKinds, SystemNotification } from "../Shared/SystemNotification";
  import { gt } from "../../l10n/l10n";
  import { onDestroy, onMount } from "svelte";

  /** Сообщения о звонке, которые показываются после его завершения (занято, нет ответа…) */
  const kCallEndedNoticeSeconds = 8;

  let stopJackdawCalls: (() => void) | null = null;
  onMount(() => {
    setJackdawCallEndedHandler((_call, message) => showUserError(new Error(message), kCallEndedNoticeSeconds));
    stopJackdawCalls = startJackdawCalls();
  });
  onDestroy(() => stopJackdawCalls?.());

  /** Входящий звонок, когда окно Jackdaw не на переднем плане: всплывающее уведомление ОС. */
  let notifiedCallIDs = new Set<string>();
  $: meeting instanceof JackdawCall && $meeting.state == MeetingState.IncomingCall &&
    !notifiedCallIDs.has(meeting.callID) && notifyIncomingCall(meeting);
  function notifyIncomingCall(call: JackdawCall) {
    notifiedCallIDs.add(call.callID);
    if (document.hasFocus()) {
      return;
    }
    let notification = new SystemNotification(
      new NotificationKinds(["popup"]),
      call.hasVideo ? gt`Incoming video call` : gt`Incoming audio call`,
      call.participants.first?.name || call.remoteEmail,
      `call-${call.callID}`,
    );
    notification.updatesTaskbarBadge = false;
    notification.onClick = () => bringAppToFront();
    notification.show().catch(backgroundError);
  }

  // HACK: Why are some ended meetings not removed? See `VideoConfMeeting.hangup()`
  $: meetings = appGlobal.meetings.filterObservable(m => m.state != MeetingState.Ended);

  /** When a call comes in or is placed, open the meet app,
   * which will then open the Calling screen. */
  $: meeting = $meetings.first;
  $: meeting && openMeet();
  function openMeet() {
    if (meeting.state == MeetingState.OutgoingCallConfirm ||
        meeting.state == MeetingState.OutgoingCall ||
        meeting.state == MeetingState.IncomingCall) {
      openApp(meetApp, { meeting });
    }
  }

  /** Open sidebar, if meeting is ongoing.
   * Note: Has to be after `openMeet()`, so that sets the correct state first */
  $: meetApp.showSidebar = $meetings.hasItems && $selectedApp != meetApp && !window.location.pathname.startsWith("/meet");

  async function onMeetingURL(event: Event, url: string) {
    let urlParsed = new URL(url);
    let acc = appGlobal.meetAccounts.find(acc => acc.isMeetingURL(urlParsed));
    if (!acc) {
      return;
    }
    event.stopPropagation();
    let meeting = await acc.openMeetingURL(url);
    openApp(meetApp, { meeting });
  }
</script>
