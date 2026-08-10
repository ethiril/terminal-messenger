const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { loadAppConfig, isAllowedMessengerUrl } = require('./shell/app-config');
const { buildApplicationMenu } = require('./shell/application-menu');
const { createMessengerWindow } = require('./shell/messenger-window');
const { loadStoredSettings, saveStoredSettings } = require('./shell/settings-store');
const { bindWebContentsGuards } = require('./shell/web-contents-guards');

const SESSION_PARTITION = 'persist:terminal-messenger';
const SAFE_PERMISSIONS = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'];
const MIN_OPACITY_PCT = 20;
const MAX_OPACITY_PCT = 100;
const DEBUG_EVAL_POLL_MS = 400;

const appConfig = loadAppConfig();
let storedSettings = {};

function configurePersistentSession() {
  const persistentSession = session.fromPartition(SESSION_PARTITION);
  persistentSession.setPermissionRequestHandler((webContents, permission, callback) => {
    /* mic/camera is granted only to pages actually served from an allowed
       messenger host - without it every call prompt was auto-denied and
       Messenger calls just silently failed. scoping by URL keeps any other
       document that ends up in this session (an oauth hop, an embedded
       frame) from inheriting the grant. */
    if (permission === 'media') {
      callback(isAllowedMessengerUrl(webContents.getURL(), appConfig.allowedHosts));
      return;
    }
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

  /* synchronous on purpose: preload needs the live values before first paint,
     and the argv snapshot it would otherwise use is frozen at window-creation
     time - so any in-session reload (the hourly refresh, cmd-R) reverted
     theme/density/font to whatever they were at launch. the payload is a
     handful of scalars. */
  ipcMain.on('tm:get-settings', (event) => {
    event.returnValue = storedSettings;
  });

  ipcMain.handle('tm:save-settings', (_event, partial) => {
    if (!partial || typeof partial !== 'object') return false;
    storedSettings = { ...storedSettings, ...partial };
    return saveStoredSettings(storedSettings);
  });
}

/* consent gate for the debug bridge below. an env var on its own is too weak a
   trigger for something this privileged: a leftover export in a shell profile,
   an inherited environment from a launcher, or a sourced dotfile would all arm
   it silently, and the person at the keyboard would never know their open
   conversations were being evaluated and screenshotted. so we ask, and we ask
   before the first eval rather than after.

   the grant is per launch and deliberately not persisted - there is no "don't
   ask again", because the whole point is that arming it stays a conscious act.
   quitting the app revokes it. */
function confirmDebugEvalBridge(evalFilePath, parentWindow) {
  const choice = dialog.showMessageBoxSync(parentWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Enable debug bridge'],
    defaultId: 0,
    /* cancel is the default and the escape route: a stray return key or a
       dismissed dialog must leave the bridge off, never on. */
    cancelId: 0,
    noLink: true,
    title: 'Enable debug eval bridge?',
    message: 'TM_DEBUG_EVAL_FILE is set. Enable the debug eval bridge?',
    detail:
      `Watching: ${evalFilePath}\n\n` +
      'While this is enabled, anything written to that file runs as JavaScript ' +
      'inside your logged-in Messenger session. Results are written to ' +
      `${evalFilePath}.out and a screenshot of the window to ${evalFilePath}.png ` +
      'after every run.\n\n' +
      'Commands are not sandboxed and are not limited to reading. Anything you ' +
      'could do in this window a command can do too, including typing in the ' +
      'composer and sending messages as you. Results and screenshots are written ' +
      'to disk unencrypted.\n\n' +
      'Only enable this if you set the variable yourself for development.\n\n' +
      'This choice is not remembered - quitting the app turns the bridge off again.'
  });
  return choice === 1;
}

/* dev-only live-debug bridge, enabled by TM_DEBUG_EVAL_FILE=<path> and by the
   consent dialog above. polls the file; when its contents change, runs them as
   JS in the messenger renderer, writes the result to <path>.out and a window
   screenshot to <path>.png. lets layout work be inspected and iterated against
   the real fb DOM from a terminal without devtools.

   inert unless the env var is set, and inert unless the dialog is accepted, so
   a shipped build with neither does none of this. */
function setupDebugEvalBridge(messengerWindow) {
  const evalFilePath = process.env.TM_DEBUG_EVAL_FILE;
  if (!evalFilePath) return;
  if (!confirmDebugEvalBridge(evalFilePath, messengerWindow)) {
    console.warn('[terminal-messenger] debug eval bridge declined - TM_DEBUG_EVAL_FILE ignored for this launch');
    return;
  }
  const fs = require('node:fs');
  let lastEvalContent = '';
  const pollTimer = setInterval(async () => {
    /* the window can go away mid-poll (cmd-Q, window closed); stop the timer
       rather than let executeJavaScript throw on a dead webContents. */
    if (messengerWindow.isDestroyed()) { clearInterval(pollTimer); return; }
    let content;
    /* a missing file is the normal state before the first command is written,
       so an unreadable path is a skip, not an error. */
    try { content = fs.readFileSync(evalFilePath, 'utf8'); } catch { return; }
    /* we poll far faster than commands arrive, so only a *change* counts as a
       new command - otherwise one written command would re-run several times a
       second for as long as it sat in the file. */
    if (!content.trim() || content === lastEvalContent) return;
    /* recorded before the eval runs, not after: a command that throws must not
       be retried on every subsequent tick. */
    lastEvalContent = content;
    try {
      /* userGesture=true so gesture-gated APIs (focus, clipboard, media) behave
         the same as they would under a real click. */
      const result = await messengerWindow.webContents.executeJavaScript(content, true);
      fs.writeFileSync(
        `${evalFilePath}.out`,
        typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? String(result)
      );
    } catch (error) {
      /* failures go to the same .out file the caller is already tailing -
         a silent failure looks identical to a hung command from there. */
      fs.writeFileSync(`${evalFilePath}.out`, `ERROR: ${error.message}`);
    }
    /* screenshot after every command: the reason for the bridge is checking how
       something *looks*, which the return value alone can't answer. best-effort
       because capturePage fails on a minimised or offscreen window. */
    try {
      const image = await messengerWindow.webContents.capturePage();
      fs.writeFileSync(`${evalFilePath}.png`, image.toPNG());
    } catch {}
  }, DEBUG_EVAL_POLL_MS);
}

app.whenReady().then(() => {
  storedSettings = loadStoredSettings();
  buildApplicationMenu(appConfig);
  configurePersistentSession();
  registerIpcHandlers();
  /* must be registered before the first window is created - popups opened by
     fb (calls, oauth dialogs) previously got no nav guards, no context menu
     and no shortcut pipeline at all. */
  app.on('web-contents-created', (_event, webContents) => {
    bindWebContentsGuards(webContents, appConfig);
  });
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
