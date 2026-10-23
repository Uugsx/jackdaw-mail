import { writable } from "svelte/store";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { appGlobal } from "../../../logic/app";
import {
  cancelPendingScheduledSend, claimScheduledSend, deleteScheduledSend, failInterruptedSends, insertScheduledSend,
  loadScheduledPayload, loadScheduledSends, updateScheduledStatus,
  type ScheduledSendMode, type ScheduledSendRow,
} from "../../../logic/Mail/Scheduled/ScheduledSendData";
import { canDeferOnServer, cancelServerScheduled, deferredSendProtocolFor } from "../../../logic/Mail/Scheduled/DeferredSendServer";
import { deserializeComposeMail, serializeComposeMail } from "../Composer/composeWindow";
import { mailApp } from "../MailJackdawApp";
import { getLocalStorage } from "../../Util/LocalStorage";
import { backgroundError, showError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";
import { UserError, assert, sleep } from "../../../logic/util/util";

/** Окно «Отменить отправку», секунд. 0 — отправлять сразу. */
export const kUndoSendChoices = [0, 5, 10, 30] as const;
export const undoSendSecondsSetting = getLocalStorage<number>("mail.send.undoSeconds", 5);

/** Не чаще: таймер перепроверяет очередь хотя бы раз в минуту (сон, смена часов) */
const kMaxTimerMs = 60_000;
/** Неудачная отправка из очереди повторяется через 2, 4, 6, 8 минут */
const kRetryDelayMs = 2 * 60_000;
const kMaxAttempts = 5;
/** Запись о письме в «Исходящих» сервера убираем чуть позже его времени */
const kServerGraceMs = 5 * 60_000;
/** После запуска ждём, пока прочитаются ящики и папки */
const kStartupDelayMs = 10_000;
/** Ящик так и не появился за это время — показываем ошибку */
const kAccountWaitMs = 5 * 60_000;
/** Ждём связь с backend после запуска, не дольше минуты */
const kBackendWaitMs = 60_000;
const kBackendPollMs = 250;
/** «Отправить позже» — хотя бы на минуту вперёд */
const kMinScheduleAheadMs = 60_000;

export interface ScheduledSendItem extends ScheduledSendRow {
  accountName: string;
}

export interface ScheduledSendState {
  items: ScheduledSendItem[];
  loaded: boolean;
  error: string | null;
}

export const scheduledSends = writable<ScheduledSendState>({ items: [], loaded: false, error: null });
/** Страница «Запланированные» вместо списка писем */
export const scheduledViewOpen = writable(false);

export interface SendUndoToastState {
  scheduleID: string;
  subject: string;
  sendAt: Date;
}
export const sendUndoToast = writable<SendUndoToastState | null>(null);

let rows: ScheduledSendRow[] = [];
/** Письма в окне отмены: отправляем сам объект редактора, без пересборки */
const liveMails = new Map<string, EMail>();
const inFlight = new Set<number>();
let started = false;
let ready: Promise<void> | null = null;
let startedAt = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
let processing = false;
let processAgain = false;

export function normalizeUndoSeconds(value: unknown): number {
  let seconds = Number(value);
  return (kUndoSendChoices as readonly number[]).includes(seconds) ? seconds : 5;
}

/** Где будет ждать письмо, запланированное из этого ящика */
export function scheduledModeFor(account: MailAccount | null | undefined): ScheduledSendMode {
  return canDeferOnServer(account) ? "server" : "local";
}

/**
 * Запускает очередь один раз на время работы главного окна. Письма, которые
 * должны были уйти, пока приложение было закрыто, отправятся после запуска.
 */
export function startScheduledSendQueue(): Promise<void> {
  if (!ready) {
    started = true;
    startedAt = Date.now();
    ready = (async () => {
      // При монтировании окна связь с backend (и mail.db) может быть ещё не готова
      await waitForBackend();
      await failInterruptedSends(gt`Sending was interrupted. Check the Sent folder before sending it again.`);
      await refresh();
    })();
    ready.then(() => {
      window.addEventListener("online", () => scheduleTimer(0));
      scheduleTimer(kStartupDelayMs);
    }, ex => {
      ready = null;
      started = false;
      scheduledSends.set({ items: [], loaded: true, error: (ex as Error)?.message ?? String(ex) });
    });
  }
  return ready;
}

async function waitForBackend(): Promise<void> {
  let deadline = Date.now() + kBackendWaitMs;
  while (!appGlobal.remoteApp && Date.now() < deadline) {
    await sleep(kBackendPollMs / 1000);
  }
}

/** Перечитать очередь из базы (страница «Запланированные») */
export async function refreshScheduledSends(): Promise<void> {
  try {
    await startScheduledSendQueue();
    await refresh();
  } catch (ex) {
    scheduledSends.update(state => ({ ...state, loaded: true, error: (ex as Error)?.message ?? String(ex) }));
    throw ex;
  }
  scheduleTimer(0);
}

async function refresh(): Promise<void> {
  rows = await loadScheduledSends();
  publish();
}

function publish(): void {
  scheduledSends.set({
    // Окно отмены — только в тосте; неудачное после перезапуска — в списке, иначе его не найти
    items: rows
      .filter(row => row.mode != "undo" || row.status == "failed")
      .map(row => ({ ...row, accountName: findAccount(row.accountID)?.name ?? "" })),
    loaded: true,
    error: null,
  });
}

function findAccount(accountID: number): MailAccount | null {
  return appGlobal.emailAccounts.find(account => Number(account.dbID) == accountID) ?? null;
}

function recipientsSummary(mail: EMail): string {
  return [...mail.to.contents, ...mail.cc.contents]
    .map(person => person.name || person.emailAddress)
    .filter(Boolean)
    .join(", ");
}

function accountOf(mail: EMail): MailAccount {
  let account = mail.identity?.account ?? mail.folder?.account;
  assert(account, "Need mail account to send");
  assert(account.dbID != null, "Mail account is not saved yet");
  return account;
}

async function serializeForQueue(mail: EMail, scheduleID: string): Promise<string> {
  return JSON.stringify(await serializeComposeMail(mail, scheduleID));
}

/**
 * «Отправить» с окном отмены: письмо уходит через N секунд, а до тех пор
 * «Отменить» возвращает его в редактор. Письмо записано в базу, поэтому
 * закрытие приложения в эти секунды его не теряет — оно уйдёт после запуска.
 */
export async function sendWithUndo(mail: EMail): Promise<void> {
  let seconds = normalizeUndoSeconds(undoSendSecondsSetting.value);
  if (!seconds) {
    await mail.compose.send();
    return;
  }
  let account = accountOf(mail);
  let scheduleID = crypto.randomUUID();
  let sendAt = new Date(Date.now() + seconds * 1000);
  try {
    await startScheduledSendQueue();
    let payload = await serializeForQueue(mail, scheduleID);
    liveMails.set(scheduleID, mail);
    await insertScheduledSend({
      accountID: Number(account.dbID),
      scheduleID,
      mode: "undo",
      sendAt,
      subject: mail.subject ?? "",
      recipients: recipientsSummary(mail),
      payload,
    });
  } catch (ex) {
    // Очень большие вложения или сбой базы: отправляем сразу, как раньше
    liveMails.delete(scheduleID);
    backgroundError(ex as Error);
    await mail.compose.send();
    return;
  }
  // Письмо уже в очереди: сбой чтения списка не должен выглядеть как ошибка отправки
  await refresh().catch(backgroundError);
  sendUndoToast.set({ scheduleID, subject: mail.subject ?? "", sendAt });
  scheduleTimer(sendAt.getTime() - Date.now());
}

/** «Отменить» в тосте: письмо не уходит и открывается в редакторе */
export async function undoSend(scheduleID: string): Promise<void> {
  sendUndoToast.update(toast => toast?.scheduleID == scheduleID ? null : toast);
  let row = rows.find(candidate => candidate.scheduleID == scheduleID);
  let live = liveMails.get(scheduleID);
  if (!row || inFlight.has(row.id)) {
    throw new UserError(gt`The message has already been sent.`);
  }
  let payload = live ? null : await loadScheduledPayload(row.id);
  if (!await cancelPendingScheduledSend(row.id)) {
    throw new UserError(gt`The message has already been sent.`);
  }
  liveMails.delete(scheduleID);
  await refresh();
  scheduleTimer(0);
  reopenInComposer(live ?? mailFromPayload(row, payload));
}

/**
 * «Отправить позже». Exchange (EWS, OWA) держит письмо в «Исходящих» сервера
 * и отправит его сам; остальные ящики — очередь Jackdaw, письмо уйдёт,
 * когда приложение будет запущено.
 */
export async function scheduleSend(mail: EMail, sendAt: Date): Promise<ScheduledSendMode> {
  if (!Number.isFinite(sendAt.getTime()) || sendAt.getTime() < Date.now() + kMinScheduleAheadMs) {
    throw new UserError(gt`The send time has already passed. Pick a later time.`);
  }
  let account = accountOf(mail);
  await startScheduledSendQueue();
  let scheduleID = crypto.randomUUID();
  let payload: string;
  try {
    payload = await serializeForQueue(mail, scheduleID);
  } catch (ex) {
    backgroundError(ex as Error);
    throw new UserError(gt`This message is too large to schedule. Remove large attachments or send it now.`);
  }
  let mode = scheduledModeFor(account);
  let input = {
    accountID: Number(account.dbID),
    scheduleID,
    mode,
    sendAt,
    subject: mail.subject ?? "",
    recipients: recipientsSummary(mail),
    payload,
  };
  if (mode == "server") {
    await mail.compose.send({ deferredSend: { sendAt, scheduleID } });
    try {
      await insertScheduledSend(input);
    } catch (ex) {
      // Письмо уже ждёт на сервере: без записи его просто не будет в списке
      backgroundError(ex as Error);
    }
  } else {
    await insertScheduledSend(input);
  }
  await refresh().catch(backgroundError);
  scheduleTimer(0);
  return mode;
}

/** Убрать письмо из очереди или из «Исходящих» сервера. Письмо не отправится. */
async function takeOutOfQueue(item: ScheduledSendRow): Promise<string | null> {
  if (inFlight.has(item.id)) {
    throw new UserError(gt`The message is being sent right now.`);
  }
  let payload = await loadScheduledPayload(item.id);
  if (item.mode == "server") {
    let account = findAccount(item.accountID);
    if (!account) {
      throw new UserError(gt`The mail account of this message is not available.`);
    }
    let found = await cancelServerScheduled(deferredSendProtocolFor(account), item.scheduleID);
    if (!found) {
      await deleteScheduledSend(item.id);
      await refresh();
      throw new UserError(gt`The message has already been sent.`);
    }
    await deleteScheduledSend(item.id);
  } else if (!await cancelPendingScheduledSend(item.id)) {
    throw new UserError(gt`The message is being sent right now.`);
  }
  await refresh();
  scheduleTimer(0);
  return payload;
}

/** «Изменить»: письмо снимается с отправки и открывается в редакторе */
export async function editScheduled(item: ScheduledSendRow): Promise<void> {
  let payload = await takeOutOfQueue(item);
  reopenInComposer(mailFromPayload(item, payload));
}

/** «Удалить»: письмо не будет отправлено */
export async function deleteScheduled(item: ScheduledSendRow): Promise<void> {
  await takeOutOfQueue(item);
}

/** «Отправить сейчас» */
export async function sendScheduledNow(item: ScheduledSendRow): Promise<void> {
  if (item.mode == "server") {
    let payload = await takeOutOfQueue(item);
    let mail = mailFromPayload(item, payload);
    try {
      await mail.compose.send();
    } catch (ex) {
      // Письмо уже снято с сервера: не теряем его — открываем в редакторе
      reopenInComposer(mail);
      throw ex;
    }
    return;
  }
  await updateScheduledStatus(item.id, { status: "pending", attempts: 0, error: null, sendAt: new Date() });
  await refresh();
  await processDue();
}

function mailFromPayload(item: ScheduledSendRow, payload: string | null): EMail {
  let account = findAccount(item.accountID);
  if (!account) {
    throw new UserError(gt`The mail account of this message is not available.`);
  }
  assert(payload, "Scheduled message content is missing");
  let mail = deserializeComposeMail(JSON.parse(payload), account);
  // Исходное письмо — только данные для цитаты: отметку «Отвечено» найдём по In-Reply-To
  mail.composeSource = null;
  return mail;
}

function reopenInComposer(mail: EMail): void {
  mail.isDraft = true;
  mailApp.writeMail(mail, { collisionChecked: true });
}

function nextDueAt(row: ScheduledSendRow): number | null {
  if (row.mode == "server") {
    return row.sendAt.getTime() + kServerGraceMs;
  }
  return row.status == "pending" ? row.sendAt.getTime() : null;
}

function scheduleTimer(delayMs?: number): void {
  if (!started) {
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  let next = Math.min(...rows.map(nextDueAt).filter((at): at is number => at != null));
  if (!Number.isFinite(next) && delayMs == null) {
    return;
  }
  let wait = Number.isFinite(next) ? next - Date.now() : kMaxTimerMs;
  if (delayMs != null) {
    wait = Math.min(wait, delayMs);
  }
  timer = setTimeout(() => {
    timer = null;
    void processDue().catch(backgroundError);
  }, Math.min(Math.max(0, wait), kMaxTimerMs));
}

async function processDue(): Promise<void> {
  if (processing) {
    processAgain = true;
    return;
  }
  processing = true;
  try {
    do {
      processAgain = false;
      await refresh();
      let now = Date.now();
      for (let row of rows.slice()) {
        if (row.mode == "server") {
          if (row.sendAt.getTime() + kServerGraceMs <= now) {
            // Сервер отправил письмо сам, запись больше не нужна
            await deleteScheduledSend(row.id);
          }
        } else if (row.status == "pending" && row.sendAt.getTime() <= now) {
          await sendRow(row);
        }
      }
      await refresh();
    } while (processAgain);
  } finally {
    processing = false;
    scheduleTimer();
  }
}

async function sendRow(row: ScheduledSendRow): Promise<void> {
  if (inFlight.has(row.id)) {
    return;
  }
  let live = liveMails.get(row.scheduleID) ?? null;
  let mail = live;
  if (!mail) {
    let account = findAccount(row.accountID);
    if (!account || !(account.findSpecialFolder(SpecialFolder.Sent) ?? account.inbox)) {
      // Ящик ещё не прочитан после запуска
      if (Date.now() - startedAt > kAccountWaitMs) {
        await updateScheduledStatus(row.id, {
          status: "failed",
          error: gt`The mail account of this message is not available.`,
        });
      }
      return;
    }
    let payload = await loadScheduledPayload(row.id);
    if (!payload) {
      return;
    }
    mail = mailFromPayload(row, payload);
  }
  if (!await claimScheduledSend(row.id)) {
    return;
  }
  inFlight.add(row.id);
  sendUndoToast.update(toast => toast?.scheduleID == row.scheduleID ? null : toast);
  try {
    await mail.compose.send();
    await deleteScheduledSend(row.id);
    liveMails.delete(row.scheduleID);
  } catch (ex) {
    await onSendFailed(row, live, ex as Error);
  } finally {
    inFlight.delete(row.id);
  }
}

async function onSendFailed(row: ScheduledSendRow, live: EMail | null, ex: Error): Promise<void> {
  if (live) {
    // Окно отмены: как при ошибке обычной отправки — письмо снова в редакторе
    liveMails.delete(row.scheduleID);
    await deleteScheduledSend(row.id);
    reopenInComposer(live);
    showError(ex);
    return;
  }
  let attempts = row.attempts + 1;
  let message = ex?.message ?? String(ex);
  if (attempts < kMaxAttempts) {
    await updateScheduledStatus(row.id, {
      status: "pending",
      attempts,
      error: message,
      sendAt: new Date(Date.now() + kRetryDelayMs * attempts),
    });
    return;
  }
  await updateScheduledStatus(row.id, { status: "failed", attempts, error: message });
  showError(new UserError(gt`Could not send the scheduled message "${row.subject}": ${message}`));
}

/** Тост окна отмены: сколько секунд осталось */
export function secondsLeft(toast: SendUndoToastState | null, now = Date.now()): number {
  return toast ? Math.max(0, Math.ceil((toast.sendAt.getTime() - now) / 1000)) : 0;
}

