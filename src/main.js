const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT_DIRECTORY = path.join(__dirname, '..');
const APP_CONFIG_PATH = path.join(APP_ROOT_DIRECTORY, 'config', 'app.json');
const TERMINAL_CSS_PATH = path.join(__dirname, 'inject', 'terminal.css');
const TERMINAL_SCRIPT_PATH = path.join(__dirname, 'inject', 'terminal.js');
const PRELOAD_SCRIPT_PATH = path.join(__dirname, 'preload.js');
const SESSION_PARTITION = 'persist:terminal-messenger';
const FIRST_PAINT_FALLBACK_MS = 5000;

const FALLBACK_APP_CONFIG = {
  homeUrl: 'https://www.facebook.com/messages',
  allowedHosts: ['facebook.com', 'www.facebook.com', 'messenger.com', 'www.messenger.com'],
  theme: 'green',
  compactByDefault: true,
  window: { width: 1280, height: 860 }
};

const SAFE_PERMISSIONS = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'];

function readTextFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Could not read ${filePath}:`, error);
    return null;
  }
}

function loadAppConfig() {
  const fileContents = readTextFileOrNull(APP_CONFIG_PATH);
  if (!fileContents) return FALLBACK_APP_CONFIG;

  try {
    const userConfig = JSON.parse(fileContents);
    return { ...FALLBACK_APP_CONFIG, ...userConfig };
  } catch (error) {
    console.error(`Could not parse ${APP_CONFIG_PATH}, using defaults:`, error);
    return FALLBACK_APP_CONFIG;
  }
}

const appConfig = loadAppConfig();

function isAllowedMessengerUrl(candidateUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return false;

  return appConfig.allowedHosts.some((allowedHost) =>
    parsedUrl.hostname === allowedHost || parsedUrl.hostname.endsWith(`.${allowedHost}`)
  );
}

async function injectTerminalLayer(targetWindow) {
  if (targetWindow.isDestroyed()) return false;
  if (!isAllowedMessengerUrl(targetWindow.webContents.getURL())) return false;

  const terminalCss = readTextFileOrNull(TERMINAL_CSS_PATH);
  const terminalScript = readTextFileOrNull(TERMINAL_SCRIPT_PATH);
  if (!terminalCss || !terminalScript) return false;

  const userPreferences = JSON.stringify({
    theme: appConfig.theme,
    compactByDefault: Boolean(appConfig.compactByDefault)
  });
  const bootstrapScript = `window.__TERMINAL_MESSENGER_CONFIG__ = ${userPreferences};\n${terminalScript}`;

  try {
    await targetWindow.webContents.insertCSS(terminalCss, { cssOrigin: 'user' });
    await targetWindow.webContents.executeJavaScript(bootstrapScript, true);
    return true;
  } catch (error) {
    console.error('Failed to inject terminal layer:', error);
    return false;
  }
}

function runRendererAction(targetWindow, methodName) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.webContents
    .executeJavaScript(`window.TerminalMessenger?.${methodName}?.()`)
    .catch((error) => console.error(`renderer action '${methodName}' failed:`, error));
}

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
  if (isAlt && pressedKey === 'left') return (win) => { if (win.webContents.canGoBack()) win.webContents.goBack(); };
  if (isAlt && pressedKey === 'right') return (win) => { if (win.webContents.canGoForward()) win.webContents.goForward(); };

  return null;
}

function createMessengerWindow() {
  const messengerWindow = new BrowserWindow({
    width: appConfig.window?.width ?? FALLBACK_APP_CONFIG.window.width,
    height: appConfig.window?.height ?? FALLBACK_APP_CONFIG.window.height,
    minWidth: 900,
    minHeight: 600,
    title: 'Terminal Messenger',
    backgroundColor: '#050805',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      partition: SESSION_PARTITION,
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
    if (isAllowedMessengerUrl(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  messengerWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMessengerUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  messengerWindow.on('page-title-updated', (event, updatedTitle) => {
    event.preventDefault();
    const unreadMatch = updatedTitle?.match(/\((\d+)\)/);
    const unreadSuffix = unreadMatch ? ` (${unreadMatch[1]})` : '';
    messengerWindow.setTitle(`Terminal Messenger${unreadSuffix}`);
  });

  messengerWindow.webContents.on('dom-ready', async () => {
    const injectionSucceeded = await injectTerminalLayer(messengerWindow);
    if (injectionSucceeded) showOnceReady();
  });
  messengerWindow.webContents.on('did-navigate-in-page', () => injectTerminalLayer(messengerWindow));
  messengerWindow.webContents.on('did-finish-load', async () => {
    await injectTerminalLayer(messengerWindow);
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

function buildApplicationMenu() {
  const menuTemplate = [
    {
      label: 'Terminal Messenger',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'openPalette')
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'toggleTheme')
        },
        {
          label: 'Toggle Ultra Terminal Mode',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'toggleUltra')
        },
        {
          label: 'Search Chats',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_menuItem, focusedWindow) => runRendererAction(focusedWindow, 'openSearchOverlay')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+H',
          click: (_menuItem, focusedWindow) => focusedWindow?.loadURL(appConfig.homeUrl)
        },
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goBack()
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: (_menuItem, focusedWindow) => focusedWindow?.webContents.goForward()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.whenReady().then(() => {
  buildApplicationMenu();

  const persistentSession = session.fromPartition(SESSION_PARTITION);
  persistentSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(SAFE_PERMISSIONS.includes(permission));
  });

  createMessengerWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMessengerWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
