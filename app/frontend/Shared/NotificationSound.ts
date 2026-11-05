import { getLocalStorage } from "../Util/LocalStorage";

export type NotificationSoundEvent =
  | "mail-incoming"
  | "mail-outgoing"
  | "calendar"
  | "chat"
  | "sla-overdue"
  | "sla-taken-in-work"
  | "other";

export type NotificationSoundId =
  | "none"
  | "default"
  | "chime"
  | "pop"
  | "bell"
  | "alarm";

export type NotificationSoundSelection = NotificationSoundId | {
  id: "custom";
  dataURL: string;
  name?: string;
};

export const notificationSoundEvents: NotificationSoundEvent[] = [
  "mail-incoming",
  "mail-outgoing",
  "calendar",
  "chat",
  "sla-overdue",
  "sla-taken-in-work",
  "other",
];

export const notificationSoundOptions: NotificationSoundId[] = [
  "none",
  "default",
  "chime",
  "pop",
  "bell",
  "alarm",
];

type NotificationSoundSettings = Partial<Record<NotificationSoundEvent, NotificationSoundId>>;

const defaultNotificationSoundSettings: Record<NotificationSoundEvent, NotificationSoundId> = {
  "mail-incoming": "default",
  "mail-outgoing": "pop",
  calendar: "bell",
  chat: "chime",
  "sla-overdue": "alarm",
  "sla-taken-in-work": "chime",
  other: "none",
};

/** Громкость звуков уведомлений, 0…1 */
export const notificationVolumeSetting = getLocalStorage("notifications.volume", 1);

export function notificationVolume(): number {
  let value = Number(notificationVolumeSetting.value);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

export const notificationSoundSetting = getLocalStorage<NotificationSoundSettings>(
  "notifications.sounds",
  defaultNotificationSoundSettings,
);

export function getNotificationSound(event: NotificationSoundEvent): NotificationSoundId {
  if (!canUseLocalStorage()) {
    return defaultNotificationSoundSettings[event];
  }
  try {
    let value = notificationSoundSetting.value?.[event];
    return isNotificationSoundId(value) ? value : defaultNotificationSoundSettings[event];
  } catch (_ex) {
    return defaultNotificationSoundSettings[event];
  }
}

export function setNotificationSound(event: NotificationSoundEvent, sound: NotificationSoundId): void {
  let current = notificationSoundSetting.value;
  if (!current || typeof current != "object") {
    current = {};
  }
  notificationSoundSetting.value = { ...current, [event]: sound };
}

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return typeof value == "string" && notificationSoundOptions.includes(value as NotificationSoundId);
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage != "undefined" && !!localStorage;
  } catch (_ex) {
    return false;
  }
}

type Tone = {
  frequency: number;
  duration: number;
  delay?: number;
  type?: OscillatorType;
};

const soundTones: Record<Exclude<NotificationSoundId, "none" | "default">, Tone[]> = {
  chime: [
    { frequency: 659.25, duration: 0.12 },
    { frequency: 783.99, duration: 0.2, delay: 0.08 },
  ],
  pop: [
    { frequency: 392, duration: 0.08, type: "triangle" },
    { frequency: 523.25, duration: 0.1, delay: 0.06, type: "triangle" },
  ],
  bell: [
    { frequency: 523.25, duration: 0.32 },
    { frequency: 783.99, duration: 0.42, delay: 0.02 },
  ],
  alarm: [
    { frequency: 880, duration: 0.16 },
    { frequency: 660, duration: 0.16, delay: 0.08 },
    { frequency: 880, duration: 0.16, delay: 0.08 },
    { frequency: 660, duration: 0.28, delay: 0.08 },
  ],
};

let audioContext: AudioContext | null = null;
let lastSoundAt = 0;
const activeAudio = new Set<HTMLAudioElement>();

/** Plays the configured sound. Preview calls bypass the notification throttle. */
export async function playNotificationSound(
  event: NotificationSoundEvent,
  options: { preview?: boolean; sound?: NotificationSoundSelection } = {},
): Promise<void> {
  let sound = options.sound ?? getNotificationSound(event);
  let volume = notificationVolume();
  if (sound == "none" || volume <= 0) {
    return;
  }
  const now = Date.now();
  if (!options.preview && now - lastSoundAt < 2000) {
    return;
  }

  if (typeof sound != "string") {
    if (!sound.dataURL.startsWith("data:audio/")) {
      return;
    }
    await playAudioSource(sound.dataURL, now, volume);
    return;
  }

  if (sound == "default") {
    await playAudioSource("sound/new-message.mp3", now, volume);
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }
  try {
    if (context.state == "suspended") {
      await context.resume();
    }
    playTones(context, soundTones[sound], context.currentTime + 0.01, volume);
    lastSoundAt = now;
  } catch (_ex) {
    // A locked audio context must not turn a successful mail/calendar event into an error.
  }
}

async function playAudioSource(source: string, now: number, volume = 1): Promise<void> {
  if (typeof Audio == "undefined") {
    return;
  }
  let audio = new Audio(source);
  if (volume < 1) {
    // При 100 % громкость не трогаем: остаётся системная по умолчанию
    audio.volume = volume;
  }
  activeAudio.add(audio);
  audio.addEventListener("ended", () => activeAudio.delete(audio), { once: true });
  lastSoundAt = now;
  try {
    await audio.play();
  } catch (_ex) {
    activeAudio.delete(audio);
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) {
    return audioContext;
  }
  const audioContextConstructor = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioContextConstructor) {
    return null;
  }
  audioContext = new audioContextConstructor();
  return audioContext;
}

function playTones(context: AudioContext, tones: Tone[], startAt: number, volume = 1): void {
  let elapsed = 0;
  for (let tone of tones) {
    let start = startAt + elapsed + (tone.delay ?? 0);
    let end = start + tone.duration;
    let oscillator = context.createOscillator();
    let gain = context.createGain();
    oscillator.type = tone.type ?? "sine";
    oscillator.frequency.setValueAtTime(tone.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.16 * volume), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    elapsed = Math.max(elapsed, (tone.delay ?? 0) + tone.duration);
  }
}
