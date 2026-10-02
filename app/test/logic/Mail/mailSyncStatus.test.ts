import { get } from "svelte/store";
import { afterEach, expect, test } from "vitest";
import { mailSyncing, trackMailSync } from "../../../logic/Mail/mailSyncStatus";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  let promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  expect(get(mailSyncing)).toBe(false);
});

test("удерживает общий индикатор, пока выполняется хотя бы одна синхронизация", async () => {
  let first = deferred<void>();
  let second = deferred<void>();
  let firstRun = trackMailSync(() => first.promise);
  let secondRun = trackMailSync(() => second.promise);

  expect(get(mailSyncing)).toBe(true);
  first.resolve(undefined);
  await firstRun;
  expect(get(mailSyncing)).toBe(true);

  second.resolve(undefined);
  await secondRun;
  expect(get(mailSyncing)).toBe(false);
});

test("сбрасывает индикатор после ошибки синхронизации", async () => {
  let error = new Error("sync failed");

  await expect(
    trackMailSync(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(get(mailSyncing)).toBe(false);
});
