/**
 * Точка входа звонков Jackdaw ↔ Jackdaw: один клиент сигналинга на приложение.
 */
import { JackdawCallClient } from "./JackdawCallClient";
import { JackdawCall, JackdawCallAccount } from "./JackdawCall";
import { callServiceURL, normalizeCallEmail } from "./JackdawCallProtocol";
import { getProCallCredential, proEntitlement, refreshProEntitlement } from "../../Billing/ProEntitlement";
import { BILLING_LICENSE_API_URL } from "../../Billing/Billing";
import { Person } from "../../Abstract/Person";
import { PersonUID } from "../../Abstract/PersonUID";
import { MeetingState } from "../VideoConfMeeting";
import { appGlobal } from "../../app";

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
    onIncoming: message => {
      let call = getJackdawCallAccount().newMeeting();
      let person = findPersonByEmail(message.from);
      call.prepareIncoming(message, person);
      let busy = appGlobal.meetings.some(m => m.state != MeetingState.Ended);
      if (busy) {
        call.rejectAsBusy();
        return;
      }
      appGlobal.meetings.add(call);
    },
  });
  return client;
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
    stopWatching = () => {
      unsubscribe();
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
 * Создаёт звонок, если собеседник доступен в Jackdaw. Показывает экран подтверждения вызова.
 * @returns null, если звонок через Jackdaw невозможен (тогда вызывающий выбирает другой способ)
 */
export async function startJackdawCall(target: CallTarget, video: boolean): Promise<JackdawCall | null> {
  let callClient = getJackdawCallClient();
  if (!callClient.isOnline || !callClient.verifiedEmails.length) return null;
  let emails = callTargetEmails(target);
  let email = emails.find(e => callClient.isReachable(e) === true);
  if (!email && emails.length) {
    let fresh = await callClient.lookupNow(emails);
    email = emails.find(e => fresh[e]);
  }
  if (!email) return null;
  let person = target instanceof Person ? target : target.findPerson();
  let call = getJackdawCallAccount().newMeeting();
  call.prepareOutgoing(email, person?.name || target.name || "", video, person);
  appGlobal.meetings.add(call);
  return call;
}
