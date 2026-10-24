/**
 * Звонки в истории чата: после звонка в личном чате с собеседником появляется
 * строка «Исходящий звонок · 3:12», «Пропущенный звонок» и т. п.
 * Запись только у себя: каждое устройство пишет свою, собеседнику ничего не отправляется.
 */
import type { JackdawCall } from "../../Meet/Jackdaw/JackdawCall";
import { getJackdawChatAccount } from "./JackdawChats";
import { gt } from "../../../l10n/l10n";

export function formatCallDuration(seconds: number): string {
  let total = Math.max(0, Math.round(seconds));
  let hours = Math.floor(total / 3600);
  let minutes = Math.floor((total % 3600) / 60);
  let rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Строка истории для завершённого звонка */
export function callSummary(call: Pick<JackdawCall, "outgoing" | "started" | "ended" | "endReason" | "missed">): string {
  if (call.started) {
    let duration = formatCallDuration(((call.ended ?? new Date()).getTime() - call.started.getTime()) / 1000);
    return call.outgoing ? gt`Outgoing call · ${duration}` : gt`Incoming call · ${duration}`;
  }
  if (call.outgoing) {
    switch (call.endReason) {
      case "declined":
        return gt`Outgoing call · declined`;
      case "no-answer":
      case "timeout":
        return gt`Outgoing call · no answer`;
      case "busy":
      case "dnd":
      case "offline":
        return gt`Outgoing call · not reached`;
      default:
        return gt`Outgoing call · cancelled`;
    }
  }
  if (call.missed) {
    return gt`Missed call`;
  }
  if (call.endReason == "answered-elsewhere") {
    return gt`Incoming call · answered on another device`;
  }
  return gt`Incoming call · declined`;
}

export async function recordCallInChat(call: JackdawCall): Promise<void> {
  let account = getJackdawChatAccount();
  if (!account || !call.remoteEmail || account.isOwnEmail(call.remoteEmail)) {
    return;
  }
  let room = await account.getDirectRoom(call.remoteEmail);
  await room.listMessages();
  let event = room.newRoomEvent();
  event.id = crypto.randomUUID();
  event.outgoing = call.outgoing;
  event.sent = call.started ?? call.ended ?? new Date();
  event.received = new Date();
  event.text = callSummary(call);
  room.messages.add(event);
  await account.storage.saveMessage(event);
}
