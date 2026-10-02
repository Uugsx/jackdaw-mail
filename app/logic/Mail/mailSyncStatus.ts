import { writable } from "svelte/store";

/** Показывает, что хотя бы одна почтовая синхронизация выполняется сейчас. */
export const mailSyncing = writable(false);

let activeSyncCount = 0;

/** Выполняет операцию и безопасно удерживает глобальный индикатор до её завершения. */
export function trackMailSync<T>(operation: () => Promise<T>): Promise<T> {
  activeSyncCount++;
  mailSyncing.set(true);

  let released = false;
  let release = () => {
    if (released) {
      return;
    }
    released = true;
    activeSyncCount = Math.max(0, activeSyncCount - 1);
    if (activeSyncCount == 0) {
      mailSyncing.set(false);
    }
  };

  try {
    return operation().finally(release);
  } catch (ex) {
    release();
    throw ex;
  }
}
