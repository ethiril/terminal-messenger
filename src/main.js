const { app, BrowserWindow, ipcMain, session } = require('electron');
const { loadAppConfig } = require('./shell/app-config');
const { buildApplicationMenu } = require('./shell/application-menu');
const { createMessengerWindow } = require('./shell/messenger-window');

const SESSION_PARTITION = 'persist:terminal-messenger';
const SAFE_PERMISSIONS = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'];
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;

const appConfig = loadAppConfig();

function configurePersistentSession() {
  const persistentSession = session.fromPartition(SESSION_PARTITION);
  persistentSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(SAFE_PERMISSIONS.includes(permission));
  });
}

function clampOpacityPct(rawPct) {
  const numeric = Number(rawPct);
  if (!Number.isFinite(numeric)) return MAX_OPACITY_PCT;
  return Math.min(MAX_OPACITY_PCT, Math.max(MIN_OPACITY_PCT, Math.round(numeric)));
}

function registerIpcHandlers() {
  ipcMain.handle('tm:set-opacity', (event, rawPct) => {
    const clampedPct = clampOpacityPct(rawPct);
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.setOpacity(clampedPct / 100);
    }
    return clampedPct;
  });

  ipcMain.handle('tm:set-muted', (event, muted) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) return false;
    const desiredMuted = Boolean(muted);
    targetWindow.webContents.setAudioMuted(desiredMuted);
    return desiredMuted;
  });

  ipcMain.handle('tm:toggle-muted', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow || targetWindow.isDestroyed()) return false;
    const nextMuted = !targetWindow.webContents.isAudioMuted();
    targetWindow.webContents.setAudioMuted(nextMuted);
    return nextMuted;
  });
}

app.whenReady().then(() => {
  buildApplicationMenu(appConfig);
  configurePersistentSession();
  registerIpcHandlers();
  createMessengerWindow(appConfig, SESSION_PARTITION);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMessengerWindow(appConfig, SESSION_PARTITION);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
