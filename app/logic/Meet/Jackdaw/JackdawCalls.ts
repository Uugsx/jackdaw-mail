/**
 * Точка входа звонков Jackdaw ↔ Jackdaw: один клиент сигналинга на приложение.
 */
import { JackdawCallClient } from "./JackdawCallClient";
import { JackdawCall, JackdawCallAccount } from "./JackdawCall";
import { callServiceURL, normalizeCallEmail, type JackdawServerMessage } from "./JackdawCallProtocol";
import { getProCallCredential, proEntitlement, refreshProEntitlement } from "../../Billing/ProEntitlement";
import { BILLING_LICENSE_API_URL } from "../../Billing/Billing";
import { Person } from "../../Abstract/Person";
import { PersonUID } from "../../Abstract/PersonUID";
import { MeetingState, type VideoConfMeeting } from "../VideoConfMeeting";
import { appGlobal } from "../../app";
import { startJackdawChat } from "../../Chat/Jackdaw/JackdawChats";
import { UserError } from "../../util/util";
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

function myDisplayName(): string {
  return appGlobal.me?.name || appGlobal.emailAccounts.first?.realname || "";
}

export function getJackdawCallClient(): JackdawCallClient {
  client ??= new JackdawCallClient({
    url: callServiceURL(BILLING_LICENSE_API_URL),
    getCredential: () => CALL_ENTITLEMENT_STATUSES.has(proEntitlement.value.status) ? getProCallCredential() : null,
    getDisplayName: myDisplayName,
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

/** Подключает звонки и следит за лицензией: при её смене соединение переоткрывается. */
export function startJackdawCalls(): () => void {
  let callClient = getJackdawCallClient();
  if (!stopWatching) {
    let lastStatus: string | null = null;
    let unsubscribe = proEntitlement.subscribe(() => {
      let status = proEntitlement.value.status;
      if (status == lastStatus) return;
      let wasAllowed = lastStatus != null && CALL_ENTITLEMENT_STATUSES.has(lastStatus);
      lastStatus = status;
      if (CALL_ENTITLEMENT_STATUSES.has(status)) {
        // Смена ключа или переход с пробного на платный тоже меняет учётные данные.
        wasAllowed ? callClient.start() : callClient.restart();
      } else if (status != "checking") {
        callClient.stop();
      }
    });
    let onOnline = () => {
      if (callClient.status == "offline") {
        callClient.restart();
      }
    };
    globalThis.addEventListener?.("online", onOnline);
    // Чат идёт по тому же соединению и включается вместе со звонками.
    let stopChat = startJackdawChat(callClient);
    stopWatching = () => {
      unsubscribe();
      stopChat();
      globalThis.removeEventListener?.("online", onOnline);
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
