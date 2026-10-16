/**
 * Постоянное соединение с сервисом звонков Jackdaw ↔ Jackdaw.
 *
 * Отвечает за вход по лицензии, подтверждённые адреса (присутствие в сети),
 * справочник «этот адрес сейчас доступен для звонка» и доставку сигналов звонкам.
 * Сам звонок (медиа) — в `JackdawCall` через LiveKit.
 */
import { Observable, notifyChangedProperty } from "../../util/Observable";
import type { ProCallCredential } from "../../Billing/ProEntitlement";
import {
  normalizeCallEmail,
  parseServerMessage,
  reconnectDelay,
  serverErrorMessage,
  type JackdawServerMessage,
} from "./JackdawCallProtocol";

export type JackdawCallStatus =
  /** Нет лицензии Pro или пробного периода на этом устройстве */
  | "disabled"
  | "connecting"
  | "online"
  /** Сеть или сервис недоступны, идёт переподключение */
  | "offline"
  /** Сервис отклонил лицензию: переподключаться бессмысленно до её смены */
  | "rejected";

/** Минимум WebSocket, который нужен клиенту. Позволяет тестам подставить свой транспорт. */
export interface CallSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Получатель сигналов одного звонка. */
export interface JackdawCallSignalTarget {
  readonly callID: string;
  onSignal(message: JackdawServerMessage): void;
}

export interface JackdawCallClientOptions {
  url: string | null;
  getCredential(): ProCallCredential | null;
  getDisplayName(): string;
  createSocket?(url: string): CallSocket;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  onIncoming?(message: Extract<JackdawServerMessage, { type: "incoming" }>): void;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
}

export class JackdawCallServiceError extends Error {
  constructor(readonly code: string) {
    super(serverErrorMessage(code));
    this.name = "JackdawCallServiceError";
  }
}

const PROOFS_STORAGE_KEY = "jackdaw.calls.email-proofs.v1";
const SOCKET_OPEN = 1;
const LOOKUP_CACHE_MS = 60_000;
const LOOKUP_DEBOUNCE_MS = 250;
const LOOKUP_BATCH = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 25_000;
/** Сервис закрывает соединение кодом 1008 при отзыве лицензии или нарушении протокола. */
const POLICY_VIOLATION_CLOSE = 1008;

interface Waiter {
  match(message: JackdawServerMessage): boolean;
  resolve(message: JackdawServerMessage): void;
  reject(error: Error): void;
  timer: unknown;
}

export class JackdawCallClient extends Observable {
  @notifyChangedProperty
  status: JackdawCallStatus = "disabled";
  /** Последняя ошибка сервиса, для показа в настройках */
  @notifyChangedProperty
  lastError: string | null = null;
  /** Адреса, подтверждённые для звонков и сейчас зарегистрированные на сервере */
  @notifyChangedProperty
  verifiedEmails: string[] = [];
  /** Меняется при каждом обновлении справочника, чтобы интерфейс перерисовал кнопки звонка */
  @notifyChangedProperty
  presenceVersion = 0;

  protected readonly options: JackdawCallClientOptions;
  protected socket: CallSocket | null = null;
  protected stopped = true;
  protected attempt = 0;
  protected reconnectTimer: unknown = null;
  protected heartbeatTimer: unknown = null;
  protected lookupTimer: unknown = null;
  protected readonly lookupQueue = new Set<string>();
  protected readonly reachable = new Map<string, { value: boolean; at: number }>();
  protected readonly waiters = new Set<Waiter>();
  protected readonly calls = new Map<string, JackdawCallSignalTarget>();
  /** Остальные получатели сообщений сервера, например чат */
  protected readonly listeners = new Set<(message: JackdawServerMessage) => void>();
  protected requestCounter = 0;

  constructor(options: JackdawCallClientOptions) {
    super();
    this.options = options;
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

  get isOnline(): boolean {
    return this.status == "online";
  }

  /** Подключается, если на устройстве есть Pro. Повторный вызов безопасен. */
  start(): void {
    this.stopped = false;
    if (this.socket || this.reconnectTimer != null) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeSocket();
    this.status = "disabled";
    this.verifiedEmails = [];
    this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
  }

  /** После смены лицензии или сети: переподключиться сразу. */
  restart(): void {
    this.stop();
    this.attempt = 0;
    this.start();
  }

  protected connect(): void {
    this.reconnectTimer = null;
    if (this.stopped) return;
    let credential = this.options.getCredential();
    if (!this.options.url || !credential) {
      this.status = "disabled";
      return;
    }
    this.status = "connecting";
    let socket: CallSocket;
    try {
      socket = this.options.createSocket
        ? this.options.createSocket(this.options.url)
        : new WebSocket(this.options.url) as unknown as CallSocket;
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket != socket) return;
      this.sendRaw({
        type: "hello",
        credential,
        name: this.options.getDisplayName(),
        emailProofs: Object.values(this.readProofs()),
        activeCalls: [...this.calls.keys()],
      });
    };
    socket.onmessage = event => {
      if (this.socket != socket) return;
      let message = parseServerMessage(event.data);
      if (message) {
        this.onMessage(message);
      }
    };
    socket.onerror = () => {
      // Подробности придут в onclose; сам браузер не раскрывает причину ошибки.
    };
    socket.onclose = event => {
      if (this.socket != socket) return;
      this.socket = null;
      this.clearTimer(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.verifiedEmails = [];
      this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
      if (this.stopped) return;
      if (this.status == "rejected" || (event as { code?: number })?.code == POLICY_VIOLATION_CLOSE && this.status != "online") {
        this.status = "rejected";
        return;
      }
      this.scheduleReconnect();
    };
  }

  protected scheduleReconnect(): void {
    this.status = "offline";
    let delay = reconnectDelay(this.attempt++);
    this.reconnectTimer = this.setTimer(() => this.connect(), delay);
  }

  protected closeSocket(): void {
    let socket = this.socket;
    this.socket = null;
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (socket) {
      try {
        socket.close(1000, "client stopped");
      } catch {
        // Соединение уже закрыто.
      }
    }
  }

  protected scheduleHeartbeat(): void {
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.setTimer(() => {
      this.sendRaw({ type: "ping" });
      this.scheduleHeartbeat();
    }, HEARTBEAT_MS);
  }

  protected sendRaw(message: Record<string, unknown>): boolean {
    let socket = this.socket;
    if (!socket || socket.readyState != SOCKET_OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  /** Отправляет сообщение звонка. @throws если соединения нет */
  send(message: Record<string, unknown>): void {
    if (!this.sendRaw(message)) {
      throw new JackdawCallServiceError("service_unavailable");
    }
  }

  protected onMessage(message: JackdawServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.attempt = 0;
        this.lastError = null;
        this.verifiedEmails = message.emails;
        this.forgetUnacceptedProofs(message.emails);
        this.status = "online";
        this.reachable.clear();
        this.presenceVersion++;
        this.scheduleHeartbeat();
        this.flushLookups();
        break;
      case "verified":
        this.saveProof(message.email, message.proof);
        if (!this.verifiedEmails.includes(message.email)) {
          this.verifiedEmails = [...this.verifiedEmails, message.email].sort();
        }
        break;
      case "lookup-result": {
        let at = this.now();
        for (let [email, value] of Object.entries(message.reachable)) {
          this.reachable.set(email, { value, at });
        }
        this.presenceVersion++;
        break;
      }
      case "incoming":
        if (!this.calls.has(message.callId)) {
          this.options.onIncoming?.(message);
        }
        break;
      case "ringing":
      case "accepted":
      case "joined":
      case "call-ended":
        this.calls.get(message.callId)?.onSignal(message);
        break;
      case "error":
        if (message.requestType == "hello") {
          this.status = "rejected";
          this.lastError = serverErrorMessage(message.code);
          // Сокет закроется сервером или здесь; без новой лицензии повторять вход бессмысленно.
          this.closeSocket();
          this.failAllWaiters(new JackdawCallServiceError(message.code));
          return;
        }
        if (message.callId) {
          this.calls.get(message.callId)?.onSignal(message);
        }
        break;
    }
    for (let listener of [...this.listeners]) {
      try {
        listener(message);
      } catch (ex) {
        console.error(ex);
      }
    }
    for (let waiter of [...this.waiters]) {
      if (waiter.match(message)) {
        this.waiters.delete(waiter);
        this.clearTimer(waiter.timer);
        if (message.type == "error") {
          waiter.reject(new JackdawCallServiceError(message.code));
        } else {
          waiter.resolve(message);
        }
      }
    }
  }

  /** Ждёт ответа сервера. Ошибка с тем же типом запроса и ключом отклоняет ожидание. */
  protected waitFor<T extends JackdawServerMessage>(
    match: (message: JackdawServerMessage) => boolean,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let waiter: Waiter = {
        match,
        resolve: resolve as (message: JackdawServerMessage) => void,
        reject,
        timer: null,
      };
      waiter.timer = this.setTimer(() => {
        this.waiters.delete(waiter);
        reject(new JackdawCallServiceError("service_unavailable"));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  protected failAllWaiters(error: Error): void {
    for (let waiter of this.waiters) {
      this.clearTimer(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  /** Подписка на все сообщения сервера. @returns отписка */
  addListener(listener: (message: JackdawServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Отправляет запрос и ждёт ответ, который распознаёт `match`. Ошибку сервера `match` тоже должен распознать. */
  async request<T extends JackdawServerMessage>(
    message: Record<string, unknown>,
    match: (reply: JackdawServerMessage) => boolean,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    let reply = this.waitFor<T>(match, timeoutMs);
    try {
      this.send(message);
    } catch (ex) {
      reply.catch(() => {});
      throw ex;
    }
    return await reply;
  }

  nextRequestID(prefix: string): string {
    return `${prefix}-${++this.requestCounter}`;
  }

  // --- звонки ---------------------------------------------------------

  register(call: JackdawCallSignalTarget): void {
    this.calls.set(call.callID, call);
  }

  unregister(call: JackdawCallSignalTarget): void {
    if (this.calls.get(call.callID) == call) {
      this.calls.delete(call.callID);
    }
  }

  // --- подтверждение адресов --------------------------------------------

  async startVerification(emailAddress: string): Promise<void> {
    let email = this.requireEmail(emailAddress);
    let reply = this.waitFor(message =>
      message.type == "verify-sent" && message.email == email ||
      message.type == "error" && message.requestType == "verify-start" && (message.email == email || !message.email));
    this.send({ type: "verify-start", email });
    await reply;
  }

  async finishVerification(emailAddress: string, code: string): Promise<void> {
    let email = this.requireEmail(emailAddress);
    let reply = this.waitFor(message =>
      message.type == "verified" && message.email == email ||
      message.type == "error" && message.requestType == "verify-finish" && (message.email == email || !message.email));
    this.send({ type: "verify-finish", email, code: code.replace(/\s/g, "") });
    await reply;
  }

  /** Отключает адрес от звонков на этом устройстве. */
  forgetEmail(emailAddress: string): void {
    let email = normalizeCallEmail(emailAddress);
    if (!email) return;
    let proofs = this.readProofs();
    delete proofs[email];
    this.writeProofs(proofs);
    this.verifiedEmails = this.verifiedEmails.filter(e => e != email);
    // Сервер узнаёт об этом при новом входе: регистрация адресов живёт только в соединении.
    if (this.socket) {
      this.restart();
    }
  }

  protected requireEmail(emailAddress: string): string {
    let email = normalizeCallEmail(emailAddress);
    if (!email) {
      throw new JackdawCallServiceError("invalid_email");
    }
    return email;
  }

  protected readProofs(): Record<string, string> {
    try {
      let raw = this.options.storage?.getItem(PROOFS_STORAGE_KEY);
      let value = raw ? JSON.parse(raw) : {};
      if (!value || typeof value != "object" || Array.isArray(value)) return {};
      let result: Record<string, string> = {};
      for (let [email, proof] of Object.entries(value)) {
        let normalized = normalizeCallEmail(email);
        if (normalized && typeof proof == "string") result[normalized] = proof;
      }
      return result;
    } catch {
      return {};
    }
  }

  protected writeProofs(proofs: Record<string, string>): void {
    try {
      if (Object.keys(proofs).length) {
        this.options.storage?.setItem(PROOFS_STORAGE_KEY, JSON.stringify(proofs));
      } else {
        this.options.storage?.removeItem(PROOFS_STORAGE_KEY);
      }
    } catch {
      // Без хранилища подтверждение работает до перезапуска.
    }
  }

  protected saveProof(email: string, proof: string): void {
    this.writeProofs({ ...this.readProofs(), [email]: proof });
  }

  /** Сервер не принял подтверждение (просрочено, другая лицензия) — убираем, чтобы не показывать адрес подтверждённым. */
  protected forgetUnacceptedProofs(accepted: string[]): void {
    let proofs = this.readProofs();
    let kept = Object.fromEntries(Object.entries(proofs).filter(([email]) => accepted.includes(email)));
    if (Object.keys(kept).length != Object.keys(proofs).length) {
      this.writeProofs(kept);
    }
  }

  // --- справочник -------------------------------------------------------

  /**
   * Можно ли сейчас позвонить на этот адрес через Jackdaw.
   * @returns undefined, пока ответа нет; тогда запрос уже поставлен в очередь.
   */
  isReachable(emailAddress: string | null | undefined): boolean | undefined {
    let email = normalizeCallEmail(emailAddress);
    if (!email || !this.isOnline || this.verifiedEmails.includes(email)) return email ? false : undefined;
    let cached = this.reachable.get(email);
    if (cached && this.now() - cached.at < LOOKUP_CACHE_MS) {
      return cached.value;
    }
    this.queueLookup(email);
    return cached?.value;
  }

  /** Спрашивает сервер сразу. Для нажатия кнопки звонка, когда кэш устарел. */
  async lookupNow(emailAddresses: string[]): Promise<Record<string, boolean>> {
    let emails = [...new Set(emailAddresses.map(normalizeCallEmail).filter((e): e is string => !!e))].slice(0, LOOKUP_BATCH);
    if (!emails.length || !this.isOnline) return {};
    let requestId = `lookup-${++this.requestCounter}`;
    let reply = this.waitFor<Extract<JackdawServerMessage, { type: "lookup-result" }>>(message =>
      message.type == "lookup-result" && message.requestId == requestId ||
      message.type == "error" && message.requestId == requestId);
    this.send({ type: "lookup", requestId, emails });
    return (await reply).reachable;
  }

  protected queueLookup(email: string): void {
    this.lookupQueue.add(email);
    if (this.lookupTimer == null) {
      this.lookupTimer = this.setTimer(() => this.flushLookups(), LOOKUP_DEBOUNCE_MS);
    }
  }

  protected flushLookups(): void {
    this.clearTimer(this.lookupTimer);
    this.lookupTimer = null;
    if (!this.isOnline || !this.lookupQueue.size) return;
    let emails = [...this.lookupQueue].slice(0, LOOKUP_BATCH);
    for (let email of emails) {
      this.lookupQueue.delete(email);
    }
    this.sendRaw({ type: "lookup", requestId: `lookup-${++this.requestCounter}`, emails });
    if (this.lookupQueue.size) {
      this.lookupTimer = this.setTimer(() => this.flushLookups(), LOOKUP_DEBOUNCE_MS);
    }
  }
}
