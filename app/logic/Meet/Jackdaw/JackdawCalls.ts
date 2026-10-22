/**
 * Точка входа звонков Jackdaw ↔ Jackdaw: один клиент сигналинга на приложение.
 */
import { JackdawCallClient, type JackdawCallStatus } from "./JackdawCallClient";
import { JackdawCall, JackdawCallAccount, setJackdawCallFinishedHandler } from "./JackdawCall";
import { callServiceURL, normalizeCallEmail, type JackdawServerMessage } from "./JackdawCallProtocol";
import { getProCallCredential, proEntitlement, refreshProEntitlement, type ProCallCredential } from "../../Billing/ProEntitlement";
import { BILLING_LICENSE_API_URL } from "../../Billing/Billing";
import { Person } from "../../Abstract/Person";
import { PersonUID } from "../../Abstract/PersonUID";
import { MeetingState, type VideoConfMeeting } from "../VideoConfMeeting";
import { appGlobal } from "../../app";
import { startJackdawChat } from "../../Chat/Jackdaw/JackdawChats";
import { recordCallInChat } from "../../Chat/Jackdaw/callHistory";
import { UserError } from "../../util/util";
import { getComputerOn, type ComputerOn } from "../../util/backend-wrapper";
import { gt } from "../../../l10n/l10n";

/** Статусы entitlement, при которых сервис звонков примет устройство */
const CALL_ENTITLEMENT_STATUSES = new Set(["active", "trial", "past_due", "offline"]);

let client: JackdawCallClient | null = null;
let account: JackdawCallAccount | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage == "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Адреса ящиков и личностей в приложении: по ним сервер решает, какие адреса лицензии наши */
export function myMailboxEmails(): string[] {
  return appGlobal.emailAccounts.contents.flatMap(account => [
    account.emailAddress,
    ...account.identities.contents
      .filter(identity => !identity.isCatchAll)
      .map(identity => identity.emailAddress),
  ]).filter(Boolean);
}

function myDisplayName(): string {
  return appGlobal.me?.name || appGlobal.emailAccounts.first?.realname || "";
}

export function getJackdawCallClient(): JackdawCallClient {
  client ??= new JackdawCallClient({
    url: callServiceURL(BILLING_LICENSE_API_URL),
    getCredential: () => CALL_ENTITLEMENT_STATUSES.has(proEntitlement.value.status) ? getProCallCredential() : null,
    getDisplayName: myDisplayName,
    getMailboxEmails: myMailboxEmails,
    storage: storage(),
    onIncoming: message => handleIncomingJackdawCall(message),
  });
  return client;
}

/** Встреча действительно идёт или звонит. Брошенный экран «Позвонить?» — ещё нет: по нему никто не соединён. */
function isActiveMeeting(meeting: VideoConfMeeting): boolean {
  return meeting.state != MeetingState.Ended && meeting.state != MeetingState.OutgoingCallConfirm;
}

/** Закрывает неподтверждённые экраны исходящего звонка: они ничего не отправляли на сервер. */
function closeUnconfirmedCalls(): void {
  for (let meeting of appGlobal.meetings.contents.filter(m => m.state == MeetingState.OutgoingCallConfirm)) {
    meeting.hangup().catch(() => {
      // Экран всё равно уходит из списка встреч в `hangup()` базового класса.
    });
  }
}

/** Проверка перед новым звонком: второй разговор поверх идущего не начинается.
 * @throws UserError, если уже идёт звонок или встреча */
export function assertNoActiveCall(): void {
  if (appGlobal.meetings.some(isActiveMeeting)) {
    throw new UserError(gt`Finish the current call before starting a new one.`);
  }
}

/** Входящий звонок от сервиса.
 * «Занято» отвечаем, только если действительно идёт другая встреча.
 * Сервер на `reject` с `busy` завершает вызов на всех устройствах вызываемого, поэтому
 * неподтверждённый экран исходящего звонка занятостью не считается: он закрывается, входящий показывается.
 * @param callAccount для тестов */
export function handleIncomingJackdawCall(
  message: Extract<JackdawServerMessage, { type: "incoming" }>,
  callAccount: JackdawCallAccount = getJackdawCallAccount(),
): JackdawCall {
  let call = callAccount.newMeeting();
  let person = findPersonByEmail(message.from);
  call.prepareIncoming(message, person);
  if (appGlobal.meetings.some(isActiveMeeting)) {
    call.rejectAsBusy();
    return call;
  }
  closeUnconfirmedCalls();
  appGlobal.meetings.add(call);
  return call;
}

export function getJackdawCallAccount(): JackdawCallAccount {
  account ??= new JackdawCallAccount(getJackdawCallClient());
  return account;
}

let stopWatching: (() => void) | null = null;

/** Состояния, из которых стоит переподключиться сразу, не дожидаясь паузы или новой лицензии */
const STALLED_STATUSES = new Set<JackdawCallStatus>(["offline", "rejected"]);
/** После сна или смены сети ответа живого соединения ждём недолго: пользователь сразу пишет в чат */
const WAKE_PONG_TIMEOUT_MS = 5_000;

/** Отличает учётные данные: новый ключ при том же статусе лицензии тоже требует нового входа */
function credentialKey(credential: ProCallCredential | null): string {
  return credential ? `${credential.kind}:${credential.kind == "license" ? credential.licenseKey : ""}` : "";
}

function computerOnOrNull(): ComputerOn | null {
  try {
    return getComputerOn() ?? null;
  } catch {
    return null; // Нет связи с процессом приложения (тесты, ранний запуск): остаётся событие `online`
  }
}

/**
 * Сеть вернулась или система проснулась: соединение без связи или с отказом пробует войти сразу,
 * а соединение на связи проверяет, живо ли оно: сокет мог пережить сон «открытым» при мёртвом TCP.
 * @param computerOn для тестов
 * @returns отписка
 */
export function watchCallReconnectTriggers(callClient: JackdawCallClient, computerOn = computerOnOrNull()): () => void {
  let reconnectIfStalled = () => {
    if (STALLED_STATUSES.has(callClient.status)) {
      callClient.restart();
    } else if (callClient.status == "online") {
      // Не restart(): он оборвал бы идущий звонок. Живое соединение ответит и останется.
      callClient.checkConnection(WAKE_PONG_TIMEOUT_MS);
    }
  };
  globalThis.addEventListener?.("online", reconnectIfStalled);
  let wasSleeping = computerOn?.isSleeping ?? false;
  let stopWake = computerOn?.subscribe(() => {
    let woke = wasSleeping && !computerOn.isSleeping;
    wasSleeping = computerOn.isSleeping;
    if (woke) {
      reconnectIfStalled();
    }
  });
  return () => {
    globalThis.removeEventListener?.("online", reconnectIfStalled);
    stopWake?.();
  };
}

/** Подключает звонки и следит за лицензией: при её смене соединение переоткрывается. */
export function startJackdawCalls(): () => void {
  let callClient = getJackdawCallClient();
  if (!stopWatching) {
    let lastStatus: string | null = null;
    let lastCredential: string | null = null;
    let unsubscribe = proEntitlement.subscribe(() => {
      let status = proEntitlement.value.status;
      let credential = credentialKey(getProCallCredential());
      if (status == lastStatus && credential == lastCredential) return;
      let wasAllowed = lastStatus != null && CALL_ENTITLEMENT_STATUSES.has(lastStatus);
      let credentialChanged = lastCredential != null && credential != lastCredential;
      lastStatus = status;
      lastCredential = credential;
      if (CALL_ENTITLEMENT_STATUSES.has(status)) {
        // Смена ключа или переход с пробного на платный тоже меняет учётные данные.
        wasAllowed && !credentialChanged ? callClient.start() : callClient.restart();
      } else if (status != "checking") {
        callClient.stop();
      }
    });
    let stopTriggers = watchCallReconnectTriggers(callClient);
    // Чат идёт по тому же соединению и включается вместе со звонками.
    let stopChat = startJackdawChat(callClient);
    // Звонок — строкой в истории личного чата с собеседником
    setJackdawCallFinishedHandler(call => recordCallInChat(call).catch(ex => console.error(ex)));
    stopWatching = () => {
      unsubscribe();
      stopChat();
      stopTriggers();
      stopWatching = null;
    };
  }
  if (proEntitlement.value.status == "checking") {
    // На десктопе лицензию иначе проверяют только экраны Pro; без проверки звонки не включатся.
    void refreshProEntitlement().catch(() => {});
  }
  callClient.start();
  return () => {
    stopWatching?.();
    callClient.stop();
  };
}

export type CallTarget = Person | PersonUID;

/** Адреса собеседника по порядку предпочтения. */
export function callTargetEmails(target: CallTarget | null | undefined): string[] {
  if (!target) return [];
  let emails: (string | null)[] = [];
  if (target instanceof PersonUID) {
    emails.push(normalizeCallEmail(target.emailAddress));
    let person = target.findPerson();
    if (person) {
      emails.push(...person.emailAddresses.contents.slice().sort((a, b) => a.preference - b.preference).map(e => normalizeCallEmail(e.value)));
    }
  } else if (target instanceof Person) {
    emails.push(...target.emailAddresses.contents.slice().sort((a, b) => a.preference - b.preference).map(e => normalizeCallEmail(e.value)));
  }
  return [...new Set(emails.filter((email): email is string => !!email))];
}

/** Можно ли позвонить сейчас. Для кнопок: undefined, пока справочник не ответил. */
export function canJackdawCall(target: CallTarget | null | undefined, callClient = client): boolean {
  if (!callClient?.isOnline || !callClient.verifiedEmails.length) return false;
  return callTargetEmails(target).some(email => callClient.isReachable(email) === true);
}

function findPersonByEmail(email: string): Person | null {
  try {
    return new PersonUID(email).findPerson() ?? null;
  } catch {
    return null;
  }
}

/**
 * Создаёт голосовой звонок, если собеседник доступен в Jackdaw. Показывает экран подтверждения вызова.
 * Видеозвонков между пользователями Jackdaw нет: `_video` оставлен для совместимости вызова.
 * @returns null, если звонок через Jackdaw невозможен (тогда вызывающий выбирает другой способ)
 * @throws UserError, если уже идёт другой звонок
 */
export async function startJackdawCall(target: CallTarget, _video = false): Promise<JackdawCall | null> {
  assertNoActiveCall();
  let callClient = getJackdawCallClient();
  if (!callClient.isOnline || !callClient.verifiedEmails.length) return null;
  let emails = callTargetEmails(target);
  let email = emails.find(e => callClient.isReachable(e) === true);
  if (!email && emails.length) {
    let fresh = await callClient.lookupNow(emails);
    email = emails.find(e => fresh[e]);
  }
  if (!email) return null;
  // Пока шёл запрос справочника, мог начаться другой звонок.
  assertNoActiveCall();
  closeUnconfirmedCalls();
  let person = target instanceof Person ? target : target.findPerson();
  let call = getJackdawCallAccount().newMeeting();
  call.prepareOutgoing(email, person?.name || target.name || "", false, person);
  appGlobal.meetings.add(call);
  return call;
}
