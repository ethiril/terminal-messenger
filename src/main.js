const { app, BrowserWindow, ipcMain, session } = require('electron');
const { loadAppConfig } = require('./shell/app-config');
const { buildApplicationMenu } = require('./shell/application-menu');
const { createMessengerWindow } = require('./shell/messenger-window');
const { loadStoredSettings, saveStoredSettings } = require('./shell/settings-store');

const SESSION_PARTITION = 'persist:terminal-messenger';
const SAFE_PERMISSIONS = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'];
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;

const appConfig = loadAppConfig();
let storedSettings = {};

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

  ipcMain.handle('tm:save-settings', (_event, partial) => {
    if (!partial || typeof partial !== 'object') return false;
    storedSettings = { ...storedSettings, ...partial };
    return saveStoredSettings(storedSettings);
  });
}

/* dev-only live-debug bridge, enabled by TM_DEBUG_EVAL_FILE=<path>. polls
   the file; when its contents change, runs them as JS in the messenger
   renderer, writes the result to <path>.out and a window screenshot to
   <path>.png. lets layout work be inspected/iterated against the real fb
   DOM from a terminal without devtools. inert unless the env var is set. */
function setupDebugEvalBridge(messengerWindow) {
  const evalFilePath = process.env.TM_DEBUG_EVAL_FILE;
  if (!evalFilePath) return;
  const fs = require('node:fs');
  let lastEvalContent = '';
  const pollTimer = setInterval(async () => {
    if (messengerWindow.isDestroyed()) { clearInterval(pollTimer); return; }
    let content;
    try { content = fs.readFileSync(evalFilePath, 'utf8'); } catch { return; }
    if (!content.trim() || content === lastEvalContent) return;
    lastEvalContent = content;
    try {
      const result = await messengerWindow.webContents.executeJavaScript(content, true);
      fs.writeFileSync(
        `${evalFilePath}.out`,
        typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? String(result)
      );
    } catch (error) {
      fs.writeFileSync(`${evalFilePath}.out`, `ERROR: ${error.message}`);
    }
    try {
      const image = await messengerWindow.webContents.capturePage();
      fs.writeFileSync(`${evalFilePath}.png`, image.toPNG());
    } catch {}
  }, 400);
}

app.whenReady().then(() => {
  storedSettings = loadStoredSettings();
  buildApplicationMenu(appConfig);
  configurePersistentSession();
  registerIpcHandlers();
  const messengerWindow = createMessengerWindow(appConfig, SESSION_PARTITION, storedSettings);
  setupDebugEvalBridge(messengerWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMessengerWindow(appConfig, SESSION_PARTITION, storedSettings);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
