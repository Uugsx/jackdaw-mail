import { CollectionObserver, type ArrayColl } from "svelte-collections";
import { writable } from "svelte/store";
import { gt } from "../../l10n/l10n";
import { appGlobal } from "../../logic/app";
import { MailAccount } from "../../logic/Mail/MailAccount";
import { type Folder } from "../../logic/Mail/Folder";
import type { EMail } from "../../logic/Mail/EMail";
import type { Tag } from "../../logic/Abstract/Tag";
import {
  loadPendingResponseRequests,
  MAX_PENDING_RESPONSE_REQUESTS,
} from "../../logic/Reports/ResponseReminderData";
import { normalizeResponseTargetMinutes } from "../../logic/Reports/ReportsData";
import {
  elapsedResponseMinutes,
  getResponseSlaStartAt,
  getDueResponseReminderIntervals,
  getResponseSlaProgress,
  isResponseRequestExcluded,
  isResponseRequestTakenInWork,
  isResponseReminderRequestAfterActivation,
  normalizeResponseReminderIntervals,
  responseReminderKey,
  shouldNotifyResponseReminderEvent,
  RESPONSE_REMINDER_MAX_STATE_AGE_MS,
  type PendingResponseRequest,
  type ResponseReminderEvent,
  type ResponseReminderStateEntry,
} from "../../logic/Reports/ResponseReminder";
import {
  normalizeResponderAttributionConfig,
  type ResponderAttributionConfig,
} from "../../logic/Reports/ReportsPresentation";
import {
  getResponseReminderConfig,
  RESPONSE_REMINDER_CONFIG_STORAGE_KEY,
  setResponseReminderConfig,
} from "../Reports/ResponseReminderSettings";
import {
  getWorkingHoursSchedule,
  subscribeWorkingHoursSettings,
} from "../Reports/WorkingHoursSettings";
import {
  getResponseTrackingArchive,
  responseTrackingArchiveSetting,
} from "../Reports/ResponseTrackingArchiveSettings";
import { isResponseTrackingArchived } from "../../logic/Reports/ResponseTrackingArchive";
import {
  isWithinWorkingHours,
  type WorkingHoursSchedule,
} from "../../logic/Reports/WorkingHours";
import { getLocalStorage } from "../Util/LocalStorage";
import { backgroundError } from "../Util/error";
import { openPendingResponseMessage } from "./openPendingResponse";
import {
  NotificationKinds,
  SystemNotification,
} from "../Shared/SystemNotification";
import MailIcon from "../asset/icon/appBar/mail.svg?raw";

const RESPONSE_REMINDER_STATE_STORAGE_KEY =
  "reports.response-reminders.state.v1";
const RESPONSE_REMINDER_POLL_MS = 15_000;
const RESPONSE_REMINDER_EVALUATION_DELAY_MS = 300;
const RESPONSE_REMINDER_INITIAL_DELAY_MS = 1_000;
const MAX_RESPONSE_REMINDER_NOTIFICATIONS_PER_CHECK = 20;
const MAX_RESPONSE_EVENT_NOTIFICATIONS_PER_CHECK = 20;

interface ResponseReminderCandidate extends PendingResponseRequest {
  accountName: string;
}

interface ReminderNotificationJob {
  candidate: ResponseReminderCandidate;
  intervalMinutes: number;
  workingHours: WorkingHoursSchedule;
  slaStartedAt: Date;
}

interface ResponseEventNotificationJob {
  event: ResponseReminderEvent;
  candidate: ResponseReminderCandidate;
  targetMinutes: number;
  workingHours: WorkingHoursSchedule;
  slaStartedAt: Date;
}

const responseReminderStateSetting = getLocalStorage<unknown>(
  RESPONSE_REMINDER_STATE_STORAGE_KEY,
  {},
);
const responseReminderConfigSetting = getLocalStorage<unknown>(
  RESPONSE_REMINDER_CONFIG_STORAGE_KEY,
  {},
);
const responseReminderTargetSetting = getLocalStorage<unknown>(
  "reports.live-sla.target.v1",
  {},
);
const responseReminderFolderSetting = getLocalStorage<unknown>(
  "reports.live-sla.folders.v1",
  {},
);
const responderAttributionSetting = getLocalStorage<unknown>(
  "reports.responder-attribution.v1",
  {},
);

let watcherStarted = false;
let evaluationRunning = false;
let evaluationPending = false;
let evaluationTimer: ReturnType<typeof setTimeout> | null = null;

/** Сигнал для открытой очереди: почтовые коллекции получили изменения. */
export const responseReminderMailEpoch = writable(0);

export interface ResponseReminderLiveTimer {
  request: PendingResponseRequest;
  targetMinutes: number;
  workingHours: WorkingHoursSchedule;
  slaStartedAt: Date;
}

export interface ResponseReminderLiveSnapshot {
  pendingCount: number;
  overdueCount: number;
  withinTargetCount: number;
  waitingForWorkingHoursCount: number;
  nextTimer: ResponseReminderLiveTimer | null;
  refreshing: boolean;
  hasError: boolean;
  updatedAt: number | null;
}

function emptyLiveSnapshot(): ResponseReminderLiveSnapshot {
  return {
    pendingCount: 0,
    overdueCount: 0,
    withinTargetCount: 0,
    waitingForWorkingHoursCount: 0,
    nextTimer: null,
    refreshing: false,
    hasError: false,
    updatedAt: null,
  };
}

/** Сводка для индикатора живого контроля в правой панели. */
export const responseReminderLiveState = writable<ResponseReminderLiveSnapshot>(
  emptyLiveSnapshot(),
);

/**
 * Возвращает якорь SLA и фиксирует переход письма вне рабочего графика
 * в непрерывный режим отсчёта.
 */
export function getResponseReminderSlaStartAt(
  request: PendingResponseRequest,
  now = new Date(),
  workingHours: WorkingHoursSchedule,
  excludedCategoryNames: readonly string[] = [],
): Date {
  const state = readState();
  const key = responseReminderKey(request);
  const receivedAt = request.receivedAt.getTime();
  const previous =
    state[key]?.receivedAt == receivedAt ? state[key] : undefined;
  const takenInWork = isResponseRequestTakenInWork(
    request,
    excludedCategoryNames,
  );
  const takenInWorkNow = getTakenInWorkStartAt(
    previous,
    request,
    takenInWork,
    now,
    workingHours,
  );
  const slaStartedAt = getResponseSlaStartAt(
    request,
    now,
    workingHours,
    previous?.startedAt ?? takenInWorkNow,
  );
  const nextStateEntry: ResponseReminderStateEntry = {
    ...previous,
    receivedAt,
    firedIntervalsMinutes: previous?.firedIntervalsMinutes ?? [],
    takenInWork,
    ...(slaStartedAt.getTime() == receivedAt
      ? {}
      : {
          startedAt: slaStartedAt.getTime(),
          startedAtSource:
            previous?.startedAtSource ??
            (takenInWorkNow == null ? undefined : "taken-in-work"),
        }),
  };
  if (
    previous?.receivedAt != nextStateEntry.receivedAt ||
    previous?.takenInWork != nextStateEntry.takenInWork ||
    previous?.startedAt != nextStateEntry.startedAt ||
    previous?.startedAtSource != nextStateEntry.startedAtSource
  ) {
    state[key] = nextStateEntry;
    responseReminderStateSetting.value = state;
  }
  return slaStartedAt;
}

/** Запускает живой SLA-контроль один раз на время работы окна приложения. */
export function startResponseReminderWatcher(): void {
  if (watcherStarted) {
    return;
  }
  watcherStarted = true;

  appGlobal.emailAccounts.registerObserver(accountsObserver);
  responseReminderConfigSetting.subscribe(() => scheduleEvaluation());
  responseReminderTargetSetting.subscribe(() => scheduleEvaluation());
  responseReminderFolderSetting.subscribe(() => scheduleEvaluation());
  subscribeWorkingHoursSettings(() => scheduleEvaluation());
  responderAttributionSetting.subscribe(() => scheduleEvaluation());
  responseTrackingArchiveSetting.subscribe(() => scheduleEvaluation());
  for (const account of appGlobal.emailAccounts.contents) {
    hookMailAccount(account);
  }

  setInterval(() => scheduleEvaluation(), RESPONSE_REMINDER_POLL_MS);
  scheduleEvaluation(RESPONSE_REMINDER_INITIAL_DELAY_MS);
}

function scheduleEvaluation(
  delayMs = RESPONSE_REMINDER_EVALUATION_DELAY_MS,
): void {
  if (!watcherStarted) {
    return;
  }
  if (evaluationRunning) {
    evaluationPending = true;
    return;
  }
  if (evaluationTimer != null) {
    return;
  }
  evaluationTimer = setTimeout(() => {
    evaluationTimer = null;
    void evaluateResponseReminders().catch(backgroundError);
  }, delayMs);
}

async function evaluateResponseReminders(): Promise<void> {
  if (evaluationRunning) {
    evaluationPending = true;
    return;
  }
  evaluationRunning = true;
  const liveSnapshot = emptyLiveSnapshot();
  let nextTimerPriority = Number.POSITIVE_INFINITY;
  let liveStatePublished = false;
  let liveStateHasError = false;
  responseReminderLiveState.update((snapshot) => ({
    ...snapshot,
    refreshing: true,
    hasError: false,
  }));
  try {
    const now = new Date();
    const state = readState();
    const trackingArchive = getResponseTrackingArchive();
    let stateChanged = pruneState(state, now);
    const jobs: ReminderNotificationJob[] = [];
    const eventJobs: ResponseEventNotificationJob[] = [];

    for (const account of appGlobal.emailAccounts.contents) {
      if (!(account instanceof MailAccount)) {
        continue;
      }
      const accountId = numericId(account.dbID);
      if (accountId == null) {
        continue;
      }

      const config = getResponseReminderConfig(accountId);
      if (!config.enabled) {
        stateChanged = clearAccountState(state, accountId) || stateChanged;
        continue;
      }
      const enabledSince = config.enabledSince ?? now.getTime();
      if (config.enabledSince == null) {
        // Старые сохранённые настройки не знали о моменте включения. Один
        // раз фиксируем его, чтобы архив не превратился в очередь тревог.
        setResponseReminderConfig(accountId, {
          ...config,
          enabledSince,
        });
      }
      const attribution = readResponderAttribution(accountId);
      const workingHours = getWorkingHoursSchedule(accountId);
      const categoryNames =
        attribution.mode == "category" ? attribution.categoryNames : null;
      if (categoryNames != null && categoryNames.length == 0) {
        stateChanged = clearAccountState(state, accountId) || stateChanged;
        continue;
      }

      try {
        const pending = (
          await loadPendingResponseRequests(
            accountId,
            categoryNames,
            now,
            undefined,
            readStoredFolderId(accountId),
            {
              mailboxAddress: account.emailAddress,
              excludedCategoryNames: config.excludedCategoryNames,
              // В режиме профиля личный ящик контролируется целиком: категория
              // может появиться позже, но якорь SLA всегда остаётся dateReceived.
              includeUncategorized:
                attribution.mode == "profile"
                  ? true
                  : config.includeUncategorized,
            },
          )
        ).filter(
          (request) =>
            !isResponseRequestExcluded(
              request,
              config.excludedCategoryNames,
            ),
        );
        const activeKeys = new Set<string>();
        const targetMinutes = readStoredTargetMinutes(accountId);
        for (const request of pending) {
          const candidate: ResponseReminderCandidate = {
            ...request,
            accountName:
              account.name || account.emailAddress || "Почтовый аккаунт",
          };
          const key = responseReminderKey(candidate);
          activeKeys.add(key);
          if (isResponseTrackingArchived(candidate, trackingArchive)) {
            if (state[key]) {
              delete state[key];
              stateChanged = true;
            }
            continue;
          }
          const receivedAt = candidate.receivedAt.getTime();
          const previous = state[key];
          const entry =
            previous?.receivedAt == receivedAt
              ? previous
              : { receivedAt, firedIntervalsMinutes: [] };
          const takenInWork = isResponseRequestTakenInWork(
            candidate,
            config.excludedCategoryNames,
          );
          const takenInWorkNow = getTakenInWorkStartAt(
            previous,
            candidate,
            takenInWork,
            now,
            workingHours,
          );
          const slaStartedAt = getResponseSlaStartAt(
            candidate,
            now,
            workingHours,
            entry.startedAt ?? takenInWorkNow,
          );
          const entryWithStart: ResponseReminderStateEntry =
            slaStartedAt.getTime() == receivedAt ||
            entry.startedAt == slaStartedAt.getTime()
              ? entry
              : {
                  ...entry,
                  startedAt: slaStartedAt.getTime(),
                  startedAtSource:
                    entry.startedAtSource ??
                    (takenInWorkNow == null ? undefined : "taken-in-work"),
                };
          const progress = getResponseSlaProgress(
            request,
            targetMinutes,
            now,
            workingHours,
            slaStartedAt,
          );
          liveSnapshot.pendingCount += 1;
          if (progress.status == "over-target") {
            liveSnapshot.overdueCount += 1;
          } else if (progress.status == "waiting-for-working-hours") {
            liveSnapshot.waitingForWorkingHoursCount += 1;
          } else {
            liveSnapshot.withinTargetCount += 1;
          }
          const timerPriority =
            progress.deadlineAt?.getTime() ?? request.receivedAt.getTime();
          if (timerPriority < nextTimerPriority) {
            nextTimerPriority = timerPriority;
            liveSnapshot.nextTimer = {
              request,
              targetMinutes,
              workingHours,
              slaStartedAt,
            };
          }
          if (
            !isResponseReminderRequestAfterActivation(candidate, enabledSince)
          ) {
            continue;
          }

          const overdue = progress.status == "over-target";
          let stateTakenInWork = takenInWork;
          let stateOverdue = overdue;
          if (
            config.notifyWhenTakenInWork &&
            shouldNotifyResponseReminderEvent(
              "taken-in-work",
              previous,
              receivedAt,
              takenInWork,
            )
          ) {
            if (eventJobs.length < MAX_RESPONSE_EVENT_NOTIFICATIONS_PER_CHECK) {
              eventJobs.push({
                event: "taken-in-work",
                candidate,
                targetMinutes,
                workingHours,
                slaStartedAt,
              });
            } else {
              // Оставляем переход незафиксированным: следующий цикл
              // доставит событие, не теряя его при большом количестве писем.
              stateTakenInWork = false;
            }
          }
          if (
            config.notifyWhenOverdue &&
            shouldNotifyResponseReminderEvent(
              "overdue",
              previous,
              receivedAt,
              overdue,
            )
          ) {
            if (eventJobs.length < MAX_RESPONSE_EVENT_NOTIFICATIONS_PER_CHECK) {
              eventJobs.push({
                event: "overdue",
                candidate,
                targetMinutes,
                workingHours,
                slaStartedAt,
              });
            } else {
              // См. комментарий выше для перехода в работу.
              stateOverdue = false;
            }
          }

          const nextStateEntry: ResponseReminderStateEntry = {
            ...entryWithStart,
            takenInWork: stateTakenInWork,
            overdue: stateOverdue,
          };
          if (
            previous?.receivedAt != receivedAt ||
            previous?.takenInWork !== stateTakenInWork ||
            previous?.overdue !== stateOverdue ||
            previous?.startedAt !== nextStateEntry.startedAt
          ) {
            state[key] = nextStateEntry;
            stateChanged = true;
          }
          const dueIntervals = getDueResponseReminderIntervals(
            candidate,
            config,
            entryWithStart,
            now,
            workingHours,
          );
          if (!dueIntervals.length) {
            continue;
          }

          if (jobs.length >= MAX_RESPONSE_REMINDER_NOTIFICATIONS_PER_CHECK) {
            // Оставляем эту запись неотмеченной: следующий цикл продолжит
            // очередь, а напоминание не потеряется при большом завале.
            continue;
          }
          state[key] = {
            ...nextStateEntry,
            receivedAt,
            firedIntervalsMinutes: normalizeResponseReminderIntervals(
              [...nextStateEntry.firedIntervalsMinutes, ...dueIntervals],
              [],
            ),
          };
          stateChanged = true;
          jobs.push({
            candidate,
            // Если приложение спало, достаточно одного уведомления. Все
            // пройденные точки отмечены выше, показываем последнюю без спама.
            intervalMinutes: dueIntervals.at(-1)!,
            workingHours,
            slaStartedAt,
          });
        }
        // При ограничении выдачи не удаляем остальные записи: иначе при
        // большом архиве уже отправленные напоминания могли бы повториться,
        // когда письмо попадёт в следующую страницу проверки.
        if (pending.length < MAX_PENDING_RESPONSE_REQUESTS) {
          for (const key of Object.keys(state)) {
            if (key.startsWith(`${accountId}:`) && !activeKeys.has(key)) {
              delete state[key];
              stateChanged = true;
            }
          }
        }
      } catch (ex) {
        liveStateHasError = true;
        const error = toError(ex);
        (error as Error & { accountName?: string }).accountName =
          account.name || account.emailAddress;
        backgroundError(error);
      }
    }

    if (stateChanged) {
      responseReminderStateSetting.value = state;
    }
    responseReminderLiveState.set({
      ...liveSnapshot,
      refreshing: false,
      hasError: liveStateHasError,
      updatedAt: now.getTime(),
    });
    liveStatePublished = true;
    for (const job of jobs) {
      if (isCurrentResponseReminderCandidate(job.candidate)) {
        await showResponseReminder(job, now);
      }
    }
    for (const job of eventJobs) {
      if (isCurrentResponseReminderCandidate(job.candidate, job.event)) {
        await showResponseEventNotification(job, now);
      }
    }
  } finally {
    if (!liveStatePublished) {
      responseReminderLiveState.set({
        ...emptyLiveSnapshot(),
        refreshing: false,
        hasError: true,
        updatedAt: Date.now(),
      });
    }
    evaluationRunning = false;
    if (evaluationPending) {
      evaluationPending = false;
      scheduleEvaluation();
    }
  }
}

/**
 * Возвращает момент перехода в работу вне графика.
 * Состояние без `startedAt` также восстанавливается после промежуточной
 * версии, которая сохраняла только признак `takenInWork`.
 */
function getTakenInWorkStartAt(
  previous: ResponseReminderStateEntry | undefined,
  request: PendingResponseRequest,
  takenInWork: boolean,
  now: Date,
  workingHours: WorkingHoursSchedule,
): number | undefined {
  if (
    !takenInWork ||
    previous?.receivedAt != request.receivedAt.getTime() ||
    isWithinWorkingHours(request.receivedAt, workingHours) ||
    isWithinWorkingHours(now, workingHours)
  ) {
    return undefined;
  }
  const isNewTakenInWork = previous.takenInWork === false;
  const isRecoveredInterimState =
    previous.takenInWork === true && previous.startedAt == null;
  return isNewTakenInWork || isRecoveredInterimState ? now.getTime() : undefined;
}

/** Не доставляет уведомления, которые устарели после изменения настроек. */
function isCurrentResponseReminderCandidate(
  candidate: ResponseReminderCandidate,
  event?: ResponseReminderEvent,
): boolean {
  const config = getResponseReminderConfig(candidate.accountId);
  if (
    !config.enabled ||
    isResponseRequestExcluded(candidate, config.excludedCategoryNames) ||
    isResponseTrackingArchived(candidate, getResponseTrackingArchive())
  ) {
    return false;
  }
  return event == null
    ? true
    : event == "overdue"
      ? config.notifyWhenOverdue
      : config.notifyWhenTakenInWork;
}

function readStoredTargetMinutes(accountId: number): number {
  let value: unknown;
  try {
    value = responseReminderTargetSetting.value;
  } catch {
    value = null;
  }
  if (!value || typeof value != "object" || Array.isArray(value)) {
    return normalizeResponseTargetMinutes(undefined);
  }
  const stored = (value as Record<string, unknown>)[String(accountId)];
  return normalizeResponseTargetMinutes(
    typeof stored == "number" ? stored : undefined,
  );
}

function readStoredFolderId(accountId: number): number | null {
  let value: unknown;
  try {
    value = responseReminderFolderSetting.value;
  } catch {
    value = null;
  }
  if (!value || typeof value != "object" || Array.isArray(value)) {
    return null;
  }
  const stored = Number(
    (value as Record<string, unknown>)[String(accountId)],
  );
  return Number.isInteger(stored) && stored > 0 ? stored : null;
}

async function showResponseReminder(
  job: ReminderNotificationJob,
  now: Date,
): Promise<void> {
  const { candidate, intervalMinutes, workingHours, slaStartedAt } = job;
  const elapsedMinutes = Math.max(
    0,
    Math.floor(
      elapsedResponseMinutes(candidate, now, workingHours, slaStartedAt),
    ),
  );
  const subject = candidate.subject.trim() || "(без темы)";
  const notification = new SystemNotification(
    new NotificationKinds(
      getLocalStorage("notifications.mail", ["popup", "sound"]).value,
    ),
    gt`No reply yet`,
    gt`No reply to “${subject}” after ${elapsedMinutes} working minutes (reminder at ${intervalMinutes} working minutes).`,
    `response-reminder:${responseReminderKey(candidate)}:${intervalMinutes}`,
    "mail-incoming",
  );
  notification.subtitle = [candidate.accountName, ...candidate.categoryNames]
    .filter(Boolean)
    .join(" · ");
  notification.icon = MailIcon;
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => {
    void openPendingResponseMessage(candidate).catch((ex) =>
      backgroundError(toError(ex)),
    );
  };
  await notification.show();
}

async function showResponseEventNotification(
  job: ResponseEventNotificationJob,
  now: Date,
): Promise<void> {
  const { event, candidate, targetMinutes, workingHours, slaStartedAt } = job;
  const subject = candidate.subject.trim() || "(без темы)";
  const soundEvent =
    event == "overdue" ? "sla-overdue" : "sla-taken-in-work";
  const notification = new SystemNotification(
    // SLA-события управляются своими переключателями и не зависят от
    // глобального переключателя уведомлений о новой почте.
    new NotificationKinds(["popup", "sound"]),
    event == "overdue"
      ? gt`SLA response overdue`
      : gt`Request taken into work`,
    event == "overdue"
      ? gt`No reply to “${subject}” within ${targetMinutes} working minutes.`
      : gt`The timer follows the selected mailbox schedule until a message is taken into work. If it is taken outside working hours, the timer continues without pausing from that moment.`,
    `response-sla:${event}:${responseReminderKey(candidate)}`,
    soundEvent,
  );
  const elapsedMinutes = Math.max(
    0,
    Math.floor(
      elapsedResponseMinutes(candidate, now, workingHours, slaStartedAt),
    ),
  );
  const elapsedLabel =
    event == "overdue"
      ? gt`${elapsedMinutes} working minutes elapsed`
      : null;
  notification.subtitle = [
    candidate.accountName,
    ...candidate.categoryNames,
    ...(elapsedLabel == null ? [] : [elapsedLabel]),
  ]
    .filter(Boolean)
    .join(" · ");
  notification.icon = MailIcon;
  notification.urgency = event == "overdue" ? "critical" : "normal";
  notification.updatesTaskbarBadge = false;
  notification.onClick = () => {
    void openPendingResponseMessage(candidate).catch((ex) =>
      backgroundError(toError(ex)),
    );
  };
  await notification.show();
}

function readResponderAttribution(
  accountId: number,
): ResponderAttributionConfig {
  let value: unknown;
  try {
    value = responderAttributionSetting.value;
  } catch {
    value = null;
  }
  const saved =
    value && typeof value == "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)[String(accountId)]
      : undefined;
  return normalizeResponderAttributionConfig(saved, {
    mode: "profile",
    categoryNames: [],
  });
}

function readState(): Record<string, ResponseReminderStateEntry> {
  let value: unknown;
  try {
    value = responseReminderStateSetting.value;
  } catch {
    value = null;
  }
  if (!value || typeof value != "object" || Array.isArray(value)) {
    return {};
  }
  const state: Record<string, ResponseReminderStateEntry> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw != "object" || Array.isArray(raw)) {
      continue;
    }
    const receivedAt = Number((raw as Record<string, unknown>).receivedAt);
    if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
      continue;
    }
    const rawRecord = raw as Record<string, unknown>;
    const startedAtSource =
      rawRecord.startedAtSource == "taken-in-work"
        ? "taken-in-work"
        : undefined;
    const startedAt =
      startedAtSource == "taken-in-work"
        ? finiteTimestamp(rawRecord.startedAt)
        : undefined;
    const takenInWork = optionalBoolean(rawRecord.takenInWork);
    const overdue = optionalBoolean(rawRecord.overdue);
    state[key] = {
      receivedAt,
      firedIntervalsMinutes: normalizeFiredIntervals(
        rawRecord.firedIntervalsMinutes,
      ),
      ...(startedAt == null
        ? {}
        : { startedAt, startedAtSource: "taken-in-work" as const }),
      ...(takenInWork == null ? {} : { takenInWork }),
      ...(overdue == null ? {} : { overdue }),
    };
  }
  return state;
}

function normalizeFiredIntervals(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ].sort((a, b) => a - b);
}

function finiteTimestamp(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? Math.floor(result) : undefined;
}

function pruneState(
  state: Record<string, ResponseReminderStateEntry>,
  now: Date,
): boolean {
  const cutoff = now.getTime() - RESPONSE_REMINDER_MAX_STATE_AGE_MS;
  let changed = false;
  for (const [key, entry] of Object.entries(state)) {
    if (entry.receivedAt < cutoff) {
      delete state[key];
      changed = true;
    }
  }
  return changed;
}

function clearAccountState(
  state: Record<string, ResponseReminderStateEntry>,
  accountId: number,
): boolean {
  let changed = false;
  for (const key of Object.keys(state)) {
    if (key.startsWith(`${accountId}:`)) {
      delete state[key];
      changed = true;
    }
  }
  return changed;
}

function numericId(value: number | string | null): number | null {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value == "boolean" ? value : undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const hookedAccounts = new WeakSet<MailAccount>();
const hookedFolders = new WeakSet<Folder>();
const hookedMessages = new WeakSet<EMail>();
const messageSubscriptions = new Map<EMail, () => void>();

function hookMailAccount(account: unknown): void {
  if (!(account instanceof MailAccount) || hookedAccounts.has(account)) {
    return;
  }
  hookedAccounts.add(account);
  account.rootFolders.registerObserver(foldersObserver);
  observeFolders(account.rootFolders.contents);
  // В некоторых провайдерах уже загруженные папки не проходят повторно через
  // rootFolders. Подключаем наблюдатель к плоскому списку, как и уведомления о
  // новой почте, чтобы очередь обновлялась сразу после добавления письма.
  observeFolders(account.getAllFolders().contents);
  account.dependentAccounts().registerObserver(dependentsObserver);
  for (const dependent of account.dependentAccounts()) {
    hookMailAccount(dependent);
  }
}

function observeFolders(folders: Iterable<Folder>): void {
  for (const folder of folders) {
    if (hookedFolders.has(folder)) {
      continue;
    }
    hookedFolders.add(folder);
    folder.messages.registerObserver(messageObserver);
    observeMessages(folder.messages);
    folder.subFolders.registerObserver(foldersObserver);
    observeFolders(folder.subFolders.contents);
  }
}

function observeMessages(messages: Iterable<EMail>): void {
  for (const email of messages) {
    if (hookedMessages.has(email)) {
      continue;
    }
    hookedMessages.add(email);
    email.tags.registerObserver(tagObserver);
    messageSubscriptions.set(
      email,
      email.subscribe((_message, propertyName) => {
        if (propertyName != "isRead" && propertyName != "isReplied") {
          return;
        }
        responseReminderMailEpoch.update((epoch) => epoch + 1);
        scheduleEvaluation();
      }),
    );
  }
}

function unobserveMessages(messages: Iterable<EMail>): void {
  for (const email of messages) {
    if (!hookedMessages.has(email)) {
      continue;
    }
    email.tags.unregisterObserver(tagObserver);
    messageSubscriptions.get(email)?.();
    messageSubscriptions.delete(email);
    hookedMessages.delete(email);
  }
}

class ResponseReminderAccountsObserver extends CollectionObserver<MailAccount> {
  added(accounts: MailAccount[]) {
    for (const account of accounts) {
      hookMailAccount(account);
    }
    scheduleEvaluation();
  }
  removed(_accounts: MailAccount[]) {
    scheduleEvaluation();
  }
}
const accountsObserver = new ResponseReminderAccountsObserver();

class ResponseReminderDependentsObserver extends CollectionObserver<unknown> {
  added(accounts: unknown[]) {
    for (const account of accounts) {
      hookMailAccount(account);
    }
    scheduleEvaluation();
  }
  removed(_accounts: unknown[]) {
    scheduleEvaluation();
  }
}
const dependentsObserver = new ResponseReminderDependentsObserver();

class ResponseReminderFoldersObserver extends CollectionObserver<Folder> {
  added(folders: Folder[] | ArrayColl<Folder>) {
    observeFolders(Array.from(folders));
    scheduleEvaluation();
  }
  removed(_folders: Folder[] | ArrayColl<Folder>) {
    scheduleEvaluation();
  }
}
const foldersObserver = new ResponseReminderFoldersObserver();

class ResponseReminderMessageObserver extends CollectionObserver<EMail> {
  added(messages: EMail[] | ArrayColl<EMail>) {
    observeMessages(Array.from(messages));
    responseReminderMailEpoch.update((epoch) => epoch + 1);
    scheduleEvaluation();
  }
  removed(messages: EMail[] | ArrayColl<EMail>) {
    unobserveMessages(Array.from(messages));
    responseReminderMailEpoch.update((epoch) => epoch + 1);
    scheduleEvaluation();
  }
}
const messageObserver = new ResponseReminderMessageObserver();

/** Изменение категории меняет область SLA даже без добавления нового письма. */
class ResponseReminderTagObserver extends CollectionObserver<Tag> {
  added(_tags: Tag[] | ArrayColl<Tag>) {
    responseReminderMailEpoch.update((epoch) => epoch + 1);
    scheduleEvaluation();
  }

  removed(_tags: Tag[] | ArrayColl<Tag>) {
    responseReminderMailEpoch.update((epoch) => epoch + 1);
    scheduleEvaluation();
  }
}
const tagObserver = new ResponseReminderTagObserver();
