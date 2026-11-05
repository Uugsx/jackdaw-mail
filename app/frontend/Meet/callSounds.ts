import { getLocalStorage } from "../Util/LocalStorage";
import { selectedLoudspeakerSetting } from "./Setup/selectedDevices";
import { gt } from "../../l10n/l10n";

/** Мелодия входящего звонка. `classic` — прежний файл, `soft` — тихий синтезированный перезвон */
export type CallRingtone = "classic" | "soft" | "none";
export const callRingtones: readonly CallRingtone[] = ["classic", "soft", "none"];

export const callRingtoneSetting = getLocalStorage<CallRingtone>("calls.ringtone", "classic");
/** Громкость мелодии и гудков звонка, 0…1 */
export const callVolumeSetting = getLocalStorage("calls.volume", 0.8);

export function callRingtoneLabel(ringtone: CallRingtone): string {
  switch (ringtone) {
    case "soft":
      return gt`Soft chime`;
    case "none":
      return gt`Silent`;
    default:
      return gt`Classic`;
  }
}

export function callRingtone(): CallRingtone {
  let value = callRingtoneSetting.value;
  return callRingtones.includes(value) ? value : "classic";
}

export function callVolume(): number {
  let value = Number(callVolumeSetting.value);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
}

type SinkTarget = { setSinkId?: (id: string) => Promise<void> };

/** Направляет звук в динамик, выбранный в настройках встреч. Без поддержки или устройства — динамик по умолчанию. */
export async function routeToLoudspeaker(target: SinkTarget | null | undefined): Promise<void> {
  let deviceID = selectedLoudspeakerSetting.value;
  if (!target?.setSinkId || !deviceID) {
    return;
  }
  try {
    await target.setSinkId(deviceID);
  } catch {
    // Динамик отключили: остаётся устройство по умолчанию
  }
}

/** Играющий звук звонка; `stop()` безопасно вызывать повторно */
export interface CallSoundHandle {
  stop(): void;
}

const kClassicRingtone = "sound/ringtone1.mp3";
/** Гудок вызова: 425 Гц, 1 с звучит, 4 с пауза (как в телефонной сети) */
const kRingbackHz = 425;
const kRingbackOnSeconds = 1;
const kRingbackPeriodSeconds = 5;
/** Тихий перезвон входящего: две ноты раз в 3 с */
const kSoftNotes = [784, 1047];
const kSoftPeriodSeconds = 3;
/** Пиковая громкость синтезированных тонов при громкости 100 % */
const kToneGain = 0.25;

/** Входящий звонок: выбранная мелодия по кругу */
export function playIncomingRingtone(): CallSoundHandle {
  let ringtone = callRingtone();
  let volume = callVolume();
  if (ringtone == "none" || volume <= 0) {
    return { stop() {} };
  }
  if (ringtone == "soft") {
    return playToneLoop(kSoftPeriodSeconds, volume, (context, gain, at) => {
      kSoftNotes.forEach((frequency, index) => scheduleTone(context, gain, frequency, at + index * 0.22, 0.35));
    });
  }
  if (typeof Audio == "undefined") {
    return { stop() {} };
  }
  let audio = new Audio(kClassicRingtone);
  audio.loop = true;
  audio.volume = volume;
  void routeToLoudspeaker(audio as SinkTarget).then(() => audio.play()).catch(() => {});
  return {
    stop() {
      audio.pause();
      audio.removeAttribute("src");
    },
  };
}

/** Исходящий звонок: гудки, пока собеседник не ответит */
export function playRingback(): CallSoundHandle {
  let volume = callVolume();
  if (volume <= 0) {
    return { stop() {} };
  }
  return playToneLoop(kRingbackPeriodSeconds, volume, (context, gain, at) => {
    scheduleTone(context, gain, kRingbackHz, at, kRingbackOnSeconds);
  });
}

function playToneLoop(periodSeconds: number, volume: number,
    schedule: (context: AudioContext, gain: GainNode, at: number) => void): CallSoundHandle {
  const AudioContextClass = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return { stop() {} };
  }
  let context = new AudioContextClass();
  let master = context.createGain();
  master.gain.value = volume * kToneGain;
  master.connect(context.destination);
  void routeToLoudspeaker(context as unknown as SinkTarget);
  let next = context.currentTime + 0.05;
  let stopped = false;
  // Планируем на пару периодов вперёд: таймер в фоновом окне может запаздывать
  let tick = () => {
    while (!stopped && next < context.currentTime + periodSeconds * 2) {
      schedule(context, master, next);
      next += periodSeconds;
    }
  };
  tick();
  let timer = setInterval(tick, periodSeconds * 500);
  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      void context.close().catch(() => {});
    },
  };
}

function scheduleTone(context: AudioContext, output: AudioNode, frequency: number, at: number, duration: number): void {
  let oscillator = context.createOscillator();
  let envelope = context.createGain();
  oscillator.frequency.setValueAtTime(frequency, at);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(1, at + 0.02);
  envelope.gain.setValueAtTime(1, at + Math.max(0.02, duration - 0.05));
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(envelope);
  envelope.connect(output);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}
