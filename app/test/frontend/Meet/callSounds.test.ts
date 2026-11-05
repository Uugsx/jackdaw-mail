// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { callRingtone, callRingtoneSetting, callVolume, callVolumeSetting, playIncomingRingtone, playRingback, routeToLoudspeaker } from "../../../frontend/Meet/callSounds";
import { selectedLoudspeakerSetting } from "../../../frontend/Meet/Setup/selectedDevices";

class FakeAudio {
  static created: FakeAudio[] = [];
  loop = false;
  volume = 1;
  played = false;
  paused = false;
  sinkId = "";
  constructor(public src: string) {
    FakeAudio.created.push(this);
  }
  async setSinkId(id: string) {
    this.sinkId = id;
  }
  async play() {
    this.played = true;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
}

const storedValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
    clear: () => storedValues.clear(),
  },
});

beforeEach(() => {
  localStorage.clear();
  FakeAudio.created = [];
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("мелодия по умолчанию — прежняя, громкость 80 %, мусор в настройках не ломает звонок", () => {
  expect(callRingtone()).toBe("classic");
  expect(callVolume()).toBe(0.8);
  callRingtoneSetting.value = "weird" as any;
  callVolumeSetting.value = 7;
  expect(callRingtone()).toBe("classic");
  expect(callVolume()).toBe(1);
});

test("входящий: мелодия по кругу с громкостью и в выбранный динамик", async () => {
  callVolumeSetting.value = 0.5;
  selectedLoudspeakerSetting.value = "speaker-2";
  let sound = playIncomingRingtone();
  await vi.waitFor(() => expect(FakeAudio.created[0]?.played).toBe(true));
  let audio = FakeAudio.created[0];
  expect(audio.loop).toBe(true);
  expect(audio.volume).toBe(0.5);
  expect(audio.sinkId).toBe("speaker-2");
  sound.stop();
  expect(audio.paused).toBe(true);
});

test("без звука и нулевая громкость ничего не играют", () => {
  callRingtoneSetting.value = "none";
  playIncomingRingtone().stop();
  callRingtoneSetting.value = "classic";
  callVolumeSetting.value = 0;
  playIncomingRingtone().stop();
  playRingback().stop();
  expect(FakeAudio.created).toHaveLength(0);
});

test("недоступный динамик не мешает звуку", async () => {
  selectedLoudspeakerSetting.value = "gone";
  await expect(routeToLoudspeaker({ setSinkId: async () => { throw new Error("NotFoundError"); } })).resolves.toBeUndefined();
  await expect(routeToLoudspeaker(null)).resolves.toBeUndefined();
});
