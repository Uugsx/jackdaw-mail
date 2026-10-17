<svelte:window
  on:beforeunload={confirmLeaveDuringCall}
  on:pagehide={hangupJackdawCalls}
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
  import { JackdawCall, setJackdawCallEndedHandler, setJackdawCallWarningHandler } from "../../logic/Meet/Jackdaw/JackdawCall";
  import { CallNotification } from "./CallNotification";
  import { gt } from "../../l10n/l10n";
  import { onDestroy, onMount } from "svelte";

  /** Сообщения о звонке, которые показываются после его завершения (занято, нет ответа…) */
  const kCallEndedNoticeSeconds = 8;

  let stopJackdawCalls: (() => void) | null = null;
  onMount(() => {
    setJackdawCallEndedHandler((call, message) => {
      showUserError(new Error(message), kCallEndedNoticeSeconds);
      notifyMissedCall(call, message);
    });
    setJackdawCallWarningHandler((_call, message) => showUserError(new Error(message), kCallEndedNoticeSeconds));
    stopJackdawCalls = startJackdawCalls();
  });
  onDestroy(() => stopJackdawCalls?.());

  /** Входящий звонок, когда окно Jackdaw не на переднем плане: всплывающее уведомление ОС.
   * Убирается, как только звонок принят, отклонён, отменён или принят на другом устройстве. */
  let notifiedCallIDs = new Set<string>();
  function notifyIncomingCall(call: JackdawCall) {
    notifiedCallIDs.add(call.callID);
    if (document.hasFocus()) {
      return;
    }
    let notification = new CallNotification(
      call.hasVideo ? gt`Incoming video call` : gt`Incoming audio call`,
      // Адрес показывается всегда: имя звонящий указывает о себе сам.
      call.remoteLabel,
      `call-${call.callID}`,
    );
    notification.onClick = () => bringAppToFront();
    let unsubscribe: (() => void) | null = null;
    unsubscribe = call.subscribe(() => {
      if (call.state != MeetingState.IncomingCall) {
        notification.close();
        unsubscribe?.();
      }
    });
    notification.show().catch(backgroundError);
  }

  /** Пропущенный звонок, пока окно не на переднем плане: сообщение в окне никто не увидит. */
  function notifyMissedCall(call: JackdawCall, message: string) {
    if (!call.missed || document.hasFocus()) {
      return;
    }
    let notification = new CallNotification(gt`Missed call`, message, `missed-call-${call.callID}`);
    notification.onClick = () => bringAppToFront();
    notification.show().catch(backgroundError);
  }

  /** Идущие звонки Jackdaw. Брошенный экран «Позвонить?» на сервере ничего не держит. */
  function liveJackdawCalls(): JackdawCall[] {
    return appGlobal.meetings.contents.filter((m): m is JackdawCall => m instanceof JackdawCall &&
      m.state != MeetingState.Ended && m.state != MeetingState.OutgoingCallConfirm);
  }

  /** Окно закрывают или приложение выходит во время разговора: сначала спрашиваем.
   * На десктопе вопрос задаёт основной процесс (`will-prevent-unload`), в браузере — сам браузер. */
  function confirmLeaveDuringCall(event: BeforeUnloadEvent) {
    if (liveJackdawCalls().some(call => call.state == MeetingState.Ongoing)) {
      event.preventDefault();
      // Electron отменяет закрытие по любому значению, кроме undefined.
      event.returnValue = false;
    }
  }

  /** Окно закрывается: собеседник сразу узнаёт о конце звонка, а не через минуту ожидания переподключения. */
  function hangupJackdawCalls() {
    // Входящий без ответа не отклоняем: отказ сбросил бы вызов и на других устройствах.
    // Сервер сам перестанет звонить сюда, когда соединение закроется.
    for (let call of liveJackdawCalls().filter(c => c.state != MeetingState.IncomingCall)) {
      // Сообщение уходит синхронно в начале `hangup()`, ждать завершения не нужно.
      call.hangup().catch(backgroundError);
    }
  }

  // HACK: Why are some ended meetings not removed? See `VideoConfMeeting.hangup()`
  // Константа, а не `$:`: от реактивных значений не зависит, а реактивная
  // версия могла вычисляться позже `meeting = $meetings.first` — тогда
  // `$meetings` был undefined и окно оставалось пустым при запуске.
  const meetings = appGlobal.meetings.filterObservable(m => m.state != MeetingState.Ended);

  /** When a call comes in or is placed, open the meet app,
   * which will then open the Calling screen. */
  $: meeting = $meetings.first;
  $: meeting instanceof JackdawCall && $meeting.state == MeetingState.IncomingCall &&
    !notifiedCallIDs.has(meeting.callID) && notifyIncomingCall(meeting);
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
