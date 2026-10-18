import type { Query } from "../../../lib/rs-sqlite";
import type { BatchStep } from "../../../lib/rs-sqlite/batch";
import { deserializeError, type SQLiteOperation, type SQLiteRequest, type SQLiteResponse } from "./protocol";

/** Транспорт к процессу базы. В приложении — utilityProcess, в тестах — сервер в том же процессе. */
export interface SQLiteChannel {
  send(request: SQLiteRequest): void;
  terminate(): void;
}

export interface SQLiteChannelHandlers {
  onResponse(response: SQLiteResponse): void;
  /** Процесс базы завершился. После `terminate()` не вызывается. */
  onExit(reason: string): void;
}

export type SQLiteChannelFactory = (handlers: SQLiteChannelHandlers) => SQLiteChannel;

/** Сколько аварийных перезапусков процесса базы допускаем за окно времени. */
const kMaxRestarts = 5;
const kRestartWindowMs = 60_000;
/** Сколько ждать закрытия баз (контрольная точка WAL) при остановке бэкенда. */
const kShutdownTimeoutMs = 5_000;
/** Pragma, задающие состояние соединения: после перезапуска процесса их нужно повторить. */
const kConnectionPragmaRE = /^\s*(foreign_keys|synchronous|busy_timeout)\s*=\s*([^;]+?)\s*;?\s*$/i;

type PendingRequest = {
  resolve(result: any): void;
  reject(ex: Error): void;
};

/** Один запущенный процесс базы и ожидающие его ответа запросы. */
class ChannelState {
  readonly pending = new Map<number, PendingRequest>();
  channel!: SQLiteChannel;
  alive = true;

  constructor(readonly generation: number) {
  }

  failAll(reason: string): void {
    this.alive = false;
    for (let pending of this.pending.values()) {
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

/** То, что знает FinalizationRegistry о забытой базе (без ссылки на сам объект). */
type DatabaseHandle = {
  dbID: number | null;
  generation: number;
};

/**
 * Владеет процессом SQLite и маршрутизирует к нему запросы.
 * Если процесс упал, следующий запрос запускает новый, а базы
 * переоткрываются при первом обращении к ним.
 */
export class SQLiteHost {
  #current: ChannelState | null = null;
  #generation = 0;
  #nextRequestID = 1;
  #crashTimes: number[] = [];
  #leakedDatabases = new FinalizationRegistry<DatabaseHandle>(handle => this.closeHandle(handle));

  constructor(protected readonly createChannel: SQLiteChannelFactory) {
  }

  /** Поколение живого процесса базы или -1, если процесс не запущен. */
  get liveGeneration(): number {
    return this.#current?.alive ? this.#current.generation : -1;
  }

  async openDatabase(filename: string | null, options: any, buffer?: Uint8Array): Promise<RemoteSQLiteDatabase> {
    let database = new RemoteSQLiteDatabase(this, filename, options, buffer);
    await database.connect();
    return database;
  }

  /** Отправляет запрос в процесс базы, при необходимости запуская его. */
  request(operation: SQLiteOperation): Promise<any> {
    let state: ChannelState;
    try {
      state = this.ensureChannel();
    } catch (ex) {
      return Promise.reject(ex);
    }
    return this.requestOn(state, operation);
  }

  /** Закрывает все базы и останавливает процесс. Следующий запрос запустит новый процесс. */
  async shutdown(): Promise<void> {
    let state = this.#current;
    this.#current = null;
    if (!state?.alive) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.requestOn(state, { op: "closeAll" }),
        new Promise(resolve => timeout = setTimeout(resolve, kShutdownTimeoutMs)),
      ]);
    } catch (ex) {
      console.error("SQLite: closing databases failed", ex);
    } finally {
      clearTimeout(timeout);
      state.failAll("SQLite process was stopped");
      state.channel.terminate();
    }
  }

  /** @internal Для RemoteSQLiteDatabase */
  trackDatabase(database: RemoteSQLiteDatabase, handle: DatabaseHandle): void {
    this.#leakedDatabases.register(database, handle, handle);
  }

  /** @internal Для RemoteSQLiteDatabase */
  untrackDatabase(handle: DatabaseHandle): void {
    this.#leakedDatabases.unregister(handle);
  }

  /** Renderer больше не держит базу (JPC отпустил объект), а close() не вызывали. */
  protected closeHandle(handle: DatabaseHandle): void {
    if (handle.dbID == null || handle.generation != this.liveGeneration) {
      return;
    }
    this.request({ op: "close", dbID: handle.dbID }).catch(() => undefined);
  }

  protected ensureChannel(): ChannelState {
    if (this.#current?.alive) {
      return this.#current;
    }
    let crashed = !!this.#current;
    if (crashed) {
      let now = Date.now();
      this.#crashTimes = this.#crashTimes.filter(time => now - time < kRestartWindowMs);
      if (this.#crashTimes.length >= kMaxRestarts) {
        throw new Error("SQLite process keeps crashing, not restarting it");
      }
      this.#crashTimes.push(now);
    }
    let state = new ChannelState(++this.#generation);
    state.channel = this.createChannel({
      onResponse: response => this.onResponse(state, response),
      onExit: reason => {
        if (!state.alive) {
          return;
        }
        console.error("SQLite:", reason);
        state.failAll(reason);
      },
    });
    this.#current = state;
    return state;
  }

  protected requestOn(state: ChannelState, operation: SQLiteOperation): Promise<any> {
    let requestID = this.#nextRequestID++;
    return new Promise((resolve, reject) => {
      state.pending.set(requestID, { resolve, reject });
      try {
        state.channel.send({ ...operation, requestID } as SQLiteRequest);
      } catch (ex) {
        state.pending.delete(requestID);
        reject(ex);
      }
    });
  }

  protected onResponse(state: ChannelState, response: SQLiteResponse): void {
    let pending = state.pending.get(response?.requestID);
    if (!pending) {
      return;
    }
    state.pending.delete(response.requestID);
    if ("error" in response) {
      pending.reject(deserializeError(response.error));
    } else {
      pending.resolve(response.binary ? restoreBuffers(response.result) : response.result);
    }
  }
}

/**
 * База, которую renderer получает через JPC вместо `Database` из
 * @radically-straightforward/sqlite. Методы те же (migrate, execute, run, get,
 * all, pragma, close) плюс `batch()`; все запросы выполняются в процессе базы.
 *
 * Внутреннее состояние — только в #-полях: JPC передаёт renderer'у
 * собственные свойства объекта.
 */
export class RemoteSQLiteDatabase {
  #host: SQLiteHost;
  #filename: string | null;
  #options: any;
  #buffer: Uint8Array | undefined;
  #handle: DatabaseHandle = { dbID: null, generation: -1 };
  #connecting: Promise<number> | null = null;
  #closed = false;
  #migrated = false;
  /** Последние значения pragma соединения, по имени */
  #connectionPragmas = new Map<string, string>();

  constructor(host: SQLiteHost, filename: string | null, options: any, buffer?: Uint8Array) {
    this.#host = host;
    this.#filename = filename;
    this.#options = options;
    this.#buffer = buffer;
  }

  /** @internal Открывает базу в процессе SQLite. */
  async connect(): Promise<void> {
    await this.#connected();
    this.#host.trackDatabase(this, this.#handle);
  }

  /**
   * Миграции в том же порядке и с той же семантикой, что у
   * @radically-straightforward/sqlite: каждая — в своей транзакции
   * `begin immediate`, номер последней успешной хранится в `user_version`.
   * Функции миграций выполняются в renderer и обращаются к этой же базе.
   */
  async migrate(...migrations: (Query | ((database: this) => void | Promise<void>))[]): Promise<this> {
    let userVersion = await this.#call({ op: "migrateSetup" }) as number;
    this.#migrated = true;
    await this.#call({ op: "pragma", source: "foreign_keys = false" });
    try {
      for (let migrationIndex = userVersion; migrationIndex < migrations.length; migrationIndex++) {
        await this.#call({ op: "execute", query: rawQuery("begin immediate;") });
        try {
          let migration = migrations[migrationIndex];
          if (typeof migration == "function") {
            await migration(this);
          } else {
            await this.#call({ op: "execute", query: migration });
          }
          await this.#call({ op: "pragma", source: `user_version = ${migrationIndex + 1}` });
          await this.#call({ op: "execute", query: rawQuery("commit;") });
        } catch (ex) {
          await this.#call({ op: "execute", query: rawQuery("rollback;") }).catch(() => undefined);
          throw ex;
        }
      }
    } finally {
      await this.#call({ op: "pragma", source: "foreign_keys = true" });
    }
    return this;
  }

  async execute(query: Query): Promise<this> {
    await this.#call({ op: "execute", query });
    return this;
  }

  run(query: Query): Promise<any> {
    return this.#call({ op: "run", query });
  }

  get(query: Query): Promise<any> {
    return this.#call({ op: "get", query });
  }

  all(query: Query): Promise<any[]> {
    return this.#call({ op: "all", query });
  }

  pragma(source: string, options?: any): Promise<any> {
    let match = kConnectionPragmaRE.exec(String(source));
    if (match) {
      this.#connectionPragmas.set(match[1].toLowerCase(), String(source));
    }
    return this.#call({ op: "pragma", source, options });
  }

  /** Все шаги одной транзакцией за один круг IPC. @see lib/rs-sqlite/batch.ts */
  batch(steps: BatchStep[]): Promise<any[]> {
    return this.#call({ op: "batch", steps });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#host.untrackDatabase(this.#handle);
    let { dbID, generation } = this.#handle;
    this.#handle.dbID = null;
    if (dbID != null && generation == this.#host.liveGeneration) {
      await this.#host.request({ op: "close", dbID });
    }
  }

  /** Отправляет запрос без лишних тактов, если база уже открыта:
   * порядок запросов должен совпадать с порядком вызовов. */
  #call(operation: DistributiveOmit<SQLiteOperation, "dbID">): Promise<any> {
    if (this.#closed) {
      return Promise.reject(new Error("SQLite database is closed"));
    }
    let { dbID, generation } = this.#handle;
    if (dbID != null && generation == this.#host.liveGeneration) {
      return this.#host.request({ ...operation, dbID } as SQLiteOperation);
    }
    return this.#connected().then(connectedID =>
      this.#host.request({ ...operation, dbID: connectedID } as SQLiteOperation));
  }

  #connected(): Promise<number> {
    let { dbID, generation } = this.#handle;
    if (dbID != null && generation == this.#host.liveGeneration) {
      return Promise.resolve(dbID);
    }
    this.#connecting ??= this.#open().finally(() => this.#connecting = null);
    return this.#connecting;
  }

  async #open(): Promise<number> {
    let reopening = this.#handle.generation != -1;
    if (reopening && this.#buffer) {
      throw new Error("In-memory SQLite database was lost when the database process restarted");
    }
    let dbID = await this.#host.request({ op: "open", filename: this.#filename, options: this.#options, buffer: this.#buffer });
    let generation = this.#host.liveGeneration;
    if (reopening) {
      // Восстанавливаем состояние соединения, которое было до падения процесса
      if (this.#migrated) {
        await this.#host.request({ op: "migrateSetup", dbID });
      }
      for (let source of this.#connectionPragmas.values()) {
        await this.#host.request({ op: "pragma", dbID, source });
      }
    }
    this.#handle.dbID = dbID;
    this.#handle.generation = generation;
    return dbID;
  }
}

type DistributiveOmit<Type, Key extends PropertyKey> = Type extends any ? Omit<Type, Key> : never;

function rawQuery(source: string): Query {
  return { sourceParts: [source], parameters: [] };
}

/** structured clone превращает Buffer в Uint8Array. Renderer раньше получал
 * BLOB как Buffer, поэтому возвращаем прежний тип (без копирования). */
function restoreBuffers(value: any): any {
  if (value instanceof Uint8Array) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = restoreBuffers(value[i]);
    }
    return value;
  }
  if (value && typeof value == "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (let key of Object.keys(value)) {
      value[key] = restoreBuffers(value[key]);
    }
  }
  return value;
}
