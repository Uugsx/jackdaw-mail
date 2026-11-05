import type { JackdawUserStatus } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import type { JackdawCallClient } from "../../../logic/Meet/Jackdaw/JackdawCallClient";
import { gt } from "../../../l10n/l10n";

/** Что видно о собеседнике: его статус или «не в сети» */
export type PresenceState = JackdawUserStatus | "offline";

/**
 * Присутствие собеседника по его адресам: в сети — его статус, иначе «не в сети».
 * null — пока неизвестно (справочник ещё не ответил или сами не подключены).
 * Для обновления подпишитесь на `presenceVersion` клиента.
 */
export function presenceOf(client: JackdawCallClient, emails: string[]): PresenceState | null {
  if (!client.isOnline || !emails.length) {
    return null;
  }
  let reachable = emails.map(email => client.isReachable(email));
  let online = emails.filter((_, i) => reachable[i] === true);
  if (online.length) {
    return online.map(email => client.statusOf(email)).find(status => status != "available") ?? "available";
  }
  return reachable.some(value => value === false) ? "offline" : null;
}

export function statusLabel(status: PresenceState): string {
  switch (status) {
    case "busy":
      return gt`Busy`;
    case "dnd":
      return gt`Do not disturb`;
    case "offline":
      return gt`Offline`;
    default:
      return gt`Available`;
  }
}

/** Что статус значит для собеседника: показывается в подсказке и в шапке чата */
export function statusHint(status: PresenceState): string {
  switch (status) {
    case "busy":
      return gt`Busy: calls still ring, but they may not answer`;
    case "dnd":
      return gt`Do not disturb: calls are declined, messages arrive silently`;
    case "offline":
      return gt`Offline: calls will not ring, messages arrive when they connect`;
    default:
      return gt`Available for calls and chat`;
  }
}

/** Конец дня по местному времени: «не беспокоить до конца дня» */
export function secondsUntilEndOfDay(now = new Date()): number {
  let end = new Date(now);
  end.setHours(23, 59, 59, 0);
  return Math.max(60, Math.round((end.getTime() - now.getTime()) / 1000));
}
