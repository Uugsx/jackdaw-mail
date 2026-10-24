import { get, writable } from "svelte/store";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { appGlobal } from "../../../logic/app";
import { UserError } from "../../../logic/util/util";
import { getLocalStorage } from "../../Util/LocalStorage";
import { backgroundError } from "../../Util/error";
import { gt } from "../../../l10n/l10n";
import {
  isSafeToRetrySend, kDefaultUndoSendDelay, normalizeUndoSendDelay, retryDelayMs,
  checkSendLaterTime, sendErrorText, sortScheduledSends,
  type ScheduledSend, type ScheduledSendKind,
} from "../../../logic/Mail/SendLater/SendLater";
import {
  claimScheduledSend, deleteScheduledSend, failScheduledSend, finishScheduledSend, getScheduledSend,
  insertScheduledSend, kInterruptedError, listScheduledSends, loadScheduledSendPayload,
  markScheduledOnServer, recoverInterruptedSends, releaseScheduledSend, removeSentServerScheduled,
  retryScheduledSendLater, setScheduledSendStatus,
} from "../../../logic/Mail/SendLater/ScheduledSendData";
import { cancelEWSDeferred, findEWSDeferred } from "../../../logic/Mail/SendLater/EWSDeferredSend";
import { deserializeComposeMail, serializeComposeMail } from "../Composer/composeWindow";
import type { ComposeWindowMail } from "../../../logic/Mail/Composer/ComposeWindowProtocol";

/**
 * Очередь отправки в главном окне: отмена отправки и «Отправить позже».
 *
 * Письмо сначала записывается в mail.db (с вложениями), потом закрывается
 * редактор. Отправляет таймер этого окна; после перезапуска — запуск
 * приложения. Пока приложение работает, исходный объект письма хранится
 * в памяти: «Отменить» возвращает в редактор ровно то, что было.
 */

export const undoSendDelaySetting = getLocalStorage<number>("mail.send.undoDelay", kDefaultUndoSendDelay);

export interface ScheduledSendsState {
  loaded: boolean;
  error: string | null;
  items: ScheduledSend[];
}

export const scheduledSends = writable<ScheduledSendsState>({ loaded: false, error: null, items: [] });

export type SendToastState =
  | { id: number, type: "undo", queueID: string, subject: string, sendAt: Date }
  | { id: number, type: "scheduled", queueID: string, subject: string, sendAt: Date }
  | { id: number, type: "sending", queueID: string, subject: string }
  | { id: number, type: "sent", subject: string }
  | { id: number, type: "retry", queueID: string, subject: string, sendAt: Date, error: string }
  | { id: number, type: "failed", queueID: string, subject: string, error: string };

export const sendToast = writable<SendToastState | null>(null);

/** Исходные объекты писем, пока приложение не перезапущено */
const liveMails = new Map<string, EMail>();
/** Письмо открыто из очереди для правки: после новой отправки старую запись убираем */
const editingMails = new WeakMap<EMail, string>();

/** Подпись «Отправлено» видна недолго */
const kSentToastMs = 4_000;
/** Подтверждение «Отправить позже» с кнопкой «Отменить» */
const kScheduledToastMs = 8_000;
/** Проверка очереди, даже если таймер сбился (сон компьютера) */
const kPollMs = 60_000;
/** Больше одного setTimeout не ставим: браузер обрезает долгие задержки */
const kMaxTimerMs = 60_000;

let toastCounter = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let processing: Promise<void> | null = null;
let processAgain = false;

// ---------- Отправка из редактора ----------

/**
 * Отправляет письмо из редактора: с задержкой для отмены или в назначенное время.
 * Письмо уже проверено редактором и получатели разрешены.
 * @param options.sendAt «Отправить позже»; без него — задержка из настроек
 */
export async function queueSend(mail: EMail, options: { sendAt?: Date } = {}): Promise<void> {
  let sendAt = options.sendAt;
  let kind: ScheduledSendKind = sendAt ? "later" : "undo";
  if (sendAt) {
    let problem = checkSendLaterTime(sendAt);
    if (problem == "past") {
      throw new UserError(gt`The send time has already passed. Pick a later time.`);
    } else if (problem) {
      throw new UserError(gt`Pick a send time within the next year.`);
    }
  }
  let delay = normalizeUndoSendDelay(undoSendDelaySetting.value);
  let previousQueueID = editingMails.get(mail) ?? null;
  if (kind == "undo" && delay == 0) {
    await mail.compose.send();
    await forgetEditedEntry(mail, previousQueueID);
    return;
  }
  let account = mailAccount(mail);
  let accountID = Number(account?.dbID);
  let queueID = crypto.randomUUID();
  let payload: ComposeWindowMail;
  try {
    if (!account || !Number.isSafeInteger(accountID)) {
      throw new Error("Mail account is not saved yet");
    }
    payload = await serializeComposeMail(mail, queueID, { loadBody: false, validate: false });
    sendAt ??= new Date(Date.now() + delay * 1000);
    await insertScheduledSend({
      queueID,
      accountID,
      kind,
      mode: "local",
      status: "pending",
      sendAt,
      subject: mail.subject ?? "",
      recipients: [...mail.to.contents, ...mail.cc.contents, ...mail.bcc.contents]
        .map(person => person.name || person.emailAddress)
        .filter(Boolean),
      payload: JSON.stringify(payload),
    });
  } catch (ex) {
    if (kind == "later") {
      backgroundError(ex);
      throw new UserError(gt`Could not schedule the message: ${sendErrorText(ex)}`);
    }
    // Без очереди (очень большие вложения, нет базы) — отправляем сразу, как раньше
    await mail.compose.send();
    await forgetEditedEntry(mail, previousQueueID);
    return;
  }
  liveMails.set(queueID, mail);
  await forgetEditedEntry(mail, previousQueueID);
  if (kind == "later" && account.canDeferSendOnServer) {
    await scheduleOnServer(queueID, account);
  }
  await refreshScheduledSends();
  showToast(kind == "undo"
    ? { id: 0, type: "undo", queueID, subject: mail.subject ?? "", sendAt }
    : { id: 0, type: "scheduled", queueID, subject: mail.subject ?? "", sendAt });
  if (started) {
    scheduleNext();
  } else {
    // Отправили до конца запуска (вход в ящики ещё идёт): таймер нужен уже сейчас
    void startSendQueue();
  }
}

/** Новая отправка письма, открытого из очереди: прежняя запись больше не нужна */
async function forgetEditedEntry(mail: EMail, queueID: string | null): Promise<void> {
  if (!queueID) {
    return;
  }
  editingMails.delete(mail);
  try {
    await deleteScheduledSend(queueID);
    await refreshScheduledSends();
  } catch (ex) {
    backgroundError(ex);
  }
}

function mailAccount(mail: EMail): MailAccount | null {
  return mail.identity?.account ?? mail.folder?.account ?? null;
}

/**
 * Передаёт письмо серверу Exchange с отложенной отправкой.
 * Если сервер не принял — письмо остаётся в локальной очереди.
 */
async function scheduleOnServer(queueID: string, account: MailAccount): Promise<void> {
  let claim = crypto.randomUUID();
  if (!await claimScheduledSend(queueID, claim, { force: true })) {
    return;
  }
  let item = await getScheduledSend(queueID);
  try {
    let mail = await mailForSend(queueID);
    await mail.compose.send({ deferred: { sendAt: item.sendAt, queueID } });
    await markScheduledOnServer(queueID, claim);
    return;
  } catch (ex) {
    backgroundError(ex);
    // Ответ мог потеряться после того, как сервер принял письмо: проверяем
    let found: string[] | null = null;
    try {
      found = await findEWSDeferred(request => (account as any).callEWS(request), queueID);
    } catch (findEx) {
      backgroundError(findEx);
    }
    if (found?.length) {
      await markScheduledOnServer(queueID, claim);
    } else if (found || isSafeToRetrySend(ex, navigator.onLine)) {
      // Сервер точно не принял: отправит приложение
      await releaseScheduledSend(queueID, claim);
    } else {
      await failScheduledSend(queueID, claim,
        gt`Could not confirm that the server accepted the scheduled message. Check Outbox and Drafts before trying again.`);
    }
  }
}

// ---------- Восстановление письма ----------

/** Объект для отправки: исходный, если он ещё в памяти, иначе из базы */
async function mailForSend(queueID: string): Promise<EMail> {
  let live = liveMails.get(queueID);
  if (live) {
    liveMails.delete(queueID);
    return live;
  }
  let mail = await restoreMail(queueID);
  // Облегчённая копия исходного письма — не для пометок «Отвечено»: найдём по In-Reply-To
  mail.composeSource = null;
  return mail;
}

async function restoreMail(queueID: string): Promise<EMail> {
  let json = await loadScheduledSendPayload(queueID);
  if (!json) {
    throw new UserError(gt`The message is no longer in the send queue.`);
  }
  let payload: ComposeWindowMail;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new UserError(gt`The saved message is damaged and cannot be opened.`);
  }
  let account = appGlobal.emailAccounts.find(candidate => candidate.id == payload.accountID);
  if (!account) {
    throw new UserError(gt`The mail account of this message was removed.`);
  }
  return deserializeComposeMail(payload, account);
}

async function openInComposer(mail: EMail): Promise<void> {
  const { openComposer } = await import("../open");
  openComposer(mail);
}

// ---------- Действия ----------

/** «Отменить» на полосе и в списке до отправки: письмо возвращается в редактор */
export async function undoSend(queueID: string): Promise<void> {
  let item = await getScheduledSend(queueID);
  if (!item) {
    throw new UserError(gt`The message has already been sent.`);
  }
  let mail = liveMails.get(queueID) ?? await restoreMail(queueID);
  if (item.status == "server") {
    await cancelOnServer(item);
  }
  if (!await deleteScheduledSend(queueID)) {
    throw new UserError(gt`The message is already being sent and can no longer be cancelled.`);
  }
  liveMails.delete(queueID);
  dismissToastFor(queueID);
  await refreshScheduledSends();
  await openInComposer(mail);
}

/** Правка из списка: письмо не уйдёт, пока его снова не отправят */
export async function editScheduledSend(queueID: string): Promise<void> {
  let item = await requireItem(queueID);
  if (item.status == "server") {
    await cancelOnServer(item);
  }
  if (!await setScheduledSendStatus(queueID, "paused")) {
    throw new UserError(gt`The message is already being sent and can no longer be changed.`);
  }
  let mail = liveMails.get(queueID) ?? await restoreMail(queueID);
  liveMails.delete(queueID);
  editingMails.set(mail, queueID);
  dismissToastFor(queueID);
  await refreshScheduledSends();
  await openInComposer(mail);
}

/** «Отменить отправку» в списке: письмо остаётся в списке и ждёт решения */
export async function pauseScheduledSend(queueID: string): Promise<void> {
  let item = await requireItem(queueID);
  if (item.status == "server") {
    await cancelOnServer(item);
  }
  if (!await setScheduledSendStatus(queueID, "paused")) {
    throw new UserError(gt`The message is already being sent and can no longer be changed.`);
  }
  dismissToastFor(queueID);
  await refreshScheduledSends();
}

/** «Возобновить»: снова по расписанию, или сейчас, если время прошло */
export async function resumeScheduledSend(queueID: string): Promise<void> {
  let item = await requireItem(queueID);
  let sendAt = item.sendAt.getTime() > Date.now() ? item.sendAt : new Date();
  if (!await setScheduledSendStatus(queueID, "pending", sendAt)) {
    throw new UserError(gt`The message is already being sent and can no longer be changed.`);
  }
  let account = accountFor(item);
  if (item.kind == "later" && account?.canDeferSendOnServer && sendAt.getTime() > Date.now() + kPollMs) {
    await scheduleOnServer(queueID, account);
  }
  await refreshScheduledSends();
  scheduleNext();
}

/** «Отправить сейчас» и «Повторить» */
export async function sendScheduledNow(queueID: string): Promise<void> {
  let item = await requireItem(queueID);
  if (item.status == "server") {
    await cancelOnServer(item);
    await setScheduledSendStatus(queueID, "pending", new Date());
  }
  await sendItem(queueID, true);
}

/** «Удалить»: письмо не уйдёт и пропадёт из списка */
export async function deleteScheduledSendFromUI(queueID: string): Promise<void> {
  let item = await requireItem(queueID);
  if (item.status == "server") {
    await cancelOnServer(item);
  }
  if (!await deleteScheduledSend(queueID)) {
    throw new UserError(gt`The message is already being sent and can no longer be cancelled.`);
  }
  liveMails.delete(queueID);
  dismissToastFor(queueID);
  await refreshScheduledSends();
}

async function requireItem(queueID: string): Promise<ScheduledSend> {
  let item = await getScheduledSend(queueID);
  if (!item) {
    await refreshScheduledSends();
    throw new UserError(gt`The message is no longer in the send queue.`);
  }
  return item;
}

function accountFor(item: ScheduledSend): MailAccount | null {
  return appGlobal.emailAccounts.find(account => String(account.dbID) == String(item.accountID)) ?? null;
}

async function cancelOnServer(item: ScheduledSend): Promise<void> {
  let account = accountFor(item);
  if (!account) {
    throw new UserError(gt`The mail account of this message was removed.`);
  }
  let cancelled = await cancelEWSDeferred(request => (account as any).callEWS(request), item.queueID);
  if (!cancelled) {
    await deleteScheduledSend(item.queueID);
    await refreshScheduledSends();
    throw new UserError(gt`The server has already sent this message.`);
  }
}

// ---------- Таймер ----------

/** Запуск в главном окне после входа в ящики */
export async function startSendQueue(): Promise<void> {
  if (started) {
    return;
  }
  started = true;
  try {
    await waitForBackend();
    await recoverInterruptedSends();
  } catch (ex) {
    // Базы нет (веб-версия) — очереди тоже нет, отправка идёт сразу
    backgroundError(ex);
    started = false;
    return;
  }
  pollTimer = setInterval(() => void processDue(), kPollMs);
  window.addEventListener("online", onOnline);
  await processDue();
}

export function stopSendQueue(): void {
  started = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
  window.removeEventListener("online", onOnline);
}

function onOnline(): void {
  // Сеть вернулась: письма, ждущие повтора, отправляем сразу
  void (async () => {
    let items = get(scheduledSends).items.filter(item => item.status == "pending" && item.attempts > 0);
    for (let item of items) {
      await setScheduledSendStatus(item.queueID, "pending", new Date()).catch(backgroundError);
    }
    await processDue();
  })();
}

/** Отправляет всё, чему пришло время. Повторный вызов во время работы — ещё один проход. */
export function processDue(): Promise<void> {
  if (processing) {
    processAgain = true;
    return processing;
  }
  processing = (async () => {
    try {
      do {
        processAgain = false;
        await removeSentServerScheduled();
        let now = Date.now();
        let due = (await listScheduledSends())
          .filter(item => item.mode == "local" && item.status == "pending" && item.sendAt.getTime() <= now);
        for (let item of due) {
          await sendItem(item.queueID, false);
        }
        await refreshScheduledSends();
      } while (processAgain);
    } catch (ex) {
      backgroundError(ex);
    } finally {
      processing = null;
      scheduleNext();
    }
  })();
  return processing;
}

function scheduleNext(): void {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
  if (!started) {
    return;
  }
  let next = get(scheduledSends).items
    .filter(item => item.mode == "local" && item.status == "pending")
    .reduce((min, item) => Math.min(min, item.sendAt.getTime()), Infinity);
  if (!Number.isFinite(next)) {
    return;
  }
  let wait = Math.min(kMaxTimerMs, Math.max(0, next - Date.now()));
  nextTimer = setTimeout(() => {
    nextTimer = null;
    void processDue();
  }, wait);
}

/**
 * Отправляет одно письмо, если удалось его забрать.
 * @param force не ждать срока: «Отправить сейчас», «Повторить»
 */
async function sendItem(queueID: string, force: boolean): Promise<void> {
  let claim = crypto.randomUUID();
  if (!await claimScheduledSend(queueID, claim, { force })) {
    if (force) {
      await refreshScheduledSends();
      throw new UserError(gt`The message is already being sent.`);
    }
    return;
  }
  let item = await getScheduledSend(queueID);
  let subject = item?.subject ?? "";
  let toast = get(sendToast);
  if (item?.kind == "undo" || force || (toast && "queueID" in toast && toast.queueID == queueID)) {
    showToast({ id: 0, type: "sending", queueID, subject });
  }
  await refreshScheduledSends();
  try {
    let mail = await mailForSend(queueID);
    await mail.compose.send();
    await finishScheduledSend(queueID, claim);
    showToast({ id: 0, type: "sent", subject });
  } catch (ex) {
    let error = sendErrorText(ex);
    if (!(ex instanceof UserError) && isSafeToRetrySend(ex, navigator.onLine)) {
      let retryAt = new Date(Date.now() + retryDelayMs((item?.attempts ?? 0) + 1));
      await retryScheduledSendLater(queueID, claim, retryAt, error);
      showToast({ id: 0, type: "retry", queueID, subject, sendAt: retryAt, error });
    } else {
      await failScheduledSend(queueID, claim, error);
      showToast({ id: 0, type: "failed", queueID, subject, error });
    }
  } finally {
    await refreshScheduledSends();
  }
}

export async function refreshScheduledSends(): Promise<void> {
  try {
    await waitForBackend();
    let items = sortScheduledSends(await listScheduledSends());
    scheduledSends.set({ loaded: true, error: null, items });
  } catch (ex) {
    backgroundError(ex);
    scheduledSends.update(state => ({ ...state, loaded: true, error: sendErrorText(ex) }));
  }
}

/** Понятная причина ошибки в списке */
export function scheduledSendErrorText(item: ScheduledSend): string | null {
  if (!item.lastError) {
    return null;
  }
  return item.lastError == kInterruptedError
    ? gt`Sending was interrupted when the app closed. Check Sent before sending again.`
    : item.lastError;
}

/** Связь с backend (и mail.db) после запуска появляется не сразу */
const kBackendWaitMs = 60_000;
const kBackendPollMs = 250;

/**
 * Ждёт backend, не дольше минуты. Список «Запланированные», раскрытый
 * с прошлого запуска, читает базу раньше, чем закончится вход в ящики.
 */
async function waitForBackend(): Promise<void> {
  let deadline = Date.now() + kBackendWaitMs;
  while (!appGlobal.remoteApp && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, kBackendPollMs));
  }
}

// ---------- Полоса внизу окна ----------

function showToast(state: SendToastState): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  let id = ++toastCounter;
  sendToast.set({ ...state, id });
  let hideAfter = state.type == "sent" ? kSentToastMs
    : state.type == "scheduled" ? kScheduledToastMs
    : null;
  if (hideAfter) {
    toastTimer = setTimeout(() => {
      toastTimer = null;
      sendToast.update(current => current?.id == id ? null : current);
    }, hideAfter);
  }
}

export function dismissSendToast(): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  sendToast.set(null);
}

function dismissToastFor(queueID: string): void {
  let current = get(sendToast);
  if (current && "queueID" in current && current.queueID == queueID) {
    dismissSendToast();
  }
}
