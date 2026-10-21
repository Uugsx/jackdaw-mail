import { afterEach, describe, expect, it, vi } from "vitest";

type Status = { phase?: string; version?: string | null; readyToInstall?: boolean; progress?: number };
const { listeners, status } = vi.hoisted(() => {
  let listeners: ((status: any) => void)[] = [];
  let status = {
    phase: "idle",
    subscribe(fn: (status: any) => void) {
      listeners.push(fn);
      return () => {
        listeners.splice(listeners.indexOf(fn), 1);
      };
    },
  };
  return { listeners, status };
});

vi.mock("../../../logic/app", () => ({ appGlobal: { remoteApp: { updateStatus: status } } }));
vi.mock("../../../logic/build", () => ({ webMail: false }));
vi.mock("../../../frontend/Settings/About/updateNavigation", () => ({ openAboutForUpdate: vi.fn() }));
vi.mock("../../../frontend/Settings/About/updateMessages", () => ({
  updateAvailableMessage: (v: string) => `available ${v}`,
  updateDownloadingMessage: (v: string, p: number) => `downloading ${v} ${p}`,
  updateReadyMessage: (v: string) => `ready ${v}`,
  updateInstallButtonLabel: () => "Install",
  updateInstalledSuccessMessage: (v: string) => `installed ${v}`,
}));

import { notifications } from "../../../frontend/MainWindow/Notification";
import { startUpdateNotificationWatcher, stopUpdateNotificationWatcher } from "../../../frontend/MainWindow/UpdateNotification";

function emit(next: Status) {
  for (let listener of listeners) {
    listener(next);
  }
}

describe("баннер обновления следует за фазой", () => {
  afterEach(() => {
    stopUpdateNotificationWatcher();
    notifications.clear();
  });

  it("«доступно» → «скачивается» → «готово» в одном и том же уведомлении", () => {
    startUpdateNotificationWatcher();
    emit({ phase: "available", version: "1.2" });
    expect(notifications.contents.map(n => n.message)).toEqual(["available 1.2"]);

    emit({ phase: "downloading", version: "1.2", progress: 40 });
    expect(notifications.contents.map(n => n.message)).toEqual(["downloading 1.2 40"]);

    emit({ phase: "downloaded", version: "1.2", readyToInstall: true });
    expect(notifications.contents.map(n => n.message)).toEqual(["ready 1.2"]);
  });

  it("закрытое пользователем уведомление о той же версии не возвращается", () => {
    startUpdateNotificationWatcher();
    emit({ phase: "available", version: "1.3" });
    notifications.clear();
    emit({ phase: "downloading", version: "1.3", progress: 10 });
    expect(notifications.isEmpty).toBe(true);
  });

  it("новая версия заменяет уведомление о прошлой", () => {
    startUpdateNotificationWatcher();
    emit({ phase: "available", version: "1.4" });
    emit({ phase: "available", version: "1.5" });
    expect(notifications.contents.map(n => n.message)).toEqual(["available 1.5"]);
  });
});
