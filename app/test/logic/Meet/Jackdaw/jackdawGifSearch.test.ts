import { beforeEach, describe, expect, test } from "vitest";
import { JackdawCallClient, JackdawCallServiceError, type CallSocket } from "../../../../logic/Meet/Jackdaw/JackdawCallClient";
import { parseServerMessage } from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";

class FakeSocket implements CallSocket {
  readyState = 0;
  sent: any[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string) {
    let message = JSON.parse(data);
    this.sent.push(message);
    if (message.type == "ping") {
      this.receive({ type: "pong" });
    }
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  last(type: string) {
    return this.sent.filter(m => m.type == type).pop();
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

async function rejection(promise: Promise<unknown>): Promise<JackdawCallServiceError> {
  try {
    await promise;
  } catch (ex) {
    return ex as JackdawCallServiceError;
  }
  throw new Error("expected a rejection");
}

describe("протокол: gif-results", () => {
  test("разбирается, лишние результаты отбрасываются", () => {
    let message = parseServerMessage(JSON.stringify({
      type: "gif-results", requestId: "gif-1", provider: "klipy", hasNext: true, results: Array(80).fill({ id: "1" }),
    }));
    expect(message).toMatchObject({ type: "gif-results", requestId: "gif-1", provider: "klipy", hasNext: true });
    expect((message as any).results).toHaveLength(50);
    expect(parseServerMessage(JSON.stringify({ type: "gif-results", results: "x" })))
      .toEqual({ type: "gif-results", requestId: null, provider: "", hasNext: false, results: [] });
  });
});

describe("клиент: поиск GIF", () => {
  let sockets: FakeSocket[];
  let timers: FakeTimers;
  let credential: any;
  let client: JackdawCallClient;

  function socket() {
    return sockets[sockets.length - 1];
  }

  beforeEach(() => {
    sockets = [];
    timers = new FakeTimers();
    credential = { kind: "license", licenseKey: "JACKDAW-PRO-AAAA-BBBB-CCCC-DDDD", deviceId: "device-1234" };
    client = new JackdawCallClient({
      url: "wss://calls.test/v1/calls",
      getCredential: () => credential,
      getDisplayName: () => "Alice",
      getMailboxEmails: () => [],
      createSocket: () => {
        let created = new FakeSocket();
        sockets.push(created);
        return created;
      },
      storage: null,
      setTimer: timers.set,
      clearTimer: timers.clear,
      now: () => timers.now,
    });
  });

  function connectOnline() {
    client.start();
    socket().open();
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
  }

  test("запрос с requestId и ответ сервера", async () => {
    connectOnline();
    let reply = client.searchGIFs("кошки", "ru");
    let sent = socket().last("gif-search");
    expect(sent).toMatchObject({ type: "gif-search", query: "кошки", locale: "ru", page: 1 });
    socket().receive({ type: "gif-results", requestId: "other", results: [] });
    socket().receive({ type: "gif-results", requestId: sent.requestId, provider: "klipy", results: [{ id: "1" }] });
    expect((await reply).results).toEqual([{ id: "1" }]);
  });

  test("ошибки сервера отличимы по коду", async () => {
    connectOnline();
    for (let code of ["unknown_type", "gifs_unavailable", "gifs_failed", "rate_limited"]) {
      let reply = client.searchGIFs("x", "en");
      let sent = socket().last("gif-search");
      socket().receive({ type: "error", code, requestType: "gif-search", requestId: sent.requestId });
      expect((await rejection(reply)).code).toBe(code);
    }
  });

  test("нет ответа — таймаут, а не вечное ожидание", async () => {
    connectOnline();
    let reply = client.searchGIFs("x", "en", 1, 5000);
    timers.advance(5000);
    expect((await rejection(reply)).code).toBe("service_unavailable");
  });

  test("без лицензии и без связи — разные ошибки", async () => {
    credential = null;
    expect((await rejection(client.searchGIFs("x", "en"))).code).toBe("gifs_no_license");
    credential = { kind: "license", licenseKey: "JACKDAW-PRO-AAAA-BBBB-CCCC-DDDD", deviceId: "device-1234" };
    connectOnline();
    socket().close();
    socket().onclose?.({ code: 1006 });
    expect(client.status).toBe("offline");
    expect((await rejection(client.searchGIFs("x", "en"))).code).toBe("not_connected");
  });

  test("подключение ещё идёт — поиск дожидается входа", async () => {
    client.start();
    expect(client.status).toBe("connecting");
    let reply = client.searchGIFs("x", "en");
    socket().open();
    socket().receive({ type: "welcome", emails: [], resumedCalls: [] });
    await Promise.resolve();
    await Promise.resolve();
    let sent = socket().last("gif-search");
    expect(sent).toBeTruthy();
    socket().receive({ type: "gif-results", requestId: sent.requestId, results: [] });
    expect((await reply).results).toEqual([]);
  });
});
