import { setMainWindow, startupBackend, shutdownBackend, startupArgs, updateState, checkForUpdateAndNotify, createJPCSecret, isQuittingForUpdate, prepareUpdaterAuth } from '../../backend/backend';
import { app, shell, BrowserWindow, dialog, session, Menu, MenuItemConstructorOptions, type ContextMenuParams, type WebContents } from 'electron'
import { ipcMain } from 'electron/main';
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import { installSignalServiceCATrust } from './signalServiceCA'
import { installTestProfileGuards, isTestProfile, testJPCPort } from '../../backend/testProfile'
import { nativeDialogLabels, registerNativeDialogHandlers } from '../../backend/nativeDialogs'
import { connectOAuth2Window } from './oauth2Window'
import { getSpellcheckSuggestions } from './spellcheck'
import {
  nativeMenuActionChannel,
  nativeMenuActions,
  nativeMenuLabelsChannel,
  type NativeMenuAction,
  type NativeMenuLabels,
} from '../../../app/logic/util/nativeMenu'
import {
  composeWindowCloseChannel,
  composeWindowClosedChannel,
  composeWindowDataChannel,
  composeWindowFocusChannel,
  composeWindowOpenChannel,
  composeWindowSendChannel,
  composeWindowSendRequestChannel,
  composeWindowSendResponseChannel,
  composeWindowSearchContactsChannel,
  composeWindowSearchContactsRequestChannel,
  composeWindowSearchContactsResponseChannel,
  isComposeWindowPersonArray,
  isComposeWindowPayload,
  isComposeWindowSendResult,
  type ComposeWindowMail,
  type ComposeWindowPerson,
  type ComposeWindowSendResult,
} from '../../../app/logic/Mail/Composer/ComposeWindowProtocol'
import {
  messageWindowCloseChannel,
  messageWindowClosedChannel,
  messageWindowDataChannel,
  messageWindowFocusChannel,
  messageWindowOpenChannel,
  messageWindowReplyChannel,
  messageWindowReplyRequestChannel,
  isMessageWindowReplyMode,
  isMessageWindowPayload,
  type MessageWindowReplyMode,
  type MessageWindowPayload,
} from '../../../app/logic/Mail/MessageWindowProtocol'

let primaryWindow: BrowserWindow | null = null;
let currentJPCSecret: string | null = null;
const composeWindows = new Map<string, { window: BrowserWindow; payload: ComposeWindowMail }>();
const messageWindows = new Map<string, { window: BrowserWindow; payload: MessageWindowPayload }>();
const kComposeWindowRequestTimeoutMS = 60_000;
/** Отправка письма с крупным вложением по медленному SMTP идёт дольше минуты. По таймауту
 * окно показывало ошибку, а главное окно всё равно отправляло: повторное «Отправить»
 * давало получателям дубль. Ждём отправку дольше, чем любой разумный SMTP. */
const kComposeWindowSendTimeoutMS = 15 * 60_000;
const kComposeWindowSearchTextMaxLength = 512;
const pendingComposeWindowSends = new Map<string, {
  windowID: string;
  resolve: (result: ComposeWindowSendResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
const pendingComposeWindowSearches = new Map<string, {
  resolve: (result: ComposeWindowPerson[]) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
const pendingNativeMenuActions = new WeakMap<BrowserWindow, NativeMenuAction>();
let currentNativeMenuLabels: NativeMenuLabels = {
  about: 'About Jackdaw Mail',
  services: 'Services',
  hide: 'Hide Jackdaw Mail',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  quit: 'Quit Jackdaw Mail',
  file: 'File',
  new: 'New',
  email: 'Email',
  calendarEvent: 'Calendar event',
  contact: 'Contact',
  close: 'Close',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  view: 'View',
  mail: 'Mail',
  calendar: 'Calendar',
  contacts: 'Contacts',
  files: 'Files',
  chat: 'Chat',
  reports: 'Reports',
  search: 'Search',
  currentApp: 'Current app',
  toggleDevTools: 'Toggle Developer Tools',
  resetZoom: 'Reset Zoom',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  fullscreen: 'Toggle Fullscreen',
  message: 'Message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
  markReadUnread: 'Mark as read/unread',
  archive: 'Archive',
  delete: 'Delete',
  tools: 'Tools',
  getMail: 'Get mail',
  settings: 'Settings',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  front: 'Bring All to Front',
};

const demoModeRequested = process.argv.includes('--jackdaw-demo') || process.env['JACKDAW_DEMO_MODE'] == '1';

function isDemoModeRequested(): boolean {
  return demoModeRequested;
}
const nativeMenuLabelKeys = Object.keys(currentNativeMenuLabels) as (keyof NativeMenuLabels)[];

registerNativeDialogHandlers();

ipcMain.on(nativeMenuLabelsChannel, (_event, labels: unknown) => {
  if (!isNativeMenuLabels(labels)) {
    return;
  }
  currentNativeMenuLabels = labels;
  createMenu();
});

function isNativeMenuLabels(value: unknown): value is NativeMenuLabels {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const labels = value as Record<string, unknown>;
  return nativeMenuLabelKeys.every(key =>
    typeof labels[key] === 'string' && (labels[key] as string).length <= 200);
}

function isComposeWindowID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isMessageWindowID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function messageWindowTitle(payload: MessageWindowPayload): string {
  const subject = payload.mail.subject.trim().slice(0, 160);
  return subject ? `Jackdaw Mail — ${subject}` : "Jackdaw Mail — Message";
}

function isPrimaryRenderer(sender: WebContents): boolean {
  return !!primaryWindow && !primaryWindow.isDestroyed() && primaryWindow.webContents === sender;
}

function notifyComposeWindowClosed(windowID: string): void {
  const window = primaryWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  try {
    window.webContents.send(composeWindowClosedChannel, windowID);
  } catch (ex) {
    console.error("Could not notify the main window about a closed compose window", ex);
  }
}

function notifyMessageWindowClosed(windowID: string): void {
  const window = primaryWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  try {
    window.webContents.send(messageWindowClosedChannel, windowID);
  } catch (ex) {
    console.error("Could not notify the main window about a closed message window", ex);
  }
}

function forwardComposeWindowSend(windowID: string, payload: ComposeWindowMail): Promise<ComposeWindowSendResult> {
  const window = primaryWindow;
  if (!window || window.isDestroyed()) {
    return Promise.resolve({ ok: false, errorMessage: "Main window is unavailable" });
  }

  const requestID = crypto.randomUUID();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      pendingComposeWindowSends.delete(requestID);
      resolve({ ok: false, errorMessage: "The main window did not respond" });
    }, kComposeWindowSendTimeoutMS);
    pendingComposeWindowSends.set(requestID, { windowID, resolve, timeout });
    try {
      window.webContents.send(composeWindowSendRequestChannel, requestID, windowID, payload);
    } catch (_ex) {
      clearTimeout(timeout);
      pendingComposeWindowSends.delete(requestID);
      resolve({ ok: false, errorMessage: "The main window is unavailable" });
    }
  });
}

function forwardComposeWindowContactSearch(windowID: string, searchText: string): Promise<ComposeWindowPerson[]> {
  const window = primaryWindow;
  if (!window || window.isDestroyed()) {
    return Promise.resolve([]);
  }

  const requestID = crypto.randomUUID();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      pendingComposeWindowSearches.delete(requestID);
      resolve([]);
    }, kComposeWindowRequestTimeoutMS);
    pendingComposeWindowSearches.set(requestID, { resolve, timeout });
    try {
      window.webContents.send(composeWindowSearchContactsRequestChannel, requestID, windowID, searchText);
    } catch (_ex) {
      clearTimeout(timeout);
      pendingComposeWindowSearches.delete(requestID);
      resolve([]);
    }
  });
}

function failPendingComposeWindowSends(errorMessage: string): void {
  for (const [requestID, pending] of pendingComposeWindowSends) {
    clearTimeout(pending.timeout);
    pendingComposeWindowSends.delete(requestID);
    pending.resolve({ ok: false, errorMessage });
  }
}

function failPendingComposeWindowSearches(): void {
  for (const [requestID, pending] of pendingComposeWindowSearches) {
    clearTimeout(pending.timeout);
    pendingComposeWindowSearches.delete(requestID);
    pending.resolve([]);
  }
}

function closeComposeWindows(): void {
  for (const entry of composeWindows.values()) {
    if (!entry.window.isDestroyed()) {
      entry.window.close();
    }
  }
  composeWindows.clear();
}

function closeMessageWindows(): void {
  for (const entry of messageWindows.values()) {
    if (!entry.window.isDestroyed()) {
      entry.window.close();
    }
  }
  messageWindows.clear();
}

function loadRendererWindow(window: BrowserWindow, hash: string): Promise<void> {
  // Копии для автопроверок: порт backend нужен и отдельным окнам письма и черновика
  if (testJPCPort()) {
    hash += '&jpcPort=' + testJPCPort();
  }
  if (is.dev) {
    return window.loadURL('http://localhost:5454/#' + hash);
  }
  // Только в разработке: в выпуске переменная окружения подменила бы интерфейс чужой страницей
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return window.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#' + hash);
  }
  return window.loadFile(join(__dirname, '../renderer/index.html'), { hash });
}

function registerComposeWindow(windowID: string, payload: ComposeWindowMail, composeWindow: BrowserWindow): void {
  composeWindows.set(windowID, { window: composeWindow, payload });
  composeWindow.on("closed", () => {
    if (composeWindows.get(windowID)?.window === composeWindow) {
      composeWindows.delete(windowID);
      notifyComposeWindowClosed(windowID);
    }
  });
}

function replaceMessageWindowWithComposeWindow(windowID: string, payload: ComposeWindowMail): boolean {
  if (!currentJPCSecret) {
    return false;
  }
  const entry = messageWindows.get(windowID);
  if (!entry) {
    return false;
  }
  if (entry.window.isDestroyed()) {
    messageWindows.delete(windowID);
    return false;
  }
  messageWindows.delete(windowID);
  notifyMessageWindowClosed(windowID);
  registerComposeWindow(windowID, payload, entry.window);
  entry.window.setTitle("Jackdaw Mail — Compose");
  // Пока renderer перезагружается, в BrowserWindow оставался старый
  // просмотр письма. Из-за этого пользователь видел заголовок Compose,
  // но продолжал видеть письмо и воспринимал ответ как не сработавший.
  // Скрываем окно до полной загрузки нового renderer и возвращаем его
  // только после did-finish-load, чтобы переход был атомарным визуально.
  entry.window.hide();
  const hash = new URLSearchParams({
    jpcSecret: currentJPCSecret,
    composeWindow: windowID,
  }).toString();
  void (async () => {
    try {
      // Одной перезагрузки недостаточно: при ошибке навигации Electron мог
      // оставить старый DOM окна просмотра. Сначала уничтожаем старую
      // страницу невидимым переходом на about:blank, затем загружаем форму
      // ответа и только после этого возвращаем окно пользователю.
      await entry.window.loadURL("about:blank");
      await loadRendererWindow(entry.window, hash);
      if (!entry.window.isDestroyed()) {
        entry.window.show();
        entry.window.focus();
      }
    } catch (ex) {
      console.error("Compose window failed to replace message window", ex);
      // Нельзя показывать старый просмотрщик под заголовком Compose. Если
      // новая страница не загрузилась, закрываем только это повреждённое
      // переходом окно; владелец удалит соответствующий compose-app через
      // обычное событие закрытия окна.
      if (!entry.window.isDestroyed()) {
        entry.window.close();
      }
    }
  })();
  return true;
}

function createComposeWindow(windowID: string, payload: ComposeWindowMail): void {
  if (!currentJPCSecret) {
    return;
  }
  const composeWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 520,
    minHeight: 360,
    show: false,
    title: "Jackdaw Mail — Compose",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  });
  setupSpellcheckContextMenu(composeWindow);
  restrictWindowNavigation(composeWindow);
  registerComposeWindow(windowID, payload, composeWindow);
  composeWindow.once("ready-to-show", () => {
    if (!composeWindow.isDestroyed()) {
      composeWindow.show();
      composeWindow.focus();
    }
  });
  composeWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error("Compose window failed to load", errorCode, errorDescription);
    }
  });
  const hash = new URLSearchParams({
    jpcSecret: currentJPCSecret,
    composeWindow: windowID,
  }).toString();
  void loadRendererWindow(composeWindow, hash).catch(console.error);
}

function createMessageWindow(windowID: string, payload: MessageWindowPayload): void {
  if (!currentJPCSecret) {
    return;
  }
  const messageWindow = new BrowserWindow({
    width: 1_100,
    height: 760,
    minWidth: 560,
    minHeight: 400,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    title: messageWindowTitle(payload),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      webviewTag: true,
    },
  });
  setupSpellcheckContextMenu(messageWindow);
  restrictWindowNavigation(messageWindow);
  messageWindows.set(windowID, { window: messageWindow, payload });
  messageWindow.on("closed", () => {
    if (messageWindows.get(windowID)?.window === messageWindow) {
      messageWindows.delete(windowID);
      notifyMessageWindowClosed(windowID);
    }
  });
  messageWindow.once("ready-to-show", () => {
    if (!messageWindow.isDestroyed()) {
      messageWindow.show();
      messageWindow.focus();
    }
  });
  messageWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error("Message window failed to load", errorCode, errorDescription);
    }
  });
  const hash = new URLSearchParams({
    jpcSecret: currentJPCSecret,
    messageWindow: windowID,
  }).toString();
  void loadRendererWindow(messageWindow, hash).catch(console.error);
}

ipcMain.on(composeWindowOpenChannel, (event, windowID: unknown, payload: unknown) => {
  if (!isPrimaryRenderer(event.sender) || !isComposeWindowID(windowID) ||
      !isComposeWindowPayload(payload) || payload.windowID !== windowID) {
    return;
  }
  if (replaceMessageWindowWithComposeWindow(windowID, payload)) {
    return;
  }
  const existing = composeWindows.get(windowID);
  if (existing && !existing.window.isDestroyed()) {
    existing.payload = payload;
    existing.window.show();
    existing.window.focus();
    return;
  }
  composeWindows.delete(windowID);
  createComposeWindow(windowID, payload);
});

ipcMain.on(messageWindowOpenChannel, (event, windowID: unknown, payload: unknown) => {
  if (!isPrimaryRenderer(event.sender) || !isMessageWindowID(windowID) ||
      !isMessageWindowPayload(payload) ||
      payload.windowID !== windowID) {
    return;
  }
  const existing = messageWindows.get(windowID);
  if (existing && !existing.window.isDestroyed()) {
    existing.payload = payload;
    existing.window.setTitle(messageWindowTitle(payload));
    existing.window.show();
    existing.window.focus();
    return;
  }
  messageWindows.delete(windowID);
  createMessageWindow(windowID, payload);
});

ipcMain.on(composeWindowFocusChannel, (event, windowID: unknown) => {
  if (!isPrimaryRenderer(event.sender) || !isComposeWindowID(windowID)) {
    return;
  }
  const composeWindow = composeWindows.get(windowID)?.window;
  if (!composeWindow || composeWindow.isDestroyed()) {
    return;
  }
  if (composeWindow.isMinimized()) {
    composeWindow.restore();
  }
  composeWindow.show();
  composeWindow.focus();
});

ipcMain.on(messageWindowFocusChannel, (event, windowID: unknown) => {
  if (!isPrimaryRenderer(event.sender) || !isMessageWindowID(windowID)) {
    return;
  }
  const messageWindow = messageWindows.get(windowID)?.window;
  if (!messageWindow || messageWindow.isDestroyed()) {
    return;
  }
  if (messageWindow.isMinimized()) {
    messageWindow.restore();
  }
  messageWindow.show();
  messageWindow.focus();
});

ipcMain.on(composeWindowCloseChannel, (event, windowID: unknown) => {
  if (!isComposeWindowID(windowID)) {
    return;
  }
  const entry = composeWindows.get(windowID);
  if (!entry || entry.window.isDestroyed() ||
      (event.sender !== entry.window.webContents && !isPrimaryRenderer(event.sender))) {
    return;
  }
  entry.window.close();
});

ipcMain.on(messageWindowCloseChannel, (event, windowID: unknown) => {
  if (!isMessageWindowID(windowID)) {
    return;
  }
  const entry = messageWindows.get(windowID);
  if (!entry || entry.window.isDestroyed() ||
      (event.sender !== entry.window.webContents && !isPrimaryRenderer(event.sender))) {
    return;
  }
  entry.window.close();
});

ipcMain.on(messageWindowReplyChannel, (event, windowID: unknown, mode: unknown) => {
  if (!isMessageWindowID(windowID) || !isMessageWindowReplyMode(mode)) {
    return;
  }
  const entry = messageWindows.get(windowID);
  const window = primaryWindow;
  if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender ||
      !window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(
    messageWindowReplyRequestChannel,
    windowID,
    mode as MessageWindowReplyMode,
    entry.payload,
  );
});

ipcMain.handle(composeWindowDataChannel, (event, windowID: unknown): ComposeWindowMail | null => {
  if (!isComposeWindowID(windowID)) {
    return null;
  }
  const entry = composeWindows.get(windowID);
  if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender) {
    return null;
  }
  return entry.payload;
});

ipcMain.handle(
  messageWindowDataChannel,
  (event, windowID: unknown): MessageWindowPayload | null => {
    if (!isMessageWindowID(windowID)) {
      return null;
    }
    const entry = messageWindows.get(windowID);
    if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender) {
      return null;
    }
    return entry.payload;
  },
);

ipcMain.handle(composeWindowSendChannel, (event, windowID: unknown, payload: unknown): Promise<ComposeWindowSendResult> => {
  if (!isComposeWindowID(windowID) || !isComposeWindowPayload(payload) || payload.windowID !== windowID) {
    return Promise.resolve({ ok: false, errorMessage: "Invalid compose window data" });
  }
  const entry = composeWindows.get(windowID);
  if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender) {
    return Promise.resolve({ ok: false, errorMessage: "Compose window is unavailable" });
  }
  return forwardComposeWindowSend(windowID, payload);
});

ipcMain.on(composeWindowSendResponseChannel, (event, requestID: unknown, result: unknown) => {
  if (!isPrimaryRenderer(event.sender) || typeof requestID !== "string" ||
      !isComposeWindowSendResult(result)) {
    return;
  }
  const pending = pendingComposeWindowSends.get(requestID);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingComposeWindowSends.delete(requestID);
  pending.resolve(result);
});

ipcMain.handle(composeWindowSearchContactsChannel, (event, windowID: unknown, searchText: unknown): Promise<ComposeWindowPerson[]> => {
  if (!isComposeWindowID(windowID) || typeof searchText !== "string" || searchText.length > kComposeWindowSearchTextMaxLength) {
    return Promise.resolve([]);
  }
  const entry = composeWindows.get(windowID);
  if (!entry || entry.window.isDestroyed() || entry.window.webContents !== event.sender) {
    return Promise.resolve([]);
  }
  return forwardComposeWindowContactSearch(windowID, searchText);
});

ipcMain.on(composeWindowSearchContactsResponseChannel, (event, requestID: unknown, result: unknown) => {
  if (!isPrimaryRenderer(event.sender) || typeof requestID !== "string" ||
      !isComposeWindowPersonArray(result)) {
    return;
  }
  const pending = pendingComposeWindowSearches.get(requestID);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingComposeWindowSearches.delete(requestID);
  pending.resolve(result);
});

async function createWindow(): Promise<void> {
  try {
    const jpcSecret = createJPCSecret();
    currentJPCSecret = jpcSecret;
    try {
      await startupBackend(jpcSecret);
    } catch (ex) {
      console.error("Backend startup failed; frontend will retry JPC connection", ex);
    }

    // Создаём главное окно приложения.
    const mainWindow = new BrowserWindow({
      width: 1700,
      height: 950,
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: process.platform == 'darwin' ? 'hiddenInset' : 'customButtonsOnHover',
      titleBarOverlay: true,
      frame: false,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        sandbox: false,
        webviewTag: true,
        backgroundThrottling: false,
      }
    })
    primaryWindow = mainWindow;
    mainWindow.webContents.on('did-finish-load', () => {
      const action = pendingNativeMenuActions.get(mainWindow);
      if (!action) {
        return;
      }
      pendingNativeMenuActions.delete(mainWindow);
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(nativeMenuActionChannel, action);
        }
      }, 0);
    });
    setMainWindow(mainWindow);

    if (process.platform == "linux" && app.commandLine.getSwitchValue("ozone-platform") == "wayland") {
      // The "ready-to-show" event doesn't always fire on Wayland.
      // "did-finish-load" works and is close enough.
      // https://github.com/electron/electron/issues/48859
      mainWindow.webContents.on("did-finish-load", () => {
        if (!isDemoModeRequested()) {
          mainWindow.show();
        }
      });
    } else {
      mainWindow.on("ready-to-show", () => {
        if (!isDemoModeRequested()) {
          mainWindow.show();
        }
      });
    }

    // Во время звонка renderer отменяет `beforeunload` (MeetBackground.svelte). Без этого обработчика
    // Electron молча не закрыл бы окно; здесь спрашиваем пользователя, завершить ли звонок.
    mainWindow.webContents.on('will-prevent-unload', event => {
      if (isQuittingForUpdate()) {
        // Установку обновления запустил сам пользователь: не мешаем выходу.
        event.preventDefault();
        return;
      }
      // Подписи на языке интерфейса передаёт рендерер (nativeDialogs.ts), до этого — по языку системы
      const labels = nativeDialogLabels();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: [labels.endCallAndClose, labels.stayInCall],
        defaultId: 1,
        cancelId: 1,
        title: 'Jackdaw Mail',
        message: labels.callInProgress,
        detail: labels.callCloseDetail,
      });
      if (choice === 0) {
        // preventDefault() здесь разрешает закрытие, вопреки отмене в renderer.
        event.preventDefault();
      }
    });

    mainWindow.on('closed', () => {
      failPendingComposeWindowSends("Main window is unavailable");
      failPendingComposeWindowSearches();
      closeComposeWindows();
      closeMessageWindows();
      currentJPCSecret = null;
      shutdownBackend().catch(console.error);
    });
    mainWindow.on('closed', () => {
      if (primaryWindow === mainWindow) {
        primaryWindow = null;
      }
    });

    /** Ensure that new web windows are opened in the browser, not inside our app.
     *
     * Attention: This does *not* catch normal `<a href="">` links.
     * Thus, sanitizeHTML() adds a `target="_blank"` to such links,
     * which is considered a new web window and forces them to end up here. */
    mainWindow.webContents.setWindowOpenHandler((details) => {
      // Chrome special-cases "about:blank". Make *sure* that we don't get this here.
      // Allow windows opened by us for OAuth2
      // Must match OAuth2Window.ts login()
      if (details?.features?.includes("oauth2popup")) {
        if (!details.url?.startsWith("https://")) {
          return { action: 'deny' };
        }
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            center: true,
            webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
          },
        };
      }
      if (!isExternalLinkURL(details.url)) {
        return { action: 'deny' };
      }
      // Open the URL in the system web browser
      shell.openExternal(details.url)
        .catch(console.error); // must return the action synchronously
      // ... and do not open a new Electron window
      return { action: 'deny' }
    })

    setupSpellcheckContextMenu(mainWindow);
    restrictWindowNavigation(mainWindow);

    mainWindow.webContents.on('did-create-window', (child, details) => {
      connectOAuth2Window(mainWindow, child, details.frameName, ipcMain);
    });

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    // The `try` above cannot catch these, because they fail asynchronously
    let rendererHash = 'jpcSecret=' + jpcSecret;
    if (isDemoModeRequested()) {
      rendererHash += '&demo=1';
    }
    void loadRendererWindow(mainWindow, rendererHash).catch(console.error);
  } catch (ex) {
    console.error(ex);
  }
}

function sendNativeMenuAction(action: NativeMenuAction): void {
  const window = primaryWindow && !primaryWindow.isDestroyed()
    ? primaryWindow
    : BrowserWindow.getFocusedWindow();
  if (!window || window.isDestroyed()) {
    return;
  }
  if (window.webContents.isLoadingMainFrame()) {
    pendingNativeMenuActions.set(window, action);
    return;
  }
  setTimeout(() => {
    if (!window.isDestroyed()) {
      window.webContents.send(nativeMenuActionChannel, action);
    }
  }, 0);
}

function menuItem(
  label: string,
  action: NativeMenuAction,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => sendNativeMenuAction(action),
  };
}

function createMenu() {
  const labels = currentNativeMenuLabels;
  const macAppMenu: MenuItemConstructorOptions = {
    label: app.getName(),
    submenu: [
      { role: 'about', label: labels.about },
      { type: 'separator' },
      { role: 'services', label: labels.services, submenu: [] },
      { type: 'separator' },
      { role: 'hide', label: labels.hide },
      { role: 'hideOthers', label: labels.hideOthers },
      { role: 'unhide', label: labels.showAll },
      { type: 'separator' },
      { role: 'quit', label: labels.quit },
    ],
  };
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [macAppMenu] : []),
    {
      label: labels.file,
      submenu: [
        {
          label: labels.new,
          submenu: [
            menuItem(labels.email, nativeMenuActions.newEmail, 'CommandOrControl+N'),
            menuItem(labels.calendarEvent, nativeMenuActions.newEvent, 'CommandOrControl+Alt+N'),
            menuItem(labels.contact, nativeMenuActions.newContact),
          ],
        },
        { type: 'separator' },
        { role: 'close', label: labels.close },
      ],
    },
    {
      label: labels.edit,
      submenu: [
        { role: 'undo', label: labels.undo },
        { role: 'redo', label: labels.redo },
        { type: 'separator' },
        { role: 'cut', label: labels.cut },
        { role: 'copy', label: labels.copy },
        { role: 'paste', label: labels.paste },
        { role: 'selectAll', label: labels.selectAll },
      ],
    },
    {
      label: labels.view,
      submenu: [
        menuItem(labels.mail, nativeMenuActions.openMail, 'CommandOrControl+1'),
        menuItem(labels.calendar, nativeMenuActions.openCalendar, 'CommandOrControl+2'),
        menuItem(labels.contacts, nativeMenuActions.openContacts, 'CommandOrControl+3'),
        menuItem(labels.files, nativeMenuActions.openFiles, 'CommandOrControl+4'),
        menuItem(labels.chat, nativeMenuActions.openChat, 'CommandOrControl+5'),
        menuItem(labels.reports, nativeMenuActions.openReports, 'CommandOrControl+6'),
        { type: 'separator' },
        {
          label: labels.search,
          submenu: [
            menuItem(labels.currentApp, nativeMenuActions.focusSearch, 'CommandOrControl+K'),
            menuItem(labels.mail, nativeMenuActions.searchMail),
            menuItem(labels.calendar, nativeMenuActions.searchCalendar),
            menuItem(labels.contacts, nativeMenuActions.searchContacts),
            menuItem(labels.files, nativeMenuActions.searchFiles),
            menuItem(labels.chat, nativeMenuActions.searchChat),
          ],
        },
        { type: 'separator' },
        // В выпуске DevTools не открываются: консоль окна имеет полный доступ к backend
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: labels.toggleDevTools } as MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'resetZoom', label: labels.resetZoom },
        { role: 'zoomIn', label: labels.zoomIn },
        { role: 'zoomOut', label: labels.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: labels.fullscreen }
      ]
    },
    {
      label: labels.message,
      submenu: [
        menuItem(labels.reply, nativeMenuActions.reply, 'CommandOrControl+R'),
        menuItem(labels.replyAll, nativeMenuActions.replyAll, 'CommandOrControl+Shift+R'),
        menuItem(labels.forward, nativeMenuActions.forward),
        { type: 'separator' },
        menuItem(labels.markReadUnread, nativeMenuActions.toggleRead),
        menuItem(labels.archive, nativeMenuActions.archive),
        menuItem(labels.delete, nativeMenuActions.delete),
      ],
    },
    {
      label: labels.tools,
      submenu: [
        menuItem(labels.getMail, nativeMenuActions.getMail, 'CommandOrControl+Shift+M'),
        menuItem(labels.settings, nativeMenuActions.openSettings, 'CommandOrControl+,'),
      ],
    },
    {
      label: labels.window,
      submenu: [
        { role: 'minimize', label: labels.minimize },
        { role: 'zoom', label: labels.zoom },
        { type: 'separator' },
        { role: 'front', label: labels.front },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function setupSpellcheckContextMenu(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on("context-menu", (event, params) => {
    if (!params.isEditable || !params.misspelledWord) {
      return;
    }
    event.preventDefault();

    void showSpellcheckContextMenu(mainWindow, params);
  });
}

async function showSpellcheckContextMenu(
  mainWindow: BrowserWindow,
  params: ContextMenuParams,
): Promise<void> {
  const suggestions = await getSpellcheckSuggestions(
    params.misspelledWord,
    params.dictionarySuggestions,
  );
  let menuItems: MenuItemConstructorOptions[] = suggestions.map((suggestion, index) => ({
    id: `spellcheckerSuggestion${index}`,
    label: suggestion,
    click: (): void => mainWindow.webContents.replaceMisspelling(suggestion),
  }));
  if (suggestions.length) {
    menuItems.push({ type: "separator" });
  }
  menuItems.push({
    id: "spellcheckerAddToDictionary",
    label: "Add word to dictionary",
    click: (): void => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
  });
  Menu.buildFromTemplate(menuItems).popup({ window: mainWindow, frame: params.frame });
}

let owaSessionsReleased = false;

async function releaseOWASessionsOnQuit(): Promise<void> {
  if (owaSessionsReleased) {
    return;
  }
  owaSessionsReleased = true;
  const { shutdownAllOWASessions } = await import('../../backend/owa');
  await shutdownAllOWASessions();
}

app.on("before-quit", event => {
  if (isQuittingForUpdate()) {
    return;
  }
  if (owaSessionsReleased) {
    return;
  }
  event.preventDefault();
  void handleBeforeQuit();
});

async function handleBeforeQuit() {
  try {
    // Без сети (VPN выключен) выход из OWA висел без ограничения, и приложение
    // не закрывалось. Ждём не дольше нескольких секунд.
    await Promise.race([
      releaseOWASessionsOnQuit(),
      new Promise<void>(resolve => setTimeout(resolve, kOWALogoffOnQuitTimeoutMs)),
    ]);
  } catch (ex) {
    console.error(ex);
  }
  app.quit();
}

const kOWALogoffOnQuitTimeoutMs = 3_000;

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.whenReady()
    .then(whenReady)
    .catch(console.error);
} else {
  // This is a second instance
  app.quit();
  // Event 'second-instance' will be called within the primary instance
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
async function whenReady() {
  // Set app user model id for MS Windows
  // <https://learn.microsoft.com/en-us/windows/win32/shell/appids>
  electronApp.setAppUserModelId('app.jackdaw');

  // Remove exec path
  handleCommandline(process.argv.splice(1));

  allowCrossDomainRequestsFromFrontend();
  installPermissionHandlers(session.defaultSession);
  app.on('session-created', installPermissionHandlers);
  installSignalServiceCATrust(); // renderer's HTTPS REST to *.signal.org (the wss socket runs in the backend with its own CA)

  installTestProfileGuards();
  createMenu();
  await createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error);
    }
  })

const kBackgroundUpdateCheckMs = 4 * 60 * 60 * 1000; // every 4 hours

  try {
    await prepareUpdaterAuth();
    await checkForUpdateAndNotify();
    setInterval(async () => {
      try {
        if (updateState.haveUpdate) {
          return;
        }
        if (updateState.phase === "checking" || updateState.phase === "available" || updateState.phase === "downloading" || updateState.phase === "downloaded") {
          return;
        }
        await checkForUpdateAndNotify(true);
      } catch (ex) {
        console.error(ex);
      }
    }, kBackgroundUpdateCheckMs);
  } catch (ex) {
    console.error(ex);
  }
}

app.on('web-contents-created', (_event, webContents) => {
  setWindowOpenHandler(webContents);
  // В <webview> показывается недоверенный контент: Node.js и preload ему не положены,
  // даже если атрибуты тега будут подменены.
  webContents.on('will-attach-webview', (attachEvent, webPreferences, params) => {
    delete webPreferences.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    if (!isAllowedWebViewSource(params.src)) {
      console.error('Blocked <webview> with source', params.src?.slice(0, 100));
      attachEvent.preventDefault();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: Capture URL during launch
app.on("open-url", (_event, url) => {
  startupArgs.url = url;
  startupArgs.notifyObservers();

  if (BrowserWindow.getAllWindows().length == 0 && app.isReady()) {
    createWindow().catch(console.error);
  }
});
// macOS: Capture file open during launch
app.on("open-file", (_event, file) => {
  startupArgs.file = file;
  startupArgs.notifyObservers();

  if (BrowserWindow.getAllWindows().length == 0 && app.isReady()) {
    createWindow().catch(console.error);
  }
});

/** Called within the primary instance when a second instance of our app was called. */
app.on("second-instance", (_, argv) => {
  // Remove executable path and "--allow-file-access-from-files"
  handleCommandline(argv.splice(2));
  // Повторный запуск должен показать уже открытое окно, даже свёрнутое
  if (primaryWindow && !primaryWindow.isDestroyed()) {
    if (primaryWindow.isMinimized()) {
      primaryWindow.restore();
    }
    primaryWindow.show();
    primaryWindow.focus();
  }
});

function handleCommandline(args: string[]) {
  try {
    console.log("commandline arguments", args);
    startupArgs.commandline = args;
    let lastArg = args[args.length - 1];
    if (lastArg?.includes(":") && !/^[a-zA-Z]:[\\/]/.test(lastArg)) {
      let urlObj = new URL(lastArg); // Check syntax
      startupArgs.url = urlObj.href;
    }
    // Путь к файлу: `/…` на macOS/Linux, `C:\…` или `\\server\…` на Windows.
    // Путь Windows похож на URL со схемой `c:`, поэтому выше он не разбирается как URL.
    let isFilePath = !!lastArg && /^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(lastArg) && lastArg.includes(".");
    if (isFilePath) {
      startupArgs.file = lastArg;
    }
    startupArgs.notifyObservers();
  } catch (ex) {
    console.error(ex);
  }
}

function allowCrossDomainRequestsFromFrontend() {
  const filter = { urls: ["https://*/*", "http://*/*"] };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      // Только запросы самого интерфейса. Письма в <webview>, виджеты и прочие страницы
      // не получают обход CORS: иначе их скрипты читали бы ответы роутера и сервисов на localhost.
      if (!isAppRendererContents(details.webContents)) {
        callback({});
        return;
      }
      let requestHeaders = details.requestHeaders ?? {};
      for (let name in requestHeaders) {
        switch (name.toLowerCase()) {
        case "origin":
        case "referer":
          delete requestHeaders[name];
          break;
        case "cookie-bypass":
          // Fake out the Cookie on all ActiveSync requests, because Hotmail.
          requestHeaders.Cookie = requestHeaders[name];
          delete requestHeaders[name];
          break;
        case "user-agent":
          // Fake out the User-Agent on all ActiveSync requests, because Office.
          if (details.url.toLowerCase().includes("/microsoft-server-activesync")) {
            requestHeaders[name] = requestHeaders[name].replace(/\).*/, ") Gecko/20100101");
          }
          break;
        }
      }
      callback({ requestHeaders: requestHeaders });
    }
  );
  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      if (!isAppRendererContents(details.webContents)) {
        callback({});
        return;
      }
      let responseHeaders = details.responseHeaders ?? {};
      // Remove server response
      for (let name in responseHeaders) {
        let lowercase = name.toLowerCase();
        if (lowercase.startsWith("access-control-allow-")) {
          delete responseHeaders[name];
        }
      }
      // Allow frontend to access other servers
      responseHeaders["Access-Control-Allow-Origin"] = ["*"];
      responseHeaders["Access-Control-Allow-Methods"] = ["*"];
      responseHeaders["Access-Control-Allow-Headers"] = ["*"];
      responseHeaders["Access-Control-Expose-Headers"] = ["*"];
      // Pretend that all CORS preflight requests succeed
      let statusLine = details.method == "OPTIONS" ? "HTTP/1.1 200 OK" : details.statusLine;
      // console.log("Response", details.url, responseHeaders);
      callback({ responseHeaders, statusLine });
    }
  );
}

/** Окно с интерфейсом приложения (главное, письмо, черновик), а не гостевая страница */
function isAppRendererContents(webContents: WebContents | undefined | null): boolean {
  return !!webContents && !webContents.isDestroyed() &&
    webContents.getType() == 'window' && isAppRendererURL(webContents.getURL());
}

/** Что разрешено страницам веб-приложений и виджетов в их собственных сессиях (`persist:…`).
 * Геолокация, чтение буфера обмена, USB/HID/serial и прочее — нет. */
const kWebAppPermissions = new Set([
  'notifications', 'fullscreen', 'media', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection',
]);

function isPermissionAllowed(webContents: WebContents | null, permission: string, ses: Electron.Session): boolean {
  if (isAppRendererContents(webContents)) {
    return true;
  }
  // Письма, приглашения и сообщения чата в <webview> без своей сессии: им ничего не положено
  if (ses == session.defaultSession) {
    return permission == 'fullscreen';
  }
  return kWebAppPermissions.has(permission);
}

const permissionHandledSessions = new WeakSet<Electron.Session>();

/** Electron по умолчанию молча разрешает всё (камера, микрофон, геолокация, буфер обмена, устройства) */
function installPermissionHandlers(ses: Electron.Session): void {
  if (permissionHandledSessions.has(ses) || isTestProfile()) {
    return;
  }
  permissionHandledSessions.add(ses);
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isPermissionAllowed(webContents, permission, ses));
  });
  ses.setPermissionCheckHandler((webContents, permission) => {
    return isPermissionAllowed(webContents, permission, ses);
  });
  ses.setDevicePermissionHandler(() => false);
}

function setWindowOpenHandler(webContents: WebContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (webContents.getType() == "webview" && isExternalLinkURL(url)) {
      shell.openExternal(url).catch(console.error);
    }
    return { action: 'deny' };
  });
}

/** <webview> показывает письма (blob:), веб-приложения и виджеты (http/https), но не файлы с диска */
export function isAllowedWebViewSource(src: string | undefined): boolean {
  return !src || /^(?:https?:|blob:|about:blank$)/i.test(src);
}

function isExternalLinkURL(url: string | undefined): boolean {
  return !!url && /^(?:https?|mailto|tel):/i.test(url);
}

/** Окна приложения с preload и JPC-секретом показывают только собственный интерфейс.
 * Переход верхнего фрейма на чужой адрес (meta refresh из вставленного HTML, брошенный в окно файл)
 * загрузил бы внешнюю страницу с доступом к preload, поэтому он отменяется,
 * а веб-ссылка открывается в браузере. Загрузки через loadURL/loadFile эти события не вызывают. */
function restrictWindowNavigation(window: BrowserWindow): void {
  const blockForeignNavigation = (details: { url: string; isMainFrame: boolean; preventDefault: () => void }): void => {
    // Переходы и редиректы внутри iframe не дают доступа к preload, их не трогаем.
    if (!details.isMainFrame || isAppRendererURL(details.url)) {
      return;
    }
    details.preventDefault();
    if (isExternalLinkURL(details.url)) {
      shell.openExternal(details.url).catch(console.error);
    }
  };
  window.webContents.on('will-navigate', blockForeignNavigation);
  window.webContents.on('will-redirect', blockForeignNavigation);
}

function isAppRendererURL(url: string): boolean {
  try {
    const target = new URL(url);
    if (is.dev) {
      return target.origin == 'http://localhost:5454';
    }
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      return target.origin == new URL(process.env['ELECTRON_RENDERER_URL']).origin;
    }
    return target.protocol == 'file:' && target.pathname == pathToFileURL(join(__dirname, '../renderer/index.html')).pathname;
  } catch {
    return false;
  }
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
