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
  /** Живой сервер отвечает на ping. false — TCP мёртв, хотя сокет ещё «открыт» */
  answersPings = true;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string) {
    let message = JSON.parse(data);
    this.sent.push(message);
    if (message.type == "ping" && this.answersPings) {
      this.receive({ type: "pong" });
    }
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
  /** Ящики в приложении этого устройства; пусто — как старый клиент или аккаунты ещё не загружены */
  let mailboxes: string[];

  function socket() {
    return sockets[sockets.length - 1];
  }

  function makeClient() {
    return new JackdawCallClient({
      url: "wss://calls.test/v1/calls",
      getCredential: () => credential,
      getDisplayName: () => "Alice",
      getMailboxEmails: () => mailboxes,
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
    mailboxes = [];
    client = makeClient();
  });

  test("вход сообщает серверу ящики этого устройства", () => {
    mailboxes = ["Bob@Example.com", "", "bob@example.com", "support@example.com"];
    client.start();
    socket().open();
    expect(socket().last("hello").mailboxEmails).toEqual(["bob@example.com", "support@example.com"]);
  });

  test("адрес коллеги с той же лицензией не становится своим и забывается", () => {
    // Так было до исправления сервера: подтверждение сотрудника приходило всем устройствам лицензии
    mailboxes = ["bob@example.com"];
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({
      "bob@example.com": "proof-bob",
      "alice@example.com": "proof-alice-from-license",
    }));
    client.start();
    socket().open();
    expect(socket().last("hello").emailProofs).toEqual(["proof-bob"]);
    socket().receive({
      type: "welcome", emails: ["alice@example.com", "bob@example.com"], resumedCalls: [],
      proofs: { "alice@example.com": "proof-alice-2" },
    });
    expect(client.verifiedEmails).toEqual(["bob@example.com"]);
    expect(JSON.parse(storage.getItem("jackdaw.calls.email-proofs.v1")!)).toEqual({ "bob@example.com": "proof-bob" });
  });

  test("подтверждение адреса коллеги, пришедшее в сети, не делает его своим", () => {
    mailboxes = ["bob@example.com"];
    connectOnline(["bob@example.com"]);
    socket().receive({ type: "verified", email: "alice@example.com", proof: "proof-alice" });
    expect(client.verifiedEmails).toEqual(["bob@example.com"]);
    expect(storage.getItem("jackdaw.calls.email-proofs.v1")).toBeNull();
  });

  test("подтверждение, начатое на этом устройстве, принимается и вне списка ящиков", async () => {
    mailboxes = ["bob@example.com"];
    connectOnline(["bob@example.com"]);
    let finished = client.finishVerification("alias@example.com", "123 456");
    socket().receive({ type: "verified", email: "alias@example.com", proof: "proof-alias" });
    await finished;
    expect(client.verifiedEmails).toEqual(["alias@example.com", "bob@example.com"]);
    socket().receive({ type: "verified", email: "primary@example.com", proof: "proof-primary", requestedEmail: "bob@example.com" });
    expect(client.verifiedEmails).toContain("primary@example.com");
  });

  test("пока ящики неизвестны, сохранённые подтверждения не отбрасываются", () => {
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({ "alice@example.com": "proof-1" }));
    client.start();
    socket().open();
    expect(socket().last("hello").mailboxEmails).toBeUndefined();
    expect(socket().last("hello").emailProofs).toEqual(["proof-1"]);
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

  test("адрес, подтверждённый на другом устройстве лицензии, сохраняется", () => {
    client.start();
    socket().open();
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [], proofs: { "Alice@Example.com": "proof-other-device", bad: 5 } });
    expect(client.verifiedEmails).toEqual(["alice@example.com"]);
    expect(JSON.parse(storage.getItem("jackdaw.calls.email-proofs.v1")!)).toEqual({ "alice@example.com": "proof-other-device" });
  });

  test("отключённый на устройстве адрес не возвращается с других устройств, пока его не подтвердят снова", () => {
    storage.setItem("jackdaw.calls.email-proofs.v1", JSON.stringify({ "alice@example.com": "proof-1" }));
    connectOnline(["alice@example.com"]);
    client.forgetEmail("alice@example.com");
    socket().open();
    expect(socket().last("hello").excludedEmails).toEqual(["alice@example.com"]);
    expect(socket().last("hello").emailProofs).toEqual([]);
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
    socket().receive({ type: "verified", email: "alice@example.com", proof: "proof-2" });
    client.restart();
    socket().open();
    expect(socket().last("hello").excludedEmails).toBeUndefined();
    expect(socket().last("hello").emailProofs).toEqual(["proof-2"]);
  });

  test("проверка письма не принимает подтверждение другого адреса", async () => {
    connectOnline();
    let check = client.checkReverseVerification("abcdefghijklmnop", "bob@example.com");
    socket().receive({ type: "verified", email: "carol@example.com", proof: "proof-carol" });
    socket().receive({ type: "verify-reverse-pending", email: "bob@example.com", token: "abcdefghijklmnop" });
    await expect(check).resolves.toBeNull();
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

  test("после переподключения звонки узнают, какие из них сервер вернул", () => {
    connectOnline();
    let reconnected: [string, boolean][] = [];
    let target = (callID: string) => ({
      callID,
      onSignal: () => {},
      onReconnected: (resumed: boolean) => reconnected.push([callID, resumed]),
    });
    client.register(target("call-0001"));
    client.register(target("call-0002"));
    // Звонок без обработчика переподключения не мешает остальным.
    client.register({ callID: "call-0003", onSignal: () => {} });
    socket().drop();
    timers.advance(RECONNECT_DELAYS_MS[0]);
    socket().open();
    expect(socket().last("hello").activeCalls).toEqual(["call-0001", "call-0002", "call-0003"]);
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: ["call-0002"] });
    expect(reconnected).toEqual([["call-0001", false], ["call-0002", true]]);
  });

  test("закрытие 1008 до welcome без error не останавливает клиент: переподключение с паузой", () => {
    // Сервер закрывает 1008 и при «slow consumer» / «closed by server» — это не отказ в лицензии.
    client.start();
    socket().open();
    socket().drop(1008);
    expect(client.status).toBe("offline");
    expect(client.lastError).toBeNull();
    timers.advance(RECONNECT_DELAYS_MS[0]);
    expect(sockets).toHaveLength(2);
    socket().open();
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [] });
    expect(client.status).toBe("online");
  });

  test("повторные закрытия 1008 до welcome — паузы растут, клиент не сдаётся", () => {
    client.start();
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length + 2; attempt++) {
      socket().open();
      socket().drop(1008);
      expect(client.status).toBe("offline");
      timers.advance(reconnectDelay(attempt));
    }
    expect(sockets).toHaveLength(RECONNECT_DELAYS_MS.length + 3);
  });

  test("перезапуск сервера: закрытие 1001 и обрыв до welcome ведут к переподключению", () => {
    connectOnline();
    socket().drop(1001);
    expect(client.status).toBe("offline");
    timers.advance(RECONNECT_DELAYS_MS[0]);
    // Сервис ещё не поднялся: прокси обрывает соединение до открытия.
    socket().drop(1006);
    expect(client.status).toBe("offline");
    timers.advance(RECONNECT_DELAYS_MS[1]);
    socket().open();
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [] });
    expect(client.status).toBe("online");
    expect(sockets).toHaveLength(3);
  });

  test("временная ошибка входа (сервис лицензий недоступен) — переподключение с причиной", () => {
    for (let code of ["service_unavailable", "rate_limited", "internal_error"]) {
      sockets = [];
      client = makeClient();
      client.start();
      socket().open();
      socket().receive({ type: "error", code, message: "x", requestType: "hello" });
      expect(client.status, code).toBe("offline");
      expect(client.lastError, code).toBeTruthy();
      expect(socket().closed, code).toBeTruthy();
      timers.advance(RECONNECT_DELAYS_MS[0]);
      expect(sockets, code).toHaveLength(2);
      socket().open();
      socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
      expect(client.status, code).toBe("online");
      expect(client.lastError, code).toBeNull();
      client.stop();
    }
  });

  test("отказ устройству или неверные учётные данные — тоже окончательный отказ", () => {
    for (let code of ["device_not_activated", "invalid_credential"]) {
      sockets = [];
      client = makeClient();
      client.start();
      socket().open();
      socket().receive({ type: "error", code, message: "x", requestType: "hello" });
      expect(client.status, code).toBe("rejected");
      timers.advance(120_000);
      expect(sockets, code).toHaveLength(1);
    }
  });

  test("отзыв лицензии у подключённого клиента: error на hello, затем закрытие 1008 — отказ", () => {
    connectOnline();
    socket().receive({ type: "error", code: "license_inactive", message: "x", requestType: "hello" });
    socket().drop(1008);
    expect(client.status).toBe("rejected");
    timers.advance(120_000);
    expect(sockets).toHaveLength(1);
  });

  test("после отказа restart() подключается снова", () => {
    client.start();
    socket().open();
    socket().receive({ type: "error", code: "license_inactive", message: "x", requestType: "hello" });
    expect(client.status).toBe("rejected");
    client.restart();
    expect(client.status).toBe("connecting");
    expect(sockets).toHaveLength(2);
    socket().open();
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
    expect(client.status).toBe("online");
    expect(client.lastError).toBeNull();
  });

  test("сервер не отвечает на hello — соединение пересоздаётся по таймауту", () => {
    client.start();
    socket().open();
    expect(client.status).toBe("connecting");
    timers.advance(20_000);
    expect(client.status).toBe("offline");
    expect(sockets[0].closed).toBeTruthy();
    timers.advance(RECONNECT_DELAYS_MS[0]);
    expect(sockets).toHaveLength(2);
    socket().open();
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
    expect(client.status).toBe("online");
    // После входа таймаут не срабатывает.
    let count = sockets.length;
    timers.advance(120_000);
    expect(sockets).toHaveLength(count);
    expect(client.status).toBe("online");
  });

  test("время потери связи: с первого обрыва, не сбрасывается кнопкой, сбрасывается после входа", () => {
    timers.now = 1_000_000;
    connectOnline();
    expect(client.offlineSince).toBeNull();
    socket().drop();
    expect(client.offlineSince).toBe(1_000_000);
    timers.advance(RECONNECT_DELAYS_MS[0]);
    socket().drop();
    expect(client.offlineSince).toBe(1_000_000);
    client.restart();
    expect(client.offlineSince).toBe(1_000_000);
    socket().open();
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
    expect(client.offlineSince).toBeNull();
    client.stop();
    expect(client.offlineSince).toBeNull();
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
    expect(await pending).toBeNull();

    socket().receive({ type: "verified", email: "alice@corp.example", proof: "proof-reverse" });
    expect(client.verifiedEmails).toEqual(["alice@corp.example"]);
    expect(JSON.parse(storage.getItem("jackdaw.calls.email-proofs.v1")!)).toEqual({ "alice@corp.example": "proof-reverse" });

    // Exchange отправил от основного адреса ящика — подтверждён он
    let again = client.checkReverseVerification(ready.token);
    socket().receive({ type: "verified", email: "primary@corp.example", proof: "proof-primary", requestedEmail: "alice@corp.example" });
    expect(await again).toBe("primary@corp.example");
    expect(client.verifiedEmails).toContain("primary@corp.example");
  });

  test("отклонённое письмо сообщается понятной ошибкой", async () => {
    connectOnline([]);
    let check = client.checkReverseVerification("abcdefghijklmnop");
    socket().receive({ type: "error", code: "sender_not_authenticated", message: "x", requestType: "verify-reverse-check" });
    let error = await check.catch(e => e);
    expect(error).toBeInstanceOf(JackdawCallServiceError);
    expect(error.code).toBe("sender_not_authenticated");
    expect(error.message).toMatch(/DKIM/);
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

  test("сервер отвечает на ping — живое соединение не рвётся часами", () => {
    connectOnline();
    // Три часа: таймеры здесь отсчитываются от конца шага, поэтому шаг — один интервал сердцебиения.
    for (let i = 0; i < 3 * 60 * 60 / 25; i++) {
      timers.advance(25_000);
    }
    expect(sockets).toHaveLength(1);
    expect(socket().closed).toBeNull();
    expect(client.status).toBe("online");
    expect(socket().sent.filter(m => m.type == "ping").length).toBe(3 * 60 * 60 / 25);
  });

  test("pong не пришёл — сокет закрывается и клиент переподключается, ожидания отклоняются", async () => {
    connectOnline();
    let dead = socket();
    dead.answersPings = false;
    let pending = client.request({ type: "chat-send" }, reply => reply.type == "chat-sent" as any);
    timers.advance(25_000);
    expect(dead.last()).toEqual({ type: "ping" });
    timers.advance(9_999);
    expect(client.status).toBe("online");
    timers.advance(1);
    expect(dead.closed).toBeTruthy();
    expect(client.status).toBe("offline");
    expect(client.verifiedEmails).toEqual([]);
    await expect(pending).rejects.toBeInstanceOf(JackdawCallServiceError);
    // Запоздалое закрытие мёртвого сокета ничего не ломает.
    dead.drop();
    expect(client.status).toBe("offline");
    timers.advance(RECONNECT_DELAYS_MS[0]);
    expect(sockets).toHaveLength(2);
    socket().open();
    socket().receive({ type: "welcome", emails: ["alice@example.com"], resumedCalls: [] });
    expect(client.status).toBe("online");
    timers.advance(120_000);
    expect(sockets).toHaveLength(2);
  });

  test("запоздалый pong отменяет переподключение", () => {
    connectOnline();
    socket().answersPings = false;
    timers.advance(25_000 + 5_000);
    socket().receive({ type: "pong" });
    timers.advance(10_000);
    expect(client.status).toBe("online");
    expect(sockets).toHaveLength(1);
  });

  test("проверка соединения: короткий срок, звонок не обрывается, повторная проверка срок не продлевает", () => {
    connectOnline();
    let signals: any[] = [];
    client.register({ callID: "call-0001", onSignal: message => signals.push(message) });
    client.checkConnection(5_000);
    expect(socket().last()).toEqual({ type: "ping" });
    expect(socket().closed).toBeNull();
    expect(sockets).toHaveLength(1);
    socket().receive({ type: "signal", callId: "call-0001", kind: "ice", candidate: null });
    expect(signals).toHaveLength(1);

    socket().answersPings = false;
    client.checkConnection(5_000);
    timers.advance(4_000);
    client.checkConnection(5_000);
    timers.advance(1_000);
    expect(client.status).toBe("offline");
    expect(socket().closed).toBeTruthy();
  });

  test("проверка соединения вне связи ничего не шлёт", () => {
    client.checkConnection();
    client.start();
    socket().open();
    client.checkConnection();
    expect(socket().sent.filter(m => m.type == "ping")).toHaveLength(0);
    client.stop();
    timers.advance(120_000);
    expect(sockets).toHaveLength(1);
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
