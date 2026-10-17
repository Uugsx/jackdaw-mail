// Порядок важен: VideoConfMeeting раньше MeetAccount, иначе циклический импорт через appGlobal ломает наследование.
import { MeetingState, VideoConfMeeting } from "../VideoConfMeeting";
import { MeetAccount } from "../MeetAccount";
import { LocalMediaDeviceStreams } from "../LocalMediaDeviceStreams";
import { MeetingParticipant, ParticipantRole } from "../Participant";
import { VideoStream } from "../VideoStream";
import type { Person } from "../../Abstract/Person";
import type { JackdawCallClient, JackdawCallSignalTarget } from "./JackdawCallClient";
import { JackdawCallServiceError } from "./JackdawCallClient";
import {
  DEFAULT_ICE_SERVERS,
  endReasonMessage,
  type JackdawCallEndReason,
  type JackdawIceCandidate,
  type JackdawIceServer,
  type JackdawServerMessage,
} from "./JackdawCallProtocol";
import { notifyChangedProperty } from "../../util/Observable";
import { NotSupported, UserError, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** Сколько ждать соединения P2P после ответа на звонок. Дольше обычно значит, что NAT не пропускает. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Сколько звонить без ответа. Сервер сам завершает вызов через 45 с; этот запас — на случай,
 * если его сообщение потерялось вместе с соединением: экран вызова и рингтон не должны висеть вечно. */
const RING_TIMEOUT_MS = 50_000;

/** Звонки Jackdaw ↔ Jackdaw: только голос, 1:1. Медиа идёт напрямую между клиентами (P2P WebRTC),
 * сигналинг — через `JackdawCallClient`.
 * Аккаунт не сохраняется и не показывается в списке аккаунтов: он есть у каждого пользователя Pro. */
export class JackdawCallAccount extends MeetAccount {
  readonly protocol: string = "jackdaw-call";
  canVideo = false;
  canAudio = true;
  canScreenShare = false;
  canMultipleParticipants = false;
  canCreateURL = false;

  constructor(readonly client: JackdawCallClient) {
    super();
    this.name = "Jackdaw Mail";
  }

  newMeeting(): JackdawCall {
    return new JackdawCall(this);
  }

  isMeetingURL(_url: URL): boolean {
    return false;
  }

  // Лицензию проверяет сервис звонков при входе.
  needsLicense(): boolean {
    return false;
  }
  async login(): Promise<void> {
  }
  get isLoggedIn(): boolean {
    return true;
  }
}

/** Вызывается, когда звонок закончился не по нашему действию: занято, нет ответа и т.п. */
export let onJackdawCallEnded: (call: JackdawCall, message: string) => void = () => {};
export function setJackdawCallEndedHandler(handler: (call: JackdawCall, message: string) => void): void {
  onJackdawCallEnded = handler;
}

/** Предупреждение во время разговора, которое не завершает звонок: например, отключился микрофон. */
export let onJackdawCallWarning: (call: JackdawCall, message: string) => void = () => {};
export function setJackdawCallWarningHandler(handler: (call: JackdawCall, message: string) => void): void {
  onJackdawCallWarning = handler;
}

export class JackdawCall extends VideoConfMeeting implements JackdawCallSignalTarget {
  declare account: JackdawCallAccount;
  mediaDeviceStreams: LocalMediaDeviceStreams;
  callID: string = crypto.randomUUID();
  /** Адрес собеседника в Jackdaw */
  remoteEmail: string;
  outgoing = false;
  hasVideo = false;
  readonly voiceOnly = true;
  @notifyChangedProperty
  endReason: JackdawCallEndReason | null = null;
  /** Звонок уже закончен на сервере: при `hangup()` ничего не отправляем */
  protected remoteEnded = false;
  /** Ответ уже отправлен: повторное нажатие «Принять» не должно слать второй `accept` */
  protected answered = false;
  protected peerConnection: RTCPeerConnection | null = null;
  /** Аудиоканал соединения. У звонящего создаётся сразу, у вызываемого — из предложения SDP. */
  protected audioTransceiver: RTCRtpTransceiver | null = null;
  /** Кандидаты ICE, пришедшие до описания сессии собеседника */
  protected pendingCandidates: JackdawIceCandidate[] = [];
  protected connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Соединение P2P хотя бы раз установилось: для текста ошибки при обрыве */
  protected mediaConnected = false;
  /** Таймаут гудков у звонящего и вызова у вызываемого */
  protected ringTimer: ReturnType<typeof setTimeout> | null = null;
  /** Имя, которое звонящий указал о себе сам. Пусто, если собеседник есть в контактах. */
  protected statedName = "";
  /** Слушатель смены аудиоустройств во время разговора */
  protected deviceChangeListener: (() => void) | null = null;
  /** Идёт переключение на другой микрофон: повторные события не запускают второе */
  protected switchingMic = false;

  constructor(account: JackdawCallAccount) {
    super();
    this.account = account;
    this.id = this.callID;
    this.mediaDeviceStreams = new LocalMediaDeviceStreams();
    this.listenStreamChanges();
    // Интерфейс звонка включает микрофон по своему участнику, поэтому он нужен с самого начала.
    this.myParticipant = new MeetingParticipant();
    this.myParticipant.role = ParticipantRole.User;
  }

  protected get client(): JackdawCallClient {
    return this.account.client;
  }

  /** Готовит исходящий звонок. Звонить начнёт `call()` после подтверждения в интерфейсе.
   * Звонки Jackdaw — только голосовые, поэтому `_video` не используется. */
  prepareOutgoing(email: string, name: string, _video = false, person?: Person | null): void {
    this.outgoing = true;
    this.remoteEmail = email;
    this.title = name || email;
    this.addRemotePlaceholder(email, name, person);
    this.state = MeetingState.OutgoingCallConfirm;
  }

  /** Входящий звонок от сервиса. Видеозвонок от старой версии принимается как голосовой. */
  prepareIncoming(message: Extract<JackdawServerMessage, { type: "incoming" }>, person?: Person | null): void {
    this.outgoing = false;
    this.callID = message.callId;
    this.id = message.callId;
    this.remoteEmail = message.from;
    this.title = message.fromName || message.from;
    this.addRemotePlaceholder(message.from, message.fromName, person);
    this.statedName = person ? "" : message.fromName;
    this.client.register(this);
    this.state = MeetingState.IncomingCall;
    this.startRingTimer();
  }

  /** Имя звонящего не из контактов, а из его собственных настроек: им можно назваться кем угодно. */
  get remoteNameUnverified(): boolean {
    return !this.outgoing && !!this.statedName && this.statedName != this.remoteEmail && !this.remoteParticipant?.person;
  }

  /** Кто звонит — для уведомлений: имя (с пометкой, если его указал сам звонящий) и адрес. */
  get remoteLabel(): string {
    let name = this.remoteParticipant?.name || this.remoteEmail;
    if (this.remoteNameUnverified) {
      name = gt`${name} (unverified)`;
    }
    return name == this.remoteEmail ? name : `${name} · ${this.remoteEmail}`;
  }

  /** Входящий звонок закончился без ответа на этом устройстве: пропущенный. */
  get missed(): boolean {
    return !this.outgoing && !this.answered &&
      (this.endReason == "cancelled" || this.endReason == "no-answer" || this.endReason == "busy");
  }

  protected missedCallMessage(): string {
    return gt`Missed call from ${this.remoteLabel}`;
  }

  protected addRemotePlaceholder(email: string, name: string, person?: Person | null): void {
    let remote = new MeetingParticipant();
    remote.emailAddress = email;
    remote.name = person?.name || name || email;
    remote.role = ParticipantRole.Invited;
    if (person) {
      remote.person = person;
    }
    this.participants.add(remote);
  }

  protected get remoteParticipant(): MeetingParticipant | null {
    return this.participants.first ?? null;
  }

  async call(): Promise<void> {
    await super.call(); // → OutgoingCall
    this.client.register(this);
    try {
      this.client.send({ type: "invite", callId: this.callID, to: this.remoteEmail, video: false });
    } catch (ex) {
      this.client.unregister(this);
      await this.endLocally();
      throw ex;
    }
    this.startRingTimer();
  }

  async answer(): Promise<void> {
    if (this.state != MeetingState.IncomingCall || this.answered) {
      return;
    }
    this.answered = true;
    try {
      this.client.send({ type: "accept", callId: this.callID });
    } catch (ex) {
      // Ответ не ушёл: кнопка «Принять» должна снова работать.
      this.answered = false;
      throw ex;
    }
    // Дальше — `joined` и предложение SDP от звонящего в `onSignal()`.
  }

  onSignal(message: JackdawServerMessage): void {
    switch (message.type) {
      case "accepted":
        if (this.outgoing) {
          this.connectMedia(message.iceServers);
        }
        break;
      case "joined":
        if (!this.outgoing) {
          this.connectMedia(message.iceServers);
        }
        break;
      case "signal":
        this.runMediaStep(() => this.onMediaSignal(message));
        break;
      case "call-ended":
        this.remoteEnded = true;
        this.endReason = message.reason;
        this.reportEnd(this.missed ? this.missedCallMessage() : endReasonMessage(message.reason, this.outgoing));
        void this.endLocally();
        break;
      case "error":
        // Отклонённый сервером сигнал (например, лимит запросов) не значит, что звонок закончился.
        if (message.requestType == "signal" && message.code != "call_not_found") {
          break;
        }
        this.remoteEnded = true;
        this.reportEnd(new JackdawCallServiceError(message.code).message);
        void this.endLocally();
        break;
    }
  }

  protected reportEnd(message: string | null): void {
    if (message) {
      onJackdawCallEnded(this, message);
    }
  }

  /** Соединение с сервисом восстановилось. Вызов (гудки, входящий) после обрыва на сервере уже отменён,
   * а идущий разговор, которого сервер не вернул, там уже закончен: без этого экран звонка завис бы. */
  onReconnected(resumed: boolean): void {
    if (this.state == MeetingState.Ended) {
      return;
    }
    let ringing = this.state == MeetingState.OutgoingCall || this.state == MeetingState.IncomingCall;
    if (resumed && !ringing) {
      return;
    }
    this.remoteEnded = true;
    this.endReason = "connection-lost";
    this.reportEnd(endReasonMessage("connection-lost", this.outgoing));
    void this.endLocally();
  }

  protected startRingTimer(): void {
    this.clearRingTimer();
    this.ringTimer = setTimeout(() => this.ringTimedOut(), RING_TIMEOUT_MS);
  }

  protected clearRingTimer(): void {
    if (this.ringTimer != null) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }

  /** Сервер не сообщил о конце вызова вовремя: завершаем сами. */
  protected ringTimedOut(): void {
    this.ringTimer = null;
    if (this.state != MeetingState.OutgoingCall && this.state != MeetingState.IncomingCall) {
      return;
    }
    if (this.answered) {
      // Ответ ушёл, но разговор так и не начался.
      this.reportEnd(this.connectFailedMessage());
    } else {
      this.endReason = "no-answer";
      this.reportEnd(this.missed ? this.missedCallMessage() : endReasonMessage("no-answer", this.outgoing));
      if (!this.outgoing) {
        // Вызов на сервере уже завершён по его таймауту; отклонение сбросило бы звонок и на других устройствах.
        this.remoteEnded = true;
      }
    }
    void this.hangup();
  }

  protected connectFailedMessage(): string {
    return gt`Could not connect the call.` + " " + gt`Check your internet connection. A firewall or VPN may be blocking calls.`;
  }

  // --- медиа P2P ---------------------------------------------------------

  /** Для тестов: в Node нет WebRTC. */
  protected createPeerConnection(configuration: RTCConfiguration): RTCPeerConnection {
    return new RTCPeerConnection(configuration);
  }

  /** Звонок принят: разговор начался, соединение P2P устанавливается.
   * Звонящий создаёт предложение SDP, вызываемый ждёт его. */
  protected connectMedia(iceServers: JackdawIceServer[] | null): void {
    if (this.peerConnection || this.state == MeetingState.Ended) {
      return;
    }
    let peerConnection: RTCPeerConnection;
    try {
      peerConnection = this.createPeerConnection({
        iceServers: (iceServers ?? DEFAULT_ICE_SERVERS).map(server => ({ ...server })),
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
    } catch (ex) {
      this.failMedia(ex);
      return;
    }
    this.peerConnection = peerConnection;
    peerConnection.onicecandidate = event => this.sendCandidate(event.candidate);
    peerConnection.ontrack = event => this.addRemoteTrack(event.track);
    peerConnection.onconnectionstatechange = () => this.connectionStateChanged(peerConnection);
    this.clearRingTimer();
    this.watchDeviceChanges();
    this.connectTimer = setTimeout(() => {
      if (!this.mediaConnected) {
        this.failMedia(null);
      }
    }, CONNECT_TIMEOUT_MS);

    let remote = this.remoteParticipant;
    if (remote) {
      remote.role = ParticipantRole.User;
    }
    this.title = remote?.name || this.remoteEmail;
    this.state = MeetingState.Ongoing;
    this.startNow();

    if (this.outgoing) {
      this.audioTransceiver = peerConnection.addTransceiver("audio", { direction: "sendrecv" });
      this.runMediaStep(async () => {
        await this.attachLocalAudio();
        await peerConnection.setLocalDescription(await peerConnection.createOffer());
        this.sendSignal({ kind: "offer", sdp: peerConnection.localDescription?.sdp });
      });
    }
  }

  protected async onMediaSignal(message: Extract<JackdawServerMessage, { type: "signal" }>): Promise<void> {
    let peerConnection = this.peerConnection;
    if (!peerConnection) {
      return;
    }
    if (message.kind == "ice") {
      if (!message.candidate) {
        return;
      }
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(message.candidate);
      } else {
        this.pendingCandidates.push(message.candidate);
      }
      return;
    }
    // Предложение делает только звонящий, ответ — только вызываемый; остальное — повтор или чужой сигнал.
    if (message.kind == "offer" && !this.outgoing && !peerConnection.remoteDescription) {
      await peerConnection.setRemoteDescription({ type: "offer", sdp: message.sdp });
      this.audioTransceiver = peerConnection.getTransceivers().find(t => t.receiver.track?.kind == "audio") ?? null;
      if (this.audioTransceiver) {
        this.audioTransceiver.direction = "sendrecv";
      }
      await this.attachLocalAudio();
      await peerConnection.setLocalDescription(await peerConnection.createAnswer());
      this.sendSignal({ kind: "answer", sdp: peerConnection.localDescription?.sdp });
      await this.addPendingCandidates(peerConnection);
    } else if (message.kind == "answer" && this.outgoing && peerConnection.signalingState == "have-local-offer") {
      await peerConnection.setRemoteDescription({ type: "answer", sdp: message.sdp });
      await this.addPendingCandidates(peerConnection);
    }
  }

  protected async addPendingCandidates(peerConnection: RTCPeerConnection): Promise<void> {
    let candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (let candidate of candidates) {
      await peerConnection.addIceCandidate(candidate);
    }
  }

  protected sendCandidate(candidate: RTCIceCandidate | null): void {
    // Конец сбора кандидатов собеседнику не нужен: соединение устанавливается и без него.
    if (!candidate?.candidate) {
      return;
    }
    try {
      this.sendSignal({
        kind: "ice",
        candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex },
      });
    } catch {
      // Вызов из события WebRTC: исключение осталось бы неперехваченным. Без связи с сервисом
      // кандидат всё равно не доставить, а судьбу звонка решит переподключение (`onReconnected()`).
    }
  }

  protected sendSignal(signal: Record<string, unknown>): void {
    if (this.state == MeetingState.Ended) {
      return;
    }
    // Без соединения с сервисом ошибка всплывёт в runMediaStep() и завершит звонок.
    this.client.send({ type: "signal", callId: this.callID, ...signal });
  }

  /** Микрофон включает интерфейс звонка через `mediaDeviceStreams`; дорожка подменяется без пересогласования. */
  protected async attachLocalAudio(): Promise<void> {
    let sender = this.audioTransceiver?.sender;
    if (!sender || this.peerConnection?.connectionState == "closed") {
      return;
    }
    let track = this.mediaDeviceStreams.cameraMicStream?.getAudioTracks()[0] ?? null;
    if (sender.track != track) {
      await sender.replaceTrack(track);
    }
  }

  protected addRemoteTrack(track: MediaStreamTrack): void {
    if (track.kind != "audio" || this.videos.find(v => !v.isMe && v.stream.getTracks().includes(track))) {
      return;
    }
    let remote = this.remoteParticipant;
    if (remote) {
      remote.micOn = true;
    }
    // Поток без видео воспроизводится как звук (AudioPlayStreams в InMeeting.svelte).
    this.videos.add(new VideoStream(new MediaStream([track]), remote ?? undefined));
  }

  protected connectionStateChanged(peerConnection: RTCPeerConnection): void {
    if (peerConnection != this.peerConnection) {
      return;
    }
    if (peerConnection.connectionState == "connected") {
      if (!this.mediaConnected) {
        // Длительность разговора — с момента, когда собеседников стало слышно.
        this.startNow();
      }
      this.mediaConnected = true;
      this.clearConnectTimer();
    } else if (peerConnection.connectionState == "failed") {
      // `disconnected` бывает при смене сети и восстанавливается сам; `failed` — нет.
      this.failMedia(null);
    }
  }

  /** Ошибка в шаге установки соединения завершает звонок с понятным сообщением. */
  protected runMediaStep(step: () => Promise<void>): void {
    step().catch(ex => this.failMedia(ex));
  }

  protected failMedia(ex: unknown): void {
    if (this.state == MeetingState.Ended) {
      return;
    }
    if (this.mediaConnected) {
      this.reportEnd(endReasonMessage("connection-lost", this.outgoing));
    } else {
      // Технический текст WebRTC пользователю ничего не скажет: он остаётся в журнале.
      if (ex) {
        this.errorCallback(ex as Error);
      }
      this.reportEnd(this.connectFailedMessage());
    }
    void this.hangup();
  }

  protected clearConnectTimer(): void {
    if (this.connectTimer != null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  protected closeMedia(): void {
    this.clearConnectTimer();
    this.clearRingTimer();
    this.unwatchDeviceChanges();
    this.pendingCandidates = [];
    let peerConnection = this.peerConnection;
    this.peerConnection = null;
    this.audioTransceiver = null;
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    }
    let remoteStreams = this.videos.contents.filter(v => !v.isMe);
    for (let video of remoteStreams) {
      for (let track of video.stream.getTracks()) {
        track.stop();
      }
    }
    this.videos.removeAll(remoteStreams);
  }

  async startCameraMic(mediaStream: MediaStream): Promise<void> {
    await super.startCameraMic(mediaStream);
    for (let track of mediaStream.getAudioTracks()) {
      // Гарнитуру отключили: дорожка заканчивается навсегда, собеседник перестал бы нас слышать.
      track.addEventListener?.("ended", () => this.localAudioEnded(track));
    }
    await this.attachLocalAudio();
  }

  protected watchDeviceChanges(): void {
    let mediaDevices = globalThis.navigator?.mediaDevices;
    if (this.deviceChangeListener || !mediaDevices?.addEventListener) {
      return;
    }
    // Не каждая система завершает дорожку при отключении устройства: проверяем и по смене списка устройств.
    this.deviceChangeListener = () => {
      let track = this.mediaDeviceStreams.cameraMicStream?.getAudioTracks()[0];
      if (track?.readyState == "ended") {
        this.localAudioEnded(track);
      }
    };
    mediaDevices.addEventListener("devicechange", this.deviceChangeListener);
  }

  protected unwatchDeviceChanges(): void {
    if (this.deviceChangeListener) {
      globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", this.deviceChangeListener);
      this.deviceChangeListener = null;
    }
  }

  /** Микрофон пропал посреди разговора: переходим на системный микрофон по умолчанию.
   * Новая дорожка подменяется в соединении через `startCameraMic()` → `attachLocalAudio()`. */
  protected localAudioEnded(track: MediaStreamTrack): void {
    let current = this.mediaDeviceStreams.cameraMicStream?.getAudioTracks()[0];
    if (this.state == MeetingState.Ended || this.switchingMic || current != track) {
      return;
    }
    this.switchingMic = true;
    // Сначала закрываем мёртвую дорожку, затем открываем микрофон заново: пустой идентификатор — устройство по умолчанию.
    this.mediaDeviceStreams.setCameraMicOn(false, false)
      .then(() => this.mediaDeviceStreams.setCameraMicOn(false, true, undefined, ""))
      .then(() => onJackdawCallWarning(this, gt`The microphone was disconnected. Switched to the default microphone.`))
      .catch(async () => {
        if (this.myParticipant) {
          this.myParticipant.micOn = false;
        }
        await this.mediaDeviceStreams.setCameraMicOn(false, false).catch(() => {
          // Устройство уже освобождено.
        });
        onJackdawCallWarning(this, gt`The microphone was disconnected. Connect a microphone and turn it on again.`);
      })
      .finally(() => {
        this.switchingMic = false;
      });
  }

  async stopCameraMic(oldStream?: MediaStream): Promise<void> {
    await super.stopCameraMic(oldStream);
    await this.attachLocalAudio();
  }

  // --- запрещённые для этого вида звонка действия ----------------------

  async createNewConference(): Promise<void> {
    throw new NotSupported(gt`This call is started from the contact`);
  }

  async createInvitationURL(): Promise<URLString> {
    throw new NotSupported(gt`Cannot invite others using a link to this kind of meeting`);
  }

  async join(_url: URLString): Promise<void> {
    throw new NotSupported(gt`This call is started from the contact`);
  }

  async start(): Promise<void> {
    throw new UserError(gt`This call is started from the contact`);
  }

  // --- завершение ------------------------------------------------------

  async hangup(): Promise<void> {
    if (!this.remoteEnded) {
      // После `accept` звонок на сервере уже идёт: отклонять поздно, только завершать.
      let type = this.state == MeetingState.Ongoing || this.answered ? "hangup"
        : this.state == MeetingState.IncomingCall ? "reject"
        : this.state == MeetingState.OutgoingCall ? "cancel"
        : null;
      if (type) {
        try {
          this.client.send({ type, callId: this.callID });
        } catch {
          // Без соединения сервер завершит звонок сам по таймауту переподключения.
        }
      }
    }
    this.remoteEnded = true;
    await this.endLocally();
  }

  /** Отвечает «занято», не показывая звонок: пользователь уже в другой встрече. */
  rejectAsBusy(): void {
    this.clearRingTimer();
    try {
      this.client.send({ type: "reject", callId: this.callID, reason: "busy" });
    } catch {
      // Сервер завершит звонок по таймауту.
    }
    this.remoteEnded = true;
    this.client.unregister(this);
    // Звонок не показывали — но пользователь должен узнать, что ему звонили.
    this.endReason = "busy";
    this.reportEnd(this.missedCallMessage());
  }

  protected async endLocally(): Promise<void> {
    this.client.unregister(this);
    if (this.state == MeetingState.Ended) {
      return;
    }
    this.closeMedia();
    await super.hangup();
    // Микрофон не должен остаться включённым, когда собеседник положил трубку.
    await this.mediaDeviceStreams.setCameraMicOn(false, false).catch(() => {
      // Устройство уже освобождено или недоступно: звонок всё равно закончен.
    });
  }
}
