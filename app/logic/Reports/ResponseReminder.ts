import {
  DEFAULT_WORKING_HOURS_SCHEDULE,
  addWorkingSeconds,
  isWithinWorkingHours,
  workingSecondsBetween,
  type WorkingHoursSchedule,
} from "./WorkingHours";

const SECONDS_PER_MINUTE = 60;
export const DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES = [10, 20, 25];
export const DEFAULT_RESPONSE_REMINDER_NEW_INTERVAL_MINUTES = 30;
export const MIN_RESPONSE_REMINDER_INTERVAL_MINUTES = 1;
export const MAX_RESPONSE_REMINDER_INTERVAL_MINUTES = 7 * 24 * 60;
export const RESPONSE_REMINDER_MAX_STATE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface ResponseReminderConfig {
  enabled: boolean;
  intervalsMinutes: number[];
  /** Категории, которые не участвуют в живом SLA-контроле и напоминаниях. */
  excludedCategoryNames: string[];
  /** Нужно ли контролировать входящие письма без категории в режиме категорий. */
  includeUncategorized: boolean;
  /** Показывать отдельное уведомление при переходе запроса в просрочку. */
  notifyWhenOverdue: boolean;
  /** Показывать отдельное уведомление, когда запрос взяли в работу. */
  notifyWhenTakenInWork: boolean;
  /** Момент включения контроля для отсечения старого архива. */
  enabledSince?: number;
}

export interface ResponseReminderStateEntry {
  receivedAt: number;
  firedIntervalsMinutes: number[];
  /** Сохранённый момент принятия в работу для письма вне рабочего графика. */
  startedAt?: number;
  /** Источник сохранённого момента старта SLA. */
  startedAtSource?: "taken-in-work";
  /** Последнее известное состояние: запрос взят в работу или ещё нет. */
  takenInWork?: boolean;
  /** Последнее известное состояние: запрос уже просрочен или ещё нет. */
  overdue?: boolean;
}

export type ResponseReminderEvent = "overdue" | "taken-in-work";

export interface PendingResponseRequest {
  accountId: number;
  folderId: number;
  emailId: number;
  messageID: string | null;
  threadID: string | null;
  subject: string;
  receivedAt: Date;
  categoryNames: string[];
  /** Флаг почтового сервера/клиента: прочитано ли письмо. */
  isRead?: boolean;
}

export type ResponseSlaStatus =
  "within-target" | "over-target" | "waiting-for-working-hours";

export interface ResponseSlaProgress {
  elapsedSeconds: number;
  remainingSeconds: number;
  overdueSeconds: number;
  targetSeconds: number;
  deadlineAt: Date | null;
  status: ResponseSlaStatus;
}

const defaultConfig: ResponseReminderConfig = {
  enabled: false,
  intervalsMinutes: [...DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES],
  excludedCategoryNames: [],
  includeUncategorized: false,
  notifyWhenOverdue: false,
  notifyWhenTakenInWork: false,
};

export function normalizeResponseReminderIntervals(
  value: unknown,
  fallback: readonly number[] = DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES,
): number[] {
  const normalized = normalizeIntervalList(value);
  if (normalized.length) {
    return normalized;
  }
  const normalizedFallback = normalizeIntervalList(fallback);
  return normalizedFallback.length
    ? normalizedFallback
    : [...DEFAULT_RESPONSE_REMINDER_INTERVALS_MINUTES];
}

export function normalizeResponseReminderConfig(
  value: unknown,
  fallback: ResponseReminderConfig = defaultConfig,
): ResponseReminderConfig {
  const source = isRecord(value) ? value : {};
  const enabledSince =
    positiveTimestamp(source.enabledSince) ??
    positiveTimestamp(fallback.enabledSince);
  return {
    enabled:
      typeof source.enabled == "boolean" ? source.enabled : fallback.enabled,
    intervalsMinutes: normalizeResponseReminderIntervals(
      source.intervalsMinutes,
      fallback.intervalsMinutes,
    ),
    excludedCategoryNames: normalizeCategoryNames(
      source.excludedCategoryNames,
      fallback.excludedCategoryNames,
    ),
    includeUncategorized:
      typeof source.includeUncategorized == "boolean"
        ? source.includeUncategorized
        : fallback.includeUncategorized,
    notifyWhenOverdue:
      typeof source.notifyWhenOverdue == "boolean"
        ? source.notifyWhenOverdue
        : fallback.notifyWhenOverdue,
    notifyWhenTakenInWork:
      typeof source.notifyWhenTakenInWork == "boolean"
        ? source.notifyWhenTakenInWork
        : fallback.notifyWhenTakenInWork,
    ...(enabledSince == null ? {} : { enabledSince }),
  };
}

export function isResponseReminderRequestAfterActivation(
  request: PendingResponseRequest,
  enabledSince: number | null | undefined,
): boolean {
  return enabledSince == null || request.receivedAt.getTime() >= enabledSince;
}

export function responseReminderKey(request: PendingResponseRequest): string {
  return `${request.accountId}:${request.folderId}:${request.emailId}`;
}

/** Проверяет, исключено ли письмо настройками SLA по одной из его категорий. */
export function isResponseRequestExcluded(
  request: PendingResponseRequest,
  excludedCategoryNames: readonly string[] | undefined,
): boolean {
  if (!excludedCategoryNames?.length || !request.categoryNames.length) {
    return false;
  }
  const excluded = new Set(
    excludedCategoryNames
      .filter((name): name is string => typeof name == "string")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  return request.categoryNames.some((name) => excluded.has(name.trim()));
}

/** Считает письмо взятым в работу для событийных уведомлений. */
export function isResponseRequestTakenInWork(
  request: PendingResponseRequest,
  excludedCategoryNames: readonly string[] = [],
): boolean {
  if (isResponseRequestExcluded(request, excludedCategoryNames)) {
    return false;
  }
  return (
    request.isRead === true ||
    request.categoryNames.some((name) => name.trim().length > 0)
  );
}

/**
 * Проверяет именно переход состояния, а не текущее значение.
 * Это не даёт повторно сигналить на каждом цикле наблюдателя.
 */
export function shouldNotifyResponseReminderEvent(
  event: ResponseReminderEvent,
  previous: ResponseReminderStateEntry | undefined,
  receivedAt: number,
  currentState: boolean,
): boolean {
  if (!previous || previous.receivedAt != receivedAt || !currentState) {
    return false;
  }
  return event == "taken-in-work"
    ? previous.takenInWork === false
    : previous.overdue === false;
}

/**
 * Возвращает момент старта SLA.
 *
 * Письмо, поступившее в рабочее время, всегда считает SLA от получения.
 * Письмо, поступившее вне графика, ждёт рабочего времени, пока его не
 * возьмут в работу. Для такого письма сохранённый момент принятия в работу
 * запускает непрерывный интервал заданной длительности и не меняется повторно.
 */
export function getResponseSlaStartAt(
  request: PendingResponseRequest,
  now = new Date(),
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
  storedStartedAt?: number | null,
): Date {
  const receivedAt = request.receivedAt.getTime();
  const storedStartAt = positiveTimestamp(storedStartedAt);
  if (
    !isWithinWorkingHours(request.receivedAt, workingHours) &&
    storedStartAt != null &&
    storedStartAt >= receivedAt &&
    storedStartAt <= now.getTime() &&
    !isWithinWorkingHours(new Date(storedStartAt), workingHours)
  ) {
    return new Date(storedStartAt);
  }
  return new Date(request.receivedAt);
}

export function elapsedResponseMinutes(
  request: PendingResponseRequest,
  now = new Date(),
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
  slaStartedAt?: Date,
): number {
  const startAt = getResponseSlaStartAt(
    request,
    now,
    workingHours,
    slaStartedAt?.getTime(),
  );
  return Math.max(
    0,
    elapsedResponseSeconds(request, startAt, now, workingHours) /
      SECONDS_PER_MINUTE,
  );
}

/** Возвращает живое состояние SLA с учётом рабочего и непрерывного режима. */
export function getResponseSlaProgress(
  request: PendingResponseRequest,
  targetMinutes: number,
  now = new Date(),
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
  slaStartedAt?: Date,
): ResponseSlaProgress {
  const safeTargetMinutes = normalizeSlaTargetMinutes(targetMinutes);
  const targetSeconds = safeTargetMinutes * SECONDS_PER_MINUTE;
  const startAt = getResponseSlaStartAt(
    request,
    now,
    workingHours,
    slaStartedAt?.getTime(),
  );
  const continuousClock = usesContinuousClock(
    request,
    startAt,
    workingHours,
  );
  const elapsedSeconds = Math.max(
    0,
    Math.floor(elapsedResponseSeconds(request, startAt, now, workingHours)),
  );
  const remainingSeconds = Math.max(targetSeconds - elapsedSeconds, 0);
  const overdueSeconds = Math.max(elapsedSeconds - targetSeconds, 0);
  const deadlineAt = continuousClock
    ? new Date(startAt.getTime() + targetSeconds * 1_000)
    : addWorkingSeconds(startAt, targetSeconds, workingHours);
  const status: ResponseSlaStatus =
    overdueSeconds > 0
      ? "over-target"
      : elapsedSeconds == 0 &&
          !isWithinWorkingHours(now, workingHours) &&
          now.getTime() > request.receivedAt.getTime() &&
          !continuousClock
        ? "waiting-for-working-hours"
        : "within-target";
  return {
    elapsedSeconds,
    remainingSeconds,
    overdueSeconds,
    targetSeconds,
    deadlineAt,
    status,
  };
}

/** Возвращает все точки напоминания, пройденные с последней проверки. */
export function getDueResponseReminderIntervals(
  request: PendingResponseRequest,
  config: ResponseReminderConfig,
  state: ResponseReminderStateEntry | null | undefined,
  now = new Date(),
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): number[] {
  if (!config.enabled) {
    return [];
  }
  const receivedAt = request.receivedAt.getTime();
  const fired = new Set(
    state?.receivedAt == receivedAt ? state.firedIntervalsMinutes : [],
  );
  const slaStartedAt = getResponseSlaStartAt(
    request,
    now,
    workingHours,
    state?.receivedAt == receivedAt ? state.startedAt : undefined,
  );
  const elapsedMinutes = elapsedResponseMinutes(
    request,
    now,
    workingHours,
    slaStartedAt,
  );
  return config.intervalsMinutes.filter(
    (interval) => interval <= elapsedMinutes && !fired.has(interval),
  );
}

/** Возвращает момент следующей точки или null после срабатывания всех точек. */
export function getNextResponseReminderAt(
  request: PendingResponseRequest,
  config: ResponseReminderConfig,
  state: ResponseReminderStateEntry | null | undefined,
  now = new Date(),
  workingHours: WorkingHoursSchedule = DEFAULT_WORKING_HOURS_SCHEDULE,
): Date | null {
  if (!config.enabled) {
    return null;
  }
  if (
    getDueResponseReminderIntervals(request, config, state, now, workingHours)
      .length
  ) {
    return new Date(now.getTime());
  }
  const receivedAt = request.receivedAt.getTime();
  const fired = new Set(
    state?.receivedAt == receivedAt ? state.firedIntervalsMinutes : [],
  );
  const slaStartedAt = getResponseSlaStartAt(
    request,
    now,
    workingHours,
    state?.receivedAt == receivedAt ? state.startedAt : undefined,
  );
  const elapsedMinutes = elapsedResponseMinutes(
    request,
    now,
    workingHours,
    slaStartedAt,
  );
  const nextInterval = config.intervalsMinutes.find(
    (interval) => interval > elapsedMinutes && !fired.has(interval),
  );
  if (nextInterval == null) {
    return null;
  }
  return usesContinuousClock(request, slaStartedAt, workingHours)
    ? new Date(
        slaStartedAt.getTime() + nextInterval * SECONDS_PER_MINUTE * 1_000,
      )
    : addWorkingSeconds(
        slaStartedAt,
        nextInterval * SECONDS_PER_MINUTE,
        workingHours,
      );
}

function normalizeIntervalList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => (typeof item == "number" ? item : Number(item)))
        .filter(
          (item) =>
            Number.isInteger(item) &&
            item >= MIN_RESPONSE_REMINDER_INTERVAL_MINUTES &&
            item <= MAX_RESPONSE_REMINDER_INTERVAL_MINUTES,
        ),
    ),
  ].sort((a, b) => a - b);
}

function normalizeCategoryNames(
  value: unknown,
  fallback: readonly string[],
): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return [
    ...new Set(
      source
        .filter((item): item is string => typeof item == "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value == "object" && !Array.isArray(value);
}

function positiveTimestamp(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? Math.floor(result) : undefined;
}

function elapsedResponseSeconds(
  request: PendingResponseRequest,
  startAt: Date,
  now: Date,
  workingHours: WorkingHoursSchedule,
): number {
  return usesContinuousClock(request, startAt, workingHours)
    ? Math.max(0, (now.getTime() - startAt.getTime()) / 1_000)
    : workingSecondsBetween(startAt, now, workingHours);
}

function usesContinuousClock(
  request: PendingResponseRequest,
  startAt: Date,
  workingHours: WorkingHoursSchedule,
): boolean {
  if (isWithinWorkingHours(request.receivedAt, workingHours)) {
    return false;
  }
  return startAt.getTime() > request.receivedAt.getTime();
}

function normalizeSlaTargetMinutes(value: number): number {
  const result = Number(value);
  return Number.isFinite(result) && result >= 1 ? Math.floor(result) : 1;
}
