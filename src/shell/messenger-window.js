const path = require('node:path');
const { BrowserWindow, shell } = require('electron');
const { isAllowedMessengerUrl } = require('./app-config');
const { injectTerminalLayer } = require('./injection-bundle');
const { runRendererAction } = require('./renderer-bridge');

const PRELOAD_SCRIPT_PATH = path.join(__dirname, '..', 'preload.js');
const FIRST_PAINT_FALLBACK_MS = 5000;

/* gate shell.openExternal on http/https: a `javascript:` or custom-scheme URL
   reaching openExternal would be handed to the OS, which may pass it to a
   browser that interprets it. fb shouldn't emit such links, but our allowed-
   host rejection path is the catch-all and must stay safe. */
function safeOpenExternal(url) {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
}
/* fb messenger leaks renderer memory over long sessions (large react tree,
   scroll-virtualised log backbuffer, retained media). reload every hour
   while the window is unfocused so we never interrupt active typing. */
const RENDERER_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/* this is the main-process keyboard pipeline (Electron's
   before-input-event). it duplicates inject/terminal.js handleKeyboardShortcut
   on purpose: the main-process one fires even if the renderer's JS is
   stalled or hasn't finished injecting. when adding/changing a shortcut,
   update BOTH pipelines or one of the two firing paths will silently miss. */
function shortcutHandlerFor(input) {
  const pressedKey = input.key?.toLowerCase();
  if (!pressedKey) return null;

  const isPrimaryModifier = process.platform === 'darwin' ? input.meta : input.control;
  const isShift = Boolean(input.shift);
  const isAlt = Boolean(input.alt);

  if (isPrimaryModifier && !isShift && pressedKey === 'r') return (win) => win.reload();
  if (isPrimaryModifier && isShift && pressedKey === 'i') return (win) => win.webContents.toggleDevTools();
  if (isPrimaryModifier && isShift && pressedKey === 't') return (win) => runRendererAction(win, 'toggleTheme');
  if (isPrimaryModifier && isShift && pressedKey === 'p') return (win) => runRendererAction(win, 'openPalette');
  if (isPrimaryModifier && isShift && pressedKey === 'u') return (win) => runRendererAction(win, 'toggleUltra');
  if (isPrimaryModifier && isShift && pressedKey === 's') return (win) => runRendererAction(win, 'openSearchOverlay');
  if (isPrimaryModifier && isShift && pressedKey === 'm') return (win) => runRendererAction(win, 'toggleMuted');
  if (isPrimaryModifier && isShift && pressedKey === 'y') return (win) => runRendererAction(win, 'toggleThemeDisabled');
  /* Electron reports arrow keys as 'ArrowLeft'/'ArrowRight' (KeyboardEvent.key
     semantics); accept the bare names too in case a build reports them. */
  if (isAlt && (pressedKey === 'arrowleft' || pressedKey === 'left')) {
    return (win) => { if (win.webContents.canGoBack()) win.webContents.goBack(); };
  }
  if (isAlt && (pressedKey === 'arrowright' || pressedKey === 'right')) {
    return (win) => { if (win.webContents.canGoForward()) win.webContents.goForward(); };
  }

  return null;
}

function formatTitleWithUnreadCount(updatedTitle) {
  const unreadMatch = updatedTitle?.match(/\((\d+)\)/);
  return unreadMatch ? `Messenger (${unreadMatch[1]})` : 'Messenger';
}

function createMessengerWindow(appConfig, sessionPartition, storedSettings = {}) {
  const windowSize = appConfig.window ?? {};
  /* additionalArguments lands in process.argv inside the sandboxed preload,
     letting us hand persisted theme/opacity to the early-paint code without
     a sync IPC round-trip. encoded as base64 so the JSON survives the
     command-line tokeniser (quotes, spaces) intact. */
  const encodedSettings = Buffer.from(JSON.stringify(storedSettings), 'utf8').toString('base64');
  const messengerWindow = new BrowserWindow({
    width: windowSize.width ?? 1280,
    height: windowSize.height ?? 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Messenger',
    backgroundColor: '#050805',
    autoHideMenuBar: true,
    show: false,
    /* drop the macOS gray title bar; statusline takes over as drag handle */
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      partition: sessionPartition,
      preload: PRELOAD_SCRIPT_PATH,
      additionalArguments: [`--tm-stored-settings=${encodedSettings}`]
    }
  });

  let firstPaintShown = false;
  function showOnceReady() {
    if (firstPaintShown || messengerWindow.isDestroyed()) return;
    firstPaintShown = true;
    messengerWindow.show();
  }
  setTimeout(showOnceReady, FIRST_PAINT_FALLBACK_MS);

  messengerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedMessengerUrl(url, appConfig.allowedHosts)) return { action: 'allow' };
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  messengerWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMessengerUrl(url, appConfig.allowedHosts)) return;
    event.preventDefault();
    safeOpenExternal(url);
  });

  messengerWindow.on('page-title-updated', (event, updatedTitle) => {
    event.preventDefault();
    messengerWindow.setTitle(formatTitleWithUnreadCount(updatedTitle));
  });

  messengerWindow.webContents.on('dom-ready', async () => {
    const injectionSucceeded = await injectTerminalLayer(messengerWindow, appConfig);
    if (injectionSucceeded) showOnceReady();
  });
  messengerWindow.webContents.on('did-navigate-in-page', () => injectTerminalLayer(messengerWindow, appConfig));
  messengerWindow.webContents.on('did-finish-load', async () => {
    await injectTerminalLayer(messengerWindow, appConfig);
    showOnceReady();
  });

  messengerWindow.webContents.on('before-input-event', (event, input) => {
    const handler = shortcutHandlerFor(input);
    if (!handler) return;
    handler(messengerWindow);
    event.preventDefault();
  });

  const refreshInterval = setInterval(() => {
    if (messengerWindow.isDestroyed()) return;
    if (messengerWindow.isFocused()) return;
    messengerWindow.webContents.reload();
  }, RENDERER_REFRESH_INTERVAL_MS);
  messengerWindow.on('closed', () => clearInterval(refreshInterval));

  messengerWindow.loadURL(appConfig.homeUrl);
  return messengerWindow;
}

module.exports = { createMessengerWindow };
