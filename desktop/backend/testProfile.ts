/**
 * Профиль автопроверок интерфейса: `JACKDAW_TEST_PROFILE=<каталог>`.
 *
 * Копия приложения с этим профилем работает рядом с обычной и ничего у пользователя не трогает:
 * - базы, настройки и файлы — только внутри каталога профиля;
 * - окна не показываются и не забирают фокус и клики (прозрачные, без значка в Dock);
 * - звук выключен, системных уведомлений нет;
 * - камера и микрофон поддельные (тестовая картинка и тон), без запроса доступа;
 * - обновления не проверяются и не скачиваются;
 * - backend слушает свой порт (`JACKDAW_TEST_JPC_PORT`), а не порт основного приложения;
 * - ссылки не открываются в браузере, системные диалоги не появляются (ответ — отмена).
 * Управляется через протокол отладки Chromium (`--remote-debugging-port`), см. scripts/ui-test/.
 */
import { app, BrowserWindow, dialog, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

const kTestProfileEnv = "JACKDAW_TEST_PROFILE";

declare const __JACKDAW_RELEASE_BUILD__: boolean | undefined;

/** Выпуск, собранный в CI. В нём профиль автопроверок и порт отладки не работают:
 * иначе любой процесс пользователя запустил бы копию с протоколом отладки
 * и через неё расшифровал бы пароли почты (ключ в Keychain выдаётся приложению). */
export const isReleaseBuild: boolean =
  typeof __JACKDAW_RELEASE_BUILD__ != "undefined" && !!__JACKDAW_RELEASE_BUILD__;

export const testProfileDir: string | null = !isReleaseBuild && process.env[kTestProfileEnv]
  ? path.resolve(process.env[kTestProfileEnv])
  : null;

const kDebugSwitches = ["remote-debugging-port", "remote-debugging-pipe", "inspect", "inspect-brk", "inspect-port"];

/** В выпуске не запускаемся с ключами удалённой отладки */
export function refuseDebugSwitchesInRelease(): void {
  if (!isReleaseBuild) {
    return;
  }
  let found = kDebugSwitches.filter(name => app.commandLine.hasSwitch(name));
  if (found.length) {
    console.error("Debug switches are not allowed in release builds:", found.join(", "));
    app.exit(1);
  }
}

export function isTestProfile(): boolean {
  return !!testProfileDir;
}

if (testProfileDir) {
  // Окно «Ошибка в главном процессе» появилось бы поверх работы пользователя: пишем в журнал и выходим.
  process.on("uncaughtException", ex => {
    console.error("Test profile: uncaught exception:", ex);
    app.exit(1);
  });
}

/** До готовности приложения: пути профиля и поддельные устройства */
export function applyTestProfile(): void {
  refuseDebugSwitchesInRelease();
  if (!testProfileDir) {
    return;
  }
  try {
    fs.mkdirSync(testProfileDir, { recursive: true });
    app.setPath("appData", testProfileDir);
    app.setPath("userData", path.join(testProfileDir, "userData"));
    app.commandLine.appendSwitch("use-fake-device-for-media-stream");
    app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
    // Порт отладки для jd.mjs, если копию запускает не он (например, `electron-vite dev`)
    let debugPort = Number(process.env["JACKDAW_TEST_DEBUG_PORT"]);
    if (Number.isInteger(debugPort) && debugPort > 1024 && debugPort < 65536) {
      app.commandLine.appendSwitch("remote-debugging-port", String(debugPort));
      app.commandLine.appendSwitch("remote-allow-origins", "*");
    }
  } catch (ex) {
    // Без своего профиля копия открыла бы данные пользователя: выходим молча, без окна ошибки.
    console.error("Test profile failed:", ex);
    app.exit(1);
  }
}

/** Свой порт связи окна с backend: обычный (5455) занят приложением пользователя.
 * Окно получает его из адреса страницы (`jpcPort=`), подключение по-прежнему только с секретом. */
export function testJPCPort(): number | null {
  let port = Number(process.env["JACKDAW_TEST_JPC_PORT"]);
  return testProfileDir && Number.isInteger(port) && port > 1024 && port < 65536 ? port : null;
}

/** Каталог файлов (вложения, общий доступ) внутри профиля */
export function testFilesDir(): string | null {
  return testProfileDir ? path.join(testProfileDir, "files") : null;
}

/** После готовности приложения: невидимые окна без фокуса и звука, без уведомлений */
export function installTestProfileGuards(): void {
  if (!testProfileDir) {
    return;
  }
  app.dock?.hide();
  app.focus = () => undefined;
  // Окно рисуется, как обычное, но пользователь его не видит, и оно пропускает клики насквозь.
  BrowserWindow.prototype.show = function (this: BrowserWindow) {
    this.setOpacity(0);
    this.setIgnoreMouseEvents(true);
    this.setSkipTaskbar(true);
    this.showInactive();
  };
  BrowserWindow.prototype.focus = () => undefined;
  BrowserWindow.prototype.moveTop = () => undefined;
  BrowserWindow.prototype.flashFrame = () => undefined;
  app.on("browser-window-created", (_event, window) => {
    window.webContents.setAudioMuted(true);
    window.webContents.setBackgroundThrottling(false);
    // Демо-режим окно не показывает, а скрытое окно может не рисоваться: показываем невидимым.
    window.once("ready-to-show", () => window.show());
  });
  shell.openExternal = async () => undefined;
  // Диалог поверх экрана прервал бы работу пользователя: отвечаем «Отмена» и пишем в журнал.
  let cancelResponse = (options: Electron.MessageBoxOptions) => {
    console.warn("Test profile: dialog skipped:", options?.message, options?.buttons?.join(" | ") ?? "");
    return options?.cancelId ?? 0;
  };
  dialog.showMessageBox = (async (...args: any[]) =>
    ({ response: cancelResponse(args.at(-1)), checkboxChecked: false })) as typeof dialog.showMessageBox;
  dialog.showMessageBoxSync = ((...args: any[]) => cancelResponse(args.at(-1))) as typeof dialog.showMessageBoxSync;
  dialog.showErrorBox = (title: string) => console.warn("Test profile: error box skipped:", title);
  dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
  dialog.showSaveDialog = (async () => ({ canceled: true, filePath: "" })) as typeof dialog.showSaveDialog;
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission != "notifications");
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission != "notifications"));
}
