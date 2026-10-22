<hbox class="actions">
  {#if isSidebar}
    <RoundButton
      label={$t`Go back to meeting`}
      classes="back-to-meet"
      onClick={() => openApp(meetApp, { meeting })}
      icon={OpenToLeftIcon}
      iconSize="16px"
      border={false}
      />
    <hbox flex />
  {:else if meeting.account.canScreenShare}
    <RoundButton
      label={$t`Screen share`}
      classes="screen-share large"
      selected={$me?.screenSharing || wantScreenShare}
      onClick={toggleScreenShare}
      icon={$me?.screenSharing ? ScreenShareIcon : ScreenShareOffIcon}
      iconSize="24px"
      border={false}
      />
    <SelectScreenShare bind:this={selectScreenShare} />
  {/if}
  {#if meeting.account.canVideo && ($meeting.hasVideo || $meeting.canAddVideo)}
    <DeviceButton video={true} {devices}
      on={$me?.cameraOn}
      selectedID={$selectedCameraSetting.value}
      on:changeOn={event => catchErrors(() => changeCameraOn(event.detail))}
      on:changeDevice={event => catchErrors(() => changeCameraSelected(event.detail))}
      stream={$stream.cameraMicStream}
      />
  {/if}
  {#if meeting.account.canAudio}
    <DeviceButton video={false} {devices}
      on={$me?.micOn}
      selectedID={$selectedMicSetting.value}
      on:changeOn={event => catchErrors(() => changeMicOn(event.detail))}
      on:changeDevice={event => catchErrors(() => changeMicSelected(event.detail))}
      stream={$stream.cameraMicStream}
      />
  {/if}
  {#if meeting instanceof PhoneCall}
    <RoundButton
      label={$t`Dial pad`}
      classes="dialpad large"
      onClick={() => $showDialPad = !$showDialPad}
      selected={$showDialPad}
      icon={DialPadIcon}
      iconSize="24px"
      border={false}
      />
  {/if}
  {#if !isSidebar}
    <hbox class="participants" flex>
      <Scroll>
        <ParticipantsList participants={participantsWithoutVideo} />
      </Scroll>
    </hbox>
    <RoundButton
      label={$t`Leave`}
      classes="leave large"
      onClick={leave}
      icon={LeaveIcon}
      iconSize="24px"
      border={false}
      />
    {#if meeting.canHandUp}
      <RoundButton
        label={$me?.handUp ? $t`Hand raised` : $t`Raise hand`}
        classes="hand large"
        selected={$me?.handUp}
        onClick={toggleHand}
        icon={$me?.handUp ? HandIcon : HandDownIcon}
        iconSize="24px"
        border={false}
        />
    {/if}
    {#if meeting.account.protocol == "fake-meeting"}
      <RoundButton
        label={$t`Add participant`}
        classes="large"
        onClick={() => meeting.addParticipant()}
        icon={AddIcon}
        iconSize="24px"
        border={false}
        />
      <RoundButton
        label={$t`Add participant`}
        classes="large"
        onClick={() => meeting.removeParticipant()}
        icon={RemoveIcon}
        iconSize="24px"
        border={false}
        />
    {/if}
    {#if selectedView != View.Phone}
      <RoundButton
        label={`Change view of participant videos`}
        classes="view-selector large"
        onClick={onShowViewSelector}
        selected={showViewSelector}
        icon={viewSelectorIcon}
        iconSize="24px"
        border={false}
        />
    {/if}
    <hbox bind:this={popupAnchor} />
    <hbox class="sidebar-button">
      <RoundButton
        label={showSidebar ? $t`Close participants list` : $t`Open participants list`}
        classes="sidebar large"
        onClick={() => showSidebar = !showSidebar}
        icon={showSidebar ? CloseSidebarIcon : OpenSidebarIcon}
        iconSize="24px"
        border={false}
        />
      {#if !showSidebar}
        <hbox class="participants-count">
          {$participants.length}
        </hbox>
      {/if}
    </hbox>
  {/if}
</hbox>

<Popup bind:popupOpen={showViewSelector} {popupAnchor} placement="top-end" boundaryElSel=".main">
  <ViewSelectorPopup bind:show={showViewSelector} videoCount={meeting.videos?.length ?? 0} />
</Popup>

<script lang="ts">
  import type { VideoConfMeeting } from "../../logic/Meet/VideoConfMeeting";
  import { PhoneCall } from "../../logic/Meet/PhoneCall";
  import { JackdawCall } from "../../logic/Meet/Jackdaw/JackdawCall";
  import { meetApp } from "./MeetJackdawApp";
  import { selectedCameraSetting, selectedMicSetting, cameraOnSetting, micOnSetting } from "./Setup/selectedDevices";
  import { showDialPad } from "./uiState";
  import { openApp } from "../AppsBar/selectedApp";
  import ParticipantsList from "./ParticipantsList/ParticipantsList.svelte";
  import DeviceButton from "./Setup/DeviceButton.svelte";
  import SelectScreenShare from "./SelectScreenShare.svelte";
  import ViewSelectorPopup, { MeetVideoView as View } from "./View/ViewSelectorPopup.svelte";
  import Popup from "../Shared/Popup.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import Scroll from "../Shared/Scroll.svelte";
  import HandIcon from '../asset/icon/meet/hand.svg?raw';
  import HandDownIcon from "lucide-svelte/icons/grab";
  import ScreenShareIcon from "lucide-svelte/icons/screen-share-off";
  import ScreenShareOffIcon from "lucide-svelte/icons/screen-share";
  import LeaveIcon from "lucide-svelte/icons/phone";
  import OpenSidebarIcon from "lucide-svelte/icons/users-round";
  import OpenToLeftIcon from "lucide-svelte/icons/arrow-left-from-line";
  import CloseSidebarIcon from "lucide-svelte/icons/arrow-right-from-line";
  import ViewGallery2x2Icon from "lucide-svelte/icons/grid-2x2";
  import ViewThumbnailsRightIcon from "lucide-svelte/icons/panel-right";
  import ViewSpeakerOnlyIcon from "lucide-svelte/icons/square-user-round";
  import AddIcon from "lucide-svelte/icons/plus";
  import RemoveIcon from "lucide-svelte/icons/minus";
  import DialPadIcon from "lucide-svelte/icons/grip";
  import { getLocalStorage } from "../Util/LocalStorage";
  import { catchErrors, showError } from "../Util/error";
  import { gt, t } from "../../l10n/l10n";
  import { getOSName } from "../Util/util";
  import { onDestroy, tick } from "svelte";

  export let meeting: VideoConfMeeting;
  export let isSidebar = false;
  export let showSidebar = false; /* in/out */

  $: me = $meeting.myParticipant;
  $: stream = $meeting.mediaDeviceStreams;
  $: participants = meeting.participants;
  /* `$meetingVideos`: видео собеседника приходит позже, чем он сам, и без подписки на видео
     его имя так и оставалось в панели, будто у него нет камеры */
  $: meetingVideos = meeting.videos;
  $: participantsWithoutVideo = selectedView == View.SpeakerOnly ? participants :
      $participants.filter(p => !$meetingVideos.find(video =>
        video.hasVideo && !video.isScreenShare && video.participant == p));

  let meInited = false;
  $: me && stream && catchErrors(() => meInit())
  async function meInit() {
    if (meInited) {
      return;
    }
    meInited = true;
    // Аудиозвонок не включает камеру, даже если она включена по умолчанию.
    // Видеозвонок Jackdaw выбран явно кнопкой «Видеозвонок»: камера включается сразу.
    let cameraOn = meeting.hasVideo && (cameraOnSetting.value || meeting instanceof JackdawCall);
    // Голосовой звонок всегда начинается со включённым микрофоном: «выключен» из прошлого
    // разговора легко не заметить, и собеседник не услышит ни слова.
    let micOn = meeting.voiceOnly || micOnSetting.value;
    try {
      await stream.setCameraMicOn(cameraOn, micOn, selectedCameraSetting.value, selectedMicSetting.value);
      me.cameraOn = cameraOn;
      me.micOn = micOn;
    } catch (ex) {
      // Кнопки показывают то, что действительно включено.
      me.cameraOn = false;
      me.micOn = false;
      await getDevices();
      throw micStartError(ex);
    }
    await getDevices();
  }

  /** Доступ к микрофону запрещён в системе: объясняем, где его разрешить. */
  function micStartError(ex: Error): Error {
    let denied = ex?.name == "NotAllowedError" || ex?.name == "SecurityError" ||
      ex?.message == gt`Microphone access denied`;
    if (!denied) {
      return ex;
    }
    let os = getOSName();
    return new Error(
      os == "macintosh" ? gt`Jackdaw Mail has no access to the microphone. Allow it in System Settings → Privacy & Security → Microphone, then turn the microphone on again.` :
      os == "windows" ? gt`Jackdaw Mail has no access to the microphone. Allow it in Settings → Privacy → Microphone, then turn the microphone on again.` :
      gt`Jackdaw Mail has no access to the microphone. Allow microphone access in your system settings, then turn the microphone on again.`);
  }

  let devices: MediaDeviceInfo[];
  async function getDevices() {
    await tick();
    // Real device names appear only after the cam delivers an actual picture
    let allDevices = await navigator.mediaDevices.enumerateDevices();
    devices = allDevices.filter(d => !d.label.startsWith("Monitor of"));

    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
  }

  function onDeviceChange() {
    getDevices()
      .catch(showError);
  }

  onDestroy(() => {
    navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  });

  async function leave() {
    await meeting.hangup();
    await stream.setScreenShare(false);
    await stream.setCameraMicOn(false, false);
  }

  async function toggleHand() {
    me.handUp = !me.handUp;
  }

  async function changeMicOn(on: boolean) {
    // Состояние кнопки меняется только после того, как микрофон действительно включился или выключился.
    try {
      await stream.setMicOn(on, selectedMicSetting.value);
    } catch (ex) {
      throw micStartError(ex);
    }
    me.micOn = on;
    micOnSetting.value = me.micOn;
  }

  async function changeMicSelected(deviceID: string) {
    selectedMicSetting.value = deviceID;
    await stream.setMicOn(me.micOn, deviceID);
  }

  async function changeCameraOn(on: boolean) {
    me.cameraOn = on;
    cameraOnSetting.value = me.cameraOn;
    await stream.setCameraOn(me.cameraOn, selectedCameraSetting.value);
  }

  async function changeCameraSelected(deviceID: string) {
    selectedCameraSetting.value = deviceID;
    await stream.setCameraOn(me.cameraOn, deviceID);
  }

  let selectScreenShare: SelectScreenShare;
  let wantScreenShare = false;
  async function toggleScreenShare() {
    if (wantScreenShare) {
      return;
    }
    wantScreenShare = !me.screenSharing;
    if (wantScreenShare) {
      startScreenSharing()
        .catch(onScreenSharingError);
    } else {
      wantScreenShare = false;
      await stream.setScreenShare(false);
      me.screenSharing = false;
    }
  }

  async function startScreenSharing() {
    await selectScreenShare.openSelector(onScreenSharingError);
    await stream.setScreenShare(true);
    await selectScreenShare.closeSelector();
    wantScreenShare = false;
    me.screenSharing = true;
  }

  async function onScreenSharingError(ex: Error) {
    wantScreenShare = false;
    console.error(ex);
    await selectScreenShare.closeSelector();
    await stream.setScreenShare(false);
    me.screenSharing = false;
  }

  let showViewSelector = false;
  let popupAnchor: HTMLElement;
  let viewSetting = getLocalStorage("meet.videoView", View.GalleryAutoView);
  $: selectedView = meeting instanceof PhoneCall || $meeting.voiceOnly ? View.Phone : $viewSetting.value;
  $: viewSelectorIcon =
    selectedView == View.SpeakerOnly ? ViewSpeakerOnlyIcon :
    selectedView == View.Thumbnails ? ViewThumbnailsRightIcon :
    selectedView == View.Gallery3x3View ||
    selectedView == View.Gallery4x4View ||
    selectedView == View.Gallery5x5View ? ViewGallery2x2Icon :
    ViewGallery2x2Icon;

  function onShowViewSelector(event: Event) {
    showViewSelector = !showViewSelector;
  }

  $showDialPad = false; // Default off for a new call
</script>

<style>
  .actions {
    margin: 8px;
  }
  .actions :global(> *) {
    margin-inline-end: 8px;
  }
  .actions :global(button) {
    background-color: inherit;
    color: inherit;
  }
  .actions :global(.device-button button.button.border) {
    border: 2px solid transparent;
  }
  .participants {
    margin-block: -1px;
  }
  .actions :global(.leave svg) {
    margin-top: 3px;
    margin-bottom: -3px;
  }
  .actions :global(.leave svg) {
    transform: rotate(135deg);
  }
  .actions :global(.leave:hover) {
    background-color: #F34949;
  }
  .participants-count {
    align-items: center;
    margin-inline-start: -6px;
    min-width: 20px;
  }
  .sidebar-button:hover .participants-count {
    visibility: hidden;
  }
  .actions :global(.hand svg) {
    fill: none;
  }
  .actions :global(.hand.selected svg) {
    fill: tan;
  }
  .actions :global(.hand.selected) {
    background-color: var(--selected-bg);
    animation-name: color;
        animation-duration: 1s;
        animation-iteration-count: infinite;
        animation-direction: alternate-reverse;
        animation-timing-function: ease;
  }
  @keyframes color {
    to {
      background-color: #A3E5DD;
    }
  }
</style>
