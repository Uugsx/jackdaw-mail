/**
 * Журнал звонков Jackdaw на экране «Встреча»: кто, когда, сколько длился разговор,
 * пропущенные и неотвеченные. Хранится только на этом устройстве.
 */
import type { JackdawCall } from "./JackdawCall";
import type { JackdawCallEndReason } from "./JackdawCallProtocol";
import { callSummary } from "../../Chat/Jackdaw/callHistory";
import { ArrayColl } from "svelte-collections";

const CALL_LOG_STORAGE_KEY = "jackdaw.calls.log.v1";
/** Старые записи отбрасываются: журнал нужен для «перезвонить», а не как архив */
export const CALL_LOG_LIMIT = 200;

export interface CallLogEntry {
  id: string;
  email: string;
  name: string;
  outgoing: boolean;
  video: boolean;
  /** Когда позвонили: время ответа или окончания вызова */
  at: number;
  /** Длительность разговора в секундах; null — разговора не было */
  duration: number | null;
  endReason: JackdawCallEndReason | null;
  missed: boolean;
}

/** Новые звонки — первыми */
export const callLog = new ArrayColl<CallLogEntry>();
let loaded = false;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isEntry(value: any): value is CallLogEntry {
  return !!value && typeof value.id == "string" && typeof value.email == "string" && typeof value.at == "number";
}

/** Читает журнал из хранилища один раз; повторные вызовы ничего не делают */
export function loadCallLog(): ArrayColl<CallLogEntry> {
  if (loaded) {
    return callLog;
  }
  loaded = true;
  try {
    let saved = JSON.parse(storage()?.getItem(CALL_LOG_STORAGE_KEY) ?? "[]");
    if (Array.isArray(saved)) {
      callLog.replaceAll(saved.filter(isEntry).slice(0, CALL_LOG_LIMIT));
    }
  } catch {
    // Повреждённый журнал не мешает звонить: начинаем с пустого
  }
  return callLog;
}

function saveCallLog(): void {
  try {
    storage()?.setItem(CALL_LOG_STORAGE_KEY, JSON.stringify(callLog.contents));
  } catch {
    // Хранилище недоступно: журнал живёт до перезапуска
  }
}

export function callLogEntry(call: JackdawCall): CallLogEntry {
  let started = call.started ?? null;
  let ended = call.ended ?? new Date();
  return {
    id: call.callID,
    email: call.remoteEmail,
    name: call.participants.first?.name || call.remoteEmail,
    outgoing: call.outgoing,
    video: call.hasVideo,
    at: (started ?? ended).getTime(),
    duration: started ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000)) : null,
    endReason: call.endReason,
    missed: call.missed,
  };
}

export function recordCallInLog(call: JackdawCall): void {
  if (!call.remoteEmail) {
    return;
  }
  loadCallLog();
  let entry = callLogEntry(call);
  let existing = callLog.find(e => e.id == entry.id);
  if (existing) {
    callLog.remove(existing);
  }
  let next = [entry, ...callLog.contents].slice(0, CALL_LOG_LIMIT);
  callLog.replaceAll(next);
  saveCallLog();
}

export function removeCallLogEntry(entry: CallLogEntry): void {
  loadCallLog();
  callLog.remove(entry);
  saveCallLog();
}

export function clearCallLog(): void {
  loadCallLog();
  callLog.clear();
  saveCallLog();
}

/** Строка журнала: «Исходящий звонок · 3:12», «Пропущенный звонок» и т. п. */
export function callLogSummary(entry: CallLogEntry): string {
  let started = entry.duration == null ? null : new Date(entry.at);
  let ended = entry.duration == null ? new Date(entry.at) : new Date(entry.at + entry.duration * 1000);
  return callSummary({ outgoing: entry.outgoing, started, ended, endReason: entry.endReason, missed: entry.missed });
}
