import type { JackdawUserStatus } from "../../../logic/Meet/Jackdaw/JackdawCallProtocol";
import { gt } from "../../../l10n/l10n";

export function statusLabel(status: JackdawUserStatus): string {
  switch (status) {
    case "busy":
      return gt`Busy`;
    case "dnd":
      return gt`Do not disturb`;
    default:
      return gt`Available`;
  }
}

/** Что статус значит для собеседника: показывается в подсказке и в шапке чата */
export function statusHint(status: JackdawUserStatus): string {
  switch (status) {
    case "busy":
      return gt`Busy: calls still ring, but they may not answer`;
    case "dnd":
      return gt`Do not disturb: calls are declined, messages arrive silently`;
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
