import { setMainWindow, startupBackend, shutdownBackend, startupArgs, updateState, checkForUpdateAndNotify, createJPCSecret, isQuittingForUpdate, prepareUpdaterAuth } from '../../backend/backend';
import { app, shell, BrowserWindow, session, Menu, MenuItemConstructorOptions, type ContextMenuParams, type WebContents } from 'electron'
import { ipcMain } from 'electron/main';
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import { installSignalServiceCATrust } from './signalServiceCA'
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

let primaryWindow: BrowserWindow | null = null;
let currentJPCSecret: string | null = null;
const composeWindows = new Map<string, { window: BrowserWindow; payload: ComposeWindowMail }>();
const kComposeWindowRequestTimeoutMS = 60_000;
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
const nativeMenuLabelKeys = Object.keys(currentNativeMenuLabels) as (keyof NativeMenuLabels)[];

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
    }, kComposeWindowRequestTimeoutMS);
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

function loadRendererWindow(window: BrowserWindow, hash: string): void {
  if (is.dev) {
    window.loadURL('http://localhost:5454/#' + hash)
      .catch(console.error);
  } else if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#' + hash)
      .catch(console.error);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
      .catch(console.error);
  }
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
  const entry = { window: composeWindow, payload };
  composeWindows.set(windowID, entry);
  composeWindow.on("closed", () => {
    if (composeWindows.get(windowID)?.window === composeWindow) {
      composeWindows.delete(windowID);
      notifyComposeWindowClosed(windowID);
    }
  });
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
  loadRendererWindow(composeWindow, hash);
}

ipcMain.on(composeWindowOpenChannel, (event, windowID: unknown, payload: unknown) => {
  if (!isPrimaryRenderer(event.sender) || !isComposeWindowID(windowID) ||
      !isComposeWindowPayload(payload) || payload.windowID !== windowID) {
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
        mainWindow.show();
      });
    } else {
      mainWindow.on("ready-to-show", () => {
        mainWindow.show();
      });
    }

    mainWindow.on('closed', () => {
      failPendingComposeWindowSends("Main window is unavailable");
      failPendingComposeWindowSearches();
      closeComposeWindows();
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

    mainWindow.webContents.on('did-create-window', (child, details) => {
      connectOAuth2Window(mainWindow, child, details.frameName, ipcMain);
    });

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    // The `try` above cannot catch these, because they fail asynchronously
    loadRendererWindow(mainWindow, 'jpcSecret=' + jpcSecret);
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
        { role: 'toggleDevTools', label: labels.toggleDevTools },
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
    await releaseOWASessionsOnQuit();
  } catch (ex) {
    console.error(ex);
  }
  app.quit();
}

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
  installSignalServiceCATrust(); // renderer's HTTPS REST to *.signal.org (the wss socket runs in the backend with its own CA)

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

app.on('web-contents-created', (_event, webContents) => setWindowOpenHandler(webContents));

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
});

function handleCommandline(args: string[]) {
  try {
    console.log("commandline arguments", args);
    startupArgs.commandline = args;
    let lastArg = args[args.length - 1];
    if (lastArg?.includes(":")) {
      let urlObj = new URL(lastArg); // Check syntax
      startupArgs.url = urlObj.href;
    }
    if (lastArg?.startsWith("/") && lastArg.includes(".")) {
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

function setWindowOpenHandler(webContents: WebContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (webContents.getType() == "webview" && isExternalLinkURL(url)) {
      shell.openExternal(url).catch(console.error);
    }
    return { action: 'deny' };
  });
}

function isExternalLinkURL(url: string | undefined): boolean {
  return !!url && /^(?:https?|mailto|tel):/i.test(url);
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
