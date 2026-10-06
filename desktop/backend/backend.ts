import { HTTPServer } from './HTTPServer';
import { HTTPConnection, type HTTPConnectionOptions } from './HTTPConnection';
import { NetSession } from './NetSession';
import JPCWebSocket from '../../lib/jpc-ws';
import * as OWA from './owa';
import { appName, production } from '../../app/logic/build';
import { WebContents } from './WebContents';
import { Observable, notifyChangedProperty } from '../../lib/util/Observable';
import { ImapFlow } from 'imapflow';
import { Database } from "@radically-straightforward/sqlite"; // formerly @leafac/sqlite
import Zip from "adm-zip";
import ky from 'ky';
import { shell, nativeTheme, Notification, Tray, nativeImage, app, BrowserWindow, webContents, Menu, MenuItemConstructorOptions, clipboard, NativeImage, session, desktopCapturer, type DesktopCapturerSource, systemPreferences, powerMonitor } from "electron";
import electronUpdater, { type UpdateCheckResult } from 'electron-updater';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { DAVClient } from "tsdav";
import { createClient as createWebDAVFileClient } from "webdav";
import { createType1Message, decodeType2Message, createType3Message } from "./ntlm";
import net from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import zlib from "node:zlib";
import path from "node:path";
import tls from "node:tls";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import https from "node:https";
import { RunOnce } from '../../app/logic/util/flow/RunOnce';
const { autoUpdater } = electronUpdater;

const kMaxMailImageBytes = 25 * 1024 * 1024;

const kGhOwner = "Uugsx";
const kGhRepo = "jackdaw-mail";

/**
 * Electron derives `userData` from the visible application name by default.
 * Keep existing Chromium data (localStorage, preferences and cookies) working
 * after the Jackdaw → Jackdaw Mail rename when the legacy profile exists.
 * The custom application databases already use this stable directory below;
 * this check covers the separate Electron profile used by the renderer.
 */
const kLegacyUserDataDirName = "Jackdaw";
const kChromiumUserDataMarkers = [
  "Local Storage",
  "Session Storage",
  "Preferences",
  "Cookies",
  "Network",
  "IndexedDB",
];

function hasChromiumUserData(dir: string): boolean {
  return kChromiumUserDataMarkers.some(marker => fs.existsSync(path.join(dir, marker)));
}

function preserveLegacyUserData(): void {
  let defaultUserDataDir = app.getPath("userData");
  let legacyUserDataDir = path.join(app.getPath("appData"), kLegacyUserDataDirName);
  if (path.resolve(defaultUserDataDir) == path.resolve(legacyUserDataDir) ||
      !hasChromiumUserData(legacyUserDataDir)) {
    return;
  }
  app.setPath("userData", legacyUserDataDir);
}

preserveLegacyUserData();

let jpc: JPCWebSocket | null = null;
let backendStartup: Promise<void> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAddrInUse(ex: unknown): boolean {
  return typeof ex === "object" && ex !== null && (ex as NodeJS.ErrnoException).code === "EADDRINUSE";
}

async function listenForJPC(appGlobal: Awaited<ReturnType<typeof createSharedAppObject>>, jpcSecret: string, port: number) {
  const kMaxAttempts = 15;
  for (let attempt = 0; attempt < kMaxAttempts; attempt++) {
    let jpcInstance = new JPCWebSocket(appGlobal);
    try {
      await jpcInstance.listen(jpcSecret, port, false);
      return jpcInstance;
    } catch (ex) {
      await jpcInstance.stopListening().catch(() => {});
      if (!isAddrInUse(ex) || attempt >= kMaxAttempts - 1) {
        throw ex;
      }
      await delay(400 * (attempt + 1));
    }
  }
  throw new Error("JPC backend failed to bind port");
}

export async function startupBackend(jpcSecret: string) {
  if (jpc) {
    return;
  }
  if (backendStartup) {
    return backendStartup;
  }
  backendStartup = (async () => {
    let appGlobal = await createSharedAppObject();
    jpc = await listenForJPC(appGlobal, jpcSecret, production ? 5455 : 5453);
  })().finally(() => {
    backendStartup = null;
  });
  return backendStartup;
}

export async function shutdownBackend() {
  await OWA.stopAllNotificationStreams();
  await jpc?.stopListening();
  jpc = null;
}

/** Returns a passcode with at least 32 chars. Only alpha-num-dash. */
export function createJPCSecret(): string {
  if (!production) {
    // For tests, get it from env var. developer has to set it.
    const env = process.env.JPC_SECRET;
    if (env && env.length >= 32) {
      return env;
    }
  }
  return crypto.randomBytes(32).toString("hex"); // 256-bit hex secret
}

function getAppVersion(): string {
  return app.getVersion();
}

async function createSharedAppObject() {
  return {
    kyCreate,
    OWA,
    newOSNotification,
    isOSNotificationSupported,
    setTrayIcon,
    setStatusBarIcon,
    clearStatusBarIcon,
    setBadgeCount,
    minimizeMainWindow,
    unminimizeMainWindow,
    focusMainWindow,
    restoreMainWindow,
    maximizeMainWindow,
    addEventListenerWebContents,
    containWebContentsNavigation,
    getWebContents,
    writeTextToClipboard,
    openExternalURL,
    openWidgetSignIn,
    openWidgetPopout,
    focusWidgetPopout,
    closeWidgetPopout,
    widgetSessionHasCookies,
    openFileInNativeApp,
    showFileInFolder,
    startupArgs,
    computerOn,
    isDefaultApp,
    setAsDefaultApp,
    askForMediaAccess,
    onScreenSharingSelect,
    restartApp,
    getAppVersion,
    fetchMailImage,
    prepareUpdaterAuth,
    checkForUpdate,
    downloadUpdate,
    installUpdate,
    openPendingReleaseDownload,
    isQuittingForUpdate,
    getUpdateStatus,
    updateStatus: updateState,
    setTheme,
    openMenu,
    getConfigDir,
    getFilesDir,
    // openFileInExternalApp,
    createIMAPFlowConnection,
    getSQLiteDatabase,
    sendMailNodemailer,
    verifyServerNodemailer,
    getMIMENodemailer,
    createWebDAVClient,
    createTSDAVClient,
    createType1Message,
    createType3MessageFromType2Message,
    newAdmZIP,
    newHTTPServer,
    newHTTPConnection,
    newNetSession,
    newTCPSocket,
    newWebSocket,
    gunzip,
    getCACertificates,
    readFile,
    writeFile,
    deleteFile,
    statFile,
    getIconForLocalFile,
    getIconForFileType,
    getThumbnailForLocalFile,
    listDirectoryContents,
    fs: fsPromises,
    directory,
    platform,
    path: {
      dirname: path.dirname,
      join: path.join,
    },
  };
}

/** Fetch an email image after an explicit user action, bypassing renderer CORS. */
async function fetchMailImage(
  url: string,
  webContentsID?: number,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let parsedURL: URL;
  try {
    parsedURL = new URL(url);
  } catch {
    return null;
  }
  if (parsedURL.protocol != "http:" && parsedURL.protocol != "https:") {
    return null;
  }
  let sourceSession = webContentsID == null
    ? session.defaultSession
    : webContents.fromId(webContentsID)?.session;
  if (!sourceSession) {
    return null;
  }
  let response = await sourceSession.fetch(parsedURL.toString(), { redirect: "follow" });
  if (!response.ok) {
    return null;
  }
  let contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > kMaxMailImageBytes) {
    return null;
  }
  let buffer = await response.arrayBuffer();
  if (buffer.byteLength > kMaxMailImageBytes) {
    return null;
  }
  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get("content-type") ?? "",
  };
}

function createType3MessageFromType2Message(WWWAuthenticate, username, password) {
  return createType3Message(decodeType2Message(WWWAuthenticate), username, password);
}

async function readFile(path: string): Promise<ArrayBufferLike> {
  let fileHandle = await fsPromises.open(path, "r");
  let { buffer } = await fileHandle.readFile();
  await fileHandle.close();
  return buffer;
}
async function writeFile(path: string, permissions: number, contents: Uint8Array): Promise<void> {
  await fsPromises.rm(path, { force: true });
  let fileHandle = await fsPromises.open(path, "w", permissions);
  await fileHandle.write(contents);
  await fileHandle.close();
}
async function deleteFile(path: string): Promise<void> {
  await fsPromises.unlink(path);
}
/** @returns (only) `size` and `lastMod` of the given file */
async function statFile(path: string): Promise<FileStat> {
  let s = await fsPromises.stat(path);
  let stat = {} as FileStat;
  stat.size = s.size;
  stat.lastMod = s.mtime;
  return stat;
}
/**
 * E.g. ```
 * let contents = new Blob(["test\n"], { type: "text/plain" });
 * let configDir = await appGlobal.remoteApp.configDir();
 * let testFile = await appGlobal.remoteApp.openFile(configDir + "test.txt", true);
 * await testFile.write(new Uint8Array(await contents.arrayBuffer()));
 * await appGlobal.remoteApp.closeFile(testFile);
 * ```
 * /
async function openFile(path: string, write: boolean, mode?: string | number): Promise<FileHandle> {
  return await fsPromises.open(path, write ? "w" : "r", mode);
}
async function closeFile(handle: FileHandle): Promise<void> {
  await handle.close(); // for some reason, only this function doesn't appear on FileHandle in JPC client
}*/
/*
async function openFileInExternalApp(filepath: string, appEXE: string): Promise<void> {
  let launcher = appEXE ??
    os.platform() == "win32" ? "explorer.exe" :
    os.platform() == "darwin" ? "open" :
    "xdg-open";
  //console.log("Launching", launcher, filepath);
  childProcess.spawn(launcher, [ filepath ], { shell: false });
}
*/

/**
 * @param defaultOptions
 * @return Object with get(url, options), post(), put() etc. functions
 *   Either options or defaultOptions contain
 *   `result = "text"` or "json", "formData", "blob", "arrayBuffer",
 *   then directly calls `text()`, so that you can do fetch in one step with a single `await`.
 *
 * E.g.
 * ```js
 * let ky = await remoteApp.kyCreate({ prefixUrl: "https://api.example.com", result: "json" });
 * let json = await ky.get("users/");
 * ```
 * or (identical)
 * ```js
 * let ky = await remoteApp.kyCreate();
 * let json = await ky.get(https://api.example.com/users", { result: "json" });
 * ```
 */
function kyCreate(defaultOptions) {
  /* `ky` (like axios) is both a function and acts like an object with functions get(), post() etc. as properties,
   * which confuses jpc, so make it only an object. */
  let kyObj = {};
  let kyFunc = ky.create(defaultOptions);
  for (let name in kyFunc) {
    kyObj[name] = async (input, options) => {
      // let resultKy = ky.post(input, options);
      let kyFetch = kyFunc[name](input, options);
      let resultType = options?.result || defaultOptions?.result;
      if (resultType &&
          ["text", "json", "formData", "blob", "arrayBuffer"].includes(resultType) &&
          ["get", "put", "post", "patch", "delete", "head"].includes(name)) {
        try {
          // console.log("Calling server", "input", input, "options", options, "defaults", defaultOptions);
          // let json = await resultKy.json();
          return await kyFetch[resultType]();
        } catch (ex) {
          throw new HTTPFetchError(ex);
        }
      } else {
        return kyFetch;
      }
    }
  }
  return kyObj;
}

export class HTTPFetchError extends Error {
  url: string;
  redirectedURL: string;
  code: string;
  httpCode: number;
  httpStatusText: string;
  httpMethod: string;
  hostname: string;

  constructor(ex: Error) {
    super(ex?.message ?? ex + "");
    this.name = ex?.name ?? this.name; // own property, so it survives the JPC JSON serialization
    let request = (ex as any).request;
    let response = (ex as any).response;
    let cause = (ex as any).cause
    if (request && response) {
      this.url = request.url;
      this.redirectedURL = response.url != request.url ? response.url : undefined;
      this.httpCode = response.status;
      this.httpStatusText = response.statusText;
      this.httpMethod = request.method;
      this.hostname = new URL(this.url).hostname;
      this.message = `HTTP ${this.httpMethod} <${this.url}>${this.redirectedURL ? ` redirected to <${this.redirectedURL}>` : ''} failed with ${this.httpCode} ${this.httpStatusText}`;
    } else if (cause) {
      this.code = cause.code;
      this.hostname = cause.hostname;
      if (cause.code == "ENOTFOUND") {
        this.message = `HTTP host ${cause.hostname} not found`;
      } else if (cause.code == "ECONNREFUSED") {
        this.message = `HTTP host ${cause.hostname} connection refused`;
      }
    }
  }
}

function newHTTPServer() {
  return new HTTPServer();
}

/** A HTTP(S) client that runs all requests over a single TCP connection,
 * for connection-based authentication like NTLM. @see `HTTPConnection` */
function newHTTPConnection(url: string, options?: HTTPConnectionOptions): HTTPConnection {
  return new HTTPConnection(url, options);
}

/** A HTTP client that uses Chromium's network stack, which performs
 * connection-based logins like NTLM natively. @see `NetSession` */
function newNetSession(url: string, partition: string, username: string, password: string): NetSession {
  return new NetSession(url, partition, username, password);
}

/** A new raw TCP socket, from the node net module.
 * You can attach `connect`/`error`/`data` listeners and `connect()` */
function newTCPSocket(): net.Socket {
  return new net.Socket();
}

/** A new `ws` WebSocket, for the Signal chat-service socket. The renderer's browser
 * WebSocket can't set the `Authorization` header (and Electron's webRequest doesn't
 * fire for WebSocket upgrades), and Node's default TLS doesn't trust Signal's private
 * root CA — both are solved here by forwarding `options.headers` and `options.ca`
 * (PEM) to `ws`. It connects on creation; attach `open`/`message`/`close`/`error`
 * listeners over JPC. */
function newWebSocket(url: string, options?: { headers?: Record<string, string>, ca?: string }): NodeWebSocket {
  return new NodeWebSocket(url, { headers: options?.headers, ca: options?.ca });
}

/** Decompresses a gzip (or zlib) buffer — used for the WhatsApp history-sync
 * blob, which the renderer's DecompressionStream handles unreliably. */
function gunzip(data: Uint8Array): Uint8Array {
  return zlib.unzipSync(Buffer.from(data));
}

function getCACertificates(type: string) {
  if (tls.getCACertificates) {
    return tls.getCACertificates(type);
  }
  // Fallback for old node.js
  return type == "bundled" ? tls.rootCertificates : [];
}

let trayIcon: Tray | null = null;
let statusBarIcon: Tray | null = null;

/** Shows our icon in the system tray, and replaces the icon that is
 * already there, if any.
 * <https://www.electronjs.org/docs/latest/api/tray> */
function setTrayIcon(imgDataURL: string, tooltip: string, onClick: () => void) {
  let image = nativeImage.createFromDataURL(imgDataURL);
  if (os.platform() == "darwin") { // macOS doesn't scale the icon down to its menu bar
    image = image.resize({ width: 16, height: 16 });
  }
  if (trayIcon) {
    trayIcon.setImage(image);
    trayIcon.removeAllListeners("click");
  } else {
    trayIcon = new Tray(image);
  }
  function remove() {
    trayIcon?.destroy();
    trayIcon = null;
  }
  trayIcon.setToolTip(tooltip);
  trayIcon.on("click", () => {
    remove();
    onClick?.();
  });
}

type StatusBarMenuAction = () => void | Promise<void>;

interface StatusBarMenuActions {
  newMessage?: StatusBarMenuAction;
  fetchMail?: StatusBarMenuAction;
  openSettings?: StatusBarMenuAction;
  disableWidget?: StatusBarMenuAction;
  unreadCount?: number;
}

function runStatusBarMenuAction(action: StatusBarMenuAction | undefined): void {
  if (!action) {
    return;
  }
  void Promise.resolve()
    .then(() => action())
    .catch(ex => console.error("Status bar menu action failed", ex));
}

/** Поддерживает постоянный значок приложения в системной строке меню. */
function setStatusBarIcon(
  imgDataURL: string,
  tooltip: string,
  onClick: () => void,
  menuActions: StatusBarMenuActions = {},
) {
  let image = nativeImage.createFromDataURL(imgDataURL);
  if (os.platform() == "darwin") { // macOS не масштабирует значок до высоты строки меню
    image = image.resize({ width: 16, height: 16 });
  }
  if (statusBarIcon) {
    statusBarIcon.setImage(image);
    statusBarIcon.removeAllListeners("click");
  } else {
    statusBarIcon = new Tray(image);
  }
  statusBarIcon.setToolTip(tooltip);
  statusBarIcon.on("click", () => onClick?.());
  let menuItems: MenuItemConstructorOptions[] = [
    {
      label: `Открыть ${appName}`,
      click: () => onClick?.(),
    },
  ];
  let hasAdditionalActions = menuActions.newMessage || menuActions.fetchMail ||
    menuActions.openSettings || menuActions.disableWidget || menuActions.unreadCount !== undefined;
  if (hasAdditionalActions) {
    menuItems.push(
      { type: "separator" },
      {
        label: "Новое письмо",
        enabled: !!menuActions.newMessage,
        click: () => runStatusBarMenuAction(menuActions.newMessage),
      },
      {
        label: "Проверить почту",
        enabled: !!menuActions.fetchMail,
        click: () => runStatusBarMenuAction(menuActions.fetchMail),
      },
      {
        label: `Непрочитанные: ${Math.max(0, Math.trunc(menuActions.unreadCount ?? 0))}`,
        enabled: (menuActions.unreadCount ?? 0) > 0,
        click: () => onClick?.(),
      },
      { type: "separator" },
      {
        label: "Настройки уведомлений",
        enabled: !!menuActions.openSettings,
        click: () => runStatusBarMenuAction(menuActions.openSettings),
      },
      {
        label: "Убрать виджет из строки меню",
        enabled: !!menuActions.disableWidget,
        click: () => runStatusBarMenuAction(menuActions.disableWidget),
      },
    );
  }
  menuItems.push(
    { type: "separator" },
    {
      label: `Выйти из ${appName}`,
      click: () => app.quit(),
    },
  );
  statusBarIcon.setContextMenu(Menu.buildFromTemplate(menuItems));
}

/** Удаляет постоянный значок приложения из системной строки меню. */
function clearStatusBarIcon() {
  statusBarIcon?.destroy();
  statusBarIcon = null;
}

/** <https://www.electronjs.org/docs/latest/api/notification>
 *
 * jpc describes only the object itself and its own class, so the frontend
 * doesn't get the functions that this native Electron class inherits
 * from `EventEmitter`. Make them properties of the object itself. */
function newOSNotification(options: any): Notification {
  let popup: any = new Notification(options);
  for (let name of ["on", "once", "off"]) {
    popup[name] = popup[name].bind(popup);
  }
  return popup;
}

function isOSNotificationSupported(): boolean {
  return Notification.isSupported();
}

function restartApp() {
  app.relaunch();
  app.quit();
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "uptodate"
  | "unsupported";

class UpdateState extends Observable {
  update: UpdateCheckResult | null = null;

  @notifyChangedProperty
  phase: UpdatePhase = "idle";

  @notifyChangedProperty
  progress = 0;

  @notifyChangedProperty
  version: string | null = null;

  @notifyChangedProperty
  error: string | null = null;

  @notifyChangedProperty
  errorCode: string | null = null;

  /** Set once on startup after an OTA install completed before the previous quit. */
  @notifyChangedProperty
  justInstalledVersion: string | null = null;

  get haveUpdate(): boolean {
    return !!this.update?.isUpdateAvailable;
  }

  get readyToInstall(): boolean {
    return this.phase === "downloaded";
  }

  reset() {
    this.update = null;
    this.phase = "idle";
    this.progress = 0;
    this.version = null;
    this.error = null;
    this.errorCode = null;
  }

  beginCheck() {
    this.error = null;
    this.errorCode = null;
    this.phase = "checking";
  }

  markUnsupported(code?: string) {
    this.update = null;
    this.phase = "unsupported";
    this.progress = 0;
    this.version = null;
    this.error = null;
    if (code) {
      this.errorCode = code;
    }
  }

  markUpToDate() {
    this.phase = "uptodate";
    this.progress = 0;
    this.version = null;
  }

  async updateDownloaded(): Promise<boolean> {
    if (!this.haveUpdate) {
      return false;
    }
    if (this.phase === "downloaded") {
      return true;
    }
    return !!(await this.update?.downloadPromise);
  }
}
export const updateState = new UpdateState();

let quittingForUpdate = false;

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate;
}

const checkForUpdateRunOnce = new RunOnce<boolean>();
const updateDownloadRunOnce = new RunOnce<boolean>();

function readGhUpdateTokenFile(filePath: string): string | null {
  try {
    let token = fs.readFileSync(filePath, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

function appResourcePaths(...parts: string[]): string[] {
  let results = new Set<string>();
  let add = (base: string | undefined) => {
    if (base) {
      results.add(path.join(base, ...parts));
    }
  };
  add(process.resourcesPath);
  add(path.join(path.dirname(app.getPath("exe")), "..", "Resources"));
  add(path.join(path.dirname(app.getPath("exe")), "resources"));
  add(path.dirname(app.getAppPath()));
  return [...results];
}

function hasAppUpdateConfig(): boolean {
  for (let candidate of appResourcePaths("app-update.yml")) {
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

function resolveGhUpdateToken(): string | null {
  for (let candidate of appResourcePaths("gh-update-token.txt")) {
    let token = readGhUpdateTokenFile(candidate);
    if (token) {
      return token;
    }
  }
  for (let candidate of [
    path.join(import.meta.dirname, "../build/gh-update-token.txt"),
  ]) {
    let token = readGhUpdateTokenFile(candidate);
    if (token) {
      return token;
    }
  }
  let token = process.env.JACKDAW_GH_UPDATE_TOKEN?.trim() || "";
  if (token) {
    return token;
  }
  token = process.env.GH_TOKEN?.trim() || "";
  return token || null;
}

let ghUpdateAuthApplied = false;

function ensureGhUpdateAuth(): boolean {
  let token = resolveGhUpdateToken();
  if (token) {
    process.env.GH_TOKEN = token;
    if (!ghUpdateAuthApplied) {
      autoUpdater.addAuthHeader(`token ${token}`);
      ghUpdateAuthApplied = true;
    }
  }
  return true;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  if (app.getVersion().includes("-dev")) {
    autoUpdater.allowPrerelease = true;
  }

  autoUpdater.on("checking-for-update", () => {
    updateState.beginCheck();
  });
  autoUpdater.on("update-available", info => {
    updateState.version = info.version ?? null;
    updateState.phase = "available";
    updateState.error = null;
    if (process.platform === "darwin") {
      void downloadMacDmgUpdate(info.version ?? null).catch(ex => {
        updateState.error = String((ex as Error)?.message ?? ex ?? "Mac update download failed");
        if (!macDmgPendingPath) {
          updateState.phase = "idle";
        }
      });
    }
  });
  autoUpdater.on("update-not-available", () => {
    updateState.markUpToDate();
  });
  autoUpdater.on("download-progress", progress => {
    if (process.platform === "darwin") {
      return;
    }
    updateState.phase = "downloading";
    updateState.progress = Math.round(progress.percent ?? 0);
  });
  autoUpdater.on("update-downloaded", info => {
    if (process.platform === "darwin") {
      return;
    }
    updateState.version = info.version ?? updateState.version;
    updateState.phase = "downloaded";
    updateState.progress = 100;
  });
  autoUpdater.on("error", err => {
    let msg = String(err?.message ?? err ?? "");
    if (process.platform === "darwin" && /code signature|ShipIt|did not pass validation/i.test(msg)) {
      updateState.error = null;
      updateState.update = null;
      if (updateState.version) {
        updateState.phase = "available";
        void downloadMacDmgUpdate(updateState.version).catch(dmgEx => {
          updateState.error = String((dmgEx as Error)?.message ?? dmgEx ?? "Mac update download failed");
        });
      }
      return;
    }
    if (/ENOENT|404|401|Cannot find .*yml/i.test(msg)) {
      if (updateState.phase === "checking") {
        updateState.markUnsupported("ota-metadata");
      } else {
        updateState.error = msg;
        updateState.phase = "idle";
      }
      return;
    }
    updateState.error = msg;
    if (updateState.phase === "checking" || updateState.phase === "available" || updateState.phase === "downloading") {
      updateState.phase = "idle";
    }
  });
}
configureAutoUpdater();
detectPostUpdateSuccess();

function pendingUpdateMarkerPath(): string {
  return path.join(app.getPath("userData"), "pending-ota-install.json");
}

async function writePendingUpdateMarker(version: string | null | undefined): Promise<void> {
  let trimmed = version?.trim();
  if (!trimmed) {
    return;
  }
  await fsPromises.writeFile(
    pendingUpdateMarkerPath(),
    JSON.stringify({ version: trimmed }),
    "utf8",
  );
}

function consumePendingUpdateMarker(): string | null {
  let markerPath = pendingUpdateMarkerPath();
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  try {
    let raw = fs.readFileSync(markerPath, "utf8");
    let parsed = JSON.parse(raw) as { version?: string };
    let expected = parsed.version?.trim();
    if (expected && expected === app.getVersion()) {
      return expected;
    }
  } catch {
    // stale or corrupt marker
  } finally {
    fs.rmSync(markerPath, { force: true });
  }
  return null;
}

function detectPostUpdateSuccess() {
  let version = consumePendingUpdateMarker();
  if (version) {
    updateState.justInstalledVersion = version;
  }
}

const kUpdateCheckTimeoutMs = 45_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function failUpdateCheck(message: string) {
  updateState.error = message;
  if (updateState.phase === "checking") {
    updateState.phase = "idle";
  }
}

const kUpdateDownloadTimeoutMs = 20 * 60_000;

let macDmgPendingPath: string | null = null;
const macDmgDownloadRunOnce = new RunOnce<void>();

type GhReleaseAsset = { name: string; url: string; size: number };
type GhRelease = { assets: GhReleaseAsset[] };

function ghApiHeaders(useAuthorization = true): Record<string, string> {
  let headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Jackdaw-Mail-Updater",
  };
  if (useAuthorization) {
    let token = resolveGhUpdateToken();
    if (token) {
      headers.Authorization = `token ${token}`;
    }
  }
  return headers;
}

async function fetchReleaseByTag(version: string): Promise<GhRelease> {
  let tag = version.startsWith("v") ? version : `v${version}`;
  let url = `https://api.github.com/repos/${kGhOwner}/${kGhRepo}/releases/tags/${tag}`;
  let headers = ghApiHeaders();
  let response = await fetch(url, { headers });
  if (response.status === 401 && headers.Authorization) {
    // Публичные релизы доступны без PAT: просроченный необязательный токен
    // не должен блокировать обновление.
    await response.arrayBuffer();
    response = await fetch(url, { headers: ghApiHeaders(false) });
  }
  if (!response.ok) {
    throw new Error(`Release ${tag} not found (${response.status})`);
  }
  return await response.json() as GhRelease;
}

function downloadGithubAsset(
  asset: GhReleaseAsset,
  destPath: string,
  onProgress: (pct: number) => void,
  useAuthorization = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let headers = {
      ...ghApiHeaders(useAuthorization),
      Accept: "application/octet-stream",
    };
    let request = https.get(asset.url, { headers }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadGithubAsset({ ...asset, url: response.headers.location }, destPath, onProgress, false).then(resolve, reject);
        return;
      }
      if (response.statusCode === 401 && useAuthorization) {
        response.resume();
        downloadGithubAsset(asset, destPath, onProgress, false).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed (${response.statusCode})`));
        return;
      }
      let total = Number(response.headers["content-length"] ?? asset.size ?? 0);
      let received = 0;
      let file = fs.createWriteStream(destPath);
      response.on("data", chunk => {
        received += chunk.length;
        if (total > 0) {
          onProgress(Math.min(100, Math.round(received / total * 100)));
        }
      });
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", reject);
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

function getMacAppBundlePath(): string {
  let dir = path.dirname(process.execPath);
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir).endsWith(".app")) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.join("/Applications", "Jackdaw Mail.app");
}

const kUpdateShutdownTimeoutMs = 3_000;

/** Quit first, then a detached shell script mounts the DMG and replaces the .app bundle. */
async function scheduleMacDmgInstallAndQuit(dmgPath: string): Promise<void> {
  let destApp = getMacAppBundlePath();
  if (!destApp.startsWith("/Applications/")) {
    destApp = path.join("/Applications", path.basename(destApp));
  }
  let scriptPath = path.join(app.getPath("temp"), `jackdaw-install-${process.pid}.sh`);
  let script = `#!/bin/bash
set -euo pipefail
DMG=${JSON.stringify(dmgPath)}
DEST=${JSON.stringify(destApp)}
PID=${process.pid}
MOUNT=$(mktemp -d /tmp/jackdaw-update.XXXXXX)

while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
sleep 0.5

cleanup() {
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$MOUNT"
  rm -f ${JSON.stringify(scriptPath)}
}
trap cleanup EXIT

hdiutil attach -nobrowse -mountpoint "$MOUNT" "$DMG"
SRC=$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -1)
if [ -z "$SRC" ]; then echo "No .app in DMG" >&2; exit 1; fi
rm -rf "$DEST"
ditto "$SRC" "$DEST"
open "$DEST"
`;
  await fsPromises.writeFile(scriptPath, script, { mode: 0o755 });
  await writePendingUpdateMarker(updateState.version);
  quittingForUpdate = true;
  let child = spawn("/bin/bash", [scriptPath], { detached: true, stdio: "ignore" });
  child.unref();

  await Promise.race([
    shutdownBackend(),
    new Promise<void>(resolve => setTimeout(resolve, kUpdateShutdownTimeoutMs)),
  ]);
  app.exit(0);
}

async function downloadMacDmgUpdate(version: string | null | undefined) {
  if (!version) {
    throw new Error("No update version to download");
  }
  return macDmgDownloadRunOnce.runOnce(async () => {
    let release = await fetchReleaseByTag(version);
    let dmgAsset = release.assets.find(asset => asset.name.endsWith(".dmg") && /jackdaw/i.test(asset.name));
    if (!dmgAsset) {
      throw new Error(`No .dmg found in release v${version}`);
    }
    let cacheDir = path.join(app.getPath("cache"), "jackdaw-updates");
    await fsPromises.mkdir(cacheDir, { recursive: true });
    let dmgPath = path.join(cacheDir, dmgAsset.name);
    updateState.phase = "downloading";
    updateState.progress = 0;
    updateState.error = null;
    await downloadGithubAsset(dmgAsset, dmgPath, pct => {
      updateState.progress = pct;
    });
    macDmgPendingPath = dmgPath;
    updateState.phase = "downloaded";
    updateState.progress = 100;
  });
}

function trackUpdateDownload(result: UpdateCheckResult | null) {
  let downloadPromise = result?.downloadPromise;
  if (!downloadPromise) {
    return;
  }
  void withTimeout(Promise.resolve(downloadPromise), kUpdateDownloadTimeoutMs, "Update download timed out")
    .then(() => {
      if (updateState.phase !== "downloaded") {
        updateState.phase = "downloaded";
        updateState.progress = 100;
        updateState.error = null;
      }
    })
    .catch(ex => {
      updateState.error = String((ex as Error)?.message ?? ex ?? "Update download failed");
      if (updateState.phase === "available" || updateState.phase === "downloading") {
        updateState.phase = "idle";
      }
    });
}

function markUpdateUnavailable(code: string) {
  updateState.errorCode = code;
  updateState.error = null;
  updateState.markUnsupported(code);
}

async function runUpdateCheck(check: () => Promise<UpdateCheckResult | null>): Promise<boolean> {
  if (!hasAppUpdateConfig()) {
    markUpdateUnavailable("ota-not-configured");
    return false;
  }
  ensureGhUpdateAuth();
  updateState.beginCheck();
  try {
    updateState.update = await ignoreMissingUpdateConfig(withTimeout(
      check(),
      kUpdateCheckTimeoutMs,
      "Update check timed out",
    ));
  } catch (ex) {
    failUpdateCheck(String((ex as Error)?.message ?? ex ?? "Update check failed"));
    throw ex;
  }
  if (!updateState.update) {
    if (updateState.phase === "checking") {
      markUpdateUnavailable("ota-server");
    }
    return false;
  }
  if (!updateState.haveUpdate) {
    updateState.markUpToDate();
    return false;
  }
  if (updateState.phase === "checking") {
    updateState.phase = "available";
  }
  let newVersion = updateState.version ?? updateState.update?.updateInfo?.version ?? null;
  if (process.platform === "darwin") {
    if (updateState.phase !== "downloading" && updateState.phase !== "downloaded") {
      void downloadMacDmgUpdate(newVersion).catch(ex => {
        updateState.error = String((ex as Error)?.message ?? ex ?? "Mac update download failed");
        if (!macDmgPendingPath && (updateState.phase === "available" || updateState.phase === "downloading")) {
          updateState.phase = "idle";
        }
      });
    }
  } else {
    trackUpdateDownload(updateState.update);
  }
  return true;
}

/** @returns have update */
async function checkForUpdate(force = false): Promise<boolean> {
  if (!force && updateState.readyToInstall) {
    return true;
  }
  if (!force && updateState.haveUpdate) {
    return true;
  }
  if (!force && (updateState.phase === "uptodate" || updateState.phase === "unsupported")) {
    return false;
  }
  if (force) {
    updateState.reset();
    checkForUpdateRunOnce.running = null;
  }
  return await checkForUpdateRunOnce.runOnce(async () => {
    try {
      return await runUpdateCheck(() => autoUpdater.checkForUpdates());
    } catch {
      return false;
    }
  });
}

export async function checkForUpdateAndNotify(force = false): Promise<boolean> {
  if (!force && (updateState.readyToInstall || updateState.haveUpdate)) {
    return updateState.haveUpdate || updateState.readyToInstall;
  }
  if (!force && (updateState.phase === "uptodate" || updateState.phase === "unsupported")) {
    return false;
  }
  if (force) {
    updateState.reset();
    checkForUpdateRunOnce.running = null;
  }
  return await checkForUpdateRunOnce.runOnce(async () => {
    try {
      return await runUpdateCheck(() => autoUpdater.checkForUpdatesAndNotify());
    } catch {
      return false;
    }
  });
}

/** Builds without a publish configuration ship no `app-update.yml`.
  * They cannot update themselves, which is not an error, but no update.
  * Also treat missing GitHub release artifacts (404) as "no update". */
async function ignoreMissingUpdateConfig(check: Promise<UpdateCheckResult | null>): Promise<UpdateCheckResult | null> {
  try {
    return await check;
  } catch (ex) {
    if (ex.code == "ENOENT") {
      return null;
    }
    let msg = String(ex?.message ?? ex ?? "");
    if (ex.statusCode == 404 || ex.httpStatusCode == 404 || /404|Cannot find .*yml/i.test(msg)) {
      return null;
    }
    if (ex.statusCode == 401 || ex.httpStatusCode == 401) {
      return null;
    }
    throw ex;
  }
}

async function syncUpdateDownloadState(): Promise<void> {
  if (updateState.phase === "downloaded") {
    return;
  }
  let promise = updateState.update?.downloadPromise;
  if (!promise) {
    return;
  }
  let outcome = await Promise.race([
    promise.then(() => "done" as const, () => "error" as const),
    new Promise<"pending">(resolve => setTimeout(() => resolve("pending"), 0)),
  ]);
  if (outcome === "done" && updateState.phase !== "downloaded") {
    updateState.phase = "downloaded";
    updateState.progress = 100;
    updateState.error = null;
  }
}

export async function getUpdateStatus() {
  await syncUpdateDownloadState();
  return {
    phase: updateState.phase,
    progress: updateState.progress,
    version: updateState.version,
    readyToInstall: updateState.readyToInstall || (process.platform === "darwin" && !!macDmgPendingPath),
    error: updateState.error,
    errorCode: updateState.errorCode,
    appVersion: app.getVersion(),
    justInstalledVersion: updateState.justInstalledVersion,
    otaConfigured: hasAppUpdateConfig(),
    otaTokenPresent: !!resolveGhUpdateToken(),
  };
}

export async function prepareUpdaterAuth(): Promise<boolean> {
  return ensureGhUpdateAuth();
}

export async function downloadUpdate(): Promise<boolean> {
  if (process.platform === "darwin") {
    if (!macDmgPendingPath) {
      await downloadMacDmgUpdate(updateState.version);
    }
    return true;
  }
  if (updateState.readyToInstall) {
    return true;
  }
  if (!updateState.haveUpdate) {
    throw new Error("No update available");
  }
  return await updateDownloadRunOnce.runOnce(async () => {
    updateState.phase = "downloading";
    updateState.progress = 0;
    updateState.error = null;
    try {
      await withTimeout(
        autoUpdater.downloadUpdate(),
        kUpdateDownloadTimeoutMs,
        "Update download timed out",
      );
      updateState.phase = "downloaded";
      updateState.progress = 100;
      updateState.error = null;
      return true;
    } catch (ex) {
      updateState.error = String((ex as Error)?.message ?? ex ?? "Update download failed");
      if (updateState.phase === "downloading") {
        updateState.phase = "available";
      }
      throw ex;
    }
  });
}

export async function installUpdate() {
  if (process.platform === "darwin") {
    if (!macDmgPendingPath && updateState.version) {
      await downloadMacDmgUpdate(updateState.version);
    }
    if (macDmgPendingPath) {
      await scheduleMacDmgInstallAndQuit(macDmgPendingPath);
      return;
    }
    throw new Error("No update downloaded");
  }
  if (!updateState.readyToInstall && !await updateState.updateDownloaded()) {
    throw new Error("No update downloaded");
  }
  await writePendingUpdateMarker(updateState.version);
  quittingForUpdate = true;
  autoUpdater.quitAndInstall(false, true);
}

export async function openPendingReleaseDownload() {
  await shell.openExternal(`https://github.com/${kGhOwner}/${kGhRepo}/releases`);
}

function setTheme(theme: "system" | "light" | "dark") {
  if (!["system", "light", "dark"].includes(theme)) {
    throw new Error("Bad theme name " + theme);
  }
  nativeTheme.themeSource = theme;
}

async function openExternalURL(url: string) {
  await shell.openExternal(url);
}

async function openFileInNativeApp(filePath: string) {
  await shell.openPath(filePath);
}

class StartupArgs extends Observable {
  /** URL that our app should open
   * E.g. a `mailto:` URL */
  @notifyChangedProperty
  url: string | null = null;
  /** File that our app should open
   * E.g. `/home/u/email.eml` */
  @notifyChangedProperty
  file: string | null = null;

  /** All OS commandline arguments.
   * Note: First argument is typically the app itself. */
  @notifyChangedProperty
  commandline: string[] | null = null;

  /** Clear parameters when a specific handler has understood and handled them */
  handled() {
    this.url = null;
    this.commandline = null;
  }
}
export const startupArgs = new StartupArgs();

/** Tells the UI whether the computer is awake or in sleep mode.
 * The UI subscribes to it via `computerOn` in app/logic/util/backend-wrapper.ts */
export class DesktopComputerOn extends Observable {
  @notifyChangedProperty
  isSleeping = false;

  start(): void {
    powerMonitor.on("suspend", () => this.isSleeping = true);
    powerMonitor.on("resume", () => this.isSleeping = false);
  }
}
const computerOn = new DesktopComputerOn();
computerOn.start();

/** @param protocol E.g. "mailto" */
function isDefaultApp(protocol: string) {
  return app.isDefaultProtocolClient(protocol);
}

/** @param protocol E.g. "mailto" */
function setAsDefaultApp(protocol: string) {
  return app.setAsDefaultProtocolClient(protocol);
}

function showFileInFolder(filePath: string) {
  shell.showItemInFolder(filePath);
}

async function askForMediaAccess(mediaType: string) {
  if (systemPreferences.getMediaAccessStatus(mediaType) == "granted") {
    return true;
  } else {
    return await systemPreferences.askForMediaAccess(mediaType);
  }
}

function onScreenSharingSelect(onSelect: (screens: DesktopCapturerSource[], error?: Error) => Promise<DesktopCapturerSource>,
    thumbnailWidth: number, thumbnailHeight: number) {
  console.log("Screen sharing dialog", !!onSelect ? "shown" : "closed");
  if (!onSelect || typeof(onSelect) != "function") {
    session.defaultSession.setDisplayMediaRequestHandler(null);
    return;
  }
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        // Security
        let url = new URL(request.securityOrigin);
        assert(url.protocol == "file:" || url.hostname == "localhost", `Screen share not allowed from URL ${url.href}`);
        assert(request.userGesture, `Screen share must be initiated by the user`);
        let screens = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
        });
        let screen = await onSelect(screens);
        callback({ video: screen, audio: 'loopback' });
      } catch (ex) {
        if (!(ex instanceof Error)) {
          ex = new Error(ex + "");
        }
        await onSelect([], ex as Error);
      }
    },
    // If true, use the system picker if available.
    // Note: this is currently experimental. If the system picker
    // is available, it will be used and the media request handler
    // will not be invoked.
    { useSystemPicker: os.platform() == "darwin" });
}


function openMenu(menuItems: MenuItemConstructorOptions[]): void {
  let menu = Menu.buildFromTemplate(menuItems);
  menu.popup();
}

function createIMAPFlowConnection(...args): ImapFlow {
  return new ImapFlow(...args);
}

function getSQLiteDatabase(filename: string, options: any, buffer?: Uint8Array): Database {
  if (buffer) {
    return new Database(Buffer.from(buffer), options);
  }
  if (!path.isAbsolute(filename)) {
    filename = path.join(getConfigDir(), filename);
  }
  return new Database(filename, options);
}

async function sendMailNodemailer(transport, mail) {
  let transporter = nodemailer.createTransport(transport);
  await transporter.sendMail(mail);
}

async function verifyServerNodemailer(transport) {
  let transporter = nodemailer.createTransport(transport);
  await transporter.verify();
}

async function getMIMENodemailer(mail): Promise<Uint8Array> {
  let composer = new MailComposer(mail);
  let buffer = await composer.compile().build();
  return buffer;
}

function createTSDAVClient(options: any) {
  return new DAVClient(options);
}

function createWebDAVClient(serverURL: string, options: any) {
  return createWebDAVFileClient(serverURL, options);
}

function newAdmZIP(filepath: string) {
  try {
    return new Zip(filepath);
  } catch (ex) {
    // ZIP file does not exist yet
    // Relying on the message is fragile, but AdmZip unfortunately doesn't give us error codes.
    if (ex.message?.includes("Invalid filename") || ex.stack?.includes("Object.INVALID_FILENAME")) {
      // Create a new ZIP file.
      let zip = new Zip();
      zip.writeZip(filepath);
      return new Zip(filepath);
    } else {
      throw ex;
    }
  }
}

let mainWindow: BrowserWindow;

const widgetSignInWindows = new Map<string, BrowserWindow>();
const widgetPopoutWindows = new Map<string, BrowserWindow>();

function widgetPartitionName(sessionID: string): string {
  return sessionID.startsWith("persist:") ? sessionID : `persist:${sessionID}`;
}

function waitForWidgetWindowClose(win: BrowserWindow): Promise<void> {
  return new Promise(resolve => {
    if (win.isDestroyed()) {
      resolve();
      return;
    }
    win.once("closed", () => {
      focusMainWindow();
      resolve();
    });
  });
}

function wireWidgetWindowNavigation(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(console.error);
    }
    return { action: "deny" };
  });
}

function createWidgetBrowserWindow(sessionID: string, url: string, title: string): BrowserWindow {
  let win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 360,
    minHeight: 480,
    title: title ? `${title} — ${appName}` : appName,
    autoHideMenuBar: true,
    webPreferences: {
      partition: widgetPartitionName(sessionID),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  wireWidgetWindowNavigation(win);
  win.loadURL(url).catch(console.error);
  return win;
}

async function openWidgetSignIn(sessionID: string, url: string, title: string): Promise<void> {
  let existing = widgetSignInWindows.get(sessionID);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    if (existing.webContents.getURL() !== url) {
      await existing.loadURL(url);
    }
    return waitForWidgetWindowClose(existing);
  }

  let win = createWidgetBrowserWindow(sessionID, url, title);
  widgetSignInWindows.set(sessionID, win);
  win.on("closed", () => widgetSignInWindows.delete(sessionID));
  return waitForWidgetWindowClose(win);
}

async function openWidgetPopout(sessionID: string, url: string, title: string): Promise<void> {
  let existing = widgetPopoutWindows.get(sessionID);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    if (existing.webContents.getURL() !== url) {
      await existing.loadURL(url);
    }
    return;
  }

  let win = createWidgetBrowserWindow(sessionID, url, title);
  widgetPopoutWindows.set(sessionID, win);
  win.on("closed", () => widgetPopoutWindows.delete(sessionID));
}

function focusWidgetPopout(sessionID: string): boolean {
  let win = widgetPopoutWindows.get(sessionID);
  if (!win || win.isDestroyed()) {
    return false;
  }
  win.focus();
  return true;
}

function closeWidgetPopout(sessionID: string): void {
  let win = widgetPopoutWindows.get(sessionID);
  if (!win || win.isDestroyed()) {
    widgetPopoutWindows.delete(sessionID);
    return;
  }
  win.close();
}

async function widgetSessionHasCookies(sessionID: string, url: string): Promise<boolean> {
  let ses = session.fromPartition(widgetPartitionName(sessionID));
  let cookies = await ses.cookies.get({ url });
  return cookies.some(cookie => cookie.name && cookie.value);
}

export function setMainWindow(mainWin: BrowserWindow) {
  mainWindow = mainWin;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
}

function minimizeMainWindow() {
  mainWindow.minimize();
}

function unminimizeMainWindow() {
  focusMainWindow();
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }
}

function maximizeMainWindow() {
  mainWindow.maximize();
}

function addEventListenerWebContents(webContentsID: number, webviewEvent: string, eventHandler: (event: Event) => void) {
  const win = webContents.fromId(webContentsID);
  if (!win) {
    // race?
    console.error(`WebContents ID ${webContentsID} not found`);
    return;
  }
  win.on(webviewEvent as any, (_: any, event: Event) => {
    eventHandler(event);
  });
}

/** Route window.open and target=_blank into the same webview (widget panel). */
function containWebContentsNavigation(webContentsID: number) {
  const guest = webContents.fromId(webContentsID);
  if (!guest) {
    console.error(`WebContents ID ${webContentsID} not found`);
    return;
  }
  guest.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      guest.loadURL(url).catch(console.error);
    }
    return { action: "deny" };
  });
}

function getWebContents(webContentsID: number) {
  const win = webContents.fromId(webContentsID);
  assert(win, `WebContents ID ${webContentsID} not found`);
  return new WebContents(win);
}

/**
 * Writes to system clipboard
 * Don't expose reading the clipboard because the user may have sensitive data
 * on their system clipboard e.g. passwords
 */
function writeTextToClipboard(text: string) {
  clipboard.writeText(text);
}

function setBadgeCount(count: number) {
  app.setBadgeCount(count);
}

export interface FileStat {
  /** Filename */
  name: string;
  /** File path, including file name */
  path: string;
  /** true: is a directory, false: is a file */
  isDirectory: boolean;
  /** File size, in bytes */
  size: number | undefined;
  /** Time of last modification */
  lastMod: Date | undefined;
}

/**
 * Get the files and directories within a directory on the harddrive
 * @param dirPath path of the directory for which you want to see the contents
 * @param withStats includes size and last modification time (slower, extra work)
 * @param includeHidden include dotfiles (on Unix: name starting with ".")
 * @returns list of files and directories in the directory
 */
async function listDirectoryContents(dirPath: string, withStats = true, includeHidden = false): FileStat[] {
  let files = [] as FileStat[];
  let entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  for (let entry of entries) {
    if (!includeHidden && entry.name[0] == ".") {
      continue;
    }
    let file = {} as FileStat;
    file.name = entry.name;
    file.path = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) {
      file.isDirectory = true;
    } else if (entry.isFile()) {
      file.isDirectory = false;
    } else {
      continue;
    }
    if (withStats) {
      let stat = await fsPromises.stat(file.path);
      file.size = stat.size;
      file.lastMod = stat.mtime;
    }
    files.push(file);
  }
  return files;
}

/** @returns data: URL */
async function getIconForFileType(ext: string, mimetype: string): Promise<string> {
  let dummy = path.join(app.getPath("temp"), "foo." + ext);
  await fsPromises.writeFile(dummy, "");
  const image = await app.getFileIcon(dummy);
  await fsPromises.unlink(dummy);
  return image.toDataURL();
}

/** @returns data: URL */
async function getIconForLocalFile(fullPath: string): Promise<string> {
  // size `large` not supported on MacOS, it causes the app to crash
  let isMac = os.platform() == "darwin";
  let image = await app.getFileIcon(fullPath, { size: isMac ? "normal" : "large" });
  return image.toDataURL();
}

/** @returns data: URL */
async function getThumbnailForLocalFile(fullPath: string, width: number, height: number): Promise<string | null> {
  if (!fullPath) {
    return null;
  }
  let platform = os.platform();
  let haveOS = platform == "win32" || platform == "darwin"
  let image: NativeImage;
  if (haveOS) {
    image = await nativeImage.createThumbnailFromPath(fullPath, { width, height });
  } else { // electron doesn't implement createThumbnailFromPath() on Linux
    let ext = fullPath.split(".").pop();
    if (ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "gif" || ext == "bmp") {
      // TODO check `~/.thumbnails/normal/` ?
      image = nativeImage.createFromPath(fullPath);
      image = image.resize({ width, quality: "good" }); // no height, to keep aspect ratio
    } else {
      return null;
    }
  }
  return image.toDataURL();
}

function platform(): string {
  return os.platform();
}

/** @param type
 *   e.g. "home", "appData" (`.config` and `%APPDATA%`), "userData" (app config)
 *   @see <https://www.electronjs.org/docs/latest/api/app#appgetpathname> */
function directory(type: string): string {
  return app.getPath(type as any);
}

// Keep the on-disk storage name stable while the user-facing product name evolves.
// This preserves settings and local mail data across the Jackdaw → Jackdaw Mail rename.
const kAppStorageDir = "Jackdaw";
const kAppDir = production ? kAppStorageDir : kAppStorageDir + "Dev"; // e.g. "Jackdaw" or "JackdawDev"

/**
 * Get the user config directory on disk.
 *
 * The files in here are useful mostly to the app itself, in internal data formats,
 * and not really useful without the app.
 * Consequently, this is a directory that is usually *not* shown to the user,
 * but still accessible, if needed by technical people or for backups.
 *
 * Linux: /home/USER/.jackdaw/
 * Windows: C:\Users\USER\AppData\Jackdaw\
 * Mac OS: /Users/USER/Library/Application Support/Jackdaw
 */
function getConfigDir(): string {
  let platform = os.platform();
  let datadir = platform == "win32" || platform == "darwin"
    ? app.getPath("appData")
    : app.getPath("home");
  let dirname = platform == "win32" || platform == "darwin"
    ? kAppDir
    : "." + kAppDir.toLowerCase();
  let dir = path.join(datadir, dirname);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let filesDirCreated = false;

/**
 * Get the directory on disk where we store the files that our user exchanged with others.
 * E.g. file sharing, email attachments, chat transfer files, and email backups.
 *
 * This should be a folder where the user can go to, but not right in the middle of his
 * personal documents and folders.
 *
 * TODO Change it
 * Linux: /home/USER/.jackdaw/
 * Windows: C:\Users\USER\AppData\Roaming\Jackdaw\
 * Mac OS: /Users/USER/Library/Jackdaw
 */
function getFilesDir(): string {
  let platform = os.platform();
  let dirname =
    platform == "win32" ? kAppDir :
    platform == "darwin" ? "Library/" + kAppDir :
    "." + kAppDir.toLowerCase();
  let dir = path.join(os.homedir(), dirname);
  if (!filesDirCreated) {
    fs.mkdirSync(dir, { recursive: true });
    filesDirCreated = true;
  }
  return dir;
}

function assert(test, errorMessage): asserts test {
  if (!test) {
    throw new Error(errorMessage);
  }
}
