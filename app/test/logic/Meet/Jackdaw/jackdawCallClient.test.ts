import { describe, expect, test, beforeEach } from "vitest";
import { JackdawCallClient, JackdawCallServiceError, type CallSocket } from "../../../../logic/Meet/Jackdaw/JackdawCallClient";
import {
  callServiceURL,
  endReasonMessage,
  parseServerMessage,
  reconnectDelay,
  RECONNECT_DELAYS_MS,
} from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";

class FakeSocket implements CallSocket {
  readyState = 0;
  sent: any[] = [];
  closed: { code?: number } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.readyState = 3;
    this.closed = { code };
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  last(type?: string) {
    let messages = this.sent.filter(m => !type || m.type == type);
    return messages[messages.length - 1];
  }
}

class FakeTimers {
  now = 0;
  pending: { at: number; callback: () => void; id: number }[] = [];
  nextID = 1;
  set = (callback: () => void, ms: number) => {
    let id = this.nextID++;
    this.pending.push({ at: this.now + ms, callback, id });
    return id;
  };
  clear = (id: unknown) => {
    this.pending = this.pending.filter(timer => timer.id != id);
  };
  advance(ms: number) {
    this.now += ms;
    for (;;) {
      let due = this.pending.filter(timer => timer.at <= this.now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      this.pending = this.pending.filter(timer => timer != due);
      due.callback();
    }
  }
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("протокол звонков", () => {
  test("сообщения сервера проверяются и нормализуются", () => {
    expect(parseServerMessage(JSON.stringify({ type: "incoming", callId: "call-0001", from: " Bob@Example.com ", to: "a@example.com", fromName: "Bob\u0007", video: 1 })))
      .toEqual({ type: "incoming", callId: "call-0001", from: "bob@example.com", to: "a@example.com", fromName: "Bob", video: false });
    expect(parseServerMessage(JSON.stringify({ type: "incoming", callId: "../x", from: "b@example.com", to: "a@example.com" }))).toBeNull();
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "teleport" }))).toBeNull();
  });

  test("ответ на звонок: P2P, токены LiveKit не используются, STUN проверяется", () => {
    expect(parseServerMessage(JSON.stringify({ type: "accepted", callId: "call-0001", media: "p2p" })))
      .toEqual({ type: "accepted", callId: "call-0001", iceServers: null });
    expect(parseServerMessage(JSON.stringify({ type: "joined", callId: "call-0001", livekitURL: "wss://calls.test", token: "t" })))
      .toEqual({ type: "joined", callId: "call-0001", iceServers: null });
    expect(parseServerMessage(JSON.stringify({
      type: "accepted", callId: "call-0001",
      iceServers: [
        { urls: ["stun:stun.example.test:3478", "http://evil.test", "stun:bad host"] },
        { urls: "turn:turn.example.test", username: "u", credential: "c" },
        { urls: ["javascript:alert(1)"] },
        "nonsense",
      ],
    }))).toEqual({
      type: "accepted", callId: "call-0001",
      iceServers: [
        { urls: ["stun:stun.example.test:3478"] },
        { urls: ["turn:turn.example.test"], username: "u", credential: "c" },
      ],
    });
    expect(parseServerMessage(JSON.stringify({ type: "accepted", callId: "../x" }))).toBeNull();
  });

  test("сигналы WebRTC проверяются", () => {
    let sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "offer", sdp })))
      .toEqual({ type: "signal", callId: "call-0001", kind: "offer", sdp });
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "answer", sdp: "<html>" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "offer", sdp: "v=0" + "a".repeat(20_000) }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "bye" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({
      type: "signal", callId: "call-0001", kind: "ice",
      candidate: { candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0, extra: "x" },
    }))).toEqual({
      type: "signal", callId: "call-0001", kind: "ice",
      candidate: { candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
    });
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "ice", candidate: null })))
      .toEqual({ type: "signal", callId: "call-0001", kind: "ice", candidate: null });
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "ice", candidate: { candidate: "c" } }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "signal", callId: "call-0001", kind: "ice", candidate: "c" }))).toBeNull();
  });

  test("неизвестная причина завершения считается обычным завершением", () => {
    expect(parseServerMessage(JSON.stringify({ type: "call-ended", callId: "call-0001", reason: "aliens" })))
      .toEqual({ type: "call-ended", callId: "call-0001", reason: "hangup" });
  });

  test("пользователь узнаёт о занятости и отказе, но не об обычном завершении", () => {
    expect(endReasonMessage("busy", true)).toBeTruthy();
    expect(endReasonMessage("declined", true)).toBeTruthy();
    expect(endReasonMessage("no-answer", false)).toBeTruthy();
    expect(endReasonMessage("hangup", true)).toBeNull();
    expect(endReasonMessage("answered-elsewhere", false)).toBeNull();
    expect(endReasonMessage("declined", false)).toBeNull();
  });

  test("адрес сигналинга строится от сервиса лицензий и только по TLS", () => {
    expect(callServiceURL("https://license.jackdaw-mail.pro")).toBe("wss://license.jackdaw-mail.pro/v1/calls");
    expect(callServiceURL("http://license.test")).toBeNull();
    expect(callServiceURL(null)).toBeNull();
    expect(callServiceURL("::")).toBeNull();
  });

  test("задержка переподключения растёт и ограничена", () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelay(100)).toBe(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]);
  });
});

describe("клиент сигналинга", () => {
  let sockets: FakeSocket[];
  let timers: FakeTimers;
  let storage: MemoryStorage;
  let credential: any;
  let incoming: any[];
  let client: JackdawCallClient;

  function socket() {
    return sockets[sockets.length - 1];
  }

  function makeClient() {
    return new JackdawCallClient({
      url: "wss://calls.test/v1/calls",
      getCredential: () => credential,
      getDisplayName: () => "Alice",
      createSocket: () => {
        let created = new FakeSocket();
        sockets.push(created);
        return created;
      },
      storage,
      onIncoming: message => incoming.push(message),
      setTimer: timers.set,
      clearTimer: timers.clear,
      now: () => timers.now,
    });
  }

  function connectOnline(emails = ["alice@example.com"]) {
    client.start();
    socket().open();
    socket().receive({ type: "welcome", emails, resumedCalls: [] });
  }

  beforeEach(() => {
    sockets = [];
    timers = new FakeTimers();
    storage = new MemoryStorage();
    credential = { kind: "license", licenseKey: "JACKDAW-PRO-AAAA-BBBB-CCCC-DDDD", deviceId: "device-1234" };
    incoming = [];
    client = makeClient();
  });

  test("без лицензии не подключается", () => {
    credential = null;
    client.start();
    expect(sockets).toHaveLength(0);
    expect(client.status).toBe("disabled");
  });

  test("вход отправляет лицензию, имя и сохранённые подтверждения", () => {
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({ "Alice@Example.com": "proof-1", "bad": 5 }));
    client.start();
    socket().open();
    expect(socket().last("hello")).toEqual({
      type: "hello",
      credential,
      name: "Alice",
      emailProofs: ["proof-1"],
      activeCalls: [],
    });
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [] });
    expect(client.status).toBe("online");
    expect(client.verifiedEmails).toEqual(["alice@example.com"]);
  });

  test("подтверждения, которые сервер не принял, удаляются", () => {
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({ "old@example.com": "proof-old" }));
    connectOnline([]);
    expect(storage.getItem("jackdaw.calls.email-proofs.v1")).toBeNull();
  });

  test("отказ в лицензии останавливает переподключения", () => {
    client.start();
    socket().open();
    socket().receive({ type: "error", code: "license_inactive", message: "x", requestType: "hello" });
    expect(client.status).toBe("rejected");
    expect(client.lastError).toBeTruthy();
    timers.advance(120_000);
    expect(sockets).toHaveLength(1);
  });

  test("обрыв сети — переподключение с паузой, повторный вход", () => {
    connectOnline();
    socket().drop();
    expect(client.status).toBe("offline");
    expect(client.verifiedEmails).toEqual([]);
    timers.advance(RECONNECT_DELAYS_MS[0]);
    expect(sockets).toHaveLength(2);
    socket().open();
    expect(socket().last("hello")).toBeTruthy();
  });

  test("stop() не переподключается", () => {
    connectOnline();
    client.stop();
    timers.advance(120_000);
    expect(sockets).toHaveLength(1);
    expect(client.status).toBe("disabled");
  });

  test("подтверждение адреса сохраняет доказательство", async () => {
    connectOnline([]);
    let started = client.startVerification(" Alice@Example.com ");
    expect(socket().last()).toEqual({ type: "verify-start", email: "alice@example.com" });
    socket().receive({ type: "verify-sent", email: "alice@example.com" });
    await started;
    let finished = client.finishVerification("alice@example.com", " 123 456 ");
    expect(socket().last()).toEqual({ type: "verify-finish", email: "alice@example.com", code: "123456" });
    socket().receive({ type: "verified", email: "alice@example.com", proof: "proof-new" });
    await finished;
    expect(JSON.parse(storage.getItem("jackdaw.calls.email-proofs.v1")!)).toEqual({ "alice@example.com": "proof-new" });
    expect(client.verifiedEmails).toEqual(["alice@example.com"]);
  });

  test("обратное подтверждение: адрес от сервера, затем подтверждение письмом", async () => {
    connectOnline([]);
    let started = client.startReverseVerification("Alice@Corp.Example");
    expect(socket().last()).toEqual({ type: "verify-reverse-start", email: "alice@corp.example" });
    socket().receive({
      type: "verify-reverse-ready", email: "alice@corp.example", token: "abcdefghijklmnop",
      address: "verify+abcdefghijklmnop@verify.calls.test", mailSubject: "Jackdaw Mail: подтверждение адреса abcdefghijklmnop", expiresIn: 900,
    });
    let ready = await started;
    expect(ready.address).toBe("verify+abcdefghijklmnop@verify.calls.test");

    let pending = client.checkReverseVerification(ready.token);
    expect(socket().last()).toEqual({ type: "verify-reverse-check", token: "abcdefghijklmnop" });
    socket().receive({ type: "verify-reverse-pending", email: "alice@corp.example", token: "abcdefghijklmnop" });
    expect(await pending).toBe(false);

    socket().receive({ type: "verified", email: "alice@corp.example", proof: "proof-reverse" });
    expect(client.verifiedEmails).toEqual(["alice@corp.example"]);
    expect(JSON.parse(storage.getItem("jackdaw.calls.email-proofs.v1")!)).toEqual({ "alice@corp.example": "proof-reverse" });
  });

  test("обратное подтверждение не отправит письмо на чужой домен", async () => {
    connectOnline([]);
    let started = client.startReverseVerification("alice@corp.example");
    socket().receive({
      type: "verify-reverse-ready", email: "alice@corp.example", token: "abcdefghijklmnop",
      address: "verify+abcdefghijklmnop@evil.example", mailSubject: "x", expiresIn: 900,
    });
    await expect(started).rejects.toBeInstanceOf(JackdawCallServiceError);
  });

  test("неверный код отклоняет ожидание понятной ошибкой", async () => {
    connectOnline([]);
    let finished = client.finishVerification("alice@example.com", "000000");
    socket().receive({ type: "error", code: "code_invalid", message: "x", requestType: "verify-finish", email: "alice@example.com" });
    await expect(finished).rejects.toBeInstanceOf(JackdawCallServiceError);
  });

  test("ответ не пришёл — ожидание завершается по таймауту", async () => {
    connectOnline([]);
    let started = client.startVerification("alice@example.com");
    timers.advance(15_000);
    await expect(started).rejects.toBeInstanceOf(JackdawCallServiceError);
  });

  test("без соединения запрос сразу отклоняется", () => {
    expect(() => client.send({ type: "invite" })).toThrow(JackdawCallServiceError);
  });

  test("справочник: запросы объединяются, ответ кэшируется", () => {
    connectOnline();
    expect(client.isReachable("bob@example.com")).toBeUndefined();
    expect(client.isReachable("Carol@example.com")).toBeUndefined();
    expect(client.isReachable("alice@example.com")).toBe(false);
    timers.advance(250);
    let lookup = socket().last("lookup");
    expect(lookup.emails).toEqual(["bob@example.com", "carol@example.com"]);
    let version = client.presenceVersion;
    socket().receive({ type: "lookup-result", requestId: lookup.requestId, reachable: { "bob@example.com": true, "carol@example.com": false } });
    expect(client.presenceVersion).toBeGreaterThan(version);
    expect(client.isReachable("bob@example.com")).toBe(true);
    expect(client.isReachable("carol@example.com")).toBe(false);
    let lookups = socket().sent.filter(m => m.type == "lookup").length;
    timers.advance(30_000);
    client.isReachable("bob@example.com");
    timers.advance(250);
    expect(socket().sent.filter(m => m.type == "lookup").length).toBe(lookups);
    timers.advance(31_000);
    expect(client.isReachable("bob@example.com")).toBe(true);
    timers.advance(250);
    expect(socket().sent.filter(m => m.type == "lookup").length).toBe(lookups + 1);
  });

  test("lookupNow отвечает на конкретный запрос", async () => {
    connectOnline();
    let result = client.lookupNow(["bob@example.com", "BOB@example.com", "nonsense"]);
    let request = socket().last("lookup");
    expect(request.emails).toEqual(["bob@example.com"]);
    socket().receive({ type: "lookup-result", requestId: "other", reachable: { "bob@example.com": false } });
    socket().receive({ type: "lookup-result", requestId: request.requestId, reachable: { "bob@example.com": true } });
    await expect(result).resolves.toEqual({ "bob@example.com": true });
  });

  test("входящий звонок передаётся наружу, сигналы — звонку", () => {
    connectOnline();
    socket().receive({ type: "incoming", callId: "call-0001", from: "bob@example.com", to: "alice@example.com", fromName: "Bob", video: true });
    expect(incoming).toHaveLength(1);
    let signals: any[] = [];
    client.register({ callID: "call-0001", onSignal: message => signals.push(message) });
    socket().receive({ type: "incoming", callId: "call-0001", from: "bob@example.com", to: "alice@example.com" });
    expect(incoming).toHaveLength(1);
    socket().receive({ type: "signal", callId: "call-0001", kind: "ice", candidate: null });
    socket().receive({ type: "call-ended", callId: "call-0001", reason: "cancelled" });
    socket().receive({ type: "call-ended", callId: "call-9999", reason: "cancelled" });
    expect(signals).toEqual([
      { type: "signal", callId: "call-0001", kind: "ice", candidate: null },
      { type: "call-ended", callId: "call-0001", reason: "cancelled" },
    ]);
  });

  test("после переподключения идущие звонки передаются в hello", () => {
    connectOnline();
    client.register({ callID: "call-0001", onSignal: () => {} });
    socket().drop();
    timers.advance(RECONNECT_DELAYS_MS[0]);
    socket().open();
    expect(socket().last("hello").activeCalls).toEqual(["call-0001"]);
  });

  test("отключение адреса удаляет подтверждение и переподключает", () => {
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({ "alice@example.com": "p" }));
    connectOnline();
    client.forgetEmail("alice@example.com");
    expect(storage.getItem("jackdaw.calls.email-proofs.v1")).toBeNull();
    expect(sockets).toHaveLength(2);
    socket().open();
    expect(socket().last("hello").emailProofs).toEqual([]);
  });

  test("сердцебиение держит соединение", () => {
    connectOnline();
    timers.advance(25_000);
    expect(socket().last()).toEqual({ type: "ping" });
  });
});

describe("адрес обратного подтверждения", () => {
  test("только одноразовый адрес на домене сервиса", async () => {
    let { isTrustedReverseAddress } = await import("../../../../logic/Meet/Jackdaw/JackdawCallProtocol");
    let url = "wss://license.jackdaw-mail.pro/v1/calls";
    expect(isTrustedReverseAddress("verify+abcdefghijklmnop@verify.jackdaw-mail.pro", url)).toBe(true);
    expect(isTrustedReverseAddress("verify+abcdefghijklmnop@jackdaw-mail.pro", url)).toBe(true);
    expect(isTrustedReverseAddress("verify+abcdefghijklmnop@evil.pro", url)).toBe(false);
    expect(isTrustedReverseAddress("verify+abcdefghijklmnop@jackdaw-mail.pro.evil.com", url)).toBe(false);
    expect(isTrustedReverseAddress("boss+abcdefghijklmnop@verify.jackdaw-mail.pro", url)).toBe(false);
    expect(isTrustedReverseAddress("verify+abc@verify.jackdaw-mail.pro", url)).toBe(false);
    expect(isTrustedReverseAddress("verify+abcdefghijklmnop@verify.jackdaw-mail.pro", null)).toBe(false);
  });

  test("сообщения сервера проверяются", () => {
    expect(parseServerMessage(JSON.stringify({ type: "verify-reverse-ready", email: "a@b.c", token: "abcdefghijklmnop",
      address: "verify+other0000000000@x.y", mailSubject: "s", expiresIn: 900 }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "verify-reverse-pending", email: "a@b.c", token: "BAD" }))).toBeNull();
  });
});
