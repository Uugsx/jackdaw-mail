import { describeError, type FriendlyErrorKind } from "../util/friendlyError";

/**
 * Состояние связи почтового аккаунта с сервером.
 *
 * Фоновые опросы при недоступном сервере ошибок не показывают (иначе были бы
 * десятки одинаковых сообщений), поэтому без этого состояния сбой не виден:
 * письма просто перестают приходить. Здесь запоминается, что сервер не
 * отвечает, с какого момента и когда была последняя успешная синхронизация.
 * Список аккаунтов показывает это у аккаунта, а первая же удачная операция
 * снимает состояние сама.
 */

/** Виды ошибок `describeError()`, которые означают, что до сервера не достучаться.
 * Ошибки входа и пароля сюда не входят: их показывает свой запрос пароля. */
const kConnectionProblemKinds: ReadonlySet<FriendlyErrorKind> = new Set<FriendlyErrorKind>([
  "offline",
  "timeout",
  "server-not-found",
  "server-unreachable",
  "connection-lost",
  "network",
  "certificate",
  "server",
]);

/** Сколько должен длиться сбой, прежде чем сообщить о нём уведомлением ОС.
 * Короткие перебои (переподключение VPN, смена Wi-Fi) уведомлений не дают. */
export const kConnectionProblemNotifyAfterMs = 2 * 60 * 1000;
/** Сбой сразу после удачного ответа сервера не показываем: при параллельных
 * запросах один может оборваться, а соседние пройти. Если сервер правда
 * недоступен, следующие попытки (OWA — каждые несколько секунд) это подтвердят. */
export const kIgnoreFailureAfterSuccessMs = 10 * 1000;
/** Как часто сохранять время последней синхронизации: OWA опрашивает сервер
 * каждые несколько секунд, писать при каждом опросе незачем. */
const kPersistLastSuccessEveryMs = 60 * 1000;
const kLastSuccessStoragePrefix = "mail.connection.lastSuccess.";

export interface ConnectionProblem {
  kind: FriendlyErrorKind;
  /** Понятный текст причины, например «Сервер не ответил вовремя». */
  message: string;
  /** Что сделать, если есть. */
  hint: string | null;
  /** Исходный текст и коды ошибки — для подсказки и поддержки. */
  technical: string;
  /** Когда начался этот эпизод сбоя. */
  since: Date;
}

/** Кому сообщать о затянувшемся сбое. Задаёт интерфейс:
 * логика не знает про системные уведомления. */
export type ConnectionProblemListener = (status: ConnectionStatus) => void;

let problemListener: ConnectionProblemListener | null = null;

/** Регистрирует получателя: он вызывается не больше одного раза на эпизод сбоя. */
export function setConnectionProblemListener(listener: ConnectionProblemListener | null): void {
  problemListener = listener;
}

/**
 * @returns вид сбоя связи с сервером,
 *   или `null`, если ошибка не означает недоступность сервера
 *   (вход, пароль, отказ в доступе, ошибка в самом письме и т.п.).
 */
export function connectionProblemKind(ex: unknown): FriendlyErrorKind | null {
  if (!ex) {
    return null;
  }
  let kind = describeError(ex).kind;
  return kConnectionProblemKinds.has(kind) ? kind : null;
}

export class ConnectionStatus {
  /** Текущий сбой, или `null`, если связь есть. */
  problem: ConnectionProblem | null = null;
  /** Название аккаунта для уведомления. */
  readonly accountName: () => string;
  protected readonly onChange: () => void;
  protected readonly storageID: () => string | null;
  /** `undefined` — ещё не прочитано из хранилища. */
  protected _lastSuccessAt: Date | null | undefined = undefined;
  protected notifiedThisEpisode = false;
  protected lastPersistedAt = 0;

  /**
   * @param onChange Вызывается, только когда сбой начался, сменил причину или закончился.
   *   Не на каждый удачный запрос: интерфейс не должен перерисовываться каждые 3 секунды.
   * @param storageID Если задан, время последней синхронизации переживает перезапуск.
   *   Функция, потому что ID аккаунта читается из настроек уже после создания объекта.
   */
  constructor(onChange: () => void, accountName: () => string, storageID: () => string | null = () => null) {
    this.onChange = onChange;
    this.accountName = accountName;
    this.storageID = storageID;
  }

  /** Последняя операция, на которую сервер ответил, в том числе до перезапуска. */
  get lastSuccessAt(): Date | null {
    if (this._lastSuccessAt === undefined) {
      this._lastSuccessAt = this.readLastSuccess();
    }
    return this._lastSuccessAt;
  }

  protected get storageKey(): string | null {
    let id = this.storageID();
    return id ? kLastSuccessStoragePrefix + id : null;
  }

  get isConnected(): boolean {
    return !this.problem;
  }

  /**
   * Сервер не ответил.
   * @returns true, если ошибка — сбой связи и учтена,
   *   false, если это другая ошибка и состояние не менялось.
   */
  reportFailure(ex: unknown, now = new Date()): boolean {
    if (!ex) {
      return false;
    }
    let described = describeError(ex);
    let kind = described.kind;
    if (!kConnectionProblemKinds.has(kind)) {
      return false;
    }
    let lastSuccess = this.lastSuccessAt;
    if (!this.problem && lastSuccess &&
        now.getTime() - lastSuccess.getTime() < kIgnoreFailureAfterSuccessMs) {
      return true;
    }
    if (!this.problem) {
      this.notifiedThisEpisode = false;
      this.problem = {
        kind,
        message: described.message,
        hint: described.hint,
        technical: described.technical,
        since: now,
      };
      this.onChange();
    } else if (this.problem.kind != kind) {
      this.problem = {
        ...this.problem,
        kind,
        message: described.message,
        hint: described.hint,
        technical: described.technical,
      };
      this.onChange();
    }
    this.notifyIfPersistent(now);
    return true;
  }

  /** Сервер ответил. Снимает сбой, если он был. */
  reportSuccess(now = new Date()): void {
    this._lastSuccessAt = now;
    this.persistLastSuccess(now);
    if (!this.problem) {
      return;
    }
    this.problem = null;
    this.notifiedThisEpisode = false;
    this.onChange();
  }

  /** Одно уведомление на эпизод и только если сбой не кратковременный.
   * Без интернета не уведомляем: это пользователь видит и так. */
  protected notifyIfPersistent(now: Date): void {
    if (this.notifiedThisEpisode || !this.problem || this.problem.kind == "offline" || !problemListener) {
      return;
    }
    if (now.getTime() - this.problem.since.getTime() < kConnectionProblemNotifyAfterMs) {
      return;
    }
    this.notifiedThisEpisode = true;
    try {
      problemListener(this);
    } catch (ex) {
      console.error(ex);
    }
  }

  protected readLastSuccess(): Date | null {
    let key = this.storageKey;
    if (!key) {
      return null;
    }
    try {
      let time = Number(globalThis.localStorage?.getItem(key));
      return time > 0 ? new Date(time) : null;
    } catch {
      // Хранилище может быть недоступно, например в тестах или отдельном окне
      return null;
    }
  }

  protected persistLastSuccess(now: Date): void {
    if (now.getTime() - this.lastPersistedAt < kPersistLastSuccessEveryMs) {
      return;
    }
    let key = this.storageKey;
    if (!key) {
      return;
    }
    this.lastPersistedAt = now.getTime();
    try {
      globalThis.localStorage?.setItem(key, String(now.getTime()));
    } catch {
      // Не сохранилось — покажем время только до перезапуска
    }
  }
}
