const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(APP_ROOT, 'config', 'app.json');
const TERMINAL_CSS_PATH = path.join(__dirname, 'inject', 'terminal.css');
const TERMINAL_JS_PATH = path.join(__dirname, 'inject', 'terminal.js');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${filePath}:`, error);
    return fallback;
  }
}

const config = readJson(CONFIG_PATH, {
  homeUrl: 'https://www.facebook.com/messages',
  allowedHosts: ['facebook.com', 'www.facebook.com', 'messenger.com', 'www.messenger.com'],
  theme: 'green',
  compactByDefault: true,
  window: { width: 1280, height: 860 }
});

function isAllowedMessengerUrl(input) {
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    return config.allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function getInjectionBundle() {
  const css = fs.readFileSync(TERMINAL_CSS_PATH, 'utf8');
  const js = fs.readFileSync(TERMINAL_JS_PATH, 'utf8');
  const bootstrap = `window.__TERMINAL_MESSENGER_CONFIG__ = ${JSON.stringify({
    theme: config.theme || 'green',
    compactByDefault: Boolean(config.compactByDefault)
  })};\n${js}`;

  return { css, js: bootstrap };
}

async function injectTerminalLayer(win) {
  if (win.isDestroyed()) return;

  const currentUrl = win.webContents.getURL();
  if (!isAllowedMessengerUrl(currentUrl)) return;

  try {
    const { css, js } = getInjectionBundle();
    await win.webContents.insertCSS(css, { cssOrigin: 'user' });
    await win.webContents.executeJavaScript(js, true);
  } catch (error) {
    console.error('Failed to inject terminal layer:', error);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: config.window?.width || 1280,
    height: config.window?.height || 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Terminal Messenger',
    backgroundColor: '#050805',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      partition: 'persist:terminal-messenger'
    }
  });

  win.loadURL(config.homeUrl);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedMessengerUrl(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedMessengerUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on('dom-ready', () => injectTerminalLayer(win));
  win.webContents.on('did-navigate-in-page', () => injectTerminalLayer(win));
  win.webContents.on('did-finish-load', () => injectTerminalLayer(win));

  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase();
    const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;

    if (ctrlOrCmd && key === 'r') {
      win.reload();
      event.preventDefault();
    }

    if (ctrlOrCmd && input.shift && key === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }

    if (ctrlOrCmd && input.shift && key === 't') {
      win.webContents.executeJavaScript('window.TerminalMessenger?.toggleTheme?.()').catch(() => {});
      event.preventDefault();
    }

    if (ctrlOrCmd && input.shift && key === 'p') {
      win.webContents.executeJavaScript('window.TerminalMessenger?.openPalette?.()').catch(() => {});
      event.preventDefault();
    }

    if (input.alt && key === 'left') {
      if (win.webContents.canGoBack()) win.webContents.goBack();
      event.preventDefault();
    }

    if (input.alt && key === 'right') {
      if (win.webContents.canGoForward()) win.webContents.goForward();
      event.preventDefault();
    }
  });

  return win;
}

function createMenu() {
  const template = [
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
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+P', click: (_, win) => win?.webContents.executeJavaScript('window.TerminalMessenger?.openPalette?.()') },
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+T', click: (_, win) => win?.webContents.executeJavaScript('window.TerminalMessenger?.toggleTheme?.()') },
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
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: (_, win) => win?.loadURL(config.homeUrl) },
        { label: 'Back', accelerator: 'Alt+Left', click: (_, win) => win?.webContents.goBack() },
        { label: 'Forward', accelerator: 'Alt+Right', click: (_, win) => win?.webContents.goForward() }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createMenu();

  const ses = session.fromPartition('persist:terminal-messenger');
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission);
    callback(allowed);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
