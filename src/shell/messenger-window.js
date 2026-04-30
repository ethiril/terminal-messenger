const path = require('node:path');
const { BrowserWindow, shell } = require('electron');
const { isAllowedMessengerUrl } = require('./app-config');
const { injectTerminalLayer } = require('./injection-bundle');
const { runRendererAction } = require('./renderer-bridge');

const PRELOAD_SCRIPT_PATH = path.join(__dirname, '..', 'preload.js');
const FIRST_PAINT_FALLBACK_MS = 5000;

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
  if (isAlt && pressedKey === 'left') return (win) => { if (win.webContents.canGoBack()) win.webContents.goBack(); };
  if (isAlt && pressedKey === 'right') return (win) => { if (win.webContents.canGoForward()) win.webContents.goForward(); };

  return null;
}

function formatTitleWithUnreadCount(updatedTitle) {
  const unreadMatch = updatedTitle?.match(/\((\d+)\)/);
  return unreadMatch ? `Terminal Messenger (${unreadMatch[1]})` : 'Terminal Messenger';
}

function createMessengerWindow(appConfig, sessionPartition) {
  const windowSize = appConfig.window ?? {};
  const messengerWindow = new BrowserWindow({
    width: windowSize.width ?? 1280,
    height: windowSize.height ?? 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Terminal Messenger',
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
      preload: PRELOAD_SCRIPT_PATH
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  messengerWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMessengerUrl(url, appConfig.allowedHosts)) return;
    event.preventDefault();
    shell.openExternal(url);
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

  messengerWindow.loadURL(appConfig.homeUrl);
  return messengerWindow;
}

module.exports = { createMessengerWindow };
