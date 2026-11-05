import { afterEach, expect, test, vi } from "vitest";
import { LocalMediaDeviceStreams } from "../../../logic/Meet/LocalMediaDeviceStreams";

function notFound(): Error {
  let ex = new Error("Requested device not found");
  ex.name = "NotFoundError";
  return ex;
}

function stream(video: boolean): MediaStream {
  return {
    getVideoTracks: () => video ? [{ getSettings: () => ({ deviceId: "cam" }) }] : [],
    getAudioTracks: () => [{ getSettings: () => ({ deviceId: "mic" }), enabled: true }],
  } as any;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("без камеры звонок продолжается только со звуком", async () => {
  let getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    if (constraints.video) {
      throw notFound();
    }
    return stream(false);
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
  let streams = new LocalMediaDeviceStreams();
  await (streams as any).startCameraMicStream(true, true, "", "");
  expect(getUserMedia.mock.calls.at(-1)![0].video).toBe(false);
  expect((streams as any)._cameraOn).toBe(false);
});

test("без микрофона — понятное сообщение вместо «Requested device not found»", async () => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => { throw notFound(); }, enumerateDevices: async () => [] } });
  let streams = new LocalMediaDeviceStreams();
  await expect((streams as any).startCameraMicStream(false, true, "", ""))
    .rejects.toThrow(/microphone/i);
});
