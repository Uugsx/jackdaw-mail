import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { JackdawCall, JackdawCallAccount, setJackdawCallEndedHandler } from "../../../../logic/Meet/Jackdaw/JackdawCall";
import { MeetingState, enterStartsCall } from "../../../../logic/Meet/VideoConfMeeting";
import { assertNoActiveCall, handleIncomingJackdawCall } from "../../../../logic/Meet/Jackdaw/JackdawCalls";
import { ParticipantRole } from "../../../../logic/Meet/Participant";
import { DEFAULT_ICE_SERVERS, endReasonMessage } from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import { appGlobal } from "../../../../logic/app";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { canStartCall, canStartVideoCall, startAudioCall, startVideoCall } from "../../../../logic/Meet/StartCall";
import { UserError } from "../../../../logic/util/util";

/** Подменяет клиент сигналинга: звонку нужны только register/unregister/send. */
class FakeClient {
  sent: any[] = [];
  registered = new Set<string>();
  online = true;
  register(call: JackdawCall) { this.registered.add(call.callID); }
  unregister(call: JackdawCall) { this.registered.delete(call.callID); }
  send(message: any) {
    if (!this.online) throw new Error("offline");
    this.sent.push(message);
  }
  last() { return this.sent[this.sent.length - 1]; }
  signals(kind?: string) { return this.sent.filter(m => m.type == "signal" && (!kind || m.kind == kind)); }
}

/** В Node нет WebRTC: минимальные заменители дорожек, потоков и соединения. */
class FakeTrack {
  stopped = false;
  enabled = true;
  constructor(readonly kind = "audio") {}
  stop() { this.stopped = true; }
  getSettings() { return { deviceId: "mic-1" }; }
}

class FakeMediaStream {
  readonly id = crypto.randomUUID();
  protected tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(t => t.kind == "audio"); }
  getVideoTracks() { return this.tracks.filter(t => t.kind == "video"); }
  addTrack(track: FakeTrack) { this.tracks.push(track); }
}

class FakeTransceiver {
  sender = { track: null as FakeTrack | null, async replaceTrack(track: FakeTrack | null) { this.track = track; } };
  receiver = { track: new FakeTrack("audio") };
  constructor(public direction: string) {}
}

class FakePeerConnection {
  transceivers: FakeTransceiver[] = [];
  localDescription: any = null;
  remoteDescription: any = null;
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  offerOptions: any[] = [];
  failCandidates = false;
  addedCandidates: any[] = [];
  closed = false;
  onicecandidate: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  constructor(readonly configuration: any) {}
  addTransceiver(_kind: string, init: { direction: string }) {
    let transceiver = new FakeTransceiver(init.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer(options?: any) {
    this.offerOptions.push(options);
    return { type: "offer", sdp: options?.iceRestart ? `v=0\r\nrestart-${this.offerOptions.length}` : "v=0\r\noffer" };
  }
  async createAnswer() { return { type: "answer", sdp: "v=0\r\nanswer" }; }
  async setLocalDescription(description: any) {
    this.localDescription = description;
    this.signalingState = description.type == "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description: any) {
    this.remoteDescription = description;
    if (description.type == "offer") {
      this.signalingState = "have-remote-offer";
      this.transceivers.push(new FakeTransceiver("recvonly"));
    } else {
      this.signalingState = "stable";
    }
  }
  async addIceCandidate(candidate: any) {
    if (this.failCandidates) throw new Error("Unknown ufrag");
    this.addedCandidates.push(candidate);
  }
  close() { this.closed = true; this.connectionState = "closed"; }
  changeState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  changeIceState(state: string) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function makeCall() {
  let client = new FakeClient();
  let account = new JackdawCallAccount(client as any);
  let call = account.newMeeting();
  let connections: FakePeerConnection[] = [];
  (call as any).createPeerConnection = (configuration: any) => {
    let connection = new FakePeerConnection(configuration);
    connections.push(connection);
    return connection;
  };
  appGlobal.meetings.add(call);
  return { call, client, connections };
}

const incoming = {
  type: "incoming" as const,
  callId: "call-0001",
  from: "bob@example.com",
  to: "alice@example.com",
  fromName: "Bob",
  video: false,
};

const candidate = { candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 };

describe("звонок Jackdaw ↔ Jackdaw", () => {
  let endedMessages: string[];
  let originalMediaStream: unknown;

  beforeAll(() => {
    originalMediaStream = (globalThis as any).MediaStream;
    (globalThis as any).MediaStream = FakeMediaStream;
  });

  afterAll(() => {
    (globalThis as any).MediaStream = originalMediaStream;
  });

  beforeEach(() => {
    endedMessages = [];
    setJackdawCallEndedHandler((_call, message) => endedMessages.push(message));
  });

  afterEach(() => {
    vi.useRealTimers();
    appGlobal.meetings.clear();
  });

  test("только голос: видео недоступно даже по запросу", () => {
    let { call } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", true);
    expect(call.hasVideo).toBe(false);
    expect(call.voiceOnly).toBe(true);
    expect(call.account.canVideo).toBe(false);
    expect(call.account.canScreenShare).toBe(false);
    expect(call.account.canAudio).toBe(true);
    expect(call.myParticipant).toBeTruthy();
  });

  test("исходящий: подтверждение → вызов → ответ → предложение SDP → разговор", async () => {
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", true);
    expect(call.state).toBe(MeetingState.OutgoingCallConfirm);
    expect(call.participants.first.emailAddress).toBe("bob@example.com");
    expect(client.sent).toHaveLength(0);

    await call.call();
    expect(call.state).toBe(MeetingState.OutgoingCall);
    expect(client.last()).toEqual({ type: "invite", callId: call.callID, to: "bob@example.com", video: false });
    expect(client.registered.has(call.callID)).toBe(true);

    call.onSignal({ type: "ringing", callId: call.callID });
    call.onSignal({ type: "joined", callId: call.callID, iceServers: null });
    expect(connections).toHaveLength(0);
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    expect(connections).toHaveLength(1);
    expect(call.state).toBe(MeetingState.Ongoing);
    expect(call.started).toBeInstanceOf(Date);
    expect(call.participants.first.role).toBe(ParticipantRole.User);
    let connection = connections[0];
    expect(connection.configuration.iceServers).toEqual(DEFAULT_ICE_SERVERS);
    expect(connection.transceivers.map(t => t.direction)).toEqual(["sendrecv"]);
    await flush();
    expect(client.signals("offer")).toEqual([{ type: "signal", callId: call.callID, kind: "offer", sdp: "v=0\r\noffer" }]);

    // Кандидат до ответа ждёт описания сессии собеседника.
    call.onSignal({ type: "signal", callId: call.callID, kind: "ice", candidate });
    await flush();
    expect(connection.addedCandidates).toEqual([]);
    call.onSignal({ type: "signal", callId: call.callID, kind: "answer", sdp: "v=0\r\nanswer" });
    await flush();
    expect(connection.remoteDescription).toEqual({ type: "answer", sdp: "v=0\r\nanswer" });
    expect(connection.addedCandidates).toEqual([candidate]);
    // Чужое предложение звонящему и повторный ответ игнорируются.
    call.onSignal({ type: "signal", callId: call.callID, kind: "offer", sdp: "v=0\r\nevil" });
    call.onSignal({ type: "signal", callId: call.callID, kind: "answer", sdp: "v=0\r\nagain" });
    await flush();
    expect(connection.remoteDescription.sdp).toBe("v=0\r\nanswer");
    expect(call.state).toBe(MeetingState.Ongoing);

    // Свои кандидаты уходят собеседнику; конец сбора — нет.
    connection.onicecandidate({ candidate: { ...candidate } });
    connection.onicecandidate({ candidate: null });
    expect(client.signals("ice")).toEqual([{ type: "signal", callId: call.callID, kind: "ice", candidate }]);
  });

  test("микрофон подключается к соединению и меняется без пересогласования", async () => {
    let { call, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    let mic = new FakeTrack("audio");
    call.mediaDeviceStreams.cameraMicStream = new FakeMediaStream([mic]) as any;
    await flush();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await flush();
    let sender = connections[0].transceivers[0].sender;
    expect(sender.track).toBe(mic);
    let otherMic = new FakeTrack("audio");
    call.mediaDeviceStreams.cameraMicStream = new FakeMediaStream([otherMic]) as any;
    await flush();
    expect(sender.track).toBe(otherMic);
    expect(call.selfVideo?.isMe).toBe(true);
  });

  test("занято: звонок завершается, пользователь видит причину", async () => {
    let { call, client } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "call-ended", callId: call.callID, reason: "busy" });
    await Promise.resolve();
    expect(call.state).toBe(MeetingState.Ended);
    expect(call.endReason).toBe("busy");
    expect(endedMessages).toHaveLength(1);
    expect(appGlobal.meetings.contents).not.toContain(call);
    expect(client.registered.size).toBe(0);
    // Сервер уже завершил звонок — повторно ничего не отправляем.
    let count = client.sent.length;
    await call.hangup();
    expect(client.sent).toHaveLength(count);
  });

  test("нет ответа и отказ сообщаются звонящему", async () => {
    for (let reason of ["no-answer", "declined", "offline"] as const) {
      let { call } = makeCall();
      call.prepareOutgoing("bob@example.com", "Bob", false);
      await call.call();
      call.onSignal({ type: "call-ended", callId: call.callID, reason });
    }
    expect(endedMessages).toHaveLength(3);
  });

  test("отмена до ответа отправляет cancel", async () => {
    let { call, client } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    await call.hangup();
    expect(client.last()).toEqual({ type: "cancel", callId: call.callID });
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(0);
  });

  test("отмена на экране подтверждения ничего не отправляет", async () => {
    let { call, client } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.hangup();
    expect(client.sent).toHaveLength(0);
  });

  test("нет соединения при вызове — звонок закрывается с ошибкой", async () => {
    let { call, client } = makeCall();
    client.online = false;
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await expect(call.call()).rejects.toThrow();
    expect(call.state).toBe(MeetingState.Ended);
    expect(client.registered.size).toBe(0);
  });

  test("входящий: принять один раз, ответить на предложение, услышать собеседника", async () => {
    let { call, client, connections } = makeCall();
    call.prepareIncoming({ ...incoming, video: true });
    expect(call.state).toBe(MeetingState.IncomingCall);
    expect(call.hasVideo).toBe(false);
    expect(call.callID).toBe("call-0001");
    expect(call.participants.first.name).toBe("Bob");
    await call.answer();
    await call.answer();
    expect(client.sent).toEqual([{ type: "accept", callId: "call-0001" }]);
    let iceServers = [{ urls: ["stun:stun.example.test:3478"] }];
    call.onSignal({ type: "accepted", callId: "call-0001", iceServers });
    expect(connections).toHaveLength(0);
    call.onSignal({ type: "joined", callId: "call-0001", iceServers });
    expect(call.state).toBe(MeetingState.Ongoing);
    let connection = connections[0];
    expect(connection.configuration.iceServers).toEqual(iceServers);
    // Вызываемый не создаёт своё предложение, а ждёт предложения звонящего.
    expect(connection.transceivers).toHaveLength(0);
    expect(client.signals()).toHaveLength(0);

    call.onSignal({ type: "signal", callId: "call-0001", kind: "ice", candidate });
    call.onSignal({ type: "signal", callId: "call-0001", kind: "ice", candidate: null });
    call.onSignal({ type: "signal", callId: "call-0001", kind: "offer", sdp: "v=0\r\noffer" });
    await flush();
    expect(connection.transceivers[0].direction).toBe("sendrecv");
    expect(client.signals("answer")).toEqual([{ type: "signal", callId: "call-0001", kind: "answer", sdp: "v=0\r\nanswer" }]);
    expect(connection.addedCandidates).toEqual([candidate]);

    let remoteTrack = new FakeTrack("audio");
    connection.ontrack({ track: remoteTrack });
    connection.ontrack({ track: remoteTrack });
    connection.ontrack({ track: new FakeTrack("video") });
    let remoteAudio = call.videos.contents.filter(v => !v.isMe);
    expect(remoteAudio).toHaveLength(1);
    expect(remoteAudio[0].hasVideo).toBe(false);
    expect(remoteAudio[0].participant).toBe(call.participants.first);
    expect(call.participants.first.micOn).toBe(true);
    connection.changeState("connected");

    await call.hangup();
    expect(client.last()).toEqual({ type: "hangup", callId: "call-0001" });
    expect(connection.closed).toBe(true);
    expect(remoteTrack.stopped).toBe(true);
    expect(call.videos.contents.filter(v => !v.isMe)).toHaveLength(0);
    expect(endedMessages).toHaveLength(0);
  });

  test("входящий: отклонить", async () => {
    let { call, client } = makeCall();
    call.prepareIncoming(incoming);
    await call.hangup();
    expect(client.last()).toEqual({ type: "reject", callId: "call-0001" });
  });

  test("входящий отменён звонящим — пропущенный звонок", () => {
    let { call } = makeCall();
    call.prepareIncoming(incoming);
    call.onSignal({ type: "call-ended", callId: "call-0001", reason: "cancelled" });
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(1);
  });

  test("принят на другом устройстве — без сообщения", () => {
    let { call } = makeCall();
    call.prepareIncoming(incoming);
    call.onSignal({ type: "call-ended", callId: "call-0001", reason: "answered-elsewhere" });
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(0);
  });

  test("занят другой встречей — отвечаем busy", () => {
    let { call, client } = makeCall();
    call.prepareIncoming(incoming);
    call.rejectAsBusy();
    expect(client.last()).toEqual({ type: "reject", callId: "call-0001", reason: "busy" });
    expect(client.registered.size).toBe(0);
  });

  test("WebRTC недоступен — звонок завершается, сервер узнаёт о завершении", async () => {
    let { call, client } = makeCall();
    (call as any).createPeerConnection = () => { throw new Error("WebRTC disabled"); };
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    await flush();
    expect(call.state).toBe(MeetingState.Ended);
    // Технический текст WebRTC пользователю не показывается — только понятная причина.
    expect(endedMessages[0]).not.toContain("WebRTC disabled");
    expect(endedMessages[0]).toContain("Could not connect the call.");
    expect(endedMessages[0]).toContain("firewall");
    // Звонок уже принят на сервере: отклонять поздно, только завершать.
    expect(client.last()).toEqual({ type: "hangup", callId: "call-0001" });
  });

  test("соединение P2P не установилось — звонок завершается с ошибкой", async () => {
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    connections[0].changeState("failed");
    await flush();
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(1);
    expect(client.last()).toEqual({ type: "hangup", callId: call.callID });
    expect(connections[0].closed).toBe(true);
  });

  test("нет соединения за отведённое время — звонок завершается", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    connections[0].changeState("connecting");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(call.state).toBe(MeetingState.Ongoing);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(1);
  });

  test("установленное соединение: таймаут не срабатывает, обрыв без восстановления — понятное сообщение", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    connections[0].changeState("connected");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.state).toBe(MeetingState.Ongoing);
    expect(call.reconnecting).toBe(false);
    // `failed` в разговоре не завершает звонок сразу: связь ещё может вернуться.
    connections[0].changeState("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(call.state).toBe(MeetingState.Ongoing);
    expect(call.reconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(call.state).toBe(MeetingState.Ended);
    expect(call.reconnecting).toBe(false);
    expect(endedMessages).toEqual([endReasonMessage("connection-lost", false)]);
  });

  test("смена сети у звонящего: «Переподключение…», перезапуск ICE, разговор продолжается", async () => {
    vi.useFakeTimers();
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await vi.advanceTimersByTimeAsync(0);
    call.onSignal({ type: "signal", callId: call.callID, kind: "answer", sdp: "v=0\r\nanswer" });
    await vi.advanceTimersByTimeAsync(0);
    let connection = connections[0];
    connection.changeState("connected");
    connection.changeIceState("connected");
    let started = call.started;

    connection.changeIceState("disconnected");
    connection.changeState("disconnected");
    expect(call.reconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // Новое предложение с перезапуском ICE уходит через обычный сигнал.
    expect(connection.offerOptions.at(-1)).toEqual({ iceRestart: true });
    expect(client.signals("offer").at(-1)).toEqual({ type: "signal", callId: call.callID, kind: "offer", sdp: "v=0\r\nrestart-2" });
    expect(client.signals("offer")).toHaveLength(2);

    // Ответа нет — через несколько секунд следующая попытка.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(client.signals("offer")).toHaveLength(3);
    call.onSignal({ type: "signal", callId: call.callID, kind: "answer", sdp: "v=0\r\nanswer-restart" });
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.remoteDescription.sdp).toBe("v=0\r\nanswer-restart");
    // Запоздавший кандидат прежнего сеанса ICE не обрывает разговор.
    connection.failCandidates = true;
    call.onSignal({ type: "signal", callId: call.callID, kind: "ice", candidate });
    await vi.advanceTimersByTimeAsync(0);
    connection.failCandidates = false;

    connection.changeIceState("connected");
    connection.changeState("connected");
    expect(call.reconnecting).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.state).toBe(MeetingState.Ongoing);
    // Перезапуски прекратились, длительность разговора не сбросилась.
    expect(client.signals("offer")).toHaveLength(3);
    expect(call.started).toBe(started);
    expect(endedMessages).toEqual([]);
  });

  test("вызываемый при обрыве ждёт новое предложение звонящего и отвечает на него", async () => {
    vi.useFakeTimers();
    let { call, client, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    call.onSignal({ type: "signal", callId: "call-0001", kind: "offer", sdp: "v=0\r\noffer" });
    await vi.advanceTimersByTimeAsync(0);
    let connection = connections[0];
    connection.changeState("connected");
    expect(client.signals("answer")).toHaveLength(1);

    // Повтор первого предложения не пересогласует соединение.
    call.onSignal({ type: "signal", callId: "call-0001", kind: "offer", sdp: "v=0\r\noffer" });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.signals("answer")).toHaveLength(1);

    connection.changeIceState("disconnected");
    expect(call.reconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    // Вызываемый сам предложений не делает: встречных перезапусков не бывает.
    expect(client.signals("offer")).toHaveLength(0);
    // Новое предложение и кандидат за ним применяются по порядку.
    call.onSignal({ type: "signal", callId: "call-0001", kind: "offer", sdp: "v=0\r\nrestart" });
    call.onSignal({ type: "signal", callId: "call-0001", kind: "ice", candidate });
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.remoteDescription).toEqual({ type: "offer", sdp: "v=0\r\nrestart" });
    expect(client.signals("answer")).toHaveLength(2);
    expect(connection.addedCandidates.at(-1)).toEqual(candidate);
    connection.changeIceState("connected");
    expect(call.reconnecting).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.state).toBe(MeetingState.Ongoing);
  });

  test("перезапуск ICE без связи с сервисом не завершает звонок, после переподключения повторяется сразу", async () => {
    vi.useFakeTimers();
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await vi.advanceTimersByTimeAsync(0);
    call.onSignal({ type: "signal", callId: call.callID, kind: "answer", sdp: "v=0\r\nanswer" });
    await vi.advanceTimersByTimeAsync(0);
    connections[0].changeState("connected");
    client.online = false;
    connections[0].changeIceState("disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(call.state).toBe(MeetingState.Ongoing);
    expect(client.signals("offer")).toHaveLength(1);
    client.online = true;
    call.onReconnected(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.signals("offer")).toHaveLength(2);
    expect(call.state).toBe(MeetingState.Ongoing);
  });

  test("обрыв до первого соединения перезапуск не запускает: действует таймаут соединения", async () => {
    vi.useFakeTimers();
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await vi.advanceTimersByTimeAsync(0);
    connections[0].changeIceState("disconnected");
    expect(call.reconnecting).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.signals("offer")).toHaveLength(1);
  });

  test("серверы ICE: свой список сервиса, к одному TURN добавляются публичные STUN", () => {
    let turn = { urls: ["turn:turn.example.com:3478?transport=udp"], username: "1760000000:abc", credential: "secret" };
    let stun = { urls: ["stun:stun.example.com:3478"] };
    let first = makeCall();
    first.call.prepareOutgoing("bob@example.com", "Bob", false);
    first.call.state = MeetingState.OutgoingCall;
    first.call.onSignal({ type: "accepted", callId: first.call.callID, iceServers: [stun, turn] });
    expect(first.connections[0].configuration.iceServers).toEqual([stun, turn]);
    let second = makeCall();
    second.call.prepareOutgoing("bob@example.com", "Bob", false);
    second.call.state = MeetingState.OutgoingCall;
    second.call.onSignal({ type: "accepted", callId: second.call.callID, iceServers: [turn] });
    expect(second.connections[0].configuration.iceServers).toEqual([...DEFAULT_ICE_SERVERS, turn]);
  });

  test("после завершения звонка обработчики соединения сняты, переподключение не висит", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    connections[0].changeState("connected");
    connections[0].changeIceState("disconnected");
    expect(call.reconnecting).toBe(true);
    await call.hangup();
    expect(call.reconnecting).toBe(false);
    expect(connections[0].oniceconnectionstatechange).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endedMessages).toEqual([]);
  });

  test("отклонённый сервером сигнал не завершает звонок, потерянный звонок — завершает", async () => {
    let { call } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    let error = { type: "error" as const, message: "", requestType: "signal", callId: call.callID, requestId: null, email: null, messageId: null, blobId: null };
    call.onSignal({ ...error, code: "rate_limited" });
    expect(call.state).toBe(MeetingState.Ongoing);
    call.onSignal({ ...error, code: "call_not_found" });
    await flush();
    expect(call.state).toBe(MeetingState.Ended);
  });

  test("нет связи с сервисом при отправке предложения — звонок завершается", async () => {
    let { call, client } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    client.online = false;
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await flush();
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toHaveLength(1);
  });

  test("переподключение: вызов без ответа завершается, сервер его уже отменил", async () => {
    let outgoing = makeCall();
    outgoing.call.prepareOutgoing("bob@example.com", "Bob", false);
    await outgoing.call.call();
    let incomingCall = makeCall();
    incomingCall.call.prepareIncoming(incoming);
    let count = outgoing.client.sent.length;

    outgoing.call.onReconnected(false);
    incomingCall.call.onReconnected(false);
    await flush();
    for (let { call, client } of [outgoing, incomingCall]) {
      expect(call.state).toBe(MeetingState.Ended);
      expect(call.endReason).toBe("connection-lost");
      expect(client.registered.size).toBe(0);
    }
    expect(endedMessages).toEqual([
      endReasonMessage("connection-lost", true),
      endReasonMessage("connection-lost", false),
    ]);
    // Звонка на сервере уже нет: отмену не отправляем.
    expect(outgoing.client.sent).toHaveLength(count);
  });

  test("переподключение: возвращённый сервером разговор продолжается, потерянный — завершается", async () => {
    let resumed = makeCall();
    resumed.call.prepareIncoming(incoming);
    await resumed.call.answer();
    resumed.call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    resumed.call.onReconnected(true);
    expect(resumed.call.state).toBe(MeetingState.Ongoing);

    let lost = makeCall();
    lost.call.prepareOutgoing("bob@example.com", "Bob", false);
    await lost.call.call();
    lost.call.onSignal({ type: "accepted", callId: lost.call.callID, iceServers: null });
    lost.call.onReconnected(false);
    await flush();
    expect(lost.call.state).toBe(MeetingState.Ended);
    expect(lost.connections[0].closed).toBe(true);
    expect(endedMessages).toEqual([endReasonMessage("connection-lost", true)]);
    await resumed.call.hangup();
  });

  test("гудки без ответа: клиент сам завершает вызов, если сервер промолчал", async () => {
    vi.useFakeTimers();
    let { call, client } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(call.state).toBe(MeetingState.OutgoingCall);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call.state).toBe(MeetingState.Ended);
    expect(call.endReason).toBe("no-answer");
    expect(client.last()).toEqual({ type: "cancel", callId: call.callID });
    expect(endedMessages).toEqual([endReasonMessage("no-answer", true)]);
  });

  test("входящий без ответа: экран закрывается, звонок пропущен, отказ не отправляется", async () => {
    vi.useFakeTimers();
    let { call, client } = makeCall();
    call.prepareIncoming(incoming);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(call.state).toBe(MeetingState.Ended);
    expect(call.missed).toBe(true);
    // Отказ сбросил бы вызов и на других устройствах.
    expect(client.sent).toHaveLength(0);
    expect(endedMessages).toHaveLength(1);
    expect(endedMessages[0]).toContain("bob@example.com");
  });

  test("принятый звонок: таймер гудков не срабатывает", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    connections[0].changeState("connected");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(call.state).toBe(MeetingState.Ongoing);
    await call.hangup();
  });

  test("ответ не ушёл — «Принять» можно нажать снова", async () => {
    let { call, client } = makeCall();
    call.prepareIncoming(incoming);
    client.online = false;
    await expect(call.answer()).rejects.toThrow();
    expect(call.state).toBe(MeetingState.IncomingCall);
    client.online = true;
    await call.answer();
    expect(client.sent).toEqual([{ type: "accept", callId: "call-0001" }]);
    await call.hangup();
  });

  test("кандидат ICE без связи с сервисом не даёт неперехваченной ошибки", async () => {
    let { call, client, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await flush();
    client.online = false;
    expect(() => connections[0].onicecandidate({ candidate: { ...candidate } })).not.toThrow();
    expect(call.state).toBe(MeetingState.Ongoing);
    await call.hangup();
  });

  test("время разговора отсчитывается с установления соединения", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", false);
    await call.call();
    call.onSignal({ type: "accepted", callId: call.callID, iceServers: null });
    await vi.advanceTimersByTimeAsync(5_000);
    connections[0].changeState("connected");
    expect(call.started.getTime()).toBe(Date.now());
    await call.hangup();
  });

  test("имя звонящего не из контактов помечено, адрес показан всегда", () => {
    let { call } = makeCall();
    call.prepareIncoming({ ...incoming, fromName: "Bank Support" });
    expect(call.remoteNameUnverified).toBe(true);
    expect(call.remoteLabel).toContain("Bank Support");
    expect(call.remoteLabel).toContain("(unverified)");
    expect(call.remoteLabel).toContain("bob@example.com");

    let { call: noName } = makeCall();
    noName.prepareIncoming({ ...incoming, fromName: "" });
    expect(noName.remoteNameUnverified).toBe(false);
    expect(noName.remoteLabel).toBe("bob@example.com");
  });

  test("комнату нельзя создать в обход сервиса звонков", async () => {
    let { call } = makeCall();
    await expect(call.start()).rejects.toBeInstanceOf(UserError);
    await expect(call.createInvitationURL()).rejects.toThrow();
    await expect(call.createNewConference()).rejects.toThrow();
    expect(call.account.isMeetingURL(new URL("https://example.com/#room=x"))).toBe(false);
  });
});

describe("выбор способа звонка", () => {
  test("без сервиса звонков и WhatsApp кнопки скрыты", () => {
    expect(canStartCall(null)).toBe(false);
    expect(canStartCall(new PersonUID("bob@example.com", "Bob"))).toBe(false);
  });

  test("видеозвонок — только через WhatsApp", () => {
    expect(canStartVideoCall(null)).toBe(false);
    expect(canStartVideoCall(new PersonUID("bob@example.com", "Bob"))).toBe(false);
  });

  test("звонок недоступен — понятная ошибка вместо пустого экрана", async () => {
    let before = appGlobal.meetings.length;
    await expect(startVideoCall(new PersonUID("bob@example.com", "Bob"))).rejects.toBeInstanceOf(UserError);
    await expect(startAudioCall(new PersonUID("bob@example.com", "Bob"))).rejects.toBeInstanceOf(UserError);
    expect(appGlobal.meetings.length).toBe(before);
  });
});

describe("занятость и второй звонок", () => {
  let endedMessages: string[];

  beforeEach(() => {
    endedMessages = [];
    setJackdawCallEndedHandler((_call, message) => endedMessages.push(message));
  });

  afterEach(() => {
    appGlobal.meetings.clear();
  });

  test("брошенный экран «Позвонить?» не занятость: входящий показывается, экран закрывается", async () => {
    let { call: unconfirmed } = makeCall();
    unconfirmed.prepareOutgoing("carol@example.com", "Carol", false);
    let client = new FakeClient();
    let call = handleIncomingJackdawCall(incoming, new JackdawCallAccount(client as any));
    await flush();
    expect(client.sent).toHaveLength(0);
    expect(call.state).toBe(MeetingState.IncomingCall);
    expect(appGlobal.meetings.contents).toContain(call);
    expect(unconfirmed.state).toBe(MeetingState.Ended);
    expect(appGlobal.meetings.contents).not.toContain(unconfirmed);
    await call.hangup();
  });

  test("идёт разговор — входящий отклоняется как «занято» и виден как пропущенный", async () => {
    let { call: ongoing } = makeCall();
    ongoing.prepareOutgoing("carol@example.com", "Carol", false);
    await ongoing.call();
    let client = new FakeClient();
    let call = handleIncomingJackdawCall(incoming, new JackdawCallAccount(client as any));
    expect(client.last()).toEqual({ type: "reject", callId: "call-0001", reason: "busy" });
    expect(appGlobal.meetings.contents).not.toContain(call);
    expect(call.missed).toBe(true);
    expect(endedMessages).toHaveLength(1);
    expect(endedMessages[0]).toContain("bob@example.com");
    await ongoing.hangup();
  });

  test("второй звонок поверх идущего не начинается", async () => {
    let { call: ongoing } = makeCall();
    ongoing.prepareOutgoing("carol@example.com", "Carol", false);
    expect(() => assertNoActiveCall()).not.toThrow();
    await ongoing.call();
    expect(() => assertNoActiveCall()).toThrow(UserError);
    await expect(startAudioCall(new PersonUID("bob@example.com", "Bob"))).rejects.toThrow("Finish the current call");
    await ongoing.hangup();
    expect(() => assertNoActiveCall()).not.toThrow();
  });
});

describe("клавиша Enter на экране вызова", () => {
  test("не принимает входящий и ничего не делает во время гудков", () => {
    expect(enterStartsCall(MeetingState.IncomingCall)).toBe(false);
    expect(enterStartsCall(MeetingState.OutgoingCall)).toBe(false);
    expect(enterStartsCall(MeetingState.Ongoing)).toBe(false);
    expect(enterStartsCall(MeetingState.Ended)).toBe(false);
  });

  test("подтверждает исходящий звонок и вход во встречу", () => {
    expect(enterStartsCall(MeetingState.OutgoingCallConfirm)).toBe(true);
    expect(enterStartsCall(MeetingState.Init)).toBe(true);
    expect(enterStartsCall(MeetingState.JoinConference)).toBe(true);
  });
});
