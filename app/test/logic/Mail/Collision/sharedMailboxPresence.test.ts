import { beforeEach, describe, expect, test } from "vitest";
import { Observable, notifyChangedProperty } from "../../../../logic/util/Observable";
import { parseServerMessage, type JackdawServerMessage } from "../../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import {
  PRESENCE_REFRESH_MS,
  REPLIED_TTL_SECONDS,
  SharedMailboxPresence,
  VIEWING_DELAY_MS,
} from "../../../../logic/Mail/Collision/SharedMailboxPresence";
import { collisionTag } from "../../../../logic/Mail/Collision/collisionTag";

const TEAM = "team@example.com";
const MSG = "<order-42@customer.example>";
const TAG = collisionTag(TEAM, MSG);

class FakeConnection extends Observable {
  @notifyChangedProperty
  isOnline = true;
  verifiedEmails: string[] = [];
  sent: Record<string, any>[] = [];
  listeners = new Set<(message: JackdawServerMessage) => void>();

  constructor(emails: string[]) {
    super();
    this.verifiedEmails = emails;
  }

  send(message: Record<string, unknown>): void {
    if (!this.isOnline) throw new Error("offline");
    this.sent.push(message);
  }

  addListener(listener: (message: JackdawServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Сообщение сервера проходит через тот же разбор, что и в клиенте */
  receive(message: Record<string, unknown>): void {
    let parsed = parseServerMessage(JSON.stringify(message));
    if (parsed) this.listeners.forEach(listener => listener(parsed));
  }

  setsOf(state?: string): Record<string, any>[] {
    return this.sent.filter(m => m.type == "presence-set" && (!state || m.state == state));
  }
}

class FakeTimers {
  now = 1_800_000_000_000;
  queue: { at: number; callback: () => void; id: number }[] = [];
  next = 0;

  set = (callback: () => void, ms: number) => {
    let id = ++this.next;
    this.queue.push({ at: this.now + ms, callback, id });
    return id;
  };

  clear = (id: unknown) => {
    this.queue = this.queue.filter(t => t.id !== id);
  };

  advance(ms: number): void {
    let until = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      let timer = this.queue[0];
      if (!timer || timer.at > until) break;
      this.queue.shift();
      this.now = timer.at;
      timer.callback();
    }
    this.now = until;
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

function member(timers: FakeTimers, emails: string[], enabled = [TEAM]) {
  let connection = new FakeConnection(emails);
  let presence = new SharedMailboxPresence(connection, {
    enabledMailboxes: () => enabled,
    replyAddress: () => emails.find(e => e != TEAM) ?? null,
    setTimer: timers.set,
    clearTimer: timers.clear,
    now: () => timers.now,
  });
  return { connection, presence };
}

/** Минимальный сервер присутствия: раздаёт состояние остальным членам ящика (см. call_server/presence.py) */
function relay(from: ReturnType<typeof member>, to: ReturnType<typeof member>[], actor: string, name: string, timers: FakeTimers) {
  let delivered = 0;
  return () => {
    for (let message of from.connection.setsOf().slice(delivered)) {
      for (let peer of to) {
        peer.connection.receive({
          type: "presence", mailbox: message.mailbox, tag: message.tag, actor, state: message.state,
          name, email: message.from ?? "", at: Math.floor(timers.now / 1000),
        });
      }
    }
    delivered = from.connection.setsOf().length;
  };
}

describe("присутствие в общем ящике", () => {
  let timers: FakeTimers;

  beforeEach(() => {
    timers = new FakeTimers();
  });

  test("сообщает серверу только включённые и подтверждённые ящики", async () => {
    let { connection, presence } = member(timers, ["alice@example.com", TEAM], [TEAM, "sales@example.com"]);
    presence.start();
    await flush();
    expect(connection.sent).toEqual([{ type: "presence-watch", mailboxes: [TEAM] }]);
    // Повторная синхронизация без изменений ничего не отправляет
    presence.refreshMailboxes();
    await flush();
    expect(connection.sent.length).toBe(1);
  });

  test("без подтверждённого общего ящика ничего не отправляется", async () => {
    let { connection, presence } = member(timers, ["alice@example.com"]);
    presence.start();
    await flush();
    presence.begin(TEAM, MSG, "replying")();
    expect(connection.sent).toEqual([]);
  });

  test("двое коллег видят «читает» и «отвечает» друг друга", async () => {
    let alice = member(timers, ["alice@example.com", TEAM]);
    let bob = member(timers, ["bob@example.com", TEAM]);
    alice.presence.start();
    bob.presence.start();
    await flush();
    let aliceToBob = relay(alice, [bob], "a".repeat(16), "Alice", timers);
    let bobToAlice = relay(bob, [alice], "b".repeat(16), "Bob", timers);

    let stopViewing = alice.presence.begin(TEAM, MSG, "viewing");
    timers.advance(VIEWING_DELAY_MS);
    aliceToBob();
    expect(bob.presence.statusFor(TEAM, MSG)?.viewing.map(c => c.name)).toEqual(["Alice"]);

    let stopReplying = bob.presence.begin(TEAM, MSG, "replying");
    bobToAlice();
    let status = alice.presence.statusFor(TEAM, MSG);
    expect(status?.replying.map(c => [c.name, c.email])).toEqual([["Bob", "bob@example.com"]]);

    stopReplying();
    stopViewing();
    aliceToBob();
    bobToAlice();
    expect(alice.presence.statusFor(TEAM, MSG)).toBeNull();
    expect(bob.presence.statusFor(TEAM, MSG)).toBeNull();
  });

  test("быстрое пролистывание писем не рассылает «читает»", async () => {
    let { connection, presence } = member(timers, ["alice@example.com", TEAM]);
    presence.start();
    await flush();
    let stop = presence.begin(TEAM, MSG, "viewing");
    timers.advance(VIEWING_DELAY_MS - 1);
    stop();
    timers.advance(VIEWING_DELAY_MS);
    expect(connection.setsOf()).toEqual([]);
  });

  test("«отвечает» важнее «читает» и снимается до «читает»", async () => {
    let { connection, presence } = member(timers, ["alice@example.com", TEAM]);
    presence.start();
    await flush();
    let stopViewing = presence.begin(TEAM, MSG, "viewing");
    let stopReplying = presence.begin(TEAM, MSG, "replying");
    expect(connection.setsOf().map(m => m.state)).toEqual(["replying"]);
    expect(connection.setsOf()[0]).toMatchObject({ mailbox: TEAM, tag: TAG, from: "alice@example.com" });
    stopReplying();
    stopReplying(); // повторное снятие безопасно
    stopViewing();
    expect(connection.setsOf().map(m => m.state)).toEqual(["replying", "viewing", "none"]);
  });

  test("состояние продлевается, пока письмо открыто", async () => {
    let { connection, presence } = member(timers, ["alice@example.com", TEAM]);
    presence.start();
    await flush();
    let stop = presence.begin(TEAM, MSG, "replying");
    timers.advance(PRESENCE_REFRESH_MS * 2);
    expect(connection.setsOf("replying").length).toBe(3);
    stop();
    timers.advance(PRESENCE_REFRESH_MS * 2);
    expect(connection.setsOf("replying").length).toBe(3);
  });

  test("после ответа коллега видит «Ответил» со временем, но не дольше суток", async () => {
    let alice = member(timers, ["alice@example.com", TEAM]);
    let bob = member(timers, ["bob@example.com", TEAM]);
    alice.presence.start();
    bob.presence.start();
    await flush();
    let aliceToBob = relay(alice, [bob], "a".repeat(16), "Alice", timers);
    let stop = alice.presence.begin(TEAM, MSG, "replying");
    alice.presence.markReplied(TEAM, MSG);
    stop();
    aliceToBob();
    expect(alice.connection.setsOf().map(m => m.state)).toEqual(["replying", "replied"]);
    let status = bob.presence.statusFor(TEAM, MSG);
    expect(status?.replying).toEqual([]);
    expect(status?.replied).toMatchObject({ name: "Alice", at: Math.floor(timers.now / 1000) });
    timers.now += REPLIED_TTL_SECONDS * 1000;
    expect(bob.presence.statusFor(TEAM, MSG)).toBeNull();
  });

  test("перерисовка только при видимом изменении", async () => {
    let { connection, presence } = member(timers, ["bob@example.com", TEAM]);
    presence.start();
    await flush();
    let entry = { type: "presence", mailbox: TEAM, tag: TAG, actor: "a".repeat(16), state: "viewing", name: "Alice", email: "", at: 1 };
    connection.receive(entry);
    expect(presence.revision).toBe(1);
    connection.receive(entry);
    connection.receive({ ...entry, state: "none" });
    connection.receive({ ...entry, state: "none" });
    expect(presence.revision).toBe(2);
  });

  test("не показывает себя с другого устройства и чужие ящики", async () => {
    let { connection, presence } = member(timers, ["bob@example.com", TEAM]);
    presence.start();
    await flush();
    let base = { type: "presence", tag: TAG, state: "replying", name: "Bob", at: 1 };
    connection.receive({ ...base, mailbox: TEAM, actor: "c".repeat(16), email: "bob@example.com" });
    connection.receive({ ...base, mailbox: "sales@example.com", actor: "d".repeat(16), email: "" });
    expect(presence.statusFor(TEAM, MSG)).toBeNull();
    expect(presence.statusFor("sales@example.com", MSG)).toBeNull();
  });

  test("отбрасывает некорректные сообщения сервера", async () => {
    let { connection, presence } = member(timers, ["bob@example.com", TEAM]);
    presence.start();
    await flush();
    let base = { type: "presence", mailbox: TEAM, actor: "a".repeat(16), name: "Alice\u0007", email: "", at: 1 };
    connection.receive({ ...base, tag: "subject", state: "viewing" });
    connection.receive({ ...base, tag: TAG, state: "typing" });
    expect(presence.statusFor(TEAM, MSG)).toBeNull();
    connection.receive({ ...base, tag: TAG, state: "viewing" });
    expect(presence.statusFor(TEAM, MSG)?.viewing[0].name).toBe("Alice");
  });

  test("при разрыве чужие состояния сбрасываются, после входа свои отправляются заново", async () => {
    let { connection, presence } = member(timers, ["alice@example.com", TEAM]);
    presence.start();
    await flush();
    let stop = presence.begin(TEAM, MSG, "replying");
    connection.receive({ type: "presence-snapshot", mailboxes: { [TEAM]: [
      { tag: TAG, actor: "b".repeat(16), state: "viewing", name: "Bob", email: "", at: 1 },
    ] } });
    expect(presence.statusFor(TEAM, MSG)?.viewing.length).toBe(1);
    connection.isOnline = false;
    await flush();
    expect(presence.statusFor(TEAM, MSG)).toBeNull();
    connection.sent = [];
    connection.isOnline = true;
    await flush();
    expect(connection.sent).toEqual([{ type: "presence-watch", mailboxes: [TEAM] }]);
    connection.receive({ type: "presence-snapshot", mailboxes: { [TEAM]: [] } });
    expect(connection.setsOf().map(m => m.state)).toEqual(["replying"]);
    stop();
  });

  test("выключение ящика в настройках снимает его", async () => {
    let enabled = [TEAM];
    let connection = new FakeConnection(["alice@example.com", TEAM]);
    let presence = new SharedMailboxPresence(connection, { enabledMailboxes: () => enabled, setTimer: timers.set, clearTimer: timers.clear });
    presence.start();
    await flush();
    presence.begin(TEAM, MSG, "replying");
    enabled = [];
    presence.refreshMailboxes();
    await flush();
    expect(connection.sent.at(-1)).toEqual({ type: "presence-watch", mailboxes: [] });
    expect(presence.isWatching(TEAM)).toBe(false);
  });
});
