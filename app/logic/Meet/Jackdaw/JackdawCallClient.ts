/**
 * Постоянное соединение с сервисом звонков Jackdaw ↔ Jackdaw.
 *
 * Отвечает за вход по лицензии, подтверждённые адреса (присутствие в сети),
 * справочник «этот адрес сейчас доступен для звонка» и доставку сигналов звонкам.
 * Сам звонок (медиа) — в `JackdawCall`, напрямую между клиентами (P2P WebRTC).
 */
import { Observable, notifyChangedProperty } from "../../util/Observable";
import type { ProCallCredential } from "../../Billing/ProEntitlement";
import {
  isTrustedReverseAddress,
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
  /** Сервис отклонил лицензию: сам клиент не переподключается до её смены, возврата сети,
   * пробуждения системы или кнопки «Переподключить» (`restart()`) */
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
  /** Соединение с сервисом восстановлено после обрыва.
   * @param resumed сервер вернул этот звонок соединению (идущий разговор продолжается) */
  onReconnected?(resumed: boolean): void;
}

export interface JackdawCallClientOptions {
  url: string | null;
  getCredential(): ProCallCredential | null;
  getDisplayName(): string;
  /** Адреса почтовых ящиков и личностей в приложении на этом устройстве.
   * Сервер раздаёт адреса с других устройств лицензии только из этого списка. */
  getMailboxEmails?(): string[];
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
/** Адреса, отключённые на этом устройстве: подтверждения с других устройств лицензии их не включают */
const EXCLUDED_STORAGE_KEY = "jackdaw.calls.excluded-emails.v1";
const SOCKET_OPEN = 1;
const LOOKUP_CACHE_MS = 60_000;
const LOOKUP_DEBOUNCE_MS = 250;
const LOOKUP_BATCH = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 25_000;
/** Сколько ждать `pong` на `ping`. После сна системы или смены сети сокет остаётся «открытым»,
 * хотя TCP уже мёртв, и ОС закрывает его лишь через минуты. */
const PONG_TIMEOUT_MS = 10_000;
/** Сколько ждать `welcome` после начала подключения: иначе молчащий сервер оставил бы клиент «подключающимся» навсегда */
const HANDSHAKE_TIMEOUT_MS = 20_000;
/**
 * Ошибки входа, которыми сервис действительно отказывает этому устройству (call_server/calls.py,
 * `CredentialVerifier.verify`): без новой лицензии повторять вход бессмысленно.
 * Остальные (`service_unavailable`, `rate_limited`, `internal_error`) временные.
 * Закрытие кодом 1008 без `error` — тоже не отказ: так сервер закрывает и «slow consumer», и «closed by server».
 */
const REJECTING_HELLO_ERRORS = new Set(["license_inactive", "device_not_activated", "invalid_credential"]);

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
  /** С какого момента нет связи (`now()`, мс), null — связь есть или клиент выключен */
  @notifyChangedProperty
  offlineSince: number | null = null;
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
  protected handshakeTimer: unknown = null;
  /** Ожидание `pong`: до `pongDeadline` (`now()`, мс) */
  protected pongTimer: unknown = null;
  protected pongDeadline = 0;
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
    this.offlineSince = null;
    this.verifiedEmails = [];
    this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
  }

  /** После смены лицензии или сети, по кнопке «Переподключить»: переподключиться сразу.
   * Время потери связи сохраняется: пока вход не удался, связи по-прежнему нет. */
  restart(): void {
    let offlineSince = this.offlineSince;
    this.stop();
    this.offlineSince = offlineSince;
    this.attempt = 0;
    this.start();
  }

  /** Связь потеряна: клиент переподключается сам или ждёт `restart()` */
  protected markOffline(status: "offline" | "rejected"): void {
    this.offlineSince ??= this.now();
    this.status = status;
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
    this.handshakeTimer = this.setTimer(() => {
      this.handshakeTimer = null;
      if (this.socket != socket || this.status == "online") return;
      this.closeSocket();
      this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
      this.scheduleReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
    socket.onopen = () => {
      if (this.socket != socket) return;
      let excluded = this.readExcluded();
      let mailboxes = this.mailboxEmails();
      this.helloMailboxes = mailboxes;
      this.sendRaw({
        type: "hello",
        credential,
        name: this.options.getDisplayName(),
        emailProofs: Object.entries(this.readProofs())
          .filter(([email]) => !mailboxes || mailboxes.has(email))
          .map(([, proof]) => proof),
        ...(mailboxes ? { mailboxEmails: [...mailboxes] } : {}),
        ...(excluded.length ? { excludedEmails: excluded } : {}),
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
    socket.onclose = () => {
      if (this.socket != socket) return;
      this.socket = null;
      this.clearSocketTimers();
      this.verifiedEmails = [];
      this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
      if (this.stopped || this.status == "rejected") return;
      // Код закрытия не различает отказ и временный сбой: отказ приходит отдельным `error` на `hello`.
      this.scheduleReconnect();
    };
  }

  protected scheduleReconnect(): void {
    this.markOffline("offline");
    let delay = reconnectDelay(this.attempt++);
    this.reconnectTimer = this.setTimer(() => this.connect(), delay);
  }

  protected closeSocket(): void {
    let socket = this.socket;
    this.socket = null;
    this.clearSocketTimers();
    if (socket) {
      try {
        socket.close(1000, "client stopped");
      } catch {
        // Соединение уже закрыто.
      }
    }
  }

  protected clearSocketTimers(): void {
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.clearTimer(this.handshakeTimer);
    this.handshakeTimer = null;
    this.clearTimer(this.pongTimer);
    this.pongTimer = null;
  }

  protected scheduleHeartbeat(): void {
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.setTimer(() => {
      this.checkConnection();
      this.scheduleHeartbeat();
    }, HEARTBEAT_MS);
  }

  /**
   * Проверяет, живо ли соединение на связи: шлёт `ping` и переподключается, если `pong` не пришёл за `timeoutMs`.
   * Повторная проверка до ответа срок не продлевает, только сокращает.
   * Идущий звонок не обрывается, пока соединение отвечает.
   */
  checkConnection(timeoutMs = PONG_TIMEOUT_MS): void {
    let socket = this.socket;
    if (!socket || this.status != "online") return;
    let deadline = this.now() + timeoutMs;
    // Срок ставится до отправки: ответ не может обогнать собственное ожидание.
    if (this.pongTimer == null || deadline < this.pongDeadline) {
      this.clearTimer(this.pongTimer);
      this.pongDeadline = deadline;
      this.pongTimer = this.setTimer(() => {
        this.pongTimer = null;
        if (this.socket != socket) return;
        // Сокет «открыт», но сервер не отвечает: ждать закрытия TCP от ОС — минуты.
        this.closeSocket();
        this.verifiedEmails = [];
        this.failAllWaiters(new JackdawCallServiceError("service_unavailable"));
        this.scheduleReconnect();
      }, timeoutMs);
    }
    this.sendRaw({ type: "ping" });
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
        this.offlineSince = null;
        this.clearTimer(this.handshakeTimer);
        this.handshakeTimer = null;
        this.verifiedEmails = this.ownMailboxesOnly(message.emails);
        this.forgetUnacceptedProofs(this.verifiedEmails, message.proofs);
        this.status = "online";
        this.reachable.clear();
        this.presenceVersion++;
        this.scheduleHeartbeat();
        this.flushLookups();
        this.notifyCallsReconnected(message.resumedCalls);
        break;
      case "pong":
        this.clearTimer(this.pongTimer);
        this.pongTimer = null;
        break;
      case "verified":
        if (!this.isOwnVerification(message.email, message.requestedEmail)) {
          // Коллега с той же лицензией подтвердил свой адрес — это не наш ящик.
          break;
        }
        this.saveProof(message.email, message.proof);
        this.setExcluded(message.email, false);
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
      case "signal":
      case "call-ended":
        this.calls.get(message.callId)?.onSignal(message);
        break;
      case "error":
        if (message.requestType == "hello") {
          this.lastError = serverErrorMessage(message.code);
          // Сокет закроется сервером или здесь.
          this.closeSocket();
          this.verifiedEmails = [];
          this.failAllWaiters(new JackdawCallServiceError(message.code));
          if (REJECTING_HELLO_ERRORS.has(message.code)) {
            // Без новой лицензии повторять вход бессмысленно.
            this.markOffline("rejected");
          } else if (!this.stopped) {
            this.scheduleReconnect();
          }
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

  /** После входа: звонки, которые сервер не вернул соединению, на сервере уже потеряны.
   * Копия списка: звонок может отписаться прямо в обработчике. */
  protected notifyCallsReconnected(resumedCalls: string[]): void {
    for (let call of [...this.calls.values()]) {
      try {
        call.onReconnected?.(resumedCalls.includes(call.callID));
      } catch (ex) {
        console.error(ex);
      }
    }
  }

  // --- подтверждение адресов --------------------------------------------

  async startVerification(emailAddress: string): Promise<void> {
    let email = this.requireEmail(emailAddress);
    this.requestedVerifications.add(email);
    let reply = this.waitFor(message =>
      message.type == "verify-sent" && message.email == email ||
      message.type == "error" && message.requestType == "verify-start" && (message.email == email || !message.email));
    this.send({ type: "verify-start", email });
    await reply;
  }

  async finishVerification(emailAddress: string, code: string): Promise<void> {
    let email = this.requireEmail(emailAddress);
    this.requestedVerifications.add(email);
    let reply = this.waitFor(message =>
      message.type == "verified" && message.email == email ||
      message.type == "error" && message.requestType == "verify-finish" && (message.email == email || !message.email));
    this.send({ type: "verify-finish", email, code: code.replace(/\s/g, "") });
    await reply;
  }

  /**
   * Обратное подтверждение: сервер выдаёт одноразовый адрес, на который нужно
   * отправить письмо с подтверждаемого ящика. Адрес проверяется: только домен сервиса.
   */
  async startReverseVerification(emailAddress: string): Promise<{ token: string, address: string, mailSubject: string, expiresIn: number }> {
    let email = this.requireEmail(emailAddress);
    this.requestedVerifications.add(email);
    let reply = this.waitFor<Extract<JackdawServerMessage, { type: "verify-reverse-ready" }>>(message =>
      message.type == "verify-reverse-ready" && message.email == email ||
      message.type == "error" && message.requestType == "verify-reverse-start" && (message.email == email || !message.email));
    this.send({ type: "verify-reverse-start", email });
    let ready = await reply;
    if (!isTrustedReverseAddress(ready.address, this.options.url)) {
      throw new JackdawCallServiceError("service_unavailable");
    }
    return { token: ready.token, address: ready.address, mailSubject: ready.mailSubject, expiresIn: ready.expiresIn };
  }

  /**
   * Подтверждённый адрес (доказательство уже сохранено) или null, если письмо ещё не пришло.
   * Адрес может отличаться от запрошенного: подтверждается фактический отправитель письма.
   * `emailAddress` — запрошенный адрес: без него ответом считается любое подтверждение,
   * и при нескольких одновременных ожиданиях подтверждение другого адреса закрыло бы это.
   */
  async checkReverseVerification(token: string, emailAddress?: string): Promise<string | null> {
    let requested = emailAddress ? normalizeCallEmail(emailAddress) : null;
    let reply = this.waitFor(message =>
      message.type == "verify-reverse-pending" && message.token == token ||
      message.type == "verified" && (!requested || message.email == requested || message.requestedEmail == requested) ||
      message.type == "error" && message.requestType == "verify-reverse-check");
    this.send({ type: "verify-reverse-check", token });
    let message = await reply;
    return message.type == "verified" ? message.email : null;
  }

  /** Отключает адрес от звонков на этом устройстве. */
  forgetEmail(emailAddress: string): void {
    let email = normalizeCallEmail(emailAddress);
    if (!email) return;
    let proofs = this.readProofs();
    delete proofs[email];
    this.writeProofs(proofs);
    // Иначе сервер вернёт адрес при следующем входе: он подтверждён на другом устройстве лицензии.
    this.setExcluded(email, true);
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

  /**
   * Сервер не принял подтверждение (просрочено, другая лицензия) — убираем, чтобы не показывать адрес подтверждённым.
   * Подтверждения, пришедшие с других устройств лицензии (`received`), сохраняем.
   */
  protected forgetUnacceptedProofs(accepted: string[], received: Record<string, string> = {}): void {
    let proofs = { ...this.readProofs(), ...received };
    let kept = Object.fromEntries(Object.entries(proofs).filter(([email]) => accepted.includes(email)));
    let stored = this.readProofs();
    if (Object.keys(kept).length != Object.keys(stored).length || Object.entries(kept).some(([email, proof]) => stored[email] != proof)) {
      this.writeProofs(kept);
    }
  }

  /** Адреса, подтверждение которых начали на этом устройстве */
  protected requestedVerifications = new Set<string>();

  /** Подтверждение адреса относится к нашему ящику или к проверке, начатой здесь.
   * Иначе это адрес коллеги с той же лицензией: он видел бы себя «своим адресом». */
  protected isOwnVerification(email: string, requestedEmail?: string): boolean {
    let mailboxes = this.mailboxEmails();
    let candidates = [email, normalizeCallEmail(requestedEmail ?? "")].filter((e): e is string => !!e);
    return !mailboxes ||
      candidates.some(e => mailboxes.has(e) || this.requestedVerifications.has(e));
  }

  /** Ящики, о которых сообщили серверу при входе в этом соединении */
  protected helloMailboxes: Set<string> | null = null;

  /** null — ящики ещё не известны (аккаунты не загружены): тогда ничего не отбрасываем */
  protected mailboxEmails(): Set<string> | null {
    let emails = (this.options.getMailboxEmails?.() ?? [])
      .map(normalizeCallEmail)
      .filter((email): email is string => !!email);
    return emails.length ? new Set(emails) : null;
  }

  /** Адрес, подтверждённый на устройстве коллеги с той же лицензией, — не наш:
   * иначе коллега видел себя в нашем адресе («Это ваш собственный адрес»)
   * и получал наши сообщения чата. Такие подтверждения здесь же забываем. */
  protected ownMailboxesOnly(emails: string[]): string[] {
    let mailboxes = this.helloMailboxes;
    return mailboxes ? emails.filter(email => mailboxes.has(email)) : emails;
  }

  protected readExcluded(): string[] {
    try {
      let value = JSON.parse(this.options.storage?.getItem(EXCLUDED_STORAGE_KEY) ?? "[]");
      return Array.isArray(value) ? [...new Set(value.map(normalizeCallEmail).filter((e): e is string => !!e))] : [];
    } catch {
      return [];
    }
  }

  protected setExcluded(email: string, excluded: boolean): void {
    let current = this.readExcluded();
    if (current.includes(email) == excluded) return;
    let next = excluded ? [...current, email] : current.filter(e => e != email);
    try {
      if (next.length) {
        this.options.storage?.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify(next));
      } else {
        this.options.storage?.removeItem(EXCLUDED_STORAGE_KEY);
      }
    } catch {
      // Без хранилища отключение действует до перезапуска.
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
