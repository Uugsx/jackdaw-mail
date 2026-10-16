import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { JackdawCall, JackdawCallAccount, setJackdawCallEndedHandler } from "../../../../logic/Meet/Jackdaw/JackdawCall";
import { MeetingState } from "../../../../logic/Meet/VideoConfMeeting";
import { appGlobal } from "../../../../logic/app";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { canStartCall, startAudioCall, startVideoCall } from "../../../../logic/Meet/StartCall";
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
}

function makeCall() {
  let client = new FakeClient();
  let account = new JackdawCallAccount(client as any);
  let call = account.newMeeting();
  // Медиа LiveKit в unit-тесте не подключаем: проверяем только сигналинг.
  let joined: string[] = [];
  (call as any).joinRoom = async (token: string) => {
    joined.push(token);
    call.state = MeetingState.Ongoing;
  };
  appGlobal.meetings.add(call);
  return { call, client, joined };
}

const incoming = {
  type: "incoming" as const,
  callId: "call-0001",
  from: "bob@example.com",
  to: "alice@example.com",
  fromName: "Bob",
  video: false,
};

describe("звонок Jackdaw ↔ Jackdaw", () => {
  let endedMessages: string[];

  beforeEach(() => {
    endedMessages = [];
    setJackdawCallEndedHandler((_call, message) => endedMessages.push(message));
  });

  afterEach(() => {
    appGlobal.meetings.clear();
  });

  test("исходящий: подтверждение → вызов → ответ → разговор", async () => {
    let { call, client, joined } = makeCall();
    call.prepareOutgoing("bob@example.com", "Bob", true);
    expect(call.state).toBe(MeetingState.OutgoingCallConfirm);
    expect(call.participants.first.emailAddress).toBe("bob@example.com");
    expect(client.sent).toHaveLength(0);

    await call.call();
    expect(call.state).toBe(MeetingState.OutgoingCall);
    expect(client.last()).toEqual({ type: "invite", callId: call.callID, to: "bob@example.com", video: true });
    expect(client.registered.has(call.callID)).toBe(true);

    call.onSignal({ type: "ringing", callId: call.callID });
    call.onSignal({ type: "joined", callId: call.callID, livekitURL: "wss://lk.test", token: "wrong-side" });
    expect(joined).toEqual([]);
    call.onSignal({ type: "accepted", callId: call.callID, livekitURL: "wss://lk.test", token: "caller-token" });
    call.onSignal({ type: "accepted", callId: call.callID, livekitURL: "wss://lk.test", token: "duplicate" });
    await Promise.resolve();
    expect(joined).toEqual(["caller-token"]);
    expect(call.webSocketURL).toBe("wss://lk.test");
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

  test("входящий: принять один раз, затем разговор", async () => {
    let { call, client, joined } = makeCall();
    call.prepareIncoming(incoming);
    expect(call.state).toBe(MeetingState.IncomingCall);
    expect(call.hasVideo).toBe(false);
    expect(call.callID).toBe("call-0001");
    expect(call.participants.first.name).toBe("Bob");
    await call.answer();
    await call.answer();
    expect(client.sent).toEqual([{ type: "accept", callId: "call-0001" }]);
    call.onSignal({ type: "joined", callId: "call-0001", livekitURL: "wss://lk.test", token: "callee-token" });
    await Promise.resolve();
    expect(joined).toEqual(["callee-token"]);
    await call.hangup();
    expect(client.last()).toEqual({ type: "hangup", callId: "call-0001" });
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

  test("ошибка подключения к комнате завершает звонок", async () => {
    let { call, client } = makeCall();
    (call as any).joinRoom = async () => { throw new Error("ICE failed"); };
    call.prepareIncoming(incoming);
    await call.answer();
    call.onSignal({ type: "joined", callId: "call-0001", livekitURL: "wss://lk.test", token: "t" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(call.state).toBe(MeetingState.Ended);
    expect(endedMessages[0]).toContain("ICE failed");
    expect(client.last()).toEqual({ type: "reject", callId: "call-0001" });
  });

  test("комнату нельзя создать в обход сервиса звонков", async () => {
    let { call } = makeCall();
    await expect(call.start()).rejects.toBeInstanceOf(UserError);
    await expect(call.createInvitationURL()).rejects.toThrow();
    expect(call.account.isMeetingURL(new URL("https://example.com/#room=x"))).toBe(false);
  });
});

describe("выбор способа звонка", () => {
  test("без сервиса звонков и WhatsApp кнопки скрыты", () => {
    expect(canStartCall(null)).toBe(false);
    expect(canStartCall(new PersonUID("bob@example.com", "Bob"))).toBe(false);
  });

  test("звонок недоступен — понятная ошибка вместо пустого экрана", async () => {
    let before = appGlobal.meetings.length;
    await expect(startVideoCall(new PersonUID("bob@example.com", "Bob"))).rejects.toBeInstanceOf(UserError);
    await expect(startAudioCall(new PersonUID("bob@example.com", "Bob"))).rejects.toBeInstanceOf(UserError);
    expect(appGlobal.meetings.length).toBe(before);
  });
});
