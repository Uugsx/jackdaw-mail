import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { JackdawCall, JackdawCallAccount, setJackdawCallEndedHandler } from "../../../../logic/Meet/Jackdaw/JackdawCall";
import { MeetingState } from "../../../../logic/Meet/VideoConfMeeting";
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
  addedCandidates: any[] = [];
  closed = false;
  onicecandidate: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(readonly configuration: any) {}
  addTransceiver(_kind: string, init: { direction: string }) {
    let transceiver = new FakeTransceiver(init.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() { return { type: "offer", sdp: "v=0\r\noffer" }; }
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
  async addIceCandidate(candidate: any) { this.addedCandidates.push(candidate); }
  close() { this.closed = true; this.connectionState = "closed"; }
  changeState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
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
    expect(endedMessages[0]).toContain("WebRTC disabled");
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

  test("установленное соединение: таймаут не срабатывает, обрыв — понятное сообщение", async () => {
    vi.useFakeTimers();
    let { call, connections } = makeCall();
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", iceServers: null });
    connections[0].changeState("connected");
    connections[0].changeState("disconnected");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.state).toBe(MeetingState.Ongoing);
    connections[0].changeState("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages).toEqual([endReasonMessage("connection-lost", false)]);
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
