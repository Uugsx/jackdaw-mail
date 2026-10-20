/**
 * Кто из коллег читает письмо общего ящика или уже отвечает на него — чтобы клиенту не ушло два ответа.
 *
 * Идёт по соединению сервиса звонков (call_server/presence.py). Сервер раздаёт состояния только
 * соединениям, подтвердившим тот же адрес ящика, и видит вместо письма метку (collisionTag.ts).
 * Модуль не знает про письма и интерфейс: их связывает `collisionMail.ts`.
 */
import { Observable, notifyChangedProperty } from "../../util/Observable";
import type { JackdawPresenceEntry, JackdawServerMessage } from "../../Meet/Jackdaw/JackdawCallProtocol";
import { collisionTag } from "./collisionTag";

export type CollisionActivity = "viewing" | "replying";

export interface CollisionColleague {
  actor: string;
  name: string;
  /** Личный адрес коллеги для чата, "" — неизвестен */
  email: string;
  /** Unix, с */
  at: number;
}

export interface CollisionStatus {
  /** Отвечают сейчас; первым — кто начал раньше */
  replying: CollisionColleague[];
  viewing: CollisionColleague[];
  /** Последний ответ коллеги, если он ещё не устарел */
  replied: CollisionColleague | null;
}

/** То, что нужно от `JackdawCallClient`. Позволяет тестам подставить своё соединение. */
export interface PresenceConnection {
  readonly isOnline: boolean;
  readonly verifiedEmails: string[];
  send(message: Record<string, unknown>): void;
  addListener(listener: (message: JackdawServerMessage) => void): () => void;
  subscribe(observer: () => void): () => void;
}

export interface SharedMailboxPresenceOptions {
  /** Общие ящики, для которых присутствие включено (в нижнем регистре) */
  enabledMailboxes(): string[];
  /** Свой подтверждённый личный адрес: по нему коллега откроет чат. null — не сообщать */
  replyAddress?(mailbox: string): string | null;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Часы, мс */
  now?(): number;
}

/** Сервер снимает «читает» и «отвечает» через 150 с без продления */
export const PRESENCE_REFRESH_MS = 60_000;
/** Письма листают стрелками: «читает» уходит, только если письмо открыто дольше этого */
export const VIEWING_DELAY_MS = 600;
/** Совпадает с REPLIED_TTL_SECONDS на сервере */
export const REPLIED_TTL_SECONDS = 24 * 60 * 60;
const MAX_TAG_CACHE = 10_000;

interface RemoteTag {
  active: Map<string, JackdawPresenceEntry>;
  replied: JackdawPresenceEntry | null;
}

interface OwnActivity {
  mailbox: string;
  tag: string;
  /** Кто сейчас держит письмо: открытое письмо и черновик ответа — разные держатели */
  holders: Map<symbol, CollisionActivity>;
  /** Что уже сообщено серверу */
  sent: CollisionActivity | null;
  viewingTimer: unknown;
}

export class SharedMailboxPresence extends Observable {
  /** Меняется, только когда меняется видимое состояние коллег: строки списка не перерисовываются зря */
  @notifyChangedProperty
  revision = 0;

  protected readonly connection: PresenceConnection;
  protected readonly options: SharedMailboxPresenceOptions;
  protected readonly remote = new Map<string, Map<string, RemoteTag>>();
  protected readonly own = new Map<string, OwnActivity>();
  protected readonly tags = new Map<string, string | null>();
  /** Ящики, о которых сообщено серверу; null — ещё не сообщено на этом соединении */
  protected watched: string[] | null = null;
  protected syncScheduled = false;
  protected refreshTimer: unknown = null;
  protected stopListening: (() => void) | null = null;

  constructor(connection: PresenceConnection, options: SharedMailboxPresenceOptions) {
    super();
    this.connection = connection;
    this.options = options;
  }

  /** @returns остановка */
  start(): () => void {
    if (!this.stopListening) {
      let removeListener = this.connection.addListener(message => this.onMessage(message));
      let unsubscribe = this.connection.subscribe(() => this.scheduleSync());
      this.stopListening = () => {
        removeListener();
        unsubscribe();
      };
    }
    this.scheduleSync();
    return () => this.stop();
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.clearTimer(this.refreshTimer);
    this.refreshTimer = null;
    for (let activity of this.own.values()) {
      this.clearTimer(activity.viewingTimer);
    }
    this.own.clear();
    this.watched = null;
    this.clearRemote();
  }

  /** Настройки или список общих ящиков изменились */
  refreshMailboxes(): void {
    this.scheduleSync();
  }

  isWatching(mailbox: string): boolean {
    return !!this.watched?.includes(mailbox);
  }

  // --- что делают коллеги ------------------------------------------------

  /** null — никто из коллег не работает с письмом */
  statusFor(mailbox: string, messageID: string | null | undefined): CollisionStatus | null {
    let byTag = this.remote.get(mailbox);
    if (!byTag?.size) return null;
    let tag = this.tagFor(mailbox, messageID);
    let remote = tag ? byTag.get(tag) : null;
    if (!remote) return null;
    let mine = new Set(this.connection.verifiedEmails);
    let status: CollisionStatus = { replying: [], viewing: [], replied: null };
    for (let entry of remote.active.values()) {
      if (entry.email && mine.has(entry.email)) continue; // своё другое устройство
      (entry.state == "replying" ? status.replying : status.viewing).push(colleague(entry));
    }
    let replied = remote.replied;
    let nowSeconds = this.now() / 1000;
    if (replied && !(replied.email && mine.has(replied.email)) && nowSeconds - replied.at < REPLIED_TTL_SECONDS) {
      status.replied = colleague(replied);
    }
    status.replying.sort((a, b) => a.at - b.at);
    status.viewing.sort((a, b) => a.at - b.at);
    return status.replying.length || status.viewing.length || status.replied ? status : null;
  }

  // --- что делаю я -------------------------------------------------------

  /**
   * Сообщает коллегам, что письмо открыто или на него пишется ответ.
   * @returns снятие; вызывать при закрытии письма или черновика
   */
  begin(mailbox: string, messageID: string | null | undefined, activity: CollisionActivity): () => void {
    let tag = this.tagFor(mailbox, messageID);
    if (!tag) return () => {};
    let key = `${mailbox}\n${tag}`;
    let own = this.own.get(key);
    if (!own) {
      own = { mailbox, tag, holders: new Map(), sent: null, viewingTimer: null };
      this.own.set(key, own);
    }
    let holder = Symbol(activity);
    own.holders.set(holder, activity);
    this.update(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      let current = this.own.get(key);
      current?.holders.delete(holder);
      this.update(key);
    };
  }

  /** Ответ отправлен: коллеги увидят «Ответил: Имя, 12:34» */
  markReplied(mailbox: string, messageID: string | null | undefined): void {
    let tag = this.tagFor(mailbox, messageID);
    if (!tag) return;
    let own = this.own.get(`${mailbox}\n${tag}`);
    if (own) {
      // «Ответил» на сервере заменяет «отвечает»; черновик закроется сам и снимет своё.
      own.sent = null;
      own.holders.forEach((activity, holder) => activity == "replying" && own.holders.delete(holder));
    }
    this.sendState(mailbox, tag, "replied");
    if (own) this.update(`${mailbox}\n${tag}`);
  }

  protected update(key: string): void {
    let own = this.own.get(key);
    if (!own) return;
    let wanted = effectiveActivity(own.holders);
    if (wanted == own.sent && wanted != "viewing") {
      this.forget(key, own);
      return;
    }
    if (wanted == "viewing" && own.sent == null) {
      own.viewingTimer ??= this.setTimer(() => {
        own.viewingTimer = null;
        if (this.own.get(key) == own && effectiveActivity(own.holders) == "viewing" && own.sent == null) {
          own.sent = "viewing";
          this.sendState(own.mailbox, own.tag, "viewing");
          this.scheduleRefresh();
        }
      }, VIEWING_DELAY_MS);
      return;
    }
    this.clearTimer(own.viewingTimer);
    own.viewingTimer = null;
    if (wanted == own.sent) return;
    if (wanted == null) {
      this.sendState(own.mailbox, own.tag, "none");
    } else {
      this.sendState(own.mailbox, own.tag, wanted);
      this.scheduleRefresh();
    }
    own.sent = wanted;
    this.forget(key, own);
  }

  protected forget(key: string, own: OwnActivity): void {
    if (!own.holders.size && own.sent == null) {
      this.clearTimer(own.viewingTimer);
      this.own.delete(key);
    }
  }

  protected sendState(mailbox: string, tag: string, state: CollisionActivity | "replied" | "none"): void {
    if (!this.connection.isOnline || !this.isWatching(mailbox)) return; // после входа отправится заново
    let message: Record<string, unknown> = { type: "presence-set", mailbox, tag, state };
    let from = this.options.replyAddress?.(mailbox);
    if (from) message.from = from;
    try {
      this.connection.send(message);
    } catch {
      // Связь пропала: после нового входа состояние уйдёт снова.
    }
  }

  protected scheduleRefresh(): void {
    if (this.refreshTimer != null) return;
    this.refreshTimer = this.setTimer(() => {
      this.refreshTimer = null;
      let any = false;
      for (let own of this.own.values()) {
        if (own.sent) {
          this.sendState(own.mailbox, own.tag, own.sent);
          any = true;
        }
      }
      if (any) this.scheduleRefresh();
    }, PRESENCE_REFRESH_MS);
  }

  /** После входа или смены ящиков сервер не знает своих состояний: отправляем их заново */
  protected resendOwn(): void {
    for (let own of this.own.values()) {
      if (own.sent) this.sendState(own.mailbox, own.tag, own.sent);
    }
  }

  // --- соединение --------------------------------------------------------

  protected scheduleSync(): void {
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      this.sync();
    });
  }

  protected sync(): void {
    if (!this.stopListening) return;
    if (!this.connection.isOnline) {
      // Сервер уже снял наши состояния; чужие могли устареть, пока нет связи.
      this.watched = null;
      this.clearRemote();
      return;
    }
    let verified = new Set(this.connection.verifiedEmails);
    let mailboxes = [...new Set(this.options.enabledMailboxes())].filter(m => verified.has(m)).sort();
    if (this.watched && sameList(this.watched, mailboxes)) return;
    if (this.watched == null && !mailboxes.length) {
      this.watched = [];
      return;
    }
    try {
      this.connection.send({ type: "presence-watch", mailboxes });
    } catch {
      return;
    }
    this.watched = mailboxes;
    for (let [key, own] of this.own) {
      if (!mailboxes.includes(own.mailbox)) {
        this.clearTimer(own.viewingTimer);
        this.own.delete(key);
      }
    }
  }

  protected onMessage(message: JackdawServerMessage): void {
    if (message.type == "presence-snapshot") {
      let changed = this.remote.size > 0;
      this.remote.clear();
      for (let [mailbox, entries] of Object.entries(message.mailboxes)) {
        if (!this.isWatching(mailbox)) continue;
        for (let entry of entries) {
          this.apply(mailbox, entry);
          changed = true;
        }
      }
      if (changed) this.revision++;
      this.resendOwn();
    } else if (message.type == "presence") {
      if (!this.isWatching(message.mailbox)) return;
      let { type: _type, mailbox, ...entry } = message;
      if (this.apply(mailbox, entry)) this.revision++;
    }
  }

  /** @returns изменилось ли что-то видимое */
  protected apply(mailbox: string, entry: JackdawPresenceEntry): boolean {
    let byTag = this.remote.get(mailbox);
    if (!byTag) {
      if (entry.state == "none") return false;
      byTag = new Map();
      this.remote.set(mailbox, byTag);
    }
    let remote = byTag.get(entry.tag);
    if (!remote) {
      if (entry.state == "none") return false;
      remote = { active: new Map(), replied: null };
      byTag.set(entry.tag, remote);
    }
    let changed: boolean;
    if (entry.state == "none") {
      changed = remote.active.delete(entry.actor);
    } else if (entry.state == "replied") {
      // Ответивший больше не «отвечает»
      remote.active.delete(entry.actor);
      changed = !sameEntry(remote.replied, entry);
      remote.replied = entry;
    } else {
      changed = !sameEntry(remote.active.get(entry.actor) ?? null, entry);
      remote.active.set(entry.actor, entry);
    }
    if (!remote.active.size && !remote.replied) {
      byTag.delete(entry.tag);
      if (!byTag.size) this.remote.delete(mailbox);
    }
    return changed;
  }

  protected clearRemote(): void {
    if (!this.remote.size) return;
    this.remote.clear();
    this.revision++;
  }

  protected tagFor(mailbox: string, messageID: string | null | undefined): string | null {
    if (!messageID) return null;
    let key = `${mailbox}\n${messageID}`;
    let tag = this.tags.get(key);
    if (tag === undefined) {
      if (this.tags.size >= MAX_TAG_CACHE) this.tags.clear();
      tag = collisionTag(mailbox, messageID);
      this.tags.set(key, tag);
    }
    return tag;
  }

  protected setTimer(callback: () => void, ms: number): unknown {
    return this.options.setTimer ? this.options.setTimer(callback, ms) : setTimeout(callback, ms);
  }

  protected clearTimer(handle: unknown): void {
    if (handle == null) return;
    if (this.options.clearTimer) {
      this.options.clearTimer(handle);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }

  protected now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

function effectiveActivity(holders: Map<symbol, CollisionActivity>): CollisionActivity | null {
  let result: CollisionActivity | null = null;
  for (let activity of holders.values()) {
    if (activity == "replying") return "replying";
    result = "viewing";
  }
  return result;
}

function colleague(entry: JackdawPresenceEntry): CollisionColleague {
  return { actor: entry.actor, name: entry.name, email: entry.email, at: entry.at };
}

function sameEntry(a: JackdawPresenceEntry | null, b: JackdawPresenceEntry): boolean {
  return !!a && a.state == b.state && a.name == b.name && a.email == b.email && a.at == b.at;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length == b.length && a.every((value, i) => value == b[i]);
}
